/**
 * Convex Sync Plugin
 *
 * Bootstraps the sync engine when an authenticated session is active.
 * Client-only plugin that starts/stops sync based on session state.
 */
import { createConvexSyncProvider } from '~/core/sync/providers/convex-sync-provider';
import { createGatewaySyncProvider } from '~/core/sync/providers/gateway-sync-provider';
import {
    registerSyncProvider,
    getActiveSyncProvider,
    getSyncProvider,
} from '~/core/sync/sync-provider-registry';
import { getHookBridge, cleanupHookBridge } from '~/core/sync/hook-bridge';
import { OutboxManager } from '~/core/sync/outbox-manager';
import { createSubscriptionManager, cleanupSubscriptionManager } from '~/core/sync/subscription-manager';
import { GcManager } from '~/core/sync/gc-manager';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { createWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import {
    useAuthTokenBroker,
    type ProviderTokenRequest,
} from '~/composables/auth/useAuthTokenBroker.client';
import { watch } from 'vue';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';
import { useConvexClient } from 'convex-vue';
import {
    CONVEX_GATEWAY_PROVIDER_ID,
    CONVEX_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';

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
let convexClient: ReturnType<typeof useConvexClient> | null = null;
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
            console.error('[convex-sync] Auth retry failed:', error);
            scheduleAuthRetry(workspaceId, attempt + 1);
        });
    }, delay);
}

/**
 * Start the sync engine for a workspace
 */
async function startSyncEngine(workspaceId: string): Promise<void> {
    if (engineState) {
        console.warn('[convex-sync] Engine already running, stopping first');
        await stopSyncEngine();
    }

    if (authRetryTimeout) {
        clearTimeout(authRetryTimeout);
        authRetryTimeout = null;
    }

    console.log('[convex-sync] Starting sync engine for workspace:', workspaceId);

    // Create workspace-specific DB
    const db = createWorkspaceDb(workspaceId);

    // Get or create provider
    const provider = getActiveSyncProvider();
    if (!provider) {
        console.error('[convex-sync] No sync provider available');
        scheduleAuthRetry(workspaceId, 1);
        return;
    }

    const resolvedProvider = await ensureProviderAuth(provider);
    if (!resolvedProvider) {
        console.error('[convex-sync] Provider auth unavailable');
        scheduleAuthRetry(workspaceId, 1);
        return;
    }

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

    console.log('[convex-sync] Sync engine started');
}

/**
 * Stop the sync engine
 */
async function stopSyncEngine(): Promise<void> {
    if (!engineState) return;
    if (stopInFlight) return stopInFlight;

    console.log('[convex-sync] Stopping sync engine');

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
            console.warn('[convex-sync] Provider dispose failed:', error);
        }

        if (engineState) {
            const scopeKey = `${engineState.scope.workspaceId}:${engineState.scope.projectId ?? 'default'}`;
            cleanupSubscriptionManager(scopeKey);
            cleanupCursorManager(engineState.db.name);
            cleanupHookBridge(engineState.db.name);
        }

        engineState = null;
        stopInFlight = null;
        console.log('[convex-sync] Sync engine stopped');
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
    if (
        !runtimeConfig.public.ssrAuthEnabled ||
        !runtimeConfig.public.sync?.enabled ||
        runtimeConfig.public.sync?.provider !== CONVEX_PROVIDER_ID
    ) {
        console.log('[convex-sync] Sync disabled, skipping sync');
        return;
    }

    // Get Convex client first (must be in Vue setup context where inject() works)
    try {
        convexClient = useConvexClient();
    } catch (error) {
        console.error('[convex-sync] Failed to get Convex client:', error);
        return;
    }

    // Register Convex provider with the captured client
    try {
        const convexProvider = createConvexSyncProvider(convexClient);
        registerSyncProvider(convexProvider);
        const gatewayProvider = createGatewaySyncProvider({ id: CONVEX_GATEWAY_PROVIDER_ID });
        registerSyncProvider(gatewayProvider);
        console.log('[convex-sync] Registered Convex sync provider');
    } catch (error) {
        console.error('[convex-sync] Failed to create Convex provider:', error);
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
            setActiveWorkspaceDb(null);
            if (authRetryTimeout) {
                clearTimeout(authRetryTimeout);
                authRetryTimeout = null;
            }
            void stopSyncEngine().catch((error) => {
                console.error('[convex-sync] Failed to stop sync engine:', error);
            });
            return;
        }

        // Start or stop sync engine based on workspace ID
        // Note: setActiveWorkspaceDb is handled by useWorkspaceManager for non-admin routes,
        // which watches activeWorkspaceId and updates the DB automatically
        if (workspaceId) {
            void startSyncEngine(workspaceId).catch((error) => {
                console.error('[convex-sync] Failed to start sync engine:', error);
            });
        } else {
            if (authRetryTimeout) {
                clearTimeout(authRetryTimeout);
                authRetryTimeout = null;
            }
            void stopSyncEngine().catch((error) => {
                console.error('[convex-sync] Failed to stop sync engine:', error);
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
    });

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            removeAfterEach();
            stopSyncEngine();
        });
    }
});

async function ensureProviderAuth(provider: SyncProvider): Promise<SyncProvider | null> {
    if (provider.mode !== 'direct' || !provider.auth) {
        return provider;
    }

    const tokenBroker = useAuthTokenBroker();
    const providerAuth = provider.auth as ProviderTokenRequest;
    const token = await tokenBroker.getProviderToken(providerAuth);
    if (!token) {
        const gatewayFallback = getSyncProvider(CONVEX_GATEWAY_PROVIDER_ID);
        if (gatewayFallback) {
            console.warn(
                '[convex-sync] Provider token unavailable, falling back to gateway mode'
            );
            const workspaceId = getActiveWorkspaceId();
            if (workspaceId) {
                scheduleAuthRetry(workspaceId, 1);
            }
            return gatewayFallback;
        }
        return null;
    }

    if (provider.id === CONVEX_PROVIDER_ID) {
        if (!convexClient) {
            console.warn('[convex-sync] Convex client unavailable for auth');
        } else if (providerAuth) {
            convexClient.setAuth(() => tokenBroker.getProviderToken(providerAuth));
        }
    }

    return provider;
}
