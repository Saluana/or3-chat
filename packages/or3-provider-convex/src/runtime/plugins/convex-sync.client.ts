import { useConvexClient } from 'convex-vue';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { registerSyncProvider, setActiveSyncProvider } from '~/core/sync/sync-provider-registry';
import { createConvexSyncProvider } from '../app/sync/convex-sync-provider';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled || !config.public.sync?.enabled) return;
    if (config.public.sync.provider !== CONVEX_PROVIDER_ID) return;

    const client = useConvexClient();
    registerSyncProvider(createConvexSyncProvider(client));
    setActiveSyncProvider(CONVEX_PROVIDER_ID);
});
