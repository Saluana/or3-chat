import { registerAuthWorkspaceStore } from '~~/server/auth/store/registry';
import { registerSyncGatewayAdapter } from '~~/server/sync/gateway/registry';
import { registerStorageGatewayAdapter } from '~~/server/storage/gateway/registry';
import { registerRateLimitProvider } from '~~/server/utils/rate-limit/registry';
import { registerBackgroundJobProvider } from '~~/server/utils/background-jobs/registry';
import { registerNotificationEmitter } from '~~/server/utils/notifications/registry';
import { registerProviderAdminAdapter } from '~~/server/admin/providers/registry';
import { registerAdminStoreProvider } from '~~/server/admin/stores/registry';
import { registerDeploymentAdminChecker } from '~~/server/auth/deployment-admin';
import { CONVEX_PROVIDER_ID, CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { convexSyncGatewayAdapter } from '../sync/convex-sync-gateway-adapter';
import { convexStorageGatewayAdapter } from '../storage/convex-storage-gateway-adapter';
import { createConvexAuthWorkspaceStore } from '../store/convex-auth-workspace-store';
import { convexRateLimitProvider } from '../utils/rate-limit/convex';
import { convexJobProvider } from '../utils/background-jobs/convex';
import { convexNotificationEmitter } from '../utils/notifications/convex-emitter';
import { convexSyncAdminAdapter } from '../admin/sync-convex';
import { convexStorageAdminAdapter } from '../admin/storage-convex';
import { ConvexDeploymentAdminChecker } from '../admin/deployment-admin-checker';
import {
    createConvexWorkspaceAccessStore,
    createConvexWorkspaceSettingsStore,
    createConvexAdminUserStore,
} from '../admin/convex-store';

export default defineNitroPlugin(() => {
    registerAuthWorkspaceStore({
        id: CONVEX_PROVIDER_ID,
        create: (event) => createConvexAuthWorkspaceStore(event),
    });

    registerSyncGatewayAdapter({
        id: CONVEX_PROVIDER_ID,
        create: () => convexSyncGatewayAdapter,
    });

    registerStorageGatewayAdapter({
        id: CONVEX_STORAGE_PROVIDER_ID,
        create: () => convexStorageGatewayAdapter,
    });

    registerRateLimitProvider({
        id: CONVEX_PROVIDER_ID,
        create: () => convexRateLimitProvider,
    });

    registerBackgroundJobProvider({
        id: CONVEX_PROVIDER_ID,
        create: () => convexJobProvider,
    });

    registerNotificationEmitter({
        id: CONVEX_PROVIDER_ID,
        create: () => convexNotificationEmitter,
    });

    registerProviderAdminAdapter(convexSyncAdminAdapter);
    registerProviderAdminAdapter(convexStorageAdminAdapter);

    registerAdminStoreProvider({
        id: CONVEX_PROVIDER_ID,
        createWorkspaceAccessStore: createConvexWorkspaceAccessStore,
        createWorkspaceSettingsStore: createConvexWorkspaceSettingsStore,
        createAdminUserStore: createConvexAdminUserStore,
        capabilities: {
            supportsServerSideAdmin: true,
            supportsUserSearch: true,
            supportsWorkspaceList: true,
            supportsWorkspaceManagement: true,
            supportsDeploymentAdminGrants: true,
        },
    });

    registerDeploymentAdminChecker({
        id: CONVEX_PROVIDER_ID,
        create: () => new ConvexDeploymentAdminChecker(),
    });
});
