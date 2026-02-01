/**
 * Clerk middleware - must run before other middleware to populate event.context.auth
 */
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    // Only run middleware when SSR auth is enabled
    if (config.auth.enabled !== true) {
        return;
    }

    // Dynamic import to avoid loading Clerk when disabled
    const { clerkMiddleware } = await import('@clerk/nuxt/server');
    const middleware = clerkMiddleware();
    return middleware(event);
});
