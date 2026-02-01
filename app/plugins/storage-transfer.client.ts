import { createConvexStorageProvider } from '~/core/storage/providers/convex-storage-provider';
import { registerStorageProvider } from '~/core/storage/provider-registry';
import { getStorageTransferQueue } from '~/core/storage/transfer-queue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { watch } from 'vue';
import { CONVEX_STORAGE_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (
        !runtimeConfig.public.ssrAuthEnabled ||
        !runtimeConfig.public.storage?.enabled ||
        runtimeConfig.public.storage?.provider !== CONVEX_STORAGE_PROVIDER_ID
    ) {
        console.log('[storage] Storage disabled, storage queue paused');
        return;
    }

    try {
        registerStorageProvider({
            id: CONVEX_STORAGE_PROVIDER_ID,
            create: createConvexStorageProvider,
        });
    } catch (error) {
        console.error('[storage] Failed to register storage provider:', error);
        return;
    }

    const queue = getStorageTransferQueue();
    const { data: sessionData } = useSessionContext();

    watch(
        () => sessionData.value?.session,
        (session) => {
            const workspaceId = session?.authenticated
                ? session.workspace?.id ?? null
                : null;
            queue?.setWorkspaceId(workspaceId);
        },
        { immediate: true }
    );
});
