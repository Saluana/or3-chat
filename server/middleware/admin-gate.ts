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
 * Check if path is the admin login page or login API.
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

    const isBasePath = isAdminPath(event.path, basePath);
    const isDefaultPath = isAdminPath(event.path, defaultPath);
    if (!isBasePath && !isDefaultPath) return;

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

    // Allow unauthenticated access to login paths
    if (isLoginPath(event.path)) {
        // Redirect to workspaces if already authenticated
        const adminContext = await resolveAdminRequestContext(event);
        if (adminContext && event.path === '/admin/login') {
            return sendRedirect(event, '/admin/workspaces', 307);
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
            return sendRedirect(event, '/admin/login', 307);
        }
    }

    // Store admin context in event for downstream use
    event.context.admin = adminContext;

    if (basePath !== defaultPath && isBasePath && !isDefaultPath) {
        const rest =
            event.path === basePath ? '' : event.path.slice(basePath.length);
        return sendRedirect(event, `${defaultPath}${rest || ''}`, 307);
    }
});
