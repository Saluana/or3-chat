/**
 * Auto-Theme Directive Plugin
 * 
 * Provides the v-theme directive for automatic theme override application.
 * This directive detects component type, context, and identifier, then
 * resolves and applies theme overrides without needing wrapper components.
 * 
 * Usage:
 * - <UButton v-theme /> - Auto-detect context
 * - <UButton v-theme="'chat.send'" /> - Explicit identifier
 * - <UButton v-theme="{ identifier: 'chat.send', theme: 'nature' }" /> - Full control
 */

import type { Directive } from 'vue';
import { watch } from 'vue';
import type { ResolveParams } from '~/theme/_shared/runtime-resolver';

/**
 * Directive binding value types
 */
type ThemeDirectiveValue = string | {
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
    'uslideoveruslideoverpanel',
    'udivider',
    'uskeleton',
    'ukbd',
    'uavatar',
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
    if (el.closest('#app-chat-container') || el.closest('[data-context="chat"]')) {
        return 'chat';
    }
    if (el.closest('#app-sidebar') || el.closest('[data-context="sidebar"]')) {
        return 'sidebar';
    }
    if (el.closest('#app-dashboard-modal') || el.closest('[data-context="dashboard"]')) {
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
function getComponentName(vnode: any): string {
    const instance = vnode.component;
    if (!instance) return 'div';

    // Try multiple ways to get component name
    const name =
        instance.type.name?.toLowerCase() ||
        instance.type.__name?.toLowerCase() ||
        vnode.type.__name?.toLowerCase() ||
        vnode.type.name?.toLowerCase();

    // Fallback based on element type
    if (!name && vnode.el) {
        return vnode.el.tagName?.toLowerCase() || 'div';
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
function applyOverrides(instance: any, resolvedProps: Record<string, unknown>) {
    if (!instance || !instance.props) return;

    const existingProps = instance.props;
    const mergedProps = { ...resolvedProps };

    // Merge with existing props (component props win)
    for (const [key, value] of Object.entries(existingProps)) {
        if (value !== undefined) {
            if (key === 'class') {
                // Concatenate classes (theme first, then explicit)
                mergedProps[key] = `${resolvedProps.class || ''} ${value}`.trim();
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
    const themePlugin = nuxtApp.$theme as any;

    // Ensure theme plugin is loaded
    if (!themePlugin) {
        console.warn('[v-theme] Theme plugin not found. The v-theme directive requires the theme plugin.');
        return;
    }

    const directive: Directive = {
        mounted(el, binding, vnode) {
            try {
                // Get component name
                const componentName = getComponentName(vnode);

                // Parse directive value
                const { identifier, themeOverride, contextOverride } = parseDirectiveValue(
                    binding.value as ThemeDirectiveValue | undefined
                );

                // Detect or use explicit context
                const context = contextOverride || detectContext(el);

                // Check if this is a Nuxt UI component
                const isNuxtUI = isNuxtUIComponent(componentName);

                // Get current theme name
                const currentTheme = themeOverride || themePlugin.activeTheme?.value || 'default';

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
                        console.warn('[v-theme] No resolver found for theme:', currentTheme);
                    }
                    return;
                }

                // Resolve overrides
                const resolved = resolver.resolve(params);

                // Apply to component
                if (vnode.component) {
                    applyOverrides(vnode.component, resolved.props);
                }

                // Watch for theme changes and re-resolve
                if (themePlugin.activeTheme) {
                    const unwatchTheme = watch(
                        () => themePlugin.activeTheme.value,
                        (newTheme) => {
                            const newResolver = themePlugin.getResolver?.(newTheme);
                            if (newResolver && vnode.component) {
                                const newResolved = newResolver.resolve(params);
                                applyOverrides(vnode.component, newResolved.props);
                            }
                        }
                    );

                    // Clean up watcher on unmount
                    if (vnode.component) {
                        const originalUnmounted = (vnode.component as any).um;
                        (vnode.component as any).um = () => {
                            unwatchTheme();
                            if (originalUnmounted) originalUnmounted();
                        };
                    }
                }
            } catch (error) {
                // Graceful degradation
                if (import.meta.dev) {
                    console.error('[v-theme] Failed to apply theme overrides:', error);
                }
            }
        },

        // Update when binding value changes
        updated(el, binding, vnode) {
            // For now, re-mount behavior is sufficient
            // Could optimize by only re-resolving if binding.value changed
            if (binding.value !== binding.oldValue) {
                directive.mounted?.(el, binding, vnode);
            }
        },
    };

    // Register directive globally
    nuxtApp.vueApp.directive('theme', directive);
});
