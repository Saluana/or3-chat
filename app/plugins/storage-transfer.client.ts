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
            if (workspaceId && queue) {
                void (async () => {
                    const [{ getDb }, { getActiveStorageProvider }, { loadFilePolicy }, { cleanupFileCache }] = await Promise.all([
                        import('~/db/client'), import('~/core/storage/provider-registry'),
                        import('~/core/storage/file-policy'), import('~/core/storage/file-cache'),
                    ]);
                    const db = getDb();
                    const policy = await loadFilePolicy(workspaceId);
                    const provider = getActiveStorageProvider();
                    if (provider && queue.getWorkspaceId() === workspaceId && getDb() === db) {
                        await cleanupFileCache(db, workspaceId, provider, policy);
                    }
                })().catch(() => {}); // Offline/settings failure preserves every local copy.
            }
        },
        { immediate: true }
    );
});
