import { CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { registerStorageProvider, listStorageProviderIds } from '~/core/storage/provider-registry';
import { createConvexStorageProvider } from '../app/storage/convex-storage-provider';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled || !config.public.storage.enabled) return;
    if (config.public.storage.provider !== CONVEX_STORAGE_PROVIDER_ID) return;

    if (listStorageProviderIds().includes(CONVEX_STORAGE_PROVIDER_ID)) return;

    registerStorageProvider({
        id: CONVEX_STORAGE_PROVIDER_ID,
        create: createConvexStorageProvider,
    });
});
