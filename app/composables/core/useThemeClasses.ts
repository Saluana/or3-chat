import { onMounted } from 'vue';
import { useNuxtApp } from '#app';
import { applyThemeClasses } from '~/theme/_shared/css-selector-runtime';
import type { ThemePlugin } from '~/plugins/90.theme.client';

/**
 * `useThemeClasses`
 *
 * Purpose:
 * Ensures theme selector classes are applied to lazy-loaded components.
 *
 * Behavior:
 * Loads the active theme on mount and applies its selector classes.
 *
 * Constraints:
 * - Requires the theme plugin to be available in Nuxt app context
 * - Runs on the client after mount
 *
 * Non-Goals:
 * - Does not change the active theme
 *
 * @example
 * ```vue
 * <script setup>
 * useThemeClasses();
 * </script>
 * ```
 */
export function useThemeClasses() {
    const nuxtApp = useNuxtApp();
    const themePlugin = nuxtApp.$theme as ThemePlugin | undefined;

    if (!themePlugin) {
        if (import.meta.dev) {
            console.warn('[useThemeClasses] Theme plugin is not available.');
        }
        return;
    }

    const { activeTheme, loadTheme } = themePlugin;

    onMounted(async () => {
        // Get current theme
        const themeName = activeTheme.value;

        // Ensure theme is loaded
        const theme = await loadTheme(themeName);

        // Apply classes if theme has cssSelectors
        if (theme?.cssSelectors) {
            applyThemeClasses(themeName, theme.cssSelectors);
        }
    });
}
