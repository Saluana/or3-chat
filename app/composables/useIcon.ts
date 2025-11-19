import { computed } from 'vue';
import { useNuxtApp } from '#app';
import { useThemeResolver } from './useThemeResolver';
import type { IconToken } from '~/config/icon-tokens';

/**
 * Reactive composable to resolve icon tokens based on the current theme.
 *
 * @param token - The semantic icon token to resolve
 * @returns A computed string containing the concrete icon name (e.g., 'pixelarticons:home')
 *
 * @example
 * ```vue
 * <script setup>
 * const icon = useIcon('shell.sidebar.toggle.left');
 * </script>
 * <template>
 *   <UButton :icon="icon" />
 * </template>
 * ```
 */
export const useIcon = (token: IconToken) => {
    const { $iconRegistry } = useNuxtApp();
    const { activeTheme } = useThemeResolver();

    return computed(() => {
        // $iconRegistry is typed as any usually in Nuxt plugins unless we extend the type,
        // but we know it's there.
        const registry = $iconRegistry as any;
        // Registry uses a reactive Map internally, so accessing resolve -> themes.get()
        // will automatically track the dependency on the specific theme's icons.
        return registry.resolve(token, activeTheme.value);
    });
};
