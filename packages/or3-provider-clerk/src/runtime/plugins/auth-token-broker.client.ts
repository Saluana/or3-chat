import { registerAuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';
import {
    registerClientAuthStatusResolver,
} from '~/composables/auth/useClientAuthStatus.client';

interface ClerkClient {
    loaded?: boolean;
    session?: {
        getToken: (options?: { template?: string }) => Promise<string | null>;
    } | null;
}

function waitForClerk(timeoutMs = 5000): Promise<ClerkClient | null> {
    return new Promise((resolve) => {
        const startTime = Date.now();

        const check = () => {
            const clerk = (window as unknown as { Clerk?: ClerkClient }).Clerk;
            if (clerk?.loaded) {
                resolve(clerk);
                return;
            }

            if (Date.now() - startTime > timeoutMs) {
                console.warn('[auth-token-broker] Clerk load timeout');
                resolve(null);
                return;
            }

            setTimeout(check, 50);
        };

        check();
    });
}

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) return;

    registerAuthTokenBroker(() => ({
        async getProviderToken(input) {
            try {
                const clerk = await waitForClerk();
                if (!clerk?.session) {
                    return null;
                }

                return await clerk.session.getToken({ template: input.template });
            } catch (error) {
                console.error('[auth-token-broker] Failed to get provider token:', error);
                return null;
            }
        },
    }));

    registerClientAuthStatusResolver(async () => {
        const clerk = await waitForClerk(2000);
        if (!clerk) {
            return { ready: false, authenticated: undefined };
        }
        const ready = Boolean(clerk.loaded);
        return {
            ready,
            authenticated: clerk.session ? true : false,
        };
    });
});
