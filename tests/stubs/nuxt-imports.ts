// Stub for Nuxt auto-imports in Vitest context
export function useToast() {
    return { add: () => {} };
}

// Mock defineNuxtPlugin for plugin tests
export function defineNuxtPlugin(plugin: any) {
    return plugin;
}
