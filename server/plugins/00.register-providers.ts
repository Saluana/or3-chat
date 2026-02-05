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

// Use static imports at the top level for ESM compatibility
// Use relative paths since Nitro plugins don't resolve the ~ alias
import { registerAuthWorkspaceStore } from '../auth/store/registry';
import { createConvexAuthWorkspaceStore } from '../auth/store/impls/convex-auth-workspace-store';
import { registerProviderTokenBroker } from '../auth/token-broker/registry';
import { createClerkTokenBroker } from '../auth/token-broker/impls/clerk-token-broker';
import { registerSyncGatewayAdapter } from '../sync/gateway/registry';
import { createConvexSyncGatewayAdapter } from '../sync/gateway/impls/convex-sync-gateway-adapter';
import { registerStorageGatewayAdapter } from '../storage/gateway/registry';
import { createConvexStorageGatewayAdapter } from '../storage/gateway/impls/convex-storage-gateway-adapter';

export default defineNitroPlugin(() => {
    // Only register if SSR auth is enabled
    // Note: On server runtime config, auth.enabled holds this flag (not ssrAuthEnabled)
    const config = useRuntimeConfig();
    if (!config.auth?.enabled) return;

    // Register Convex AuthWorkspaceStore (temporary - will move to provider package)
    try {
        registerAuthWorkspaceStore({
            id: 'convex',
            order: 100,
            create: createConvexAuthWorkspaceStore,
        });
    } catch (error) {
        console.error('[providers] Failed to register Convex AuthWorkspaceStore:', error);
    }

    // Register Clerk ProviderTokenBroker (temporary - will move to provider package)
    try {
        registerProviderTokenBroker('clerk', createClerkTokenBroker);
    } catch (error) {
        console.error('[providers] Failed to register Clerk ProviderTokenBroker:', error);
    }

    // Register Convex SyncGatewayAdapter (temporary - will move to provider package)
    try {
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
        registerStorageGatewayAdapter({
            id: 'convex',
            order: 100,
            create: createConvexStorageGatewayAdapter,
        });
    } catch (error) {
        console.error('[providers] Failed to register Convex StorageGatewayAdapter:', error);
    }
});
