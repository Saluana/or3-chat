/**
 * Theme Resolver Composable
 * 
 * Provides programmatic access to the theme resolver for advanced use cases.
 * Most components should use the v-theme directive instead, but this composable
 * is useful when you need direct control over override resolution.
 * 
 * @example
 * ```vue
 * <script setup>
 * const { resolveOverrides } = useThemeResolver();
 * 
 * const buttonProps = computed(() => 
 *   resolveOverrides({
 *     component: 'button',
 *     context: 'chat',
 *     identifier: 'chat.send',
 *   })
 * );
 * </script>
 * 
 * <template>
 *   <UButton v-bind="buttonProps">Send</UButton>
 * </template>
 * ```
 */

import type { ComputedRef } from 'vue';
import type { ResolveParams, ResolvedOverride } from '~/theme/_shared/runtime-resolver';

export interface UseThemeResolverReturn {
    /**
     * Resolve theme overrides for given parameters
     * 
     * @param params - Resolution parameters
     * @returns Resolved override props
     */
    resolveOverrides: (params: ResolveParams) => Record<string, unknown>;

    /**
     * Current active theme name
     */
    activeTheme: ComputedRef<string>;

    /**
     * Switch to a different theme
     * 
     * @param themeName - Theme to switch to
     */
    setActiveTheme: (themeName: string) => Promise<void>;
}

/**
 * Use theme resolver composable
 * 
 * Provides access to theme resolution functionality for programmatic use.
 * Automatically tracks the active theme and re-resolves when it changes.
 * 
 * @returns Theme resolver utilities
 */
export function useThemeResolver(): UseThemeResolverReturn {
    const nuxtApp = useNuxtApp();
    const theme = nuxtApp.$theme;

    if (!theme) {
        throw new Error('[useThemeResolver] Theme plugin not found');
    }

    const activeTheme = computed(() => theme.activeTheme.value);

    const resolveOverrides = (params: ResolveParams): Record<string, unknown> => {
        const currentTheme = theme.activeTheme.value;
        const resolver = theme.getResolver(currentTheme);

        if (!resolver) {
            if (import.meta.dev) {
                console.warn(`[useThemeResolver] No resolver found for theme "${currentTheme}"`);
            }
            return {};
        }

        const resolved = resolver.resolve(params);
        return resolved.props;
    };

    const setActiveTheme = async (themeName: string): Promise<void> => {
        await theme.setActiveTheme(themeName);
    };

    return {
        resolveOverrides,
        activeTheme,
        setActiveTheme,
    };
}

/**
 * Reactive theme overrides composable
 * 
 * Returns a reactive computed ref that automatically updates when the theme changes.
 * This is useful for components that need to react to theme switches.
 * 
 * @param params - Resolution parameters (can be a ref or computed)
 * @returns Reactive computed ref with resolved overrides
 * 
 * @example
 * ```vue
 * <script setup>
 * const props = defineProps<{ identifier?: string }>();
 * 
 * const overrides = useThemeOverrides({
 *   component: 'button',
 *   context: 'chat',
 *   identifier: props.identifier,
 * });
 * </script>
 * 
 * <template>
 *   <UButton v-bind="overrides">Click me</UButton>
 * </template>
 * ```
 */
export function useThemeOverrides(
    params: ResolveParams | ComputedRef<ResolveParams>
): ComputedRef<Record<string, unknown>> {
    const { resolveOverrides, activeTheme } = useThemeResolver();

    return computed(() => {
        // Trigger recomputation when theme changes
        const _ = activeTheme.value;

        // Get params (unwrap if computed)
        const resolveParams = unref(params);

        return resolveOverrides(resolveParams);
    });
}
