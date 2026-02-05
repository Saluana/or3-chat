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
import { createWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { watch } from 'vue';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';

/** Sync engine state */
interface SyncEngineState {
    db: Or3DB;
    provider: SyncProvider;
    scope: SyncScope;
    hookBridge: ReturnType<typeof getHookBridge>;
    outboxManager: OutboxManager;
    subscriptionManager: ReturnType<typeof createSubscriptionManager>;
    gcManager: GcManager;
}

let engineState: SyncEngineState | null = null;
let authRetryTimeout: ReturnType<typeof setTimeout> | null = null;
const AUTH_RETRY_DELAYS = [500, 1000, 2000, 5000];
let stopInFlight: Promise<void> | null = null;

function getActiveWorkspaceId(): string | null {
    return engineState?.scope.workspaceId ?? null;
}

function scheduleAuthRetry(workspaceId: string, attempt: number): void {
    if (authRetryTimeout) {
        clearTimeout(authRetryTimeout);
        authRetryTimeout = null;
    }

    const delayIndex = Math.min(attempt - 1, AUTH_RETRY_DELAYS.length - 1);
    const delay = AUTH_RETRY_DELAYS[delayIndex] ?? 5000;

    authRetryTimeout = setTimeout(() => {
        authRetryTimeout = null;
        void startSyncEngine(workspaceId).catch((error) => {
            console.error('[sync-engine] Auth retry failed:', error);
            scheduleAuthRetry(workspaceId, attempt + 1);
        });
    }, delay);
}

/**
 * Start the sync engine for a workspace
 */
async function startSyncEngine(workspaceId: string): Promise<void> {
    if (engineState) {
        console.warn('[sync-engine] Engine already running, stopping first');
        await stopSyncEngine();
    }

    if (authRetryTimeout) {
        clearTimeout(authRetryTimeout);
        authRetryTimeout = null;
    }

    console.log('[sync-engine] Starting sync engine for workspace:', workspaceId);

    // Create workspace-specific DB
    const db = createWorkspaceDb(workspaceId);

    // Get or create provider
    const provider = getActiveSyncProvider();
    if (!provider) {
        console.error('[sync-engine] No sync provider available');
        scheduleAuthRetry(workspaceId, 1);
        return;
    }

    const resolvedProvider = provider;

    const scope: SyncScope = { workspaceId };
    // Initialize components
    const hookBridge = getHookBridge(db);
    hookBridge.start();

    const outboxManager = new OutboxManager(db, resolvedProvider, scope);
    outboxManager.start();

    const subscriptionManager = createSubscriptionManager(db, resolvedProvider, scope);
    await subscriptionManager.start();

    const gcManager = new GcManager(db, resolvedProvider, scope);
    gcManager.start();

    engineState = {
        db,
        provider: resolvedProvider,
        scope,
        hookBridge,
        outboxManager,
        subscriptionManager,
        gcManager,
    };

    console.log('[sync-engine] Sync engine started');
}

/**
 * Stop the sync engine
 */
async function stopSyncEngine(): Promise<void> {
    if (!engineState) return;
    if (stopInFlight) return stopInFlight;

    console.log('[sync-engine] Stopping sync engine');

    if (authRetryTimeout) {
        clearTimeout(authRetryTimeout);
        authRetryTimeout = null;
    }

    stopInFlight = (async () => {
        // Stop outbox
        engineState?.outboxManager.stop();
        engineState?.hookBridge.stop();
        await engineState?.subscriptionManager.stop();
        engineState?.gcManager.stop();

        // Dispose provider
        try {
            await engineState?.provider.dispose();
        } catch (error) {
            console.warn('[sync-engine] Provider dispose failed:', error);
        }

        if (engineState) {
            const scopeKey = `${engineState.scope.workspaceId}:${engineState.scope.projectId ?? 'default'}`;
            cleanupSubscriptionManager(scopeKey);
            cleanupCursorManager(engineState.db.name, engineState.scope);
            cleanupHookBridge(engineState.db.name);
        }

        engineState = null;
        stopInFlight = null;
        console.log('[sync-engine] Sync engine stopped');
    })();

    return stopInFlight;
}

export default defineNuxtPlugin(async () => {
    // Only run on client
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    // Admin pages are currently mounted at `/admin/*` (canonical).
    // `admin.basePath` is treated as an alias that redirects to `/admin/*`.
    const defaultAdminBasePath = '/admin';
    const adminBasePath = runtimeConfig.public.admin?.basePath || defaultAdminBasePath;

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

    // Only run when SSR auth and sync are enabled
    if (!runtimeConfig.public.ssrAuthEnabled || !runtimeConfig.public.sync?.enabled) {
        console.log('[sync-engine] Sync disabled, skipping sync');
        return;
    }

    const providerId = runtimeConfig.public.sync?.provider ?? 'gateway';

    // Register a gateway provider for the configured sync provider if none exists.
    try {
        if (!getActiveSyncProvider()) {
            const gatewayProvider = createGatewaySyncProvider({ id: providerId });
            registerSyncProvider(gatewayProvider);
        }
        setActiveSyncProvider(providerId);
        console.log('[sync-engine] Registered gateway sync provider:', providerId);
    } catch (error) {
        console.error('[sync-engine] Failed to register sync provider:', error);
        return;
    }

    // Watch for session changes
    const { data: sessionData } = useSessionContext();
    const { activeWorkspaceId } = useWorkspaceManager();
    const nuxtApp = useNuxtApp();
    const router = useRouter();

    let currentPath = getCurrentPath();

    function updateSyncForRouteAndSession(workspaceId: string | null, path: string): void {
        const isAdmin = isAdminPath(path);

        if (isAdmin) {
            // Admin routes shouldn't run the user sync engine (heavy + irrelevant).
            // Special case: Admin routes explicitly set workspace to null, overriding
            // the workspace manager. This is intentional to ensure admin operations
            // run in the default DB context rather than a workspace-scoped DB.
            // 
            // Note: This creates a potential race condition with useWorkspaceManager.
            // In practice, this is acceptable because:
            // 1. Admin routes are accessed infrequently
            // 2. The workspace manager's watch runs synchronously after this
            // 3. Admin route access typically follows a page navigation which
            //    gives the workspace manager time to settle
            setActiveWorkspaceDb(null);
            if (authRetryTimeout) {
                clearTimeout(authRetryTimeout);
                authRetryTimeout = null;
            }
            void stopSyncEngine().catch((error) => {
                console.error('[sync-engine] Failed to stop sync engine:', error);
            });
            return;
        }

        // Manage sync engine based on workspace ID
        // Note: Workspace DB switching is handled separately by useWorkspaceManager
        // in 00-workspace-db.client.ts. This function only starts/stops the sync engine.
        if (workspaceId) {
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

    const removeAfterEach = router.afterEach((to) => {
        currentPath = to.path;
        updateSyncForRouteAndSession(activeWorkspaceId.value, currentPath);
    });

    watch(
        activeWorkspaceId,
        (workspaceId) => updateSyncForRouteAndSession(workspaceId, currentPath),
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
    });

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            removeAfterEach();
            stopSyncEngine();
        });
    }
});
