import { abortNavigation, createError, defineNuxtRouteMiddleware } from '#app';

export default defineNuxtRouteMiddleware(() => {
    const config = useRuntimeConfig();
    if (config.public.wizardUi.enabled !== true) {
        return abortNavigation(
            createError({
                statusCode: 404,
                statusMessage: 'Not Found',
            })
        );
    }

    const granted = useCookie<unknown>('or3_wizard_granted').value;
    if (String(granted ?? '') !== '1') {
        return abortNavigation(
            createError({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            })
        );
    }
});
