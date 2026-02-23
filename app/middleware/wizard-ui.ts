import { abortNavigation, createError, defineNuxtRouteMiddleware } from '#app';

export default defineNuxtRouteMiddleware(() => {
    const config = useRuntimeConfig();
    if (config.public.wizardUi.enabled === true) {
        return;
    }

    return abortNavigation(
        createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        })
    );
});
