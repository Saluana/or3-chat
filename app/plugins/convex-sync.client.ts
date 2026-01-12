/**
 * Convex Sync Plugin
 *
 * Bootstraps the sync engine when an authenticated session is active.
 * Client-only plugin that starts/stops sync based on session state.
 */
import { createConvexSyncProvider } from '~/core/sync/providers/convex-sync-provider';
import { registerSyncProvider, getActiveSyncProvider } from '~/core/sync/sync-provider-registry';
import { getHookBridge } from '~/core/sync/hook-bridge';
import { OutboxManager } from '~/core/sync/outbox-manager';
import { ConflictResolver } from '~/core/sync/conflict-resolver';
import { getDeviceId } from '~/core/sync/hlc';
import { createWorkspaceDb, type Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';

/** Sync engine state */
interface SyncEngineState {
    db: Or3DB;
    provider: SyncProvider;
    scope: SyncScope;
    hookBridge: ReturnType<typeof getHookBridge>;
    outboxManager: OutboxManager;
    conflictResolver: ConflictResolver;
    unsubscribe: (() => void) | null;
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

    const scope: SyncScope = { workspaceId };
    const deviceId = getDeviceId();

    // Initialize components
    const hookBridge = getHookBridge(db);
    hookBridge.start();

    const outboxManager = new OutboxManager(db, provider, scope);
    outboxManager.start();

    const conflictResolver = new ConflictResolver(db);

    // Subscribe to remote changes
    const unsubscribe = await provider.subscribe(scope, [], async (changes) => {
        console.log('[convex-sync] Received', changes.length, 'remote changes');
        const result = await conflictResolver.applyChanges(changes);
        console.log('[convex-sync] Applied:', result.applied, 'conflicts:', result.conflicts);

        // Update device cursor
        if (changes.length > 0) {
            const latestVersion = Math.max(...changes.map((c) => c.serverVersion));
            await provider.updateCursor(scope, deviceId, latestVersion);
        }
    });

    engineState = {
        db,
        provider,
        scope,
        hookBridge,
        outboxManager,
        conflictResolver,
        unsubscribe,
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

    // Unsubscribe from remote changes
    if (engineState.unsubscribe) {
        engineState.unsubscribe();
    }

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
        console.log('[convex-sync] Registered Convex sync provider');
    } catch (error) {
        console.error('[convex-sync] Failed to create Convex provider:', error);
        return;
    }

    // Watch for session changes
    // Note: This would integrate with useSessionContext() from the auth system
    // For now, we expose start/stop functions that can be called from auth flows
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
