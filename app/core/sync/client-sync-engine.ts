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
import { createSubscriptionManager, cleanupSubscriptionManager } from '~/core/sync/subscription-manager';
import { GcManager } from '~/core/sync/gc-manager';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { createWorkspaceDb, getActiveWorkspaceId as getActiveDbWorkspaceId, type Or3DB } from '~/db/client';
import { getCachedSessionContext, useSessionContext } from '~/composables/auth/useSessionContext';
import { startCoordinatedSubscription } from './subscription-coordinator';
import { useAuthTokenBroker, type AuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { watch } from 'vue';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';

/** Sync engine state */
interface SyncEngineState {
    db: Or3DB;
    target: SyncTarget;
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
interface SyncTarget {
    workspaceId: string;
    userId: string | null;
    authorizationRevision?: number;
}
let desiredTarget: SyncTarget | null = null;
let lifecycle: Promise<void> = Promise.resolve();
let authTokenBroker: AuthTokenBroker | null = null;

function sameTarget(left: SyncTarget | null, right: SyncTarget | null): boolean {
    return left === right || Boolean(left && right && left.workspaceId === right.workspaceId
        && left.userId === right.userId && left.authorizationRevision === right.authorizationRevision);
}

function clearAuthRetry(): void {
    if (authRetryTimeout) clearTimeout(authRetryTimeout);
    authRetryTimeout = null;
}

function scheduleAuthRetry(workspaceId: string, attempt: number): void {
    const target = desiredTarget;
    if (!target || target.workspaceId !== workspaceId) return;
    if (authRetryTimeout) {
        clearTimeout(authRetryTimeout);
        authRetryTimeout = null;
    }

    const delayIndex = Math.min(attempt - 1, AUTH_RETRY_DELAYS.length - 1);
    const delay = AUTH_RETRY_DELAYS[delayIndex] ?? 5000;

    authRetryTimeout = setTimeout(() => {
        authRetryTimeout = null;
        if (desiredTarget !== target) return;
        void startSyncEngine(workspaceId).catch((error) => {
            console.error('[sync-engine] Auth retry failed:', error);
            if (desiredTarget === target) scheduleAuthRetry(workspaceId, attempt + 1);
        });
    }, delay);
}

async function hasDirectProviderToken(provider: SyncProvider): Promise<boolean> {
    if (provider.mode !== 'direct' || !provider.auth) return true;
    if (!authTokenBroker) return false;

    try {
        const token = await authTokenBroker.getProviderToken({
            providerId: provider.auth.providerId,
            template: provider.auth.template,
        });
        return Boolean(token);
    } catch {
        return false;
    }
}

/** Serialize transitions and always reconcile the newest requested identity. */
function reconcileSyncEngine(): Promise<void> {
    const transition = lifecycle.catch(() => {}).then(async () => {
        if (engineState && sameTarget(engineState.target, desiredTarget)) return;
        await stopRunningEngine();
        const target = desiredTarget;
        if (target) await startRunningEngine(target);
    });
    lifecycle = transition;
    return transition;
}

function startSyncEngine(workspaceId: string): Promise<void> {
    const session = getCachedSessionContext();
    const target: SyncTarget = { workspaceId, userId: session?.user?.id ?? null,
        authorizationRevision: session?.authorizationRevision };
    if (!sameTarget(desiredTarget, target)) desiredTarget = target;
    clearAuthRetry();
    return reconcileSyncEngine();
}

function stopSyncEngine(): Promise<void> {
    desiredTarget = null;
    clearAuthRetry();
    return reconcileSyncEngine();
}

async function startRunningEngine(target: SyncTarget): Promise<void> {
    const provider = getActiveSyncProvider();
    if (!provider) {
        console.error('[sync-engine] No sync provider available');
        scheduleAuthRetry(target.workspaceId, 1);
        return;
    }
    const hasAuth = await hasDirectProviderToken(provider);
    if (desiredTarget !== target) return;
    if (!hasAuth) {
        scheduleAuthRetry(target.workspaceId, 1);
        return;
    }
    const db = createWorkspaceDb(target.workspaceId);
    const scope: SyncScope = { workspaceId: target.workspaceId };
    const hookBridge = getHookBridge(db);
    hookBridge.start();
    const subscriptionManager = createSubscriptionManager(db, provider, scope);
    const outboxManager = new OutboxManager(db, provider, scope);
    const gcManager = new GcManager(db, provider, scope);
    let stopSubscription = () => subscriptionManager.stop();
    const state: SyncEngineState = { db, target, provider, scope, hookBridge, subscriptionManager,
        outboxManager, gcManager, stopSubscription: () => stopSubscription() };
    try {
        stopSubscription = provider.mode === 'gateway'
            ? await startCoordinatedSubscription(JSON.stringify([db.name, provider.id, scope, target.userId]), subscriptionManager)
            : await (async () => { await subscriptionManager.start(); return () => subscriptionManager.stop(); })();
    } catch (error) {
        await disposeEngine(state);
        throw error;
    }
    if (desiredTarget !== target) {
        await disposeEngine(state);
        return;
    }
    try {
        outboxManager.start();
        gcManager.start();
        engineState = state;
    } catch (error) {
        await disposeEngine(state);
        throw error;
    }
}

async function stopRunningEngine(): Promise<void> {
    const state = engineState;
    engineState = null;
    if (state) await disposeEngine(state);
}

async function disposeEngine(state: SyncEngineState): Promise<void> {
    state.outboxManager.stop();
    state.gcManager.stop();
    try {
        await state.stopSubscription();
    } finally {
        try { await state.provider.dispose(); }
        catch (error) { console.warn('[sync-engine] Provider dispose failed:', error); }
        cleanupSubscriptionManager(`${state.scope.workspaceId}:${state.scope.projectId ?? 'default'}`);
        cleanupCursorManager(state.db.name, state.scope);
        // Capture belongs to the active DB, even while an Admin route pauses
        // transport. Workspace/account departure and DB eviction release it.
        const session = getCachedSessionContext();
        if (getActiveDbWorkspaceId() !== state.scope.workspaceId || !session?.authenticated
            || (session.user?.id ?? null) !== state.target.userId) cleanupHookBridge(state.db.name);
    }
}

export async function setupSyncEngine(): Promise<void> {
    // Only run on client
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    const publicConfig = runtimeConfig.public as {
        admin?: { basePath?: string };
        sync?: { enabled?: boolean; provider?: string };
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
                const gatewayProvider = createGatewaySyncProvider({ id: providerId });
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

    function getRoutePathSafe(): string {
        const maybeRouter = router as unknown as { currentRoute?: { value?: { path?: unknown } } };
        const raw = maybeRouter.currentRoute?.value?.path;
        if (typeof raw === 'string') return raw;
        return getCurrentPath();
    }

    function updateSyncForRouteAndSession(
        workspaceId: string | null,
        path: string,
        authenticated: boolean
    ): void {
        const isAdmin = isAdminPath(path);

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
        if (workspaceId && authenticated) {
            void startSyncEngine(workspaceId).catch((error) => {
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

    watch(
        () => ({
            workspaceId: activeWorkspaceId.value,
            path: getRoutePathSafe(),
            authenticated: sessionData.value?.session?.authenticated ?? false,
            userId: sessionData.value?.session?.user?.id ?? null,
            authorizationRevision: sessionData.value?.session?.authorizationRevision,
        }),
        ({ workspaceId, path, authenticated }) => updateSyncForRouteAndSession(workspaceId, path, authenticated),
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

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            stopSyncEngine();
        });
    }
}
