import { listProviderIds } from '~/server/auth/registry';
import { listAuthWorkspaceStoreIds } from '~/server/auth/store/registry';
import { listSyncGatewayAdapterIds } from '~/server/sync/gateway/registry';
import { listStorageGatewayAdapterIds } from '~/server/storage/gateway/registry';

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();

    if (config.auth.enabled) {
        const authProvider = config.auth.provider;
        if (authProvider && !listProviderIds().includes(authProvider)) {
            throw new Error(
                `[or3-cloud] Auth provider "${authProvider}" not registered. Install the provider package.`
            );
        }
    }

    if (config.sync.enabled) {
        const syncProvider = config.sync.provider;
        if (syncProvider && !listSyncGatewayAdapterIds().includes(syncProvider)) {
            throw new Error(
                `[or3-cloud] Sync provider "${syncProvider}" not registered. Install the provider package.`
            );
        }
        if (syncProvider && !listAuthWorkspaceStoreIds().includes(syncProvider)) {
            throw new Error(
                `[or3-cloud] AuthWorkspaceStore for "${syncProvider}" not registered.`
            );
        }
    }

    if (config.storage.enabled) {
        const storageProvider = config.storage.provider;
        if (storageProvider && !listStorageGatewayAdapterIds().includes(storageProvider)) {
            throw new Error(
                `[or3-cloud] Storage provider "${storageProvider}" not registered. Install the provider package.`
            );
        }
    }
});
