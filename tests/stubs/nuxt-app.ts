// Minimal Nuxt app stub for Vitest
import { ref } from 'vue';
import { createHookEngine } from '../../app/core/hooks/hooks';
import type { ThemePlugin } from '~/plugins/90.theme.client';

const engine = createHookEngine();
// Expose globally for optional introspection
(globalThis as Record<string, unknown>).__TEST_HOOK_ENGINE__ = engine;

const currentScheme = ref('light');
const activeTheme = ref('retro');

const defaultResolver = {
    resolve: () => ({ props: {} }),
};

const themePlugin: ThemePlugin = {
    set: (name: string) => {
        currentScheme.value = name;
    },
    toggle: () => {
        currentScheme.value = currentScheme.value.startsWith('dark')
            ? 'light'
            : 'dark';
    },
    get: () => currentScheme.value,
    system: () => 'light',
    current: currentScheme,
    activeTheme,
    setActiveTheme: async (themeName: string) => {
        activeTheme.value = themeName;
    },
    getResolver: () =>
        defaultResolver as ThemePlugin['getResolver'] extends () => infer R
            ? R
            : never,
    loadTheme: async () => null,
};

export function useNuxtApp(): { $hooks: typeof engine; $theme: ThemePlugin } {
    return { $hooks: engine, $theme: themePlugin };
}
