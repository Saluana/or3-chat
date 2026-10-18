/**
 * Admin Authentication Route Middleware
 *
 * This middleware runs on admin pages to check authentication before rendering.
 * It provides a clean UX by redirecting to login before the page even mounts.
 *
 * This is Layer 1 of the auth protection (client/universal).
 * Layer 2 is the server middleware that protects APIs.
 */
import {
    defineNuxtRouteMiddleware,
    navigateTo,
    useNuxtData,
    createError,
} from '#app';

type AdminSessionKind = 'super_admin' | 'workspace_admin';

type FetchLikeError = {
    statusCode?: number;
    status?: number;
    response?: {
        status?: number;
    };
};

function getStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const e = error as FetchLikeError;
    return e.statusCode ?? e.status ?? e.response?.status;
}

function isWorkspaceScopedPath(path: string): boolean {
    return (
        path === '/admin' ||
        path === '/admin/' ||
        path === '/admin/plugins' ||
        path.startsWith('/admin/plugins/') ||
        path === '/admin/workspace' ||
        path.startsWith('/admin/workspace/')
    );
}

function resolveAdminLanding(kind: AdminSessionKind): string {
    return kind === 'super_admin' ? '/admin' : '/admin/plugins';
}

export default defineNuxtRouteMiddleware(async (to) => {
    // Skip for login page
    if (to.path === '/admin/login' || to.path.startsWith('/admin/login/')) {
        return;
    }

    try {
        const requestFetch = useRequestFetch();
        const data = await requestFetch<{ authenticated: boolean; kind: AdminSessionKind }>('/api/admin/auth/session', {
            credentials: 'include',
            cache: 'no-store',
            retry: 0,
            timeout: 3000,
            headers: {
                Accept: 'application/json',
            },
        });
        useNuxtData<{ authenticated: boolean; kind: AdminSessionKind }>(
            'admin:auth:session'
        ).data.value = data;

        if (data.authenticated && data.kind === 'super_admin') {
            return;
        }

        if (data.authenticated && data.kind === 'workspace_admin') {
            if (isWorkspaceScopedPath(to.path)) {
                if (to.path === '/admin' || to.path === '/admin/') {
                    return navigateTo(resolveAdminLanding(data.kind));
                }
                return;
            }

            return navigateTo(resolveAdminLanding(data.kind));
        }

        useNuxtData('admin:auth:session').data.value = undefined;
        return navigateTo('/admin/login');
    } catch (error: unknown) {
        const status = getStatus(error);

        if (status === 404) {
            useNuxtData('admin:auth:session').data.value = undefined;
            if (import.meta.dev) {
                console.log(
                    '[admin-auth middleware] Admin session route unavailable (404), redirecting to login'
                );
            }
            return navigateTo('/admin/login');
        }

        if (status === 401 || status === 403) {
            useNuxtData('admin:auth:session').data.value = undefined;
            if (import.meta.dev) {
                console.log(
                    '[admin-auth middleware] Not authenticated, redirecting to login'
                );
            }
            return navigateTo('/admin/login');
        }

        // Maintenance or a transport outage does not invalidate authentication.
        // Do not render protected content from cached identity or redirect to login.
        throw createError({
            statusCode: 503,
            statusMessage: 'Admin session temporarily unavailable. Please retry shortly.',
        });
    }
});
