import {
    defineEventHandler,
    createError,
    sendRedirect,
} from 'h3';
import { useRuntimeConfig } from '#imports';
import { isAdminEnabled } from '../utils/admin/is-admin-enabled';
import { normalizeHost } from '../utils/normalize-host';
import { resolveAdminRequestContext } from '../admin/context';
import { getProxyRequestHost, normalizeProxyTrustConfig } from '../utils/net/request-identity';

/**
 * @module server/middleware/admin-gate
 *
 * Purpose:
 * Protects the admin UI surface by gating admin routes behind:
 * - An enablement flag (`isAdminEnabled`)
 * - An optional host allowlist (supports reverse proxy deployments)
 * - A resolved admin session (`resolveAdminRequestContext`)
 *
 * Behavior:
 * 1. Skips non-admin paths entirely (early return)
 * 2. If a custom `admin.basePath` is configured, blocks the default `/admin/*`
 *    path (404) for UI routes while still allowing `/api/admin/*`.
 * 3. Rewrites custom base path UI requests to `/admin/*` internally so Nuxt pages
 *    are reachable without duplicating routes.
 * 4. Enforces host allowlist when configured. If a proxy is trusted, uses
 *    forwarded host headers; otherwise uses `Host`.
 * 5. Allows unauthenticated access to login paths.
 * 6. Requires an admin session for all other admin paths; redirects UI requests
 *    to login and returns 401 for API requests.
 * 7. Stores the resolved context on `event.context.admin` for downstream use.
 *
 * Auth boundary:
 * This middleware establishes admin session context for UI navigation.
 * Downstream admin API routes must still enforce authorization explicitly.
 * For OR3 Cloud SSR endpoints, `can()` is the sole authorization gate.
 *
 * Constraints:
 * - SSR only. Not intended for static builds.
 * - Uses 404 for several denial cases to reduce information leakage about the
 *   existence of admin routes.
 *
 * Non-Goals:
 * - Fine-grained permissions. This middleware only checks session presence.
 * - Protecting non-admin routes. It intentionally early-returns for everything else.
 */

/**
 * Internal helper.
 *
 * Purpose:
 * Normalizes the idea of "is under basePath" for both `/admin` and custom base
 * paths, including the exact base path value.
 */
function isAdminPath(path: string, basePath: string): boolean {
    if (basePath === '/') return true;
    if (path === basePath) return true;
    return path.startsWith(basePath + '/');
}

/**
 * Check if path is the admin login page or login API (using internal /admin paths).
 * These are always accessible (when admin is enabled) to allow authentication.
 */
/**
 * Internal helper.
 *
 * Purpose:
 * Identifies the subset of admin routes that must remain reachable without an
 * existing admin session.
 *
 * Constraints:
 * - Uses internal `/admin/*` paths. Call after any basePath rewrite.
 */
function isLoginPath(path: string): boolean {
    return (
        path === '/admin/login' ||
        path === '/api/admin/auth/login' ||
        path.startsWith('/admin/login/') ||
        path.startsWith('/api/admin/auth/login/')
    );
}

/**
 * Admin route guard.
 *
 * Purpose:
 * Enforces admin enablement, host allowlisting, and session presence for admin
 * routes. Designed to be safe for proxy deployments and compatible with custom
 * admin base paths.
 *
 * @remarks
 * - Redirects use 307 to preserve method for login flows.
 * - When `admin.basePath` is customized, UI requests are rewritten to `/admin/*`
 *   so Nuxt page routing remains stable.
 */
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const adminConfig = config.admin as { basePath?: string; allowedHosts?: string[] } | undefined;
    const basePath = adminConfig?.basePath || '/admin';
    const defaultPath = '/admin';
    const hasCustomPath = basePath !== defaultPath;

    const isBasePath = isAdminPath(event.path, basePath);
    const isDefaultPath = isAdminPath(event.path, defaultPath);
    
    // Skip non-admin paths entirely
    if (!isBasePath && !isDefaultPath) return;

    // Block default /admin/* when a custom basePath is configured (security through obscurity)
    // Exception: Allow /api/admin/* as these are internal API routes
    if (hasCustomPath && isDefaultPath && !event.path.startsWith('/api/admin')) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    // Rewrite custom basePath requests to /admin internally so Nuxt pages work
    if (hasCustomPath && isBasePath && !event.path.startsWith('/api/')) {
        const rest = event.path === basePath ? '' : event.path.slice(basePath.length);
        event.node.req.url = `/admin${rest || ''}`;
        // Update event.path to reflect the rewrite for downstream checks
        Object.defineProperty(event, 'path', {
            value: `/admin${rest || ''}`,
            writable: true,
            configurable: true,
        });
    }

    // Check if admin is enabled - 404 if not
    if (!isAdminEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    // Check allowed hosts
    const allowedHosts = (adminConfig?.allowedHosts || [])
        .map((host) => host.trim())
        .filter(Boolean)
        .map((host) => normalizeHost(host));

    if (allowedHosts.length > 0) {
        const proxyConfig = normalizeProxyTrustConfig(config.security.proxy);
        const requestHost = getProxyRequestHost(event, proxyConfig);

        if (!requestHost) {
            throw createError({ statusCode: 404, statusMessage: 'Not Found' });
        }

        const normalizedHost = normalizeHost(requestHost);
        if (!allowedHosts.includes(normalizedHost)) {
            throw createError({ statusCode: 404, statusMessage: 'Not Found' });
        }
    }

    // Allow unauthenticated access to login paths (checked after rewrite)
    if (isLoginPath(event.path)) {
        // Redirect to workspaces if already authenticated
        const adminContext = await resolveAdminRequestContext(event);
        if (adminContext && event.path === '/admin/login') {
            return sendRedirect(event, `${basePath}/workspaces`, 307);
        }
        return;
    }

    // Require admin authentication for all other admin paths
    const adminContext = await resolveAdminRequestContext(event);

    if (!adminContext) {
        // Redirect to login page for UI routes, 401 for API routes
        if (event.path.startsWith('/api/')) {
            throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
        } else {
            return sendRedirect(event, `${basePath}/login`, 307);
        }
    }

    // Store admin context in event for downstream use
    event.context.admin = adminContext;
});
