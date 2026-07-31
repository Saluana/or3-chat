import { registerLockPageAdapter, type LockPageAdapter } from '~/core/lock-page/registry';

type LockPageRegistryGlobalState = typeof globalThis & {
    __or3LockPageAdapterQueue__?: LockPageAdapter[];
};

export default defineNuxtPlugin((nuxtApp) => {
    const register = (input: LockPageAdapter): void => {
        registerLockPageAdapter(input);
    };

    nuxtApp.provide('registerLockPageAdapter', register);

    const globalState = globalThis as LockPageRegistryGlobalState;
    if (Array.isArray(globalState.__or3LockPageAdapterQueue__)) {
        for (const queued of globalState.__or3LockPageAdapterQueue__) {
            register(queued);
        }
        globalState.__or3LockPageAdapterQueue__ = [];
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('or3:lock-page-adapter-register', (event) => {
            const customEvent = event as CustomEvent<LockPageAdapter>;
            if (customEvent.detail) {
                register(customEvent.detail);
            }
        });
    }
});