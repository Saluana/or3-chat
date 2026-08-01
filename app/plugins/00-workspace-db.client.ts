import { watch } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { confirmClientSignedOut } from '~/composables/auth/confirmClientSignedOut';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { cleanupHookBridge } from '~/core/sync/hook-bridge';
import { cleanupSubscriptionManager } from '~/core/sync/subscription-manager';
import { logoutCleanup } from '~/utils/logout-cleanup';

async function shouldRunLogoutCleanup(
    authenticated: boolean | undefined
): Promise<boolean> {
    if (authenticated) return false;
    return await confirmClientSignedOut();
}

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
    if (await shouldRunLogoutCleanup(data.value?.session?.authenticated)) {
        const cleanupOptions: {
            preserveExternalAgentCredentials: boolean;
            preserveOpenRouterPkce?: boolean;
        } = { preserveExternalAgentCredentials: true };
        // This page must retain the verifier created before the redirect, even
        // when the workspace session is unauthenticated. It is cleared as soon
        // as the OpenRouter exchange completes.
        if (window.location.pathname === '/openrouter-callback') {
            cleanupOptions.preserveOpenRouterPkce = true;
        }
        await logoutCleanup(
            nuxtApp as Parameters<typeof logoutCleanup>[0],
            cleanupOptions
        );
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
            if (
                oldSession?.authenticated &&
                !newSession?.authenticated &&
                (await shouldRunLogoutCleanup(newSession?.authenticated))
            ) {
                await logoutCleanup(nuxtApp as Parameters<typeof logoutCleanup>[0]);
            }
        }
    );
});
