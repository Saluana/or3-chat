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
import { getHookBridge } from '~/core/sync/hook-bridge';
import { OutboxManager } from '~/core/sync/outbox-manager';
import { createSubscriptionManager } from '~/core/sync/subscription-manager';
import { GcManager } from '~/core/sync/gc-manager';
import { createWorkspaceDb, type Or3DB } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useAuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';
import { watch } from 'vue';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';
import { useConvexClient } from 'convex-vue';

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

/**
 * Start the sync engine for a workspace
 */
async function startSyncEngine(workspaceId: string): Promise<void> {
    if (engineState) {
        console.warn('[convex-sync] Engine already running, stopping first');
        await stopSyncEngine();
    }

    console.log('[convex-sync] Starting sync engine for workspace:', workspaceId);

    // Create workspace-specific DB
    const db = createWorkspaceDb(workspaceId);

    // Get or create provider
    const provider = getActiveSyncProvider();
    if (!provider) {
        console.error('[convex-sync] No sync provider available');
        return;
    }

    const resolvedProvider = await ensureProviderAuth(provider);
    if (!resolvedProvider) {
        console.error('[convex-sync] Provider auth unavailable');
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

    console.log('[convex-sync] Stopping sync engine');

    // Stop outbox
    engineState.outboxManager.stop();
    engineState.hookBridge.stop();
    await engineState.subscriptionManager.stop();
    engineState.gcManager.stop();

    // Dispose provider
    await engineState.provider.dispose();

    engineState = null;

    console.log('[convex-sync] Sync engine stopped');
}

export default defineNuxtPlugin(async () => {
    // Only run on client
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();

    // Only run when SSR auth is enabled
    if (!runtimeConfig.public.ssrAuthEnabled) {
        console.log('[convex-sync] SSR auth disabled, skipping sync');
        return;
    }

    // Register Convex provider
    try {
        const convexProvider = createConvexSyncProvider();
        registerSyncProvider(convexProvider);
        const gatewayProvider = createGatewaySyncProvider({ id: 'convex-gateway' });
        registerSyncProvider(gatewayProvider);
        console.log('[convex-sync] Registered Convex sync provider');
    } catch (error) {
        console.error('[convex-sync] Failed to create Convex provider:', error);
        return;
    }

    // Watch for session changes
    const { data: sessionData } = useSessionContext();
    watch(
        () => sessionData.value?.session,
        (session) => {
            if (session?.authenticated && session.workspace?.id) {
                void startSyncEngine(session.workspace.id).catch((error) => {
                    console.error('[convex-sync] Failed to start sync engine:', error);
                });
            } else {
                void stopSyncEngine().catch((error) => {
                    console.error('[convex-sync] Failed to stop sync engine:', error);
                });
            }
        },
        { immediate: true }
    );

    // Expose sync control functions for advanced callers
    const nuxtApp = useNuxtApp();

    // Expose sync control functions
    nuxtApp.provide('syncEngine', {
        start: startSyncEngine,
        stop: stopSyncEngine,
        isRunning: () => engineState !== null,
    });

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            stopSyncEngine();
        });
    }
});

async function ensureProviderAuth(provider: SyncProvider): Promise<SyncProvider | null> {
    if (provider.mode !== 'direct' || !provider.auth) {
        return provider;
    }

    const tokenBroker = useAuthTokenBroker();
    const token = await tokenBroker.getProviderToken(provider.auth);
    if (!token) {
        const gatewayFallback = getSyncProvider(`${provider.id}-gateway`);
        if (gatewayFallback) {
            console.warn(
                '[convex-sync] Provider token unavailable, falling back to gateway mode'
            );
            return gatewayFallback;
        }
        return null;
    }

    if (provider.id === 'convex') {
        try {
            const convex = useConvexClient();
            if (provider.auth) {
                convex.setAuth(() => tokenBroker.getProviderToken(provider.auth!));
            }
        } catch (error) {
            console.warn('[convex-sync] Failed to configure Convex auth:', error);
        }
    }

    return provider;
}
