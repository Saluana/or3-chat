import { useSessionContext } from '~/composables/auth/useSessionContext';

const AUTH_SESSION_STORAGE_KEY = 'or3:auth-session-changed';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const sessionContext = useSessionContext();

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

            if (
                previousWorkspaceId !== nextWorkspaceId ||
                previousAuthenticated !== nextAuthenticated
            ) {
                reloadNuxtApp({ ttl: 500 });
            }
        } catch (error) {
            console.warn('[auth-session-refresh] Failed to refresh auth session:', error);
        }
    };

    const handleStorage = (event: StorageEvent): void => {
        if (event.key !== AUTH_SESSION_STORAGE_KEY) return;
        void handleAuthSessionChanged();
    };

    window.addEventListener('or3:auth-session-changed', handleAuthSessionChanged);
    window.addEventListener('or3:sync-session-invalid', handleAuthSessionChanged);
    window.addEventListener('storage', handleStorage);

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
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
