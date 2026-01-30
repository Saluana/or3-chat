import {
    defineEventHandler,
    createError,
    getRequestHeader,
    sendRedirect,
} from 'h3';
import { isAdminEnabled } from '../utils/admin/is-admin-enabled';
import { normalizeHost } from '../utils/normalize-host';
import { resolveAdminRequestContext } from '../admin/context';

function isAdminPath(path: string, basePath: string): boolean {
    if (basePath === '/') return true;
    if (path === basePath) return true;
    return path.startsWith(basePath + '/');
}

/**
 * Check if path is the admin login page or login API (using internal /admin paths).
 * These are always accessible (when admin is enabled) to allow authentication.
 */
function isLoginPath(path: string): boolean {
    return (
        path === '/admin/login' ||
        path === '/api/admin/auth/login' ||
        path.startsWith('/admin/login/') ||
        path.startsWith('/api/admin/auth/login/')
    );
}

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
        const hostHeader = getRequestHeader(event, 'host') || '';
        const normalizedHost = normalizeHost(hostHeader);
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
