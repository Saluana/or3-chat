import { useConvexClient } from 'convex-vue';
import { registerSyncProvider, setActiveSyncProvider } from '~~/app/core/sync/sync-provider-registry';
import { createConvexSyncProvider } from '../sync/convex-sync-provider';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();

    if (!runtimeConfig.public.ssrAuthEnabled || !runtimeConfig.public.sync?.enabled) {
        return;
    }

    if (runtimeConfig.public.sync?.provider !== CONVEX_PROVIDER_ID) {
        return;
    }

    let convexClient: ReturnType<typeof useConvexClient>;
    try {
        convexClient = useConvexClient();
    } catch (error) {
        console.error('[convex-sync] Failed to get Convex client:', error);
        return;
    }

    try {
        const convexProvider = createConvexSyncProvider(convexClient);
        registerSyncProvider(convexProvider);
        setActiveSyncProvider(CONVEX_PROVIDER_ID);
    } catch (error) {
        console.error('[convex-sync] Failed to register Convex provider:', error);
    }
});
