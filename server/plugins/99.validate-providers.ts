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
import { listConnectStoreIds } from '../connect/store/registry';
import { listConnectRelayIds } from '../connect/relay/registry';
import { parseConnectMaxComputers } from '../connect/config';
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

    if (config.connect?.enabled) {
        const connectProviderId = config.connect.provider;
        const connectStores = listConnectStoreIds();
        if (!connectStores.includes(connectProviderId)) {
            errors.push(
                `connect.provider "${connectProviderId}" is not registered. ` +
                    `Install a provider package with OR3 Connect support (e.g. or3-provider-${connectProviderId}).`
            );
        }
        const relayProviderId = config.connect.relayProvider;
        const relayProviders = listConnectRelayIds();
        if (!relayProviders.includes(relayProviderId)) {
            errors.push(
                `connect.relayProvider "${relayProviderId}" is not registered.`
            );
        }
        const publicURL = String(config.connect.publicURL ?? '').trim();
        try {
            const parsed = new URL(publicURL);
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                throw new Error('invalid');
            }
        } catch {
            errors.push(
                'OR3_CONNECT_PUBLIC_URL must be an absolute HTTPS URL without embedded credentials.'
            );
        }
        if (String(config.connect.encryptionKey ?? '').trim().length < 32) {
            errors.push(
                'OR3_CONNECT_ENCRYPTION_KEY must contain at least 32 characters.'
            );
        }
        try {
            parseConnectMaxComputers(config.connect.maxComputers);
        } catch (error) {
            errors.push(
                error instanceof Error
                    ? error.message
                    : 'OR3_CONNECT_MAX_COMPUTERS is invalid.'
            );
        }
        if (relayProviderId === 'cloudflare') {
            const cloudflare = config.connect.cloudflare;
            const accountId = String(cloudflare?.accountId ?? '').trim();
            const zoneId = String(cloudflare?.zoneId ?? '').trim();
            const apiToken = String(cloudflare?.apiToken ?? '').trim();
            const suffix = String(cloudflare?.hostnameSuffix ?? '')
                .trim()
                .toLowerCase()
                .replace(/\.$/, '');
            if (!apiToken) {
                errors.push('OR3_CONNECT_CLOUDFLARE_API_TOKEN is required.');
            }
            if (
                !suffix ||
                suffix.includes('://') ||
                suffix.includes('/') ||
                !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(suffix)
            ) {
                errors.push(
                    'OR3_CONNECT_HOSTNAME_SUFFIX must be a valid hostname.'
                );
            }
            if ((accountId && !zoneId) || (!accountId && zoneId)) {
                errors.push(
                    'Set both OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID and OR3_CONNECT_CLOUDFLARE_ZONE_ID, or leave both unset for discovery.'
                );
            }
        }
        if (
            connectProviderId === 'convex' &&
            !String(config.sync?.convexAdminKey ?? '').trim()
        ) {
            errors.push(
                'CONVEX_SELF_HOSTED_ADMIN_KEY is required when Convex backs OR3 Connect server operations.'
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
