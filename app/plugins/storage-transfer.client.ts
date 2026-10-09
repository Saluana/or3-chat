import {
    registerStorageProvider,
    listStorageProviderIds,
} from '~/core/storage/provider-registry';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { watch } from 'vue';

export default defineNuxtPlugin(async () => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled || !runtimeConfig.public.storage?.enabled) {
        if (import.meta.dev) {
            console.log('[storage] Storage disabled, storage queue paused');
        }
        return;
    }

    try {
        const { createGatewayStorageProvider } = await import('~/core/storage/providers/gateway-storage-provider');
        const providerId = runtimeConfig.public.storage.provider ?? 'gateway';
        if (!listStorageProviderIds().includes(providerId)) {
            registerStorageProvider({
                id: providerId,
                create: () =>
                    createGatewayStorageProvider({
                        id: providerId,
                        displayName: `Gateway (${providerId})`,
                    }),
            });
        }
    } catch (error) {
        console.error('[storage] Failed to register storage provider:', error);
        return;
    }

    const { getStorageTransferQueue } = await import('~/core/storage/transfer-queue');
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
