import { watch } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
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

    // Initialize the unified workspace manager
    // This will handle setting the active workspace DB automatically
    const { activeWorkspaceId } = useWorkspaceManager();

    // Watch for workspace changes to handle cleanup
    watch(
        activeWorkspaceId,
        async (newWorkspaceId, oldWorkspaceId) => {
            // Clean up resources from old workspace
            if (oldWorkspaceId) {
                const dbName = `or3-db-${oldWorkspaceId}`;
                cleanupCursorManager(dbName);
                cleanupHookBridge(dbName);
                cleanupSubscriptionManager(`${oldWorkspaceId}:default`);
            }
        }
    );

    // Watch for logout to clean up
    watch(
        () => data.value?.session,
        async (newSession, oldSession) => {
            if (oldSession?.authenticated && !newSession?.authenticated) {
                await logoutCleanup(nuxtApp as Parameters<typeof logoutCleanup>[0]);
            }
        }
    );
});
