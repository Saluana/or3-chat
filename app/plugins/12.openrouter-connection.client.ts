import { watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { clearPersistedUserApiKey, findLegacyOpenRouterKey, migrateLegacyOpenRouterKey, refreshOpenRouterConnection, useUserApiKey } from '~/core/auth/useUserApiKey';

/** One metadata request per account/reconnect; no credentials in hydration state. */
export default defineNuxtPlugin(() => {
    if (useRuntimeConfig().public.ssrAuthEnabled !== true) return;
    const session = useSessionContext();
    const toast = useToast();
    const { connected } = useUserApiKey();
    const offered = new Set<string>();
    const refresh = async () => {
        const userId = session.data.value?.session?.authenticated ? session.data.value.session.user?.id : undefined;
        if (!userId) return;
        try {
            await refreshOpenRouterConnection();
            if (!connected.value && !offered.has(userId) && await findLegacyOpenRouterKey()) {
                if (session.data.value?.session?.user?.id !== userId) return;
                offered.add(userId);
                if (window.confirm('Move your existing OpenRouter key into secure account storage? It will work across devices. The browser copy is removed only after it is saved.')) {
                    await migrateLegacyOpenRouterKey();
                }
            }
        } catch {
            // Failed migration retains the source. An explicit reconnect/save remains available.
            if (session.data.value?.session?.user?.id === userId) toast.add({ title: 'OpenRouter connection unavailable', description: 'Your existing browser key has been retained. Reconnect or contact the administrator.', color: 'warning' });
        }
    };
    const stop = watch(() => session.data.value?.session?.user?.id, () => {
        void clearPersistedUserApiKey();
        void refresh();
    }, { immediate: true });
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    if (import.meta.hot) import.meta.hot.dispose(() => { stop(); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visible); });
});
