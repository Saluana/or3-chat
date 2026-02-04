import { useConvexClient } from 'convex-vue';
import { useAuthTokenBroker } from '~~/app/composables/auth/useAuthTokenBroker.client';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';

export default defineNuxtPlugin(async () => {
    const runtimeConfig = useRuntimeConfig();

    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    if (!(runtimeConfig.public.convex as { url?: string })?.url) {
        return;
    }

    let convex: ReturnType<typeof useConvexClient>;
    try {
        convex = useConvexClient();
    } catch {
        return;
    }

    const tokenBroker = useAuthTokenBroker();
    const getToken = async () => {
        return tokenBroker.getProviderToken({
            providerId: runtimeConfig.public.sync?.provider ?? 'convex',
            template: CONVEX_JWT_TEMPLATE,
        });
    };

    convex.setAuth(getToken);

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            convex.setAuth(() => null);
        });
    }
});
