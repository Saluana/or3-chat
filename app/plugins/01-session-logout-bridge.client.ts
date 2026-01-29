import { logoutCleanup } from '~/utils/logout-cleanup';
import { useSessionContext } from '~/composables/auth/useSessionContext';

type ClerkClient = {
    loaded?: boolean;
    session?: unknown;
    addListener?: (callback: () => void) => () => void;
};

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
        if (!data.value?.session?.authenticated) {
            await logoutCleanup(nuxtApp);
        }
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unsubscribe?.();
        });
    }
});
