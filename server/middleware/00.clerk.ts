/**
 * @module server/middleware/00.clerk
 *
 * Purpose:
 * Initializes Clerk request context for SSR requests when OR3 SSR auth is enabled.
 * This middleware is responsible for populating `event.context.auth` so downstream
 * SSR endpoints and middleware can resolve sessions and perform authorization.
 *
 * Behavior:
 * - No-ops unless `runtimeConfig.auth.enabled === true`
 * - Dynamically imports `@clerk/nuxt/server` to avoid pulling Clerk into builds
 *   when SSR auth is disabled
 * - Runs before other middleware (file name prefix `00.`) so `event.context.auth`
 *   is available early
 *
 * Constraints:
 * - SSR only. This file must not be imported into static builds.
 * - This middleware does not authorize routes. It only establishes auth context.
 *
 * Non-Goals:
 * - Route access control. Downstream server routes must enforce authorization
 *   explicitly (for OR3 Cloud SSR, `can()` is the sole authorization gate).
 */

import { useRuntimeConfig } from '#imports';

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
