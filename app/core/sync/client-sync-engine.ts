import { isHistoryProtocolBoundary, protocolPauseId } from './history-incarnation';
import { liveQuery } from 'dexie';
/**
 * Sync Engine Plugin
 *
 * Bootstraps the sync engine when an authenticated session is active.
 * Client-only plugin that starts/stops sync based on session state.
 */
import { createGatewaySyncProvider } from '~/core/sync/providers/gateway-sync-provider';
import {
    registerSyncProvider,
    getActiveSyncProvider,
    setActiveSyncProvider,
} from '~/core/sync/sync-provider-registry';
import { getHookBridge, cleanupHookBridge } from '~/core/sync/hook-bridge';
import { OutboxManager } from '~/core/sync/outbox-manager';
import { createSubscriptionManager, cleanupSubscriptionManager, getScopeKey } from '~/core/sync/subscription-manager';
import { GcManager } from '~/core/sync/gc-manager';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { createWorkspaceDb, rebindWorkspaceDb, getActiveWorkspaceId as getActiveDbWorkspaceId, type Or3DB } from '~/db/client';
import { getCachedSessionContext, useSessionContext } from '~/composables/auth/useSessionContext';
import { startCoordinatedSubscription } from './subscription-coordinator';
import { useAuthTokenBroker, type AuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { getLocalWorkspaceSession } from '~/composables/auth/useLocalWorkspaceSession';
import { getOfflineWorkspace } from '~/composables/auth/offline-workspace';
import { watch, effectScope } from 'vue';
import { hasCloudAccess, useCloudAccess } from '~/core/cloud/access';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';

/** Sync engine state */
interface SyncEngineState {
    db: Or3DB;
    provider: SyncProvider;
    scope: SyncScope;
    hookBridge: ReturnType<typeof getHookBridge>;
    outboxManager: OutboxManager;
    subscriptionManager: ReturnType<typeof createSubscriptionManager>;
    stopSubscription: () => Promise<void>;
    gcManager: GcManager;
}

let engineState: SyncEngineState | null = null;
let authRetryTimeout: ReturnType<typeof setTimeout> | null = null;
const AUTH_RETRY_DELAYS = [500, 1000, 2000, 5000];
let authTokenBroker: AuthTokenBroker | null = null;
let desiredScope: SyncScope | null = null;
// Role/membership changes keep the scope but must restart authorized transport.
let desiredAuthorizationRevision: number | undefined;
let lifecycleGeneration = 0;
let lifecycleQueue: Promise<void> = Promise.resolve();
let reconcilePending = false;
let cancelStartup: (() => Promise<void>) | null = null;

function clearAuthRetry(): void {
    if (authRetryTimeout) clearTimeout(authRetryTimeout);
    authRetryTimeout = null;
}

function scheduleAuthRetry(scope: SyncScope, generation: number, attempt = 1): void {
    clearAuthRetry();
    authRetryTimeout = setTimeout(() => {
        authRetryTimeout = null;
        if (generation !== lifecycleGeneration) return;
        void requestEngine(scope, true, desiredAuthorizationRevision).catch(error => {
            console.error('[sync-engine] Auth retry failed:', error);
            if (generation === lifecycleGeneration) scheduleAuthRetry(scope, generation, attempt + 1);
        });
    }, AUTH_RETRY_DELAYS[Math.min(attempt - 1, AUTH_RETRY_DELAYS.length - 1)] ?? 5000);
}

async function hasDirectProviderToken(provider: SyncProvider): Promise<boolean> {
    if (provider.mode !== 'direct' || !provider.auth) return true;
    if (!authTokenBroker) return false;
    let cancel!: () => Promise<void>;
    const cancelled = new Promise<boolean>(resolve => {
        cancel = async () => { resolve(false); };
    });
    // SDK token lookups do not expose an AbortSignal. Let a newer lifecycle
    // request release this wait without waiting for the old SDK to settle.
    cancelStartup = cancel;
    try {
        return Boolean(await Promise.race([authTokenBroker.getProviderToken({
            providerId: provider.auth.providerId, template: provider.auth.template,
        }), cancelled]));
    } catch { return false; }
    finally { if (cancelStartup === cancel) cancelStartup = null; }
}

/**
 * Capture belongs to the active DB, even while an Admin route pauses
 * transport. Workspace/account departure and DB eviction release it.
 */
function releaseCapture(dbName: string, scope: SyncScope): void {
    const session = getLocalWorkspaceSession();
    if (getActiveDbWorkspaceId() !== scope.workspaceId || !session?.authenticated
        || session.user?.id !== scope.principalId) cleanupHookBridge(dbName);
}

async function disposeEngine(state: SyncEngineState): Promise<void> {
    state.outboxManager.stop();
    state.gcManager.stop();
    try {
        await state.stopSubscription();
    } finally {
        try { await state.provider.dispose(); }
        catch (error) { console.warn('[sync-engine] Provider dispose failed:', error); }
        cleanupSubscriptionManager(getScopeKey(state.scope));
        cleanupCursorManager(state.db.name, state.scope);
        releaseCapture(state.db.name, state.scope);
    }
}

/** Serialize all ownership changes; only the newest desired scope may publish. */
function requestEngine(scope: SyncScope | null, force = false, authorizationRevision?: number): Promise<void> {
    const same = (scope ? getScopeKey(scope) : null) ===
        (desiredScope ? getScopeKey(desiredScope) : null)
        && authorizationRevision === desiredAuthorizationRevision;
    if (!force && same && (reconcilePending || (scope ? engineState !== null : engineState === null))) {
        return lifecycleQueue;
    }
    desiredScope = scope;
    desiredAuthorizationRevision = authorizationRevision;
    const generation = ++lifecycleGeneration;
    clearAuthRetry();
    // Abort network/bootstrap immediately, before waiting for the serialized
    // teardown. A hanging old request must never hold a workspace switch hostage.
    void cancelStartup?.().catch(error => console.warn('[sync-engine] Startup cancellation failed:', error));
    reconcilePending = true;
    const operation = lifecycleQueue.catch(() => {}).then(async () => {
        if (generation !== lifecycleGeneration) return;
        if (engineState) {
            const previous = engineState;
            engineState = null;
            await disposeEngine(previous);
        }
        if (!scope || generation !== lifecycleGeneration) return;
        const provider = getActiveSyncProvider();
        if (!provider || !await hasDirectProviderToken(provider)) {
            if (generation === lifecycleGeneration) scheduleAuthRetry(scope, generation);
            return;
        }
        if (generation !== lifecycleGeneration) return;
        let db = createWorkspaceDb(scope.workspaceId);
        if (provider.capabilities?.historyIncarnation !== 'v1') throw new Error('Selected sync mode requires separate history incarnation qualification');
        await db.transaction('rw', ['sync_state'], async () => {
            if (!await db.sync_state.get('sync_history')) await db.sync_state.put({ id: 'sync_history',
                historyIncarnation: null, phase: 'unbound', resetTarget: null, cursor: 0, deviceId: '', lastSyncAt: 0 });
        });
        if (db.syncHistoryAtOpen === undefined) db.syncHistoryAtOpen = (await db.sync_state.get('sync_history'))?.historyIncarnation ?? null;
        const guard = await db.sync_state.get('sync_history');
        if (guard?.phase === 'ready' && guard.historyIncarnation !== db.syncHistoryAtOpen) {
            db = await rebindWorkspaceDb(scope.workspaceId, db);
        }
        if (generation !== lifecycleGeneration) return;
        const hookBridge = getHookBridge(db);
        hookBridge.start();
        const refreshHistory = liveQuery(() => db.sync_state.get('sync_history')).subscribe(guard => {
            if (generation !== lifecycleGeneration || guard?.phase !== 'ready' || guard.historyIncarnation === db.syncHistoryAtOpen) return;
            refreshHistory.unsubscribe();
            void requestEngine(scope, true, authorizationRevision).catch(error => {
                console.error('[sync-engine] History rebind failed:', error);
            });
        });
        const subscriptionManager = createSubscriptionManager(db, provider, scope);
        const cancel = () => subscriptionManager.stop();
        cancelStartup = cancel;
        let stopSubscription: (() => Promise<void>) | undefined;
        try {
            stopSubscription = provider.mode === 'gateway'
                ? await startCoordinatedSubscription(JSON.stringify([db.name, provider.id, scope]), subscriptionManager)
                : await (async () => {
                    await subscriptionManager.start();
                    return () => subscriptionManager.stop();
                })();
            if (generation !== lifecycleGeneration) {
                refreshHistory.unsubscribe();
                await stopSubscription();
                cleanupSubscriptionManager(getScopeKey(scope));
                cleanupCursorManager(db.name, scope);
                releaseCapture(db.name, scope);
                return;
            }
            const outboxManager = new OutboxManager(db, provider, scope);
            outboxManager.start();
            const gcManager = new GcManager(db, provider, scope);
            gcManager.start();
            engineState = { db, provider, scope, hookBridge, outboxManager,
                subscriptionManager, stopSubscription: async () => { refreshHistory.unsubscribe(); await stopSubscription!(); }, gcManager };
        } catch (error) {
            refreshHistory.unsubscribe();
            await (stopSubscription ? stopSubscription() : subscriptionManager.stop());
            cleanupSubscriptionManager(getScopeKey(scope));
            cleanupCursorManager(db.name, scope);
            releaseCapture(db.name, scope);
            if (generation === lifecycleGeneration && !isHistoryProtocolBoundary(error)) scheduleAuthRetry(scope, generation);
            throw error;
        } finally {
            if (cancelStartup === cancel) cancelStartup = null;
        }
    });
    lifecycleQueue = operation;
    void operation.finally(() => {
        if (lifecycleQueue === operation) reconcilePending = false;
    }).catch(() => {});
    return operation;
}

async function startSyncEngine(
    workspaceId: string,
    principalId = getCachedSessionContext()?.user?.id,
    authorizationRevision = getCachedSessionContext()?.authorizationRevision,
): Promise<void> {
    if (getOfflineWorkspace() || !hasCloudAccess()) return stopSyncEngine();
    const generation = lifecycleGeneration;
    // Explicit retry of a storage-paused subscription retains its staged chain.
    // A healthy same-scope start remains idempotent; auth changes still reconcile.
    const retry = !reconcilePending && desiredScope?.workspaceId === workspaceId && desiredScope.principalId === principalId &&
        engineState?.scope.workspaceId === workspaceId && engineState.scope.principalId === principalId &&
        desiredAuthorizationRevision === authorizationRevision && (engineState.subscriptionManager.getStatus() === 'error' ||
            !!(await engineState.db.sync_state.get(protocolPauseId(engineState.provider.id, engineState.scope)))?.protocolPause);
    // A newer workspace/account/stop request owns the lifecycle after this read.
    if (generation !== lifecycleGeneration) return lifecycleQueue;
    return requestEngine({ workspaceId, ...(principalId ? { principalId } : {}) }, retry, authorizationRevision);
}

function stopSyncEngine(): Promise<void> {
    return requestEngine(null);
}

export async function setupSyncEngine(): Promise<void> {
    // Only run on client
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    const publicConfig = runtimeConfig.public as {
        admin?: { basePath?: string };
        sync?: { enabled?: boolean; provider?: string };
        gzipRequests?: boolean;
    };
    // Admin pages are currently mounted at `/admin/*` (canonical).
    // `admin.basePath` is treated as an alias that redirects to `/admin/*`.
    const defaultAdminBasePath = '/admin';
    const adminBasePath = publicConfig.admin?.basePath || defaultAdminBasePath;

    function isPrefix(path: string, base: string): boolean {
        if (base === '/') return true;
        if (path === base) return true;
        return path.startsWith(`${base}/`);
    }

    function isAdminPath(path: string): boolean {
        return (
            isPrefix(path, defaultAdminBasePath) || isPrefix(path, adminBasePath)
        );
    }

    function getCurrentPath(): string {
        if (typeof window === 'undefined') return '/';
        return window.location.pathname || '/';
    }

    if (!publicConfig.sync?.enabled) {
        if (import.meta.dev) console.log('[sync-engine] Sync disabled, skipping sync');
        return;
    }

    const providerId = publicConfig.sync.provider ?? 'gateway';
    const ssrAuthEnabled = Boolean(runtimeConfig.public.ssrAuthEnabled);
    if (ssrAuthEnabled) {
        try {
            if (!getActiveSyncProvider()) {
                const gatewayProvider = createGatewaySyncProvider({ id: providerId, gzipRequests: publicConfig.gzipRequests === true });
                registerSyncProvider(gatewayProvider);
            }
            setActiveSyncProvider(providerId);
            if (import.meta.dev) {
                console.log('[sync-engine] Registered gateway sync provider:', providerId);
            }
        } catch (error) {
            console.error('[sync-engine] Failed to register sync provider:', error);
            return;
        }
    } else {
        const existing = getActiveSyncProvider();
        if (!existing || existing.mode !== 'direct') {
            if (import.meta.dev) {
                console.log('[sync-engine] Direct sync provider not registered, skipping');
            }
            return;
        }
        setActiveSyncProvider(existing.id);
    }
    authTokenBroker = useAuthTokenBroker();

    // Watch for session changes
    const { data: sessionData } = useSessionContext();
    const { activeWorkspaceId } = useWorkspaceManager();
    const nuxtApp = useNuxtApp();
    const router = useRouter();
    const accessScope = effectScope();
    const cloudEnabled = accessScope.run(() => useCloudAccess())!;

    function getRoutePathSafe(): string {
        const maybeRouter = router as unknown as { currentRoute?: { value?: { path?: unknown } } };
        const raw = maybeRouter.currentRoute?.value?.path;
        if (typeof raw === 'string') return raw;
        return getCurrentPath();
    }

    function updateSyncForRouteAndSession(
        workspaceId: string | null,
        path: string,
        authenticated: boolean,
        principalId?: string,
        authorizationRevision?: number,
        cloudEnabled = true
    ): void {
        const isAdmin = isAdminPath(path);
        // Capture local edits even on Free Local, including after a reload. Only
        // transport is paused; upgrade snapshots must preserve this local intent.
        if (workspaceId && authenticated) {
            getHookBridge(createWorkspaceDb(workspaceId)).start({ coalesceUnsent: !cloudEnabled });
        }

        if (isAdmin) {
            // Admin routes shouldn't run the user sync engine (heavy + irrelevant).
            // Keep the active workspace DB intact; clobbering it causes authenticated
            // users to fall back to `or3-db` and leak local state into cloud sessions.
            if (authRetryTimeout) {
                clearTimeout(authRetryTimeout);
                authRetryTimeout = null;
            }
            void stopSyncEngine().catch((error) => {
                console.error('[sync-engine] Failed to stop sync engine:', error);
            });
            return;
        }

        // Manage sync engine based on workspace ID AND authentication status
        // Note: Workspace DB switching is handled separately by useWorkspaceManager
        // in 00-workspace-db.client.ts. This function only starts/stops the sync engine.
        if (workspaceId && authenticated && cloudEnabled) {
            void startSyncEngine(workspaceId, principalId, authorizationRevision).catch((error) => {
                console.error('[sync-engine] Failed to start sync engine:', error);
            });
        } else {
            if (authRetryTimeout) {
                clearTimeout(authRetryTimeout);
                authRetryTimeout = null;
            }
            void stopSyncEngine().catch((error) => {
                console.error('[sync-engine] Failed to stop sync engine:', error);
            });
        }
    }

    const stopWatch = watch(
        () => ({
            workspaceId: activeWorkspaceId.value,
            path: getRoutePathSafe(),
            authenticated: sessionData.value?.session?.authenticated === true
                && sessionData.value.appAccessAllowed !== false
                && (!ssrAuthEnabled || sessionData.value.session.workspace?.id === activeWorkspaceId.value),
            principalId: sessionData.value?.session?.user?.id,
            authorizationRevision: sessionData.value?.session?.authorizationRevision,
            cloudEnabled: cloudEnabled.value,
        }),
        ({ workspaceId, path, authenticated, principalId, authorizationRevision, cloudEnabled }) =>
            updateSyncForRouteAndSession(workspaceId, path, authenticated, principalId, authorizationRevision, cloudEnabled),
        { immediate: true }
    );

    // Expose sync control functions for advanced callers
    // Expose sync control functions
    nuxtApp.provide('syncEngine', {
        start: startSyncEngine,
        stop: stopSyncEngine,
        isRunning: () => engineState !== null,
        flush: async () => {
            if (engineState?.outboxManager) {
                return engineState.outboxManager.flush();
            }
            return false;
        },
        retryFailed: async () => {
            if (engineState?.outboxManager) {
                await engineState.outboxManager.retryFailed();
            }
        },
        /** Set aside corrupt queued ops (preserved, and rebuilt from local rows where unambiguous). */
        quarantineCorruptOps: async () => {
            return engineState?.outboxManager.quarantineCorruptOps() ?? { quarantined: 0, repaired: 0 };
        },
        getQuarantined: async () => engineState?.outboxManager.getQuarantined() ?? [],
        exportQuarantined: async () => engineState?.outboxManager.exportQuarantined() ?? null,
        discardQuarantined: async (id: string) => engineState?.outboxManager.discardQuarantined(id) ?? false,
    });

    const dispose = () => { stopWatch(); accessScope.stop(); void stopSyncEngine(); };
    nuxtApp.vueApp.onUnmount(dispose);

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            dispose();
        });
    }
}
