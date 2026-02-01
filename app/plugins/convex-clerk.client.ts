/**
 * Convex + Clerk Auth Integration Plugin
 *
 * This plugin connects Clerk authentication to Convex so that server-side
 * Convex functions (queries, mutations, actions) can access the authenticated
 * user's identity via `ctx.auth.getUserIdentity()`.
 *
 * Requirements:
 * 1. You must have a JWT template named 'convex' set up in your Clerk dashboard
 *    (see: https://docs.convex.dev/auth/clerk)
 * 2. SSR auth must be enabled (SSR_AUTH_ENABLED=true) for Clerk module to load
 *
 * The plugin only runs on the client side (.client.ts suffix).
 */

import { useConvexClient } from 'convex-vue';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';

// Full Clerk client type with load promise
interface ClerkClient {
    loaded?: boolean;
    session?: {
        getToken: (options?: { template?: string }) => Promise<string | null>;
    } | null;
    addListener?: (callback: (event: unknown) => void) => () => void;
}

// Wait for Clerk to be fully loaded
async function waitForClerk(maxWait = 10000): Promise<ClerkClient | null> {
    const start = Date.now();
    
    while (Date.now() - start < maxWait) {
        const clerk = (window as unknown as { Clerk?: ClerkClient }).Clerk;
        if (clerk?.loaded) {
            return clerk;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.warn('[convex-clerk] Timed out waiting for Clerk to load');
    return null;
}

export default defineNuxtPlugin(async () => {
    const runtimeConfig = useRuntimeConfig();

    // Skip if SSR auth is disabled (Clerk module won't be loaded)
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    // Skip if Convex isn't configured (prevents startup crash).
    if (!(runtimeConfig.public.convex as { url?: string })?.url) {
        return;
    }

    // Get the Convex client instance from convex-nuxt
    let convex: ReturnType<typeof useConvexClient>;
    try {
        convex = useConvexClient();
    } catch {
        return;
    }

    // Wait for Clerk to be loaded
    const clerk = await waitForClerk();
    if (!clerk) {
        console.warn('[convex-clerk] Clerk not available, skipping auth integration');
        return;
    }

    // Define the token fetcher for Convex
    const getToken = async (): Promise<string | null> => {
        try {
            if (!clerk.session) {
                return null;
            }
            return await clerk.session.getToken({ template: CONVEX_JWT_TEMPLATE });
        } catch (error) {
            console.error('[convex-clerk] Failed to get auth token:', error);
            return null;
        }
    };

    // Register the auth provider with Convex
    convex.setAuth(getToken);

    // Listen for session changes to refresh auth
    let unsubscribeClerkListener: (() => void) | undefined;
    if (clerk.addListener) {
        unsubscribeClerkListener = clerk.addListener(() => {
            // When session changes, Convex will automatically call getToken again
            convex.setAuth(getToken);
        });
    }

    // Clean up listener on HMR to prevent memory leaks
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unsubscribeClerkListener?.();
        });
    }
});
