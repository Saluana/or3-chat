/**
 * Composable for managing sidebar sections and footer actions.
 * Provides registration system and reactive access to sidebar UI components.
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
 * Interface defining a sidebar section that can be registered and rendered.
 * Extends the base RegistryItem with sidebar-specific properties.
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
 * Interface grouping sidebar sections by their placement.
 * Provides organized access to sections in different sidebar regions.
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
 * Context object provided to sidebar footer action handlers.
 * Contains information about the current sidebar state for conditional behavior.
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
 * Color variants for sidebar footer actions.
 * Maps to UI component color schemes for consistent theming.
 */
export type ChromeActionColor =
    | 'neutral'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'inverse-primary'
    | (string & {});

/**
 * Interface defining a sidebar footer action button.
 * Extends the base RegistryItem with footer-specific properties and behavior.
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
 * Interface for footer action entries with computed disabled state.
 * Used in the reactive list returned by useSidebarFooterActions.
 */
export interface SidebarFooterActionEntry {
    /** The footer action definition */
    action: SidebarFooterAction;
    /** Whether the action is currently disabled based on context */
    disabled: boolean;
}

/**
 * Register a new sidebar section.
 * Adds the section to the global registry for reactive access.
 * 
 * @param section - The sidebar section to register
 */
export function registerSidebarSection(section: SidebarSection) {
    sectionRegistry.register(section);
}

/**
 * Unregister a sidebar section by ID.
 * Removes the section from the global registry.
 * 
 * @param id - The ID of the section to unregister
 */
export function unregisterSidebarSection(id: string) {
    sectionRegistry.unregister(id);
}

/**
 * Register a new sidebar footer action.
 * Adds the action to the global registry for reactive access.
 * 
 * @param action - The footer action to register
 */
export function registerSidebarFooterAction(action: SidebarFooterAction) {
    footerRegistry.register(action);
}

/**
 * Unregister a sidebar footer action by ID.
 * Removes the action from the global registry.
 * 
 * @param id - The ID of the action to unregister
 */
export function unregisterSidebarFooterAction(id: string) {
    footerRegistry.unregister(id);
}

/**
 * Composable for accessing sidebar sections organized by placement.
 * Returns reactive groups of sections sorted by their order property.
 * 
 * @returns ComputedRef containing sections grouped by placement (top, main, bottom)
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
 * Composable for accessing sidebar footer actions with context-aware filtering.
 * Returns a reactive list of actions filtered by visibility and computed disabled state.
 * 
 * @param context - Function that returns the current footer action context
 * @returns ComputedRef containing filtered and sorted footer action entries
 */
export function useSidebarFooterActions(
    context: () => SidebarFooterActionContext = () => ({})
): ComputedRef<SidebarFooterActionEntry[]> {
    const items = footerRegistry.useItems();
    return computed(() => {
        const ctx = context() || {};
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
 * Get a list of all registered sidebar section IDs.
 * Useful for debugging and registry inspection.
 * 
 * @returns Array of registered section IDs
 */
export function listRegisteredSidebarSectionIds(): string[] {
    return sectionRegistry.listIds();
}

/**
 * Get a list of all registered sidebar footer action IDs.
 * Useful for debugging and registry inspection.
 * 
 * @returns Array of registered footer action IDs
 */
export function listRegisteredSidebarFooterActionIds(): string[] {
    return footerRegistry.listIds();
}
