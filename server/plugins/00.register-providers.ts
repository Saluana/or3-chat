/**
 * @module server/plugins/00.register-providers.ts
 *
 * Purpose:
 * TEMPORARY plugin that registers provider implementations during the refactoring phase.
 * This ensures existing functionality continues to work while we migrate to the new architecture.
 *
 * Status:
 * - Phase 2: Temporary registrations for Convex/Clerk
 * - Phase 3: These registrations will move to provider packages
 * - Phase 4: This file will be deleted
 *
 * DO NOT add new registrations here. This is only for maintaining existing functionality.
 */
export default defineNitroPlugin(() => {
    // Only register if SSR auth is enabled
    const config = useRuntimeConfig();
    if (!config.ssrAuthEnabled) return;

    // Register Convex AuthWorkspaceStore (temporary - will move to provider package)
    // This is a runtime-only registration to avoid import errors during Phase 2
    // In Phase 3, this will be moved to the Convex provider Nitro plugin
    try {
        const { registerAuthWorkspaceStore } = require('~/server/auth/store/registry');
        const { createConvexAuthWorkspaceStore } = require('~/server/auth/store/impls/convex-auth-workspace-store');
        
        registerAuthWorkspaceStore({
            id: 'convex',
            order: 100,
            create: createConvexAuthWorkspaceStore,
        });
    } catch (error) {
        console.error('[providers] Failed to register Convex AuthWorkspaceStore:', error);
    }

    // Register Convex SyncGatewayAdapter (temporary - will move to provider package)
    try {
        const { registerSyncGatewayAdapter } = require('~/server/sync/gateway/registry');
        const { createConvexSyncGatewayAdapter } = require('~/server/sync/gateway/impls/convex-sync-gateway-adapter');
        
        registerSyncGatewayAdapter({
            id: 'convex',
            order: 100,
            create: createConvexSyncGatewayAdapter,
        });
    } catch (error) {
        console.error('[providers] Failed to register Convex SyncGatewayAdapter:', error);
    }

    // Register Convex StorageGatewayAdapter (temporary - will move to provider package)
    try {
        const { registerStorageGatewayAdapter } = require('~/server/storage/gateway/registry');
        const { createConvexStorageGatewayAdapter } = require('~/server/storage/gateway/impls/convex-storage-gateway-adapter');
        
        registerStorageGatewayAdapter({
            id: 'convex',
            order: 100,
            create: createConvexStorageGatewayAdapter,
        });
    } catch (error) {
        console.error('[providers] Failed to register Convex StorageGatewayAdapter:', error);
    }
});
