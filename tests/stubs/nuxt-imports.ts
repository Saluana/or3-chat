// Stub for Nuxt auto-imports in Vitest context
export { createRegistry } from '../../app/composables/_registry';

export function useToast() {
    return { add: () => {} };
}

export function defineNuxtPlugin<T>(plugin: T): T | unknown {
    const definePlugin = (
        globalThis as typeof globalThis & {
            defineNuxtPlugin?: (candidate: T) => unknown;
        }
    ).defineNuxtPlugin;
    return definePlugin ? definePlugin(plugin) : plugin;
}

export function useRuntimeConfig(_event?: unknown): any {
    const runtimeConfig = (
        globalThis as typeof globalThis & {
            useRuntimeConfig?: (event?: unknown) => unknown;
        }
    ).useRuntimeConfig;
    if (runtimeConfig) {
        return runtimeConfig(_event);
    }
    throw new Error('useRuntimeConfig must be mocked in tests');
}

export function useNuxtApp(): unknown {
    const resolveNuxtApp = (
        globalThis as typeof globalThis & {
            useNuxtApp?: () => unknown;
        }
    ).useNuxtApp;
    if (resolveNuxtApp) {
        return resolveNuxtApp();
    }
    throw new Error('useNuxtApp must be mocked in tests');
}
