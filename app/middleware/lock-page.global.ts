import { abortNavigation, defineNuxtRouteMiddleware, navigateTo } from '#app';
import { resolveLockPageAccess } from '~/core/lock-page/access';
import {
    isAdminRoute,
    sanitizeLockPageRedirectTarget,
    useLockPageRuntimeConfig,
} from '~/core/lock-page/runtime';

export default defineNuxtRouteMiddleware(async (to, from) => {
    const config = useLockPageRuntimeConfig();

    if (!config.ssrAuthEnabled || !config.enabled) {
        return;
    }

    if (isAdminRoute(to.path, config.adminBasePath)) {
        return;
    }

    if (to.path === config.route || to.path.startsWith(`${config.route}/`)) {
        return;
    }

    if (to.meta.lockPageProtected !== true) {
        return;
    }

    const access = await resolveLockPageAccess();
    if (access.allowed) {
        return;
    }

    if (access.reason === 'session-rate-limited' &&
        from.meta.lockPageProtected === true) {
        // Keep the current surface (and its draft), but don't admit another
        // protected route from an unverified refresh.
        return abortNavigation();
    }
    return navigateTo(
        {
            path: config.route,
            query: {
                next: sanitizeLockPageRedirectTarget(to.fullPath, '/'),
            },
        },
        { replace: true }
    );
});
