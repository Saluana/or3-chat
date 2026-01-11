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
import { useAuth } from '#imports';

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();

    // Skip if SSR auth is disabled (Clerk module won't be loaded)
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    // Get the Convex client instance from convex-nuxt
    const convex = useConvexClient();

    // Get Clerk's useAuth composable (auto-imported when @clerk/nuxt is loaded)
    let auth: ReturnType<typeof useAuth>;
    try {
        auth = useAuth();
    } catch {
        console.warn(
            '[convex-clerk] Clerk useAuth not available, skipping auth integration'
        );
        return;
    }

    // Define the token fetcher for Convex
    // This is called whenever Convex needs to authenticate a request
    const getToken = async (): Promise<string | null> => {
        try {
            // Request a JWT from Clerk using the 'convex' template
            // The template should be configured in Clerk dashboard to include
            // the claims that Convex expects
            const token = await auth.getToken.value({
                template: 'convex',
                skipCache: false,
            });

            return token;
        } catch (error) {
            console.error('[convex-clerk] Failed to get auth token:', error);
            return null;
        }
    };

    // Register the auth provider with Convex
    convex.setAuth(getToken);
});
