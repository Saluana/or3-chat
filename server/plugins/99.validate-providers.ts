/**
 * @module server/plugins/01.validate-providers.ts
 *
 * Purpose:
 * Strict-mode validation for provider registrations.
 */
import { listProviderIds } from '../auth/registry';
import { listAuthWorkspaceStoreIds } from '../auth/store/registry';
import { listSyncGatewayAdapterIds } from '../sync/gateway/registry';
import { listStorageGatewayAdapterIds } from '../storage/gateway/registry';
import { useRuntimeConfig } from '#imports';

function isStrictMode(): boolean {
    return (
        process.env.NODE_ENV === 'production' ||
        process.env.OR3_STRICT_CONFIG === 'true'
    );
}

export default defineNitroPlugin(() => {
    if (!isStrictMode()) return;

    const config = useRuntimeConfig();
    const errors: string[] = [];

    if (config.auth.enabled) {
        const authProviderId = config.auth.provider;
        const authProviders = listProviderIds();
        if (!authProviders.includes(authProviderId)) {
            errors.push(
                `auth.provider "${authProviderId}" is not registered. ` +
                    `Install the provider package that registers it (e.g. or3-provider-${authProviderId}).`
            );
        }
    }

    if (config.sync.enabled) {
        const syncProviderId = config.sync.provider;
        const syncAdapters = listSyncGatewayAdapterIds();
        if (!syncAdapters.includes(syncProviderId)) {
            errors.push(
                `sync.provider "${syncProviderId}" is not registered. ` +
                    `Install the provider package that registers it (e.g. or3-provider-${syncProviderId}).`
            );
        }
        const workspaceStores = listAuthWorkspaceStoreIds();
        if (!workspaceStores.includes(syncProviderId)) {
            errors.push(
                `AuthWorkspaceStore for "${syncProviderId}" is not registered. ` +
                    `Install the provider package that registers it (e.g. or3-provider-${syncProviderId}).`
            );
        }
    }

    if (config.storage.enabled) {
        const storageProviderId = config.storage.provider;
        const storageAdapters = listStorageGatewayAdapterIds();
        if (!storageAdapters.includes(storageProviderId)) {
            errors.push(
                `storage.provider "${storageProviderId}" is not registered. ` +
                    `Install the provider package that registers it (e.g. or3-provider-${storageProviderId}).`
            );
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `[or3-cloud-config] Provider registration validation failed:\n- ${errors.join(
                '\n- '
            )}`
        );
    }
});
