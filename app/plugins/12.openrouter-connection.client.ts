import { watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { clearPersistedUserApiKey, findLegacyOpenRouterKey, migrateLegacyOpenRouterKey, refreshOpenRouterConnection, useUserApiKey } from '~/core/auth/useUserApiKey';

/** One metadata request per account/reconnect; no credentials in hydration state. */
export default defineNuxtPlugin((nuxtApp) => {
    if (useRuntimeConfig().public.ssrAuthEnabled !== true) return;
    const session = useSessionContext();
    const toast = useToast();
    const { connected } = useUserApiKey();
    const offered = new Set<string>();
    const refresh = async () => {
        const userId = session.data.value?.session?.authenticated ? session.data.value.session.user?.id : undefined;
        if (!userId) return;
        let legacyKeyAvailable: boolean;
        try {
            await refreshOpenRouterConnection();
            legacyKeyAvailable = !connected.value && !offered.has(userId) && await findLegacyOpenRouterKey();
        } catch {
            // Passive checks can fail offline or during startup. Explicit connect
            // and save actions report their own errors without a toast on every load.
            return;
        }
        if (!legacyKeyAvailable || offered.has(userId) || session.data.value?.session?.user?.id !== userId) return;
        offered.add(userId);
        if (!window.confirm('Move your existing OpenRouter key into secure account storage? It will work across devices. The browser copy is removed only after it is saved.')) return;
        try {
            await migrateLegacyOpenRouterKey();
        } catch {
            if (session.data.value?.session?.user?.id === userId) toast.add({ title: 'OpenRouter key migration failed', description: 'Your existing browser key has been retained. Reconnect or contact the administrator.', color: 'warning' });
        }
    };
    let stop = () => {};
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    // Metadata and migration UI must not change the SSR tree during hydration.
    const removeMountedHook = nuxtApp.hook('app:mounted', () => {
        stop = watch(() => session.data.value?.session?.user?.id, () => {
            void clearPersistedUserApiKey();
            void refresh();
        }, { immediate: true });
        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', visible);
    });
    if (import.meta.hot) import.meta.hot.dispose(() => { removeMountedHook(); stop(); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visible); });
});
