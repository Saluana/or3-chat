import { watch } from 'vue';
import { useConvexClient } from 'convex-vue';
import {
    CONVEX_JWT_TEMPLATE,
    CONVEX_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';
import { useAuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';
import { useSessionContext } from '~/composables/auth/useSessionContext';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled || !config.public.sync.enabled) return;
    if (config.public.sync.provider !== CONVEX_PROVIDER_ID) return;

    let client: ReturnType<typeof useConvexClient>;
    try {
        client = useConvexClient();
    } catch (error) {
        console.warn(
            '[or3-provider-convex] Convex context unavailable; skipping auth bridge',
            {
                error: error instanceof Error ? error.message : String(error),
            }
        );
        return;
    }

    const broker = useAuthTokenBroker();
    const getToken = async (): Promise<string | null> =>
        broker.getProviderToken({
            providerId: CONVEX_PROVIDER_ID,
            template: CONVEX_JWT_TEMPLATE,
        });

    // Register token fetcher so direct Convex queries/mutations include identity.
    client.setAuth(getToken);

    const { data: sessionData } = useSessionContext();
    watch(
        () => sessionData.value?.session?.authenticated,
        () => {
            // Force Convex auth refresh when session state flips.
            client.setAuth(getToken);
        }
    );
});
