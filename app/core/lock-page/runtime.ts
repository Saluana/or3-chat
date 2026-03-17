import { useRuntimeConfig } from '#imports';

export const DEFAULT_LOCK_PAGE_ROUTE = '/welcome';

interface LockPagePublicRuntimeConfig {
    ssrAuthEnabled?: boolean;
    guestAccessEnabled?: boolean;
    authProvider?: string;
    admin?: {
        basePath?: string;
    };
    lockPage?: {
        enabled?: boolean;
        adapter?: string;
    };
}

export interface LockPageRuntimeConfig {
    ssrAuthEnabled: boolean;
    enabled: boolean;
    adapter: string;
    route: string;
    adminBasePath: string;
    guestAccessEnabled: boolean;
    authProvider: string;
}

function normalizePath(value: string | null | undefined, fallback = '/'): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return fallback;
    const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (withLeadingSlash === '/') return '/';
    return withLeadingSlash.replace(/\/+$/, '') || '/';
}

export function resolveLockPageRuntimeConfig(
    publicConfig: LockPagePublicRuntimeConfig = {}
): LockPageRuntimeConfig {
    const adminBasePath = normalizePath(publicConfig.admin?.basePath, '/admin');

    return {
        ssrAuthEnabled: publicConfig.ssrAuthEnabled === true,
        enabled: publicConfig.lockPage?.enabled === true,
        adapter: String(publicConfig.lockPage?.adapter ?? 'default').trim() || 'default',
        route: DEFAULT_LOCK_PAGE_ROUTE,
        adminBasePath,
        guestAccessEnabled: publicConfig.guestAccessEnabled === true,
        authProvider: String(publicConfig.authProvider ?? 'clerk').trim() || 'clerk',
    };
}

export function useLockPageRuntimeConfig(): LockPageRuntimeConfig {
    return resolveLockPageRuntimeConfig(
        useRuntimeConfig().public as LockPagePublicRuntimeConfig
    );
}

export function isSameOrChildPath(path: string, basePath: string): boolean {
    const normalizedPath = normalizePath(path);
    const normalizedBasePath = normalizePath(basePath);
    return (
        normalizedPath === normalizedBasePath ||
        normalizedPath.startsWith(`${normalizedBasePath}/`)
    );
}

export function isAdminRoute(path: string, adminBasePath: string): boolean {
    return isSameOrChildPath(path, adminBasePath);
}

export function sanitizeLockPageRedirectTarget(
    value: unknown,
    fallback = '/'
): string {
    const candidate: unknown = Array.isArray(value)
        ? (value as unknown[])[0]
        : value;
    if (typeof candidate !== 'string') return fallback;

    const trimmed = candidate.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
        return fallback;
    }

    try {
        const parsed = new URL(trimmed, 'http://or3.local');
        if (parsed.origin !== 'http://or3.local') {
            return fallback;
        }
        const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return normalized || fallback;
    } catch {
        return fallback;
    }
}

export function resolvePostAuthRedirectTarget(
    next: unknown,
    lockPageRoute: string
): string {
    const target = sanitizeLockPageRedirectTarget(next, '/');
    return normalizePath(target) === normalizePath(lockPageRoute) ? '/' : target;
}
