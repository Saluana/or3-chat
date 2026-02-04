import { registerAuthWorkspaceStore } from '~~/server/auth/store/registry';
import { registerSyncGatewayAdapter } from '~~/server/sync/gateway/registry';
import { createSqliteAuthWorkspaceStore } from '../store/sqlite-auth-workspace-store';
import { sqliteSyncGatewayAdapter } from '../sync/sqlite-sync-gateway-adapter';

export default defineNitroPlugin(() => {
    registerAuthWorkspaceStore({
        id: 'sqlite',
        create: () => createSqliteAuthWorkspaceStore(),
    });

    registerSyncGatewayAdapter({
        id: 'sqlite',
        create: () => sqliteSyncGatewayAdapter,
    });
});
