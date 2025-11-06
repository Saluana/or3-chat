/**
 * Auto-Theme Directive Plugin (Client-side only)
 *
 * Provides the v-theme directive for automatic theme override application.
 * This directive detects component type, context, and identifier, then
 * resolves and applies theme overrides without needing wrapper components.
 *
 * **Important Note on Component Root Nodes:**
 * Vue directives work best on elements with a single root node. When used on
 * components like UButton that wrap other components (ULink, NuxtLink), Vue
 * will show a warning. This is expected behavior, and the directive will still
 * function correctly by applying props to the component instance.
 *
 * To suppress the warning, the directive includes a `getSSRProps()` hook that
 * indicates we're handling prop application ourselves.
 *
 * Usage:
 * - <UButton v-theme /> - Auto-detect context
 * - <UButton v-theme="'chat.send'" /> - Explicit identifier
 * - <UButton v-theme="{ identifier: 'chat.send', theme: 'nature' }" /> - Full control
 */

import type {
    Directive,
    VNode,
    ComponentInternalInstance,
    ObjectDirective,
} from 'vue';
import { watch, onScopeDispose } from 'vue';
import type { ResolveParams } from '~/theme/_shared/runtime-resolver';
import type { Ref } from 'vue';
import type { RuntimeResolver } from '~/theme/_shared/runtime-resolver';

/**
 * Theme plugin interface
 */
interface ThemePlugin {
    activeTheme?: Ref<string>;
    getResolver?: (themeName: string) => RuntimeResolver | null;
}

/**
 * Directive binding value types
 */
type ThemeDirectiveValue =
    | string
    | {
          identifier?: string;
          theme?: string;
          context?: string;
      };

/**
 * Known Nuxt UI component names (lowercase)
 * These components receive props directly without mapping
 */
const NUXT_UI_COMPONENTS = new Set([
    'ubutton',
    'uinput',
    'umodal',
    'ucard',
    'ubadge',
    'ualert',
    'uavatar',
    'utable',
    'uselect',
    'utextarea',
    'uform',
    'uformgroup',
    'utabs',
    'uaccordion',
    'udropdown',
    'upopover',
    'utooltip',
    'unotification',
    'ucommandpalette',
    'uslideover', // Fixed: was duplicated as 'uslideoveruslideoverpanel'
    'udivider',
    'uskeleton',
    'ukbd',
    'urange',
    'utoggle',
    'ucheckbox',
    'uradio',
    'uicon',
]);

/**
 * Detect context from DOM ancestry
 *
 * Walks up the DOM tree looking for known context container IDs/classes.
 * Falls back to 'global' if no specific context is found.
 *
 * @param el - Element to detect context from
 * @returns Context name (e.g., 'chat', 'sidebar', 'dashboard', 'global')
 */
function detectContext(el: HTMLElement): string {
    // Check for known context containers by ID
    if (
        el.closest('#app-chat-container') ||
        el.closest('[data-context="chat"]')
    ) {
        return 'chat';
    }
    if (el.closest('#app-sidebar') || el.closest('[data-context="sidebar"]')) {
        return 'sidebar';
    }
    if (
        el.closest('#app-dashboard-modal') ||
        el.closest('[data-context="dashboard"]')
    ) {
        return 'dashboard';
    }
    if (el.closest('#app-header') || el.closest('[data-context="header"]')) {
        return 'header';
    }

    // Default to global context
    return 'global';
}

/**
 * Get component name from Vue component instance
 *
 * @param vnode - Vue VNode
 * @returns Component name (lowercase)
 */
function getComponentName(vnode: VNode): string {
    const instance: ComponentInternalInstance | null =
        vnode.component as ComponentInternalInstance | null;
    if (!instance) return 'div';

    // Try multiple ways to get component name
    const componentType = instance.type as {
        name?: string;
        __name?: string;
    };

    const name =
        componentType.name?.toLowerCase() ||
        componentType.__name?.toLowerCase();

    // Fallback based on element type
    if (!name && vnode.el) {
        return (vnode.el as HTMLElement).tagName?.toLowerCase() || 'div';
    }

    return name || 'button'; // Reasonable default
}

/**
 * Check if component is a Nuxt UI component
 *
 * @param componentName - Component name (lowercase)
 * @returns true if component is from Nuxt UI
 */
function isNuxtUIComponent(componentName: string): boolean {
    return NUXT_UI_COMPONENTS.has(componentName);
}

/**
 * Parse directive binding value
 *
 * @param value - Directive binding value
 * @returns Parsed identifier and optional theme override
 */
function parseDirectiveValue(value: ThemeDirectiveValue | undefined): {
    identifier?: string;
    themeOverride?: string;
    contextOverride?: string;
} {
    if (!value) {
        return {};
    }

    if (typeof value === 'string') {
        return { identifier: value };
    }

    return {
        identifier: value.identifier,
        themeOverride: value.theme,
        contextOverride: value.context,
    };
}

/**
 * Apply resolved overrides to component instance
 *
 * Merges theme overrides with existing component props, ensuring
 * that explicit props always win over theme defaults.
 *
 * @param instance - Vue component instance
 * @param resolvedProps - Resolved theme override props
 */
function applyOverrides(
    instance: ComponentInternalInstance | null,
    resolvedProps: Record<string, unknown>
) {
    if (!instance || !instance.props) return;

    const existingProps = instance.props;
    const mergedProps = { ...resolvedProps };

    // Merge with existing props (component props win)
    for (const [key, value] of Object.entries(existingProps)) {
        if (value !== undefined) {
            if (key === 'class') {
                // Concatenate classes (theme first, then explicit)
                mergedProps[key] = `${
                    resolvedProps.class || ''
                } ${value}`.trim();
            } else {
                // Explicit prop wins
                mergedProps[key] = value;
            }
        }
    }

    // Apply merged props to component
    Object.assign(instance.props, mergedProps);
}

/**
 * v-theme directive implementation
 *
 * Automatically applies theme overrides to components based on:
 * - Component type (auto-detected)
 * - Context (auto-detected from DOM)
 * - Identifier (from directive value)
 * - Current theme (from theme plugin)
 */
export default defineNuxtPlugin((nuxtApp) => {
    // Access theme composable
    // Note: useTheme is provided by theme.client.ts plugin
    const themePlugin = nuxtApp.$theme as ThemePlugin;

    // Ensure theme plugin is loaded
    if (!themePlugin) {
        console.warn(
            '[v-theme] Theme plugin not found. The v-theme directive requires the theme plugin.'
        );
        return;
    }

    /**
     * Apply theme directive logic
     * Extracted to a separate function so it can be reused by both mounted and updated hooks
     */
    const applyThemeDirective = (
        el: HTMLElement,
        binding: any,
        vnode: VNode
    ) => {
        try {
            // Get component name
            const componentName = getComponentName(vnode);

            // Parse directive value
            const { identifier, themeOverride, contextOverride } =
                parseDirectiveValue(
                    binding.value as ThemeDirectiveValue | undefined
                );

            // Detect or use explicit context
            const context = contextOverride || detectContext(el);

            // Check if this is a Nuxt UI component
            const isNuxtUI = isNuxtUIComponent(componentName);

            // Get current theme name
            const currentTheme =
                themeOverride || themePlugin.activeTheme?.value || 'default';

            // Build resolve parameters
            const params: ResolveParams = {
                component: componentName,
                context,
                identifier,
                state: 'default', // TODO: Detect state from element
                element: el,
                isNuxtUI,
            };

            // Get resolver for current theme
            const resolver = themePlugin.getResolver?.(currentTheme);

            if (!resolver) {
                if (import.meta.dev) {
                    console.warn(
                        '[v-theme] No resolver found for theme:',
                        currentTheme
                    );
                }
                return;
            }

            // Resolve overrides
            const resolved = resolver.resolve(params);

            // Apply to component
            if (vnode.component) {
                applyOverrides(
                    vnode.component as ComponentInternalInstance,
                    resolved.props
                );
            }

            // Watch for theme changes and re-resolve
            if (themePlugin.activeTheme) {
                const unwatchTheme = watch(
                    () => themePlugin.activeTheme!.value,
                    (newTheme) => {
                        const newResolver = themePlugin.getResolver?.(newTheme);
                        if (newResolver && vnode.component) {
                            const newResolved = newResolver.resolve(params);
                            applyOverrides(
                                vnode.component as ComponentInternalInstance,
                                newResolved.props
                            );
                        }
                    }
                );

                // Clean up watcher on unmount using onScopeDispose
                // This is safer than directly manipulating Vue internals
                if (vnode.component) {
                    onScopeDispose(() => {
                        unwatchTheme();
                    });
                }
            }
        } catch (error) {
            // Graceful degradation
            if (import.meta.dev) {
                console.error(
                    '[v-theme] Failed to apply theme overrides:',
                    error
                );
            }
        }
    };

    const directive: ObjectDirective = {
        mounted(el, binding, vnode, prevVnode) {
            applyThemeDirective(el, binding, vnode);
        },

        // Update when binding value changes
        updated(el, binding, vnode, prevVnode) {
            // Only re-resolve if binding value actually changed
            if (binding.value === binding.oldValue) {
                return;
            }

            // Re-apply with new binding value
            applyThemeDirective(el, binding, vnode);
        },

        // Provide getSSRProps for client-side to suppress warnings
        getSSRProps() {
            // This tells Vue that we handle our own prop application
            // and suppresses the "non-element root node" warning
            return {};
        },
    };

    // Register directive globally
    nuxtApp.vueApp.directive('theme', directive);
});
