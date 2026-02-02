/**
 * @module app/composables/sidebar/useSidebarSections
 *
 * Purpose:
 * Defines registries and composables for sidebar sections and footer actions.
 *
 * Responsibilities:
 * - Registers sidebar sections and footer actions
 * - Exposes grouped, ordered lists for rendering
 *
 * Non-responsibilities:
 * - Does not render sidebar UI
 * - Does not persist registry state across sessions
 */
import { computed } from 'vue';
import type { Component, ComputedRef } from 'vue';
import { createRegistry } from '../_registry';
import type { RegistryItem } from '../_registry';

/**
 * Placement options for sidebar sections relative to built-in sections.
 */
export type SidebarSectionPlacement = 'top' | 'main' | 'bottom';

/**
 * `SidebarSection`
 *
 * Purpose:
 * Defines a sidebar section entry for registration and rendering.
 *
 * Behavior:
 * Captures component metadata, placement, and ordering details.
 *
 * Constraints:
 * - `id` must be unique in the registry
 *
 * Non-Goals:
 * - Does not define rendering layout
 */
export interface SidebarSection extends RegistryItem {
    /** Unique id (stable across reloads). */
    id: string;
    /** Async or synchronous component rendered inside the sidebar stack. */
    component: Component | (() => Promise<Component>);
    /** Ordering (lower first). Defaults to 200. */
    order?: number;
    /** Where the section should render relative to built-ins. Defaults to `main`. */
    placement?: SidebarSectionPlacement;
}

/**
 * `SidebarSectionGroups`
 *
 * Purpose:
 * Groups sidebar sections by placement for rendering.
 *
 * Behavior:
 * Organizes sections into top, main, and bottom lists.
 *
 * Constraints:
 * - Placement defaults to `main` when omitted
 *
 * Non-Goals:
 * - Does not handle visibility or permissions
 */
export interface SidebarSectionGroups {
    /** Sections that appear at the top of the sidebar */
    top: SidebarSection[];
    /** Main sections in the middle of the sidebar */
    main: SidebarSection[];
    /** Sections that appear at the bottom of the sidebar */
    bottom: SidebarSection[];
}

/**
 * `SidebarFooterActionContext`
 *
 * Purpose:
 * Provides footer action handlers with sidebar state context.
 *
 * Behavior:
 * Supplies active IDs and collapsed state for action logic.
 *
 * Constraints:
 * - Values may be undefined depending on the current view
 *
 * Non-Goals:
 * - Does not resolve active IDs automatically
 */
export interface SidebarFooterActionContext {
    /** ID of the currently active thread, if any */
    activeThreadId?: string | null;
    /** ID of the currently active document, if any */
    activeDocumentId?: string | null;
    /** Whether the sidebar is currently collapsed */
    isCollapsed?: boolean;
}

/**
 * `ChromeActionColor`
 *
 * Purpose:
 * Enumerates color variants available to chrome action buttons.
 *
 * Behavior:
 * Maps to UI component color schemes for consistent theming.
 *
 * Constraints:
 * - Variants are defined by the UI theme
 */
export type ChromeActionColor =
    | 'neutral'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'inverse-primary';

/**
 * `SidebarFooterAction`
 *
 * Purpose:
 * Defines a footer action entry for the sidebar.
 *
 * Behavior:
 * Captures icon, label, and handler metadata with optional visibility controls.
 *
 * Constraints:
 * - `id` must be unique in the registry
 *
 * Non-Goals:
 * - Does not render buttons directly
 */
export interface SidebarFooterAction extends RegistryItem {
    /** Unique id (stable across reloads). */
    id: string;
    /** Icon name rendered inside the footer button. */
    icon: string;
    /** Optional visible label (text inside button). */
    label?: string;
    /** Optional tooltip shown on hover/focus. */
    tooltip?: string;
    /** Ordering (lower first). Defaults to 200. */
    order?: number;
    /** Optional variant hint passed through to button components. */
    color?: ChromeActionColor;
    /** Execute when the footer button is clicked. */
    handler: (ctx: SidebarFooterActionContext) => void | Promise<void>;
    /** Optionally hide the action for a given context. */
    visible?: (ctx: SidebarFooterActionContext) => boolean;
    /** Optionally disable the action for a given context. */
    disabled?: (ctx: SidebarFooterActionContext) => boolean;
}

/**
 * Default order value for sections and actions that don't specify an order.
 */
const DEFAULT_ORDER = 200;

/**
 * Global registry for sidebar sections using the factory pattern.
 */
const sectionRegistry = createRegistry<SidebarSection>(
    '__or3SidebarSectionsRegistry'
);

/**
 * Global registry for sidebar footer actions using the factory pattern.
 */
const footerRegistry = createRegistry<SidebarFooterAction>(
    '__or3SidebarFooterActionsRegistry'
);

/**
 * `SidebarFooterActionEntry`
 *
 * Purpose:
 * Represents a resolved footer action plus disabled state.
 *
 * Behavior:
 * Combines the action definition with a context-derived disabled flag.
 *
 * Constraints:
 * - Disabled state is recalculated on each reactive update
 *
 * Non-Goals:
 * - Does not apply visibility filtering
 */
export interface SidebarFooterActionEntry {
    /** The footer action definition */
    action: SidebarFooterAction;
    /** Whether the action is currently disabled based on context */
    disabled: boolean;
}

/**
 * `registerSidebarSection`
 *
 * Purpose:
 * Adds a sidebar section to the registry.
 *
 * Behavior:
 * Registers the section for retrieval by `useSidebarSections`.
 *
 * Constraints:
 * - Overwrites existing entries with the same ID
 *
 * Non-Goals:
 * - Does not validate component structure
 */
export function registerSidebarSection(section: SidebarSection) {
    sectionRegistry.register(section);
}

/**
 * `unregisterSidebarSection`
 *
 * Purpose:
 * Removes a sidebar section from the registry.
 *
 * Behavior:
 * Deletes the section entry if present.
 *
 * Constraints:
 * - No-op when the ID is not found
 *
 * Non-Goals:
 * - Does not run teardown hooks
 */
export function unregisterSidebarSection(id: string) {
    sectionRegistry.unregister(id);
}

/**
 * `registerSidebarFooterAction`
 *
 * Purpose:
 * Adds a footer action to the registry.
 *
 * Behavior:
 * Registers the action for retrieval by `useSidebarFooterActions`.
 *
 * Constraints:
 * - Overwrites existing entries with the same ID
 *
 * Non-Goals:
 * - Does not validate action handlers
 */
export function registerSidebarFooterAction(action: SidebarFooterAction) {
    footerRegistry.register(action);
}

/**
 * `unregisterSidebarFooterAction`
 *
 * Purpose:
 * Removes a footer action from the registry.
 *
 * Behavior:
 * Deletes the action entry if present.
 *
 * Constraints:
 * - No-op when the ID is not found
 *
 * Non-Goals:
 * - Does not run teardown hooks
 */
export function unregisterSidebarFooterAction(id: string) {
    footerRegistry.unregister(id);
}

/**
 * `useSidebarSections`
 *
 * Purpose:
 * Provides a grouped, ordered list of sidebar sections.
 *
 * Behavior:
 * Filters sections by placement and sorts them by order.
 *
 * Constraints:
 * - Must be called during component setup for reactivity
 *
 * Non-Goals:
 * - Does not filter by visibility or permissions
 */
export function useSidebarSections() {
    const items = sectionRegistry.useItems();
    return computed<SidebarSectionGroups>(() => ({
        top: items.value
            .filter((entry) => (entry.placement ?? 'main') === 'top')
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            ),
        main: items.value
            .filter((entry) => (entry.placement ?? 'main') === 'main')
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            ),
        bottom: items.value
            .filter((entry) => (entry.placement ?? 'main') === 'bottom')
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            ),
    }));
}

/**
 * `useSidebarFooterActions`
 *
 * Purpose:
 * Provides a context-aware list of footer actions.
 *
 * Behavior:
 * Applies visibility filters, sorts by order, and computes disabled state.
 *
 * Constraints:
 * - Must be called during component setup for reactivity
 *
 * Non-Goals:
 * - Does not memoize results across contexts
 */
export function useSidebarFooterActions(
    context: () => SidebarFooterActionContext = () => ({})
): ComputedRef<SidebarFooterActionEntry[]> {
    const items = footerRegistry.useItems();
    return computed(() => {
        const ctx = context();
        return items.value
            .filter((action) => !action.visible || action.visible(ctx))
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            )
            .map((action) => ({
                action,
                disabled: action.disabled ? action.disabled(ctx) : false,
            }));
    });
}

/**
 * `listRegisteredSidebarSectionIds`
 *
 * Purpose:
 * Lists registered sidebar section IDs for inspection.
 *
 * Behavior:
 * Returns IDs in registry order.
 *
 * Constraints:
 * - Intended for debugging or diagnostics
 *
 * Non-Goals:
 * - Does not reflect visibility or placement
 */
export function listRegisteredSidebarSectionIds(): string[] {
    return sectionRegistry.listIds();
}

/**
 * `listRegisteredSidebarFooterActionIds`
 *
 * Purpose:
 * Lists registered footer action IDs for inspection.
 *
 * Behavior:
 * Returns IDs in registry order.
 *
 * Constraints:
 * - Intended for debugging or diagnostics
 *
 * Non-Goals:
 * - Does not reflect visibility or ordering
 */
export function listRegisteredSidebarFooterActionIds(): string[] {
    return footerRegistry.listIds();
}
