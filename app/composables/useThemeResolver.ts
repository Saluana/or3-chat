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

import { computed, getCurrentInstance, unref } from 'vue';
import { useNuxtApp } from '#app';
import type { ComputedRef, ComponentPublicInstance } from 'vue';
import type { ResolveParams } from '../theme/_shared/runtime-resolver';
import type { OverrideProps, ResolvedOverrideProps } from '~/theme/_shared/types';

/**
 * Type-safe merge of base component props with theme overrides.
 * Preserves literal types from base props while allowing overrides to replace them.
 *
 * @param base - Base component props with literal types (e.g., { color: 'primary' as const })
 * @param overrides - Theme override props (may contain wider types like string)
 * @returns Merged props with preserved type safety
 *
 * @example
 * ```ts
 * const props = mergeThemeProps(
 *   { color: 'primary' as const, size: 'md' as const },
 *   { variant: 'solid', size: 'lg' } // size override will be applied
 * );
 * // Type of props.color is still 'primary', not string
 * ```
 */
export function mergeThemeProps<T extends Record<string, unknown>>(
    base: T,
    overrides: ResolvedOverrideProps
): T {
    // Spread base first to preserve types, then selectively apply overrides
    const result = { ...base } as Record<string, unknown>;

    // Apply overrides but only for keys that exist in base or are special override keys
    const specialKeys = new Set(['class', 'style', 'ui']);

    for (const key in overrides) {
        if (key in base || specialKeys.has(key)) {
            result[key] = overrides[key];
        }
    }

    return result as T;
}

interface ComponentOverrideCache {
    theme: string;
    entries: Map<string, ResolvedOverrideProps>;
}

// Resolution cache using WeakMap to prevent memory leaks
const componentOverrideCache = new WeakMap<
    ComponentPublicInstance,
    ComponentOverrideCache
>();

const MAX_CACHE_ENTRIES = 50;

/**
 * Internal helper to build deterministic cache keys for override resolution.
 * Returns null when caching should be skipped (e.g. element-specific matches).
 */
export function __createThemeOverrideCacheKey(
    params: ResolveParams | null | undefined
): string | null {
    if (!params) return null;
    const { component, context, identifier, state, isNuxtUI, element } = params;

    // Element-scoped matches depend on live DOM, skip caching to avoid stale data.
    if (!component || element) {
        return null;
    }

    return [
        component,
        context ?? '',
        identifier ?? '',
        state ?? '',
        isNuxtUI ? 'ui' : 'plain',
    ].join('|');
}

export interface UseThemeResolverReturn {
    /**
     * Resolve theme overrides for given parameters
     *
     * @param params - Resolution parameters
     * @returns Resolved override props
     */
    resolveOverrides: (params: ResolveParams) => ResolvedOverrideProps;

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

    const activeTheme = computed(() => theme.activeTheme.value);

    const resolveOverrides = (params: ResolveParams): ResolvedOverrideProps => {
        const currentTheme = theme.activeTheme.value;
        const resolver = theme.getResolver(currentTheme);

        if (!resolver) {
            if (import.meta.dev) {
                console.warn(
                    `[useThemeResolver] No resolver found for theme "${currentTheme}"`
                );
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
): ComputedRef<ResolvedOverrideProps> {
    const { resolveOverrides, activeTheme } = useThemeResolver();
    const instance = getCurrentInstance();

    return computed(() => {
        // Trigger recomputation when theme changes by reading the value
        void activeTheme.value;

        // Get params (unwrap if computed)
        const resolveParams = unref(params);

        // Use cache if available
        if (instance?.proxy) {
            const proxy = instance.proxy;
            const cacheKey = __createThemeOverrideCacheKey(resolveParams);

            if (cacheKey) {
                const currentTheme = activeTheme.value;

                let cache = componentOverrideCache.get(proxy);
                if (!cache || cache.theme !== currentTheme) {
                    cache = {
                        theme: currentTheme,
                        entries: new Map(),
                    };
                    componentOverrideCache.set(proxy, cache);
                }

                const cached = cache.entries.get(cacheKey);
                if (cached) {
                    cache.entries.delete(cacheKey);
                    cache.entries.set(cacheKey, cached);
                    return cached;
                }

                const result = resolveOverrides(resolveParams);
                cache.entries.set(cacheKey, result);
                if (cache.entries.size > MAX_CACHE_ENTRIES) {
                    const oldestKey = cache.entries.keys().next().value;
                    if (oldestKey) {
                        cache.entries.delete(oldestKey);
                    }
                }
                return result;
            }
        }

        return resolveOverrides(resolveParams);
    });
}
