import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useNuxtApp } from '#app';
import { useThemeResolver } from './useThemeResolver';
import type { IconToken } from '~/config/icon-tokens';

/**
 * Reactive composable to resolve icon tokens based on the current theme.
 *
 * @param token - The semantic icon token, ref, or getter to resolve
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
export const useIcon = (token: MaybeRefOrGetter<IconToken>) => {
    const { $iconRegistry } = useNuxtApp();
    const { activeTheme } = useThemeResolver();

    return computed(() => {
        // $iconRegistry is typed loosely in Nuxt plugins, but we know the shape
        interface IconRegistry {
            resolve: (token: IconToken, theme: string) => string;
        }
        const registry = $iconRegistry as IconRegistry;
        // Registry uses a reactive Map internally, so accessing resolve -> themes.get()
        // will automatically track the dependency on the specific theme's icons.
        return registry.resolve(toValue(token), activeTheme.value);
    });
};
