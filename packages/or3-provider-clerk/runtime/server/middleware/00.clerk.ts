/**
 * @module packages/or3-provider-clerk/runtime/server/middleware/00.clerk
 *
 * Purpose:
 * Initializes Clerk request context for SSR requests when OR3 SSR auth is enabled.
 */
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    if (config.auth.enabled !== true) {
        return;
    }

    const { clerkMiddleware } = await import('@clerk/nuxt/server');
    const middleware = clerkMiddleware();
    return middleware(event);
});
