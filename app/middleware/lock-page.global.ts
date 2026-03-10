import { defineNuxtRouteMiddleware, navigateTo } from '#app';
import { resolveLockPageAccess } from '~/core/lock-page/access';
import {
    isAdminRoute,
    isProtectedShellRoute,
    sanitizeLockPageRedirectTarget,
    useLockPageRuntimeConfig,
} from '~/core/lock-page/runtime';

export default defineNuxtRouteMiddleware(async (to) => {
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

    if (!isProtectedShellRoute(to.path)) {
        return;
    }

    const access = await resolveLockPageAccess();
    if (access.allowed) {
        return;
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
