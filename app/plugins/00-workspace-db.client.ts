import { watch } from 'vue';
import { liveQuery } from 'dexie';
import { getDb, setActiveWorkspaceDb } from '~/db/client';
import { clearClientWorkspaceSession, useSessionContext } from '~/composables/auth/useSessionContext';
import { confirmClientSignedOut } from '~/composables/auth/confirmClientSignedOut';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { clearPersistedUserApiKey } from '~/core/auth/useUserApiKey';
import { stopWorkspacePluginsAndAwait } from '~/composables/plugins/workspace-plugin-coordinator';
import { abortBackgroundClientToolDispatchesForWorkspace } from '~/utils/chat/useAi-internal/backgroundJobs';
import {
    bindOfflineWorkspaceDb,
    invalidateOfflineWorkspace,
    ownsOfflineWorkspaceDb,
    releaseOfflineWorkspaceDb,
    OFFLINE_WORKSPACE_KEY,
    OFFLINE_WORKSPACE_OWNER_PREFIX,
    parseOfflineWorkspace,
    readOfflineWorkspaceRecord,
    useOfflineWorkspace,
} from '~/composables/auth/offline-workspace';
import { flushWorkspaceTabDrafts } from '~/composables/core/useWorkspaceTabDrafts';

export default defineNuxtPlugin(async () => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        setActiveWorkspaceDb(null);
        return;
    }

    // This plugin validates the session itself below, so skip the automatic load.
    const { data, refresh } = useSessionContext({ autoLoad: false });
    const nuxtApp = useNuxtApp();

    const [{ cleanupCursorManager }, { cleanupHookBridge }, { cleanupSubscriptionManager }] = await Promise.all([
        import('~/core/sync/cursor-manager'), import('~/core/sync/hook-bridge'), import('~/core/sync/subscription-manager'),
    ]);

    const { logoutCleanup, clearDevicePluginSecrets, cleanupConfirmedLogout } = await import('~/utils/logout-cleanup');
    const offline = useOfflineWorkspace();
    const enterOfflineWorkspace = () => {
        if (navigator.onLine || offline.value) return;
        const verified = data.value;
        const saved = parseOfflineWorkspace(readOfflineWorkspaceRecord());
        if (!saved || (verified && (
            !verified.appAccessAllowed || !verified.offlineWorkspaceAccess ||
            verified.session?.user?.id !== saved.userId || verified.session.workspace?.id !== saved.workspaceId ||
            verified.session.role !== saved.role
        ))) return;
        if (!bindOfflineWorkspaceDb(saved)) return;
        offline.value = saved;
        clearClientWorkspaceSession();
    };
    enterOfflineWorkspace();
    // A failed session check is not evidence that local data needs cleanup.
    const validated = await refresh({ dedupe: 'defer' }).catch(() => {
        enterOfflineWorkspace();
        return undefined;
    });
    const initialSession = data.value?.session;
    if (
        validated === data.value &&
        validated &&
        !initialSession?.authenticated &&
        (await confirmClientSignedOut()) &&
        data.value === validated
    ) {
        const cleanupOptions: {
            preservePluginSecrets: boolean;
            preserveWorkspaceCaches: boolean;
            preserveOpenRouterPkce?: boolean;
        } = { preservePluginSecrets: true, preserveWorkspaceCaches: true };
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

    // Register before workspace management so an account change clears old
    // credentials synchronously. Remember the owner across transient null or
    // signed-out states while provider confirmation is still pending.
    let credentialOwner = initialSession?.user?.id ?? offline.value?.userId;
    watch(
        () => data.value?.session,
        (newSession) => {
            if (!newSession?.authenticated) return;
            const userId = newSession.user?.id;
            if (credentialOwner && credentialOwner !== userId) {
                clearDevicePluginSecrets();
                void clearPersistedUserApiKey().catch(() => {
                    // Best-effort; memory and pending hydration are cleared first.
                });
            }
            credentialOwner = userId;
        },
        { flush: 'sync' }
    );

    // Initialize the unified workspace manager
    // This will handle setting the active workspace DB automatically
    const { activeWorkspaceId } = useWorkspaceManager();

    // Keep ownership across a restart or reauthentication until the owner's
    // pending operations and transfers have drained. Scope the observation to
    // that account's verified session, and stop it when the tab goes offline.
    const stopOwnerWatch = watch(
        () => [data.value?.session, activeWorkspaceId.value, offline.value] as const,
        ([session, workspaceId, disconnected], _previous, onCleanup) => {
            const userId = session?.user?.id;
            if (disconnected || !userId || !workspaceId || session.workspace?.id !== workspaceId ||
                !ownsOfflineWorkspaceDb(workspaceId, userId)) return;
            const db = getDb();
            const pending = liveQuery(async () =>
                await db.pending_ops.filter(row => row.status !== 'applied' && row.status !== 'discarded').limit(1).count() > 0 ||
                await db.file_transfers.filter(row => row.direction === 'upload' && row.state !== 'done').limit(1).count() > 0
            ).subscribe({
                next(hasPending) {
                    if (!hasPending && navigator.onLine && !offline.value && data.value?.session?.user?.id === userId &&
                        activeWorkspaceId.value === workspaceId && getDb() === db) {
                        releaseOfflineWorkspaceDb(workspaceId, userId);
                    }
                },
                error() { /* Keep ownership if the local state cannot be read. */ },
            });
            onCleanup(() => pending.unsubscribe());
        },
        { immediate: true },
    );

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

    // Reopen the same DB locally while disconnected. Network clients still
    // see an empty session until a fresh server check succeeds.
    let revalidating = false;
    const revalidate = async () => {
        const previous = offline.value;
        if (!previous || !navigator.onLine || revalidating) return;
        revalidating = true;
        try {
            const checked = await refresh({
                revalidateOfflineWorkspace: true,
                shouldCommit: async (payload) => {
                    if (offline.value !== previous || !navigator.onLine) return false;
                    if (!payload.appAccessAllowed || payload.session?.user?.id !== previous.userId ||
                        payload.session.workspace?.id !== previous.workspaceId) {
                        await flushWorkspaceTabDrafts();
                    }
                    return offline.value === previous && navigator.onLine;
                },
            });
            if (checked && data.value === checked && (!checked.appAccessAllowed || checked.session?.user?.id !== previous.userId ||
                checked.session.workspace?.id !== previous.workspaceId)) {
                reloadNuxtApp({ ttl: 500 });
            }
        } catch {
            if (!offline.value) reloadNuxtApp({ ttl: 500 });
        } finally {
            revalidating = false;
        }
    };
    const stopOfflineAccess = () => {
        if (!offline.value) return;
        offline.value = null;
        clearClientWorkspaceSession();
        reloadNuxtApp({ ttl: 500 });
    };
    const handleStorage = (event: StorageEvent) => {
        if (event.key?.startsWith(OFFLINE_WORKSPACE_OWNER_PREFIX) && !offline.value) {
            const session = data.value?.session;
            if (session?.workspace?.id === event.key.slice(OFFLINE_WORKSPACE_OWNER_PREFIX.length) &&
                event.newValue && event.newValue !== session.user?.id) {
                clearClientWorkspaceSession();
                reloadNuxtApp({ ttl: 500 });
            }
            return;
        }
        if (event.key === 'or3:auth-session-changed') {
            stopOfflineAccess();
            return;
        }
        if ((event.key !== OFFLINE_WORKSPACE_KEY && event.key !== null) || !offline.value) return;
        const saved = parseOfflineWorkspace(readOfflineWorkspaceRecord());
        const current = offline.value;
        if (!saved || saved.userId !== current.userId || saved.workspaceId !== current.workspaceId ||
            saved.role !== current.role) stopOfflineAccess();
    };
    const handleProviderChange = () => {
        if (readOfflineWorkspaceRecord()) invalidateOfflineWorkspace();
        stopOfflineAccess();
    };
    window.addEventListener('offline', enterOfflineWorkspace);
    window.addEventListener('online', revalidate);
    window.addEventListener('focus', revalidate);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('or3:auth-session-changed', handleProviderChange);
    if (offline.value && navigator.onLine) void revalidate();
    const dispose = () => {
        stopOwnerWatch();
        window.removeEventListener('offline', enterOfflineWorkspace);
        window.removeEventListener('online', revalidate);
        window.removeEventListener('focus', revalidate);
        window.removeEventListener('storage', handleStorage);
        window.removeEventListener('or3:auth-session-changed', handleProviderChange);
    };
    nuxtApp.vueApp.onUnmount(dispose);
    import.meta.hot?.dispose(dispose);

    // Watch for logout to clean up
    watch(
        data,
        async (next, previous) => {
            if (
                previous?.session?.authenticated &&
                next &&
                !next.session?.authenticated &&
                (await confirmClientSignedOut()) &&
                data.value === next
            ) {
                await cleanupConfirmedLogout(next, nuxtApp);
            }
        }
    );
});
