import { CONVEX_PROVIDER_ID, CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { registerAuthWorkspaceStore } from '~~/server/auth/store/registry';
import { registerSyncGatewayAdapter } from '~~/server/sync/gateway/registry';
import { registerStorageGatewayAdapter } from '~~/server/storage/gateway/registry';
import { registerProviderAdminAdapter } from '~~/server/admin/providers/registry';
import { registerAdminStoreProvider } from '~~/server/admin/stores/registry';
import { registerBackgroundJobProvider } from '~~/server/utils/background-jobs/registry';
import { registerRateLimitProvider } from '~~/server/utils/rate-limit/registry';
import { registerNotificationEmitter } from '~~/server/utils/notifications/registry';
import { registerDeploymentAdminChecker } from '~~/server/auth/deployment-admin';
import { createConvexAuthWorkspaceStore } from '../auth/convex-auth-workspace-store';
import { createConvexSyncGatewayAdapter } from '../sync/convex-sync-gateway-adapter';
import { createConvexStorageGatewayAdapter } from '../storage/convex-storage-gateway-adapter';
import { convexSyncAdminAdapter } from '../admin/adapters/sync-convex';
import { convexStorageAdminAdapter } from '../admin/adapters/storage-convex';
import {
    createConvexWorkspaceAccessStore,
    createConvexWorkspaceSettingsStore,
    createConvexAdminUserStore,
} from '../admin/stores/convex-store';
import { ConvexDeploymentAdminChecker } from '../admin/deployment-admin-checker';
import { convexJobProvider } from '../background-jobs/convex-provider';
import { convexRateLimitProvider } from '../rate-limit/convex-provider';
import {
    emitBackgroundJobComplete,
    emitBackgroundJobError,
} from '../notifications/emit';
import { useRuntimeConfig } from '#imports';

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();
    if (!config.auth.enabled) return;

    registerAuthWorkspaceStore({
        id: CONVEX_PROVIDER_ID,
        order: 100,
        create: createConvexAuthWorkspaceStore,
    });

    registerSyncGatewayAdapter({
        id: CONVEX_PROVIDER_ID,
        order: 100,
        create: createConvexSyncGatewayAdapter,
    });

    registerStorageGatewayAdapter({
        id: CONVEX_STORAGE_PROVIDER_ID,
        order: 100,
        create: createConvexStorageGatewayAdapter,
    });

    registerProviderAdminAdapter(convexSyncAdminAdapter);
    registerProviderAdminAdapter(convexStorageAdminAdapter);

    registerAdminStoreProvider({
        id: CONVEX_PROVIDER_ID,
        createWorkspaceAccessStore: createConvexWorkspaceAccessStore,
        createWorkspaceSettingsStore: createConvexWorkspaceSettingsStore,
        createAdminUserStore: createConvexAdminUserStore,
        getCapabilities: () => ({
            supportsServerSideAdmin: true,
            supportsUserSearch: true,
            supportsWorkspaceList: true,
            supportsWorkspaceManagement: true,
            supportsDeploymentAdminGrants: true,
        }),
    });

    registerBackgroundJobProvider(CONVEX_PROVIDER_ID, convexJobProvider);
    registerRateLimitProvider(CONVEX_PROVIDER_ID, convexRateLimitProvider);

    registerNotificationEmitter(CONVEX_PROVIDER_ID, {
        emitBackgroundJobComplete,
        emitBackgroundJobError,
    });

    registerDeploymentAdminChecker(CONVEX_PROVIDER_ID, () => new ConvexDeploymentAdminChecker());
});
