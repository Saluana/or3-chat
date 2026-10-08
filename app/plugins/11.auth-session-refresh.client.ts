import { watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { confirmClientSignedOut } from '~/composables/auth/confirmClientSignedOut';
import {
    ACTIVE_WORKSPACE_REVISION_STORAGE_KEY,
    activeWorkspaceRevisionCoordinator,
    parseActiveWorkspaceRevision,
    type ActiveWorkspaceRevision,
} from '~/composables/workspace/activeWorkspaceRevision';
import { useWorkspaceManagerSession } from '~/composables/workspace/useWorkspaceManagerSession';

const AUTH_SESSION_STORAGE_KEY = 'or3:auth-session-changed';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) return;

    const sessionContext = useSessionContext();
    const { refreshSessionForActiveWorkspaceRevision } =
        useWorkspaceManagerSession(sessionContext);

    const handleAuthSessionChanged = async (): Promise<void> => {
        try {
            const previousWorkspaceId =
                sessionContext.data.value?.session?.workspace?.id ?? null;
            const previousAuthenticated =
                sessionContext.data.value?.session?.authenticated ?? false;

            await sessionContext.refresh();

            const nextWorkspaceId =
                sessionContext.data.value?.session?.workspace?.id ?? null;
            const nextAuthenticated =
                sessionContext.data.value?.session?.authenticated ?? false;

            const workspaceChanged = previousWorkspaceId !== nextWorkspaceId;
            const authChanged = previousAuthenticated !== nextAuthenticated;

            if (!workspaceChanged && !authChanged) {
                return;
            }

            // Auth flip to signed-out must be confirmed — HMR can briefly null the session.
            if (previousAuthenticated && !nextAuthenticated) {
                const signedOut = await confirmClientSignedOut();
                if (!signedOut) {
                    return;
                }
            }

            reloadNuxtApp({ ttl: 500 });
        } catch (error) {
            console.warn('[auth-session-refresh] Failed to refresh auth session:', error);
        }
    };

    const handleActiveWorkspaceRevision = async (
        revision: ActiveWorkspaceRevision
    ): Promise<void> => {
        const previousWorkspaceId =
            sessionContext.data.value?.session?.workspace?.id ?? null;
        try {
            const refreshed = await refreshSessionForActiveWorkspaceRevision(revision);
            if (!refreshed) return;
            const nextWorkspaceId =
                sessionContext.data.value?.session?.workspace?.id ?? null;
            if (previousWorkspaceId !== nextWorkspaceId) {
                reloadNuxtApp({ ttl: 500 });
            }
        } catch (error) {
            console.warn(
                '[auth-session-refresh] Failed to apply active workspace revision:',
                error
            );
        }
    };

    const handleStorage = (event: StorageEvent): void => {
        if (event.key === ACTIVE_WORKSPACE_REVISION_STORAGE_KEY) {
            const revision = parseActiveWorkspaceRevision(event.newValue);
            if (!revision || !activeWorkspaceRevisionCoordinator.observe(revision)) {
                return;
            }
            void handleActiveWorkspaceRevision(revision);
            return;
        }
        if (event.key === AUTH_SESSION_STORAGE_KEY) {
            void handleAuthSessionChanged();
        }
    };

    // Provider cookies can renew independently of the host's cached session.
    // Refresh at expiry, and again on focus after suspended/offline tabs resume.
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryRefresh: Promise<void> | null = null;
    const refreshExpiredSession = (): void => {
        const session = sessionContext.data.value?.session;
        if (
            !session?.authenticated || !session.expiresAt ||
            Date.parse(session.expiresAt) > Date.now() || expiryRefresh
        ) return;
        expiryRefresh = handleAuthSessionChanged().finally(() => {
            expiryRefresh = null;
        });
    };
    const stopExpiryWatch = watch(
        () => sessionContext.data.value?.session?.expiresAt,
        (expiresAt) => {
            clearTimeout(expiryTimer);
            if (!expiresAt || !sessionContext.data.value?.session?.authenticated) return;
            expiryTimer = setTimeout(
                refreshExpiredSession,
                Math.max(0, Date.parse(expiresAt) - Date.now()) + 1
            );
        },
        { immediate: true }
    );
    const handleVisibility = (): void => {
        if (document.visibilityState === 'visible') refreshExpiredSession();
    };
    window.addEventListener('focus', refreshExpiredSession);
    document.addEventListener('visibilitychange', handleVisibility);

    window.addEventListener('or3:auth-session-changed', handleAuthSessionChanged);
    window.addEventListener('or3:sync-session-invalid', handleAuthSessionChanged);
    window.addEventListener('storage', handleStorage);

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            stopExpiryWatch();
            clearTimeout(expiryTimer);
            window.removeEventListener('focus', refreshExpiredSession);
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener(
                'or3:auth-session-changed',
                handleAuthSessionChanged
            );
            window.removeEventListener(
                'or3:sync-session-invalid',
                handleAuthSessionChanged
            );
            window.removeEventListener('storage', handleStorage);
        });
    }
});
