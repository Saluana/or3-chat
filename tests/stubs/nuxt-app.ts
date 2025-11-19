// Minimal Nuxt app stub for Vitest
import { ref } from 'vue';
import { createHookEngine } from '../../app/core/hooks/hooks';
import type { ThemePlugin } from '~/plugins/90.theme.client';

const engine = createHookEngine();
// Expose globally for optional introspection
(globalThis as any).__TEST_HOOK_ENGINE__ = engine;

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
    getResolver: () => defaultResolver as any,
    loadTheme: async () => null,
};

export function useNuxtApp() {
    return { $hooks: engine, $theme: themePlugin } as any;
}
