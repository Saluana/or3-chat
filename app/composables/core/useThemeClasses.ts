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
    if (import.meta.dev) {
        console.warn(
            '[useThemeClasses] Deprecated: active theme selector classes now observe added DOM automatically.'
        );
    }
}
