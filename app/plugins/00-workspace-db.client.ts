import { watch } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { confirmClientSignedOut } from '~/composables/auth/confirmClientSignedOut';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { cleanupHookBridge } from '~/core/sync/hook-bridge';
import { cleanupSubscriptionManager } from '~/core/sync/subscription-manager';
import { clearPersistedUserApiKey } from '~/core/auth/useUserApiKey';
import { logoutCleanup } from '~/utils/logout-cleanup';
import { stopWorkspacePluginsAndAwait } from '~/composables/plugins/workspace-plugin-coordinator';
import { abortBackgroundClientToolDispatchesForWorkspace } from '~/utils/chat/useAi-internal/backgroundJobs';

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
    const initialSession = data.value?.session;
    if (
        (await shouldRunLogoutCleanup(initialSession?.authenticated)) &&
        data.value?.session === initialSession
    ) {
        const cleanupOptions: {
            preservePluginSecrets: boolean;
            preserveOpenRouterPkce?: boolean;
        } = { preservePluginSecrets: true };
        // This page must retain the verifier created before the redirect, even
        // when the workspace session is unauthenticated. It is cleared as soon
        // as the OpenRouter exchange completes.
        if (window.location.pathname === '/openrouter-callback') {
            cleanupOptions.preserveOpenRouterPkce = true;
        }
        const cleanup = logoutCleanup(
            nuxtApp as Parameters<typeof logoutCleanup>[0],
            cleanupOptions
        );
        await stopWorkspacePluginsAndAwait();
        await cleanup;
    }

    // Register before workspace management so an account change captures the
    // previous DB and clears memory synchronously, even without a signed-out
    // intermediate session. Same-user workspace switches retain the key.
    watch(
        () => data.value?.session,
        (newSession, oldSession) => {
            if (
                oldSession?.authenticated &&
                newSession?.authenticated &&
                oldSession.user?.id !== newSession.user?.id
            ) {
                void clearPersistedUserApiKey().catch(() => {
                    // Best-effort; memory and pending hydration are cleared first.
                });
            }
        },
        { flush: 'sync' }
    );

    // Initialize the unified workspace manager
    // This will handle setting the active workspace DB automatically
    const { activeWorkspaceId } = useWorkspaceManager();

    // Watch for workspace changes to handle cleanup
    watch(
        activeWorkspaceId,
        async (newWorkspaceId, oldWorkspaceId) => {
            // Clean up resources from old workspace
            if (oldWorkspaceId) {
                abortBackgroundClientToolDispatchesForWorkspace(oldWorkspaceId);
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
                (await shouldRunLogoutCleanup(newSession?.authenticated)) &&
                data.value?.session === newSession
            ) {
                const cleanup = logoutCleanup(nuxtApp as Parameters<typeof logoutCleanup>[0]);
                await stopWorkspacePluginsAndAwait();
                await cleanup;
            }
        }
    );
});
