import { abortNavigation, createError, defineNuxtRouteMiddleware, navigateTo } from '#app';

const WIZARD_TOKEN_KEY = 'or3:wizard:token';

export default defineNuxtRouteMiddleware((to) => {
    const config = useRuntimeConfig();
    if (config.public.wizardUi.enabled !== true) {
        return abortNavigation(
            createError({
                statusCode: 404,
                statusMessage: 'Not Found',
            })
        );
    }

    if (!import.meta.client) return;

    const tokenFromQuery = typeof to.query.token === 'string' ? to.query.token.trim() : '';

    if (tokenFromQuery) {
        globalThis.sessionStorage.setItem(WIZARD_TOKEN_KEY, tokenFromQuery);

        // Strip the token from the visible URL to keep it out of browser history.
        const { token: _, ...remainingQuery } = to.query;
        return navigateTo(
            { path: to.path, query: remainingQuery, hash: to.hash },
            { replace: true }
        );
    }
});
