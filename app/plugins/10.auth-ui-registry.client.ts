import { registerAuthUiAdapter, type AuthUiAdapter } from '~/core/auth-ui/registry';

type AuthUiRegistryGlobalState = typeof globalThis & {
    __or3AuthUiAdapterQueue__?: AuthUiAdapter[];
};

export default defineNuxtPlugin((nuxtApp) => {
    const register = (input: AuthUiAdapter): void => {
        registerAuthUiAdapter(input);
    };

    nuxtApp.provide('registerAuthUiAdapter', register);

    const globalState = globalThis as AuthUiRegistryGlobalState;
    if (Array.isArray(globalState.__or3AuthUiAdapterQueue__)) {
        for (const queued of globalState.__or3AuthUiAdapterQueue__) {
            register(queued);
        }
        globalState.__or3AuthUiAdapterQueue__ = [];
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('or3:auth-ui-adapter-register', (event) => {
            const customEvent = event as CustomEvent<AuthUiAdapter>;
            if (customEvent.detail) {
                register(customEvent.detail);
            }
        });
    }
});
