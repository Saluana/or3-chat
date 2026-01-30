import { watch } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { cleanupHookBridge } from '~/core/sync/hook-bridge';
import { cleanupSubscriptionManager } from '~/core/sync/subscription-manager';
import { logoutCleanup } from '~/utils/logout-cleanup';

export default defineNuxtPlugin(async () => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        setActiveWorkspaceDb(null);
        return;
    }

    const { data, refresh } = useSessionContext();
    const nuxtApp = useNuxtApp();

    await refresh();
    if (!data.value?.session?.authenticated) {
        await logoutCleanup(nuxtApp as Parameters<typeof logoutCleanup>[0]);
    }

    const resolveWorkspaceId = () =>
        data.value?.session?.authenticated ? data.value?.session?.workspace?.id ?? null : null;

    setActiveWorkspaceDb(resolveWorkspaceId());

    watch(
        () => data.value?.session,
        async (newSession, oldSession) => {
            const oldWorkspaceId = oldSession?.workspace?.id;
            if (oldWorkspaceId) {
                const dbName = `or3-db-${oldWorkspaceId}`;
                cleanupCursorManager(dbName);
                cleanupHookBridge(dbName);
                cleanupSubscriptionManager(`${oldWorkspaceId}:default`);
            }
            if (oldSession?.authenticated && !newSession?.authenticated) {
                await logoutCleanup(nuxtApp as Parameters<typeof logoutCleanup>[0]);
            }
            setActiveWorkspaceDb(resolveWorkspaceId());
        }
    );
});
