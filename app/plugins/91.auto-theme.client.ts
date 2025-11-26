/**
 * Auto-Theme Directive Plugin (Client-side only)
 *
 * Provides the v-theme directive for automatic theme override application.
 * This directive detects component type, context, and identifier, then
 * resolves and applies theme overrides without needing wrapper components.
 *
 * **Important: Vue Warning about Non-Element Root Nodes**
 *
 * When using v-theme on Nuxt UI components (like UButton, UInput), you may see
 * this Vue warning:
 *
 *   "Runtime directive used on component with non-element root node.
 *    The directives will not function as intended."
 *
 * This is a **known limitation** of Vue's directive system. Vue directives are
 * designed for plain HTML elements, not for components that wrap other components.
 *
 * **The directive WILL still work correctly** - it applies theme overrides by:
 * 1. Finding the actual rendered root element of the component
 * 2. Applying data attributes that can be styled with CSS
 * 3. Adding classes for theme styling
 *
 * **To avoid the warning**, use one of these alternatives:
 * 1. Wrap the component in a plain element: `<div v-theme><UButton /></div>`
 * 2. Use a theme composable: `const theme = useTheme(); const props = theme.resolve(...)`
 * 3. Use wrapper components that already handle theming
 *
 * **If the warning bothers you**, you can filter it in your Vue config or browser console.
 * The warning does not indicate a functional problem - it's just Vue's way of saying
 * "directives work best on plain elements."
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
import type { ThemePlugin } from './90.theme.client';

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
        vnode.component;
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
 * Apply resolved overrides to component instance or element
 *
 * This function handles both Nuxt UI components and regular HTML elements.
 * For components, we store the overrides and let Vue's reactivity handle updates.
 * For elements, we apply styles/classes directly.
 *
 * @param el - DOM element
 * @param vnode - Vue VNode
 * @param resolvedProps - Resolved theme override props
 */
function applyOverrides(
    el: HTMLElement,
    vnode: VNode,
    resolvedProps: Record<string, unknown>,
    identifier?: string
) {
    const instance = vnode.component;

    if (!instance) {
        // For plain elements, apply as data attributes that can be read by CSS
        // Include identifier in props for data-id setting
        const propsWithIdentifier = identifier
            ? { ...resolvedProps, identifier }
            : resolvedProps;
        applyToElement(el, propsWithIdentifier);
        return;
    }

    // For components, we need to update the vnode's props before rendering
    // Store resolved props on the element for reactive updates
    const dataKey = '__theme_overrides__';
    (el as any)[dataKey] = resolvedProps;

    // Apply to the actual rendered element if possible
    // This works for components that forward refs or have a root element
    if (instance.subTree?.el) {
        const propsWithIdentifier = identifier
            ? { ...resolvedProps, identifier }
            : resolvedProps;
        applyToElement(instance.subTree.el as HTMLElement, propsWithIdentifier);
    }
}

/**
 * Apply props to a DOM element as attributes/styles
 *
 * @param el - DOM element
 * @param props - Props to apply
 */
function applyToElement(el: HTMLElement, props: Record<string, unknown>) {
    // Apply identifier as data-id if present
    if (props.identifier) {
        el.setAttribute('data-id', String(props.identifier));
    }

    // Apply color as data attribute
    if (props.color) {
        el.setAttribute('data-theme-color', String(props.color));
    }

    // Apply variant as data attribute
    if (props.variant) {
        el.setAttribute('data-theme-variant', String(props.variant));
    }

    // Apply size as data attribute
    if (props.size) {
        el.setAttribute('data-theme-size', String(props.size));
    }

    // Apply classes if present
    if (props.class && typeof props.class === 'string') {
        const existingClasses = el.className;
        const themeClasses = props.class;

        // Only add if not already present
        const classesToAdd = themeClasses
            .split(' ')
            .filter((cls) => cls && !existingClasses.includes(cls));

        if (classesToAdd.length > 0) {
            el.className = `${existingClasses} ${classesToAdd.join(
                ' '
            )}`.trim();
        }
    }

    // Apply debug data attributes or custom data-* props (dev helper)
    for (const [key, value] of Object.entries(props)) {
        if (!key.startsWith('data-')) continue;
        if (value === undefined || value === null) continue;

        el.setAttribute(key, String(value));
    }
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
            // For components, try to get the actual rendered root element
            // This helps avoid the "non-element root node" warning
            const instance =
                vnode.component;
            const targetEl =
                (instance?.subTree?.el as HTMLElement | null) || el;

            // Get component name
            const componentName = getComponentName(vnode);

            // Parse directive value
            const { identifier, themeOverride, contextOverride } =
                parseDirectiveValue(
                    binding.value as ThemeDirectiveValue | undefined
                );

            // Detect or use explicit context (use target element for better detection)
            const context = contextOverride || detectContext(targetEl);

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
                element: targetEl,
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

            // Apply to component or element (use target element)
            applyOverrides(targetEl, vnode, resolved.props, identifier);

            // Theme changes are now handled globally by 92.theme-lazy-sync.client.ts,
            // which uses $forceUpdate to re-render components when themes change.
            // This eliminates thousands of individual watchers and saves significant memory.
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
        // Created hook runs before mounted, good for setup
        created(el, binding, vnode) {
            // Mark element as having theme directive
            el.setAttribute('data-v-theme', '');
        },

        mounted(el, binding, vnode) {
            applyThemeDirective(el, binding, vnode);
        },

        // Update when binding value changes
        updated(el, binding, vnode) {
            // Only re-resolve if binding value actually changed
            if (binding.value === binding.oldValue) {
                return;
            }

            // Re-apply with new binding value
            applyThemeDirective(el, binding, vnode);
        },

        beforeUnmount(el) {
            // Clean up data attributes
            el.removeAttribute('data-v-theme');
            el.removeAttribute('data-theme-color');
            el.removeAttribute('data-theme-variant');
            el.removeAttribute('data-theme-size');
        },

        // This hook tells Vue how to handle SSR
        // Returning {} means we handle our own prop application
        getSSRProps() {
            return {};
        },
    };

    // Register directive globally (only if not already registered)
    // The 00.theme-directive.ts plugin registers a no-op for SSR,
    // so we need to check if it exists before overriding it
    const app = nuxtApp.vueApp;
    if (!app.directive('theme')) {
        app.directive('theme', directive);
    } else {
        // Override the SSR no-op with the real implementation
        // This is safe because we're on the client side
        app._context.directives.theme = directive;
    }
});
