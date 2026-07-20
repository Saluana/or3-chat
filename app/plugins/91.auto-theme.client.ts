/**
 * Auto-Theme Directive Plugin (Client-side only)
 *
 * Provides the compatibility v-theme directive for owned DOM decoration.
 * It detects a semantic target, context, and identifier, then applies resolved
 * classes, inline styles, and data annotations to the rendered element.
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
 * The directive remains useful for DOM decoration by:
 * 1. Finding the actual rendered root element of the component
 * 2. Applying data attributes that can be styled with CSS
 * 3. Adding classes for theme styling
 *
 * **To avoid the warning**, use one of these alternatives:
 * 1. Wrap the component in a plain element: `<div v-theme><UButton /></div>`
 * 2. Bind `useThemeOverrides()` with `v-bind` for Vue component props
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

import type { VNode, ComponentInternalInstance, ObjectDirective } from 'vue';
import { watch, type WatchStopHandle } from 'vue';
import type { ResolveParams } from '~/theme/_shared/runtime-resolver';
import type { ThemePlugin } from './90.theme.client';
import { findThemeTarget } from '~/theme/_shared/theme-target-registry';

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

    const target = name ? findThemeTarget(name) : null;
    return target?.target || name || 'div';
}

/**
 * Check if component is a Nuxt UI component
 *
 * @param componentName - Component name (lowercase)
 * @returns true if component is from Nuxt UI
 */
function isNuxtUIComponent(componentName: string): boolean {
    return findThemeTarget(componentName)?.kind === 'nuxt-ui';
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
    _vnode: VNode,
    resolvedProps: Record<string, unknown>,
    identifier?: string
) {
    const propsWithIdentifier = identifier
        ? { ...resolvedProps, identifier }
        : resolvedProps;
    applyToElement(el, propsWithIdentifier);
}

/**
 * Apply props to a DOM element as attributes/styles
 *
 * @param el - DOM element
 * @param props - Props to apply
 */
interface AppliedDomThemeState {
    classes: Set<string>;
    attributes: Map<string, string | null>;
    styles: Map<string, { value: string; priority: string }>;
}

const appliedDomTheme = new WeakMap<HTMLElement, AppliedDomThemeState>();

function restoreDomTheme(el: HTMLElement): void {
    const state = appliedDomTheme.get(el);
    if (!state) return;
    for (const className of state.classes) el.classList.remove(className);
    for (const [name, previous] of state.attributes) {
        if (previous === null) el.removeAttribute(name);
        else el.setAttribute(name, previous);
    }
    for (const [property, previous] of state.styles) {
        if (previous.value) {
            el.style.setProperty(property, previous.value, previous.priority);
        } else {
            el.style.removeProperty(property);
        }
    }
    appliedDomTheme.delete(el);
}

function applyToElement(el: HTMLElement, props: Record<string, unknown>) {
    restoreDomTheme(el);
    const state: AppliedDomThemeState = {
        classes: new Set(),
        attributes: new Map(),
        styles: new Map(),
    };
    const setOwnedAttribute = (name: string, value: unknown) => {
        if (!state.attributes.has(name)) {
            state.attributes.set(name, el.getAttribute(name));
        }
        el.setAttribute(name, String(value));
    };

    // Apply identifier as data-id if present
    if (props.identifier) {
        setOwnedAttribute('data-id', props.identifier);
    }

    // Apply color as data attribute
    if (props.color) {
        setOwnedAttribute('data-theme-color', props.color);
    }

    // Apply variant as data attribute
    if (props.variant) {
        setOwnedAttribute('data-theme-variant', props.variant);
    }

    // Apply size as data attribute
    if (props.size) {
        setOwnedAttribute('data-theme-size', props.size);
    }

    // Apply classes if present
    if (props.class && typeof props.class === 'string') {
        for (const className of props.class.split(/\s+/).filter(Boolean)) {
            if (el.classList.contains(className)) continue;
            el.classList.add(className);
            state.classes.add(className);
        }
    }

    if (props.style && typeof props.style === 'object') {
        for (const [property, value] of Object.entries(props.style)) {
            if (typeof value !== 'string') continue;
            state.styles.set(property, {
                value: el.style.getPropertyValue(property),
                priority: el.style.getPropertyPriority(property),
            });
            el.style.setProperty(property, value);
        }
    }

    // Apply debug data attributes or custom data-* props (dev helper)
    for (const [key, value] of Object.entries(props)) {
        if (!key.startsWith('data-')) continue;
        if (value === undefined || value === null) continue;

        setOwnedAttribute(key, value);
    }
    appliedDomTheme.set(el, state);
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
    const stops = new WeakMap<HTMLElement, WatchStopHandle>();

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
            stops.set(
                el,
                watch(
                    [
                        () => themePlugin.activeTheme.value,
                        () => themePlugin.resolversVersion.value,
                    ],
                    () => applyThemeDirective(el, binding, vnode)
                )
            );
        },

        // Update when binding value changes
        updated(el, binding, vnode) {
            applyThemeDirective(el, binding, vnode);
        },

        beforeUnmount(el) {
            stops.get(el)?.();
            stops.delete(el);
            restoreDomTheme(el);
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
