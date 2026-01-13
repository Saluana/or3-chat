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
    if (!runtimeConfig.public.convex?.url) {
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
            return await clerk.session.getToken({ template: 'convex' });
        } catch (error) {
            console.error('[convex-clerk] Failed to get auth token:', error);
            return null;
        }
    };

    // Register the auth provider with Convex
    convex.setAuth(getToken);

    // Listen for session changes to refresh auth
    if (clerk.addListener) {
        clerk.addListener(() => {
            // When session changes, Convex will automatically call getToken again
            convex.setAuth(getToken);
        });
    }
});
