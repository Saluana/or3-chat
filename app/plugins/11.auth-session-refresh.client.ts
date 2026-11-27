import { watch } from 'vue';
import { noteClientSessionRateLimit } from '~/composables/auth/client-session-request';
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
const AUTH_SESSION_ERROR_TOAST_ID = 'auth-session-refresh-failed';

export default defineNuxtPlugin((nuxtApp) => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) return;

    const sessionContext = useSessionContext({ autoLoad: false });
    const toast = useToast();
    const { refreshSessionForActiveWorkspaceRevision } =
        useWorkspaceManagerSession(sessionContext);

    let retryAt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let activeRefresh: Promise<void> | undefined;
    let pendingIdentitySignal = false;
    let disposed = false;
    const scheduleRetry = () => {
        if (disposed || retryTimer || !retryAt) return;
        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void handleAuthSessionChanged();
        }, Math.min(2_147_483_647, Math.max(0, retryAt - Date.now())));
    };
    const runRefresh = async (): Promise<void> => {
        try {
            const previous = sessionContext.data.value?.session;
            const transition = { reload: false, signedOut: false };
            const refreshed = await sessionContext.refresh({
                async shouldCommit(payload) {
                    if (disposed || pendingIdentitySignal) return false;
                    const next = payload.session;
                    const previousAuthenticated = previous?.authenticated ?? false;
                    const nextAuthenticated = next?.authenticated ?? false;
                    const workspaceChanged = (previous?.workspace?.id ?? null) !== (next?.workspace?.id ?? null);
                    const userChanged = previous?.user?.id !== next?.user?.id;

                    // A transient signed-out response should not replace a live session.
                    if (previousAuthenticated && !nextAuthenticated) {
                        transition.signedOut = await confirmClientSignedOut();
                        transition.reload = transition.signedOut;
                        return !disposed && !pendingIdentitySignal && transition.signedOut;
                    }
                    if (!previousAuthenticated && nextAuthenticated) {
                        // Let the new page bootstrap sync once.
                        transition.reload = true;
                        return false;
                    }
                    transition.reload = workspaceChanged || userChanged;
                    return true;
                },
            });
            if (!refreshed || disposed || pendingIdentitySignal) return;
            retryAt = 0;
            toast.remove(AUTH_SESSION_ERROR_TOAST_ID);
            if (transition.signedOut) {
                const { cleanupConfirmedLogout } = await import('~/utils/logout-cleanup');
                if (disposed || pendingIdentitySignal || sessionContext.data.value !== refreshed) return;
                await cleanupConfirmedLogout(refreshed, nuxtApp);
                if (disposed || pendingIdentitySignal || sessionContext.data.value !== refreshed) return;
            }
            if (transition.reload) reloadNuxtApp({ ttl: 500 });
        } catch (error) {
            if (disposed) return;
            const limitedUntil = noteClientSessionRateLimit(error);
            const rateLimited = limitedUntil !== undefined;
            if (rateLimited) {
                retryAt = limitedUntil;
                scheduleRetry();
                // Existing local view/drafts stay intact while this retry is
                // pending. Do not turn a background 429 into an error toast.
                if (sessionContext.data.value?.session?.authenticated) return;
            }
            const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
            toast.add({
                id: AUTH_SESSION_ERROR_TOAST_ID,
                title: rateLimited ? 'Too many requests' : 'Unable to load your account',
                description: rateLimited
                    ? `Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
                    : "We couldn't load your workspace session. Please try again.",
                color: 'error',
                duration: 0,
                actions: [{
                    label: 'Retry',
                    closeOnClick: false,
                    onClick: () => {
                        if (!activeRefresh && Date.now() >= retryAt) void handleAuthSessionChanged();
                    },
                }],
            });
            console.warn('[auth-session-refresh] Failed to refresh auth session:', error);
        }
    };
    function handleAuthSessionChanged(identitySignal = false): Promise<void> {
        if (disposed) return Promise.resolve();
        if (activeRefresh) {
            // An actual identity signal after the request started may need a
            // fresh check; expiry, focus, and repeated sync errors can join.
            pendingIdentitySignal ||= identitySignal;
            return activeRefresh;
        }
        if (Date.now() < retryAt) {
            scheduleRetry();
            return Promise.resolve();
        }
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryAt = 0;
        activeRefresh = runRefresh().finally(() => {
            activeRefresh = undefined;
            if (pendingIdentitySignal) {
                pendingIdentitySignal = false;
                void handleAuthSessionChanged();
            }
        });
        return activeRefresh;
    }
    const handleIdentitySignal = () => { void handleAuthSessionChanged(true); };
    const handleSyncSignal = () => { void handleAuthSessionChanged(); };

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
        if (event.key === AUTH_SESSION_STORAGE_KEY) handleIdentitySignal();
    };

    // Provider cookies can renew independently of the host's cached session.
    // Refresh at expiry, and again on focus after suspended/offline tabs resume.
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshExpiredSession = (): void => {
        const session = sessionContext.data.value?.session;
        if (
            !session?.authenticated || !session.expiresAt ||
            Date.parse(session.expiresAt) > Date.now()
        ) return;
        void handleAuthSessionChanged();
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

    window.addEventListener('or3:auth-session-changed', handleIdentitySignal);
    window.addEventListener('or3:sync-session-invalid', handleSyncSignal);
    window.addEventListener('storage', handleStorage);

    const dispose = () => {
        disposed = true;
        stopExpiryWatch();
        clearTimeout(expiryTimer);
        clearTimeout(retryTimer);
        window.removeEventListener('focus', refreshExpiredSession);
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('or3:auth-session-changed', handleIdentitySignal);
        window.removeEventListener('or3:sync-session-invalid', handleSyncSignal);
        window.removeEventListener('storage', handleStorage);
    };
    nuxtApp.vueApp?.onUnmount(dispose);
    import.meta.hot?.dispose(dispose);
});
