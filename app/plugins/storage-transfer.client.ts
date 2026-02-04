import { createGatewayStorageProvider } from '~/core/storage/providers/gateway-storage-provider';
import { registerStorageProvider } from '~/core/storage/provider-registry';
import { getStorageTransferQueue } from '~/core/storage/transfer-queue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { watch } from 'vue';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled || !runtimeConfig.public.storage?.enabled) {
        console.log('[storage] Storage disabled, storage queue paused');
        return;
    }

    try {
        registerStorageProvider({
            id: 'gateway',
            create: () => createGatewayStorageProvider('gateway'),
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
