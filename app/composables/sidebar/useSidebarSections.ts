import { computed } from 'vue';
import type { Component, ComputedRef } from 'vue';
import { createRegistry } from '../ui-extensions/_registry';
import type { RegistryItem } from '../ui-extensions/_registry';

export type SidebarSectionPlacement = 'top' | 'main' | 'bottom';

export interface SidebarSection extends RegistryItem {
    /** Unique id (stable across reloads). */
    id: string;
    /** Async or synchronous component rendered inside the sidebar stack. */
    component: Component | (() => Promise<any>);
    /** Ordering (lower first). Defaults to 200. */
    order?: number;
    /** Where the section should render relative to built-ins. Defaults to `main`. */
    placement?: SidebarSectionPlacement;
}

export interface SidebarFooterActionContext {
    activeThreadId?: string | null;
    activeDocumentId?: string | null;
    isCollapsed?: boolean;
}

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

const DEFAULT_ORDER = 200;

// Create registries using factory
const sectionRegistry = createRegistry<SidebarSection>(
    '__or3SidebarSectionsRegistry'
);
const footerRegistry = createRegistry<SidebarFooterAction>(
    '__or3SidebarFooterActionsRegistry'
);

export interface SidebarFooterActionEntry {
    action: SidebarFooterAction;
    disabled: boolean;
}

export function registerSidebarSection(section: SidebarSection) {
    sectionRegistry.register(section);
}

export function unregisterSidebarSection(id: string) {
    sectionRegistry.unregister(id);
}

export function registerSidebarFooterAction(action: SidebarFooterAction) {
    footerRegistry.register(action);
}

export function unregisterSidebarFooterAction(id: string) {
    footerRegistry.unregister(id);
}

export function useSidebarSections() {
    const items = sectionRegistry.useItems();
    return computed(() => ({
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

export function listRegisteredSidebarSectionIds(): string[] {
    return sectionRegistry.listIds();
}

export function listRegisteredSidebarFooterActionIds(): string[] {
    return footerRegistry.listIds();
}
