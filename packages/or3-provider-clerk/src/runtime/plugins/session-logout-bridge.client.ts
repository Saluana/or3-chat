import { logoutCleanup } from '~/utils/logout-cleanup';
import { useSessionContext } from '~/composables/auth/useSessionContext';

type ClerkClient = {
    loaded?: boolean;
    session?: unknown;
    addListener?: (callback: () => void) => () => void;
};

function shouldRunLogoutCleanup(
    authenticated: boolean | undefined,
    clerk: ClerkClient | null
): boolean {
    if (authenticated) return false;
    if (!clerk) return true;
    if (!clerk.loaded) return false;
    return !clerk.session;
}

async function waitForClerk(maxWaitMs = 5000): Promise<ClerkClient | null> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const clerk = (window as unknown as { Clerk?: ClerkClient }).Clerk;
        if (clerk?.loaded) return clerk;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
}

export default defineNuxtPlugin(async () => {
    if (import.meta.server) return;
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) return;

    const { refresh, data } = useSessionContext();
    const nuxtApp = useNuxtApp();
    const clerk = await waitForClerk();
    if (!clerk?.addListener) return;

    const unsubscribe = clerk.addListener(async () => {
        await refresh();
        if (shouldRunLogoutCleanup(data.value?.session?.authenticated, clerk)) {
            await logoutCleanup(nuxtApp as Parameters<typeof logoutCleanup>[0]);
        }
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unsubscribe();
        });
    }
});
