/**
 * Admin Authentication Route Middleware
 *
 * This middleware runs on admin pages to check authentication before rendering.
 * It provides a clean UX by redirecting to login before the page even mounts.
 *
 * This is Layer 1 of the auth protection (client/universal).
 * Layer 2 is the server middleware that protects APIs.
 */
import { defineNuxtRouteMiddleware, navigateTo } from '#app';

export default defineNuxtRouteMiddleware(async (to) => {
    // Skip for login page
    if (to.path === '/admin/login' || to.path.startsWith('/admin/login/')) {
        return;
    }

    try {
        const requestFetch = useRequestFetch();
        const data = await requestFetch<{ authenticated: boolean; kind: string }>('/api/admin/auth/session', {
            credentials: 'include',
            headers: {
                Accept: 'application/json',
            },
        });

        if (data.authenticated) {
            return;
        }

        return navigateTo('/admin/login');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const status = error?.statusCode || error?.status || error?.response?.status;

        if (status === 404) {
            // Admin endpoint not available (admin disabled or not configured)
            // Redirect to home to avoid showing a broken page
            console.log('[admin-auth middleware] Admin not available (404), redirecting to home');
            return navigateTo('/');
        }

        if (status === 401 || status === 403) {
            console.log('[admin-auth middleware] Not authenticated, redirecting to login');
            return navigateTo('/admin/login');
        }

        console.error('[admin-auth middleware] Auth check error:', error);
        return navigateTo('/admin/login');
    }
});
