import {
    defineEventHandler,
    createError,
    getRequestHeader,
    sendRedirect,
} from 'h3';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';

function normalizeHost(host: string): string {
    const lower = host.trim().toLowerCase();
    const withoutPort = lower.includes(':') ? lower.split(':')[0] || lower : lower;
    return withoutPort;
}

function isAdminPath(path: string, basePath: string): boolean {
    if (basePath === '/') return true;
    if (path === basePath) return true;
    return path.startsWith(basePath + '/');
}

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const adminConfig = config.admin as { basePath?: string; allowedHosts?: string[] } | undefined;
    const basePath = adminConfig?.basePath || '/admin';
    const defaultPath = '/admin';

    const isBasePath = isAdminPath(event.path, basePath);
    const isDefaultPath = isAdminPath(event.path, defaultPath);
    if (!isBasePath && !isDefaultPath) return;

    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

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

    if (basePath !== defaultPath && isBasePath && !isDefaultPath) {
        const rest =
            event.path === basePath ? '' : event.path.slice(basePath.length);
        return sendRedirect(event, `${defaultPath}${rest || ''}`, 307);
    }
});
