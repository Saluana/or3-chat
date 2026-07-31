import { abortNavigation, createError, defineNuxtRouteMiddleware } from '#app';

function hasWizardTokenInSessionStorage(): boolean {
    if (!import.meta.client) return false;

    const legacyToken = globalThis.sessionStorage.getItem('or3:wizard:token')?.trim();
    if (legacyToken) {
        return true;
    }

    for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
        const key = globalThis.sessionStorage.key(index);
        if (!key?.startsWith('or3:wizard:token:')) continue;
        const value = globalThis.sessionStorage.getItem(key)?.trim();
        if (value) {
            return true;
        }
    }

    return false;
}

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
        if (hasWizardTokenInSessionStorage()) {
            return;
        }

        return abortNavigation(
            createError({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            })
        );
    }
});
