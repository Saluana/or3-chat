import { useConvexClient } from 'convex-vue';
import {
    CONVEX_JWT_TEMPLATE,
    CONVEX_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';
import { registerSyncProvider, setActiveSyncProvider } from '~/core/sync/sync-provider-registry';
import { useAuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';
import { createConvexSyncProvider } from '../app/sync/convex-sync-provider';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled || !config.public.sync.enabled) return;
    if (config.public.sync.provider !== CONVEX_PROVIDER_ID) return;

    try {
        const client = useConvexClient();
        const broker = useAuthTokenBroker();

        // Bind auth directly on the same client instance used by sync operations.
        client.setAuth(async () =>
            broker.getProviderToken({
                providerId: CONVEX_PROVIDER_ID,
                template: CONVEX_JWT_TEMPLATE,
            })
        );

        registerSyncProvider(createConvexSyncProvider(client));
        setActiveSyncProvider(CONVEX_PROVIDER_ID);
    } catch (error) {
        console.warn('[or3-provider-convex] Convex context unavailable; skipping sync provider init', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
