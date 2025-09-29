import { computed, reactive } from 'vue';
import type { Component, ComputedRef } from 'vue';

export type SidebarSectionPlacement = 'top' | 'main' | 'bottom';

export interface SidebarSection {
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

export interface SidebarFooterAction {
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

const g: any = globalThis as any;

const sectionRegistry: Map<string, SidebarSection> =
    g.__or3SidebarSectionsRegistry ||
    (g.__or3SidebarSectionsRegistry = new Map());
const footerRegistry: Map<string, SidebarFooterAction> =
    g.__or3SidebarFooterActionsRegistry ||
    (g.__or3SidebarFooterActionsRegistry = new Map());

const reactiveSections = reactive<{ items: SidebarSection[] }>({ items: [] });
const reactiveFooters = reactive<{ items: SidebarFooterAction[] }>({
    items: [],
});

export interface SidebarFooterActionEntry {
    action: SidebarFooterAction;
    disabled: boolean;
}

function syncSections() {
    reactiveSections.items = Array.from(sectionRegistry.values());
}

function syncFooters() {
    reactiveFooters.items = Array.from(footerRegistry.values());
}

export function registerSidebarSection(section: SidebarSection) {
    if (import.meta.dev && sectionRegistry.has(section.id)) {
        console.warn(
            `[useSidebarSections] Overwriting existing section: ${section.id}`
        );
    }
    const frozen = Object.freeze({ ...section });
    sectionRegistry.set(section.id, frozen);
    syncSections();
}

export function unregisterSidebarSection(id: string) {
    if (sectionRegistry.delete(id)) {
        syncSections();
    }
}

export function registerSidebarFooterAction(action: SidebarFooterAction) {
    if (import.meta.dev && footerRegistry.has(action.id)) {
        console.warn(
            `[useSidebarSections] Overwriting existing footer action: ${action.id}`
        );
    }
    const frozen = Object.freeze({ ...action });
    footerRegistry.set(action.id, frozen);
    syncFooters();
}

export function unregisterSidebarFooterAction(id: string) {
    if (footerRegistry.delete(id)) {
        syncFooters();
    }
}

export function useSidebarSections() {
    return computed(() => ({
        top: reactiveSections.items
            .filter((entry) => (entry.placement ?? 'main') === 'top')
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            ),
        main: reactiveSections.items
            .filter((entry) => (entry.placement ?? 'main') === 'main')
            .sort(
                (a, b) =>
                    (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
            ),
        bottom: reactiveSections.items
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
    return computed(() => {
        const ctx = context() || {};
        return reactiveFooters.items
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
    return Array.from(sectionRegistry.keys());
}

export function listRegisteredSidebarFooterActionIds(): string[] {
    return Array.from(footerRegistry.keys());
}
