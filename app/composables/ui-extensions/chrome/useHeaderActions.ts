import { computed, reactive } from 'vue';
import type { ComputedRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ChromeActionColor } from './useSidebarSections';

export interface HeaderActionContext {
    route?: RouteLocationNormalizedLoaded | null;
    isMobile?: boolean;
    [key: string]: unknown;
}

export interface HeaderAction {
    id: string;
    icon: string;
    tooltip?: string;
    label?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: HeaderActionContext) => void | Promise<void>;
    visible?: (ctx: HeaderActionContext) => boolean;
    disabled?: (ctx: HeaderActionContext) => boolean;
}

export interface HeaderActionEntry {
    action: HeaderAction;
    disabled: boolean;
}

const DEFAULT_ORDER = 200;

const g: any = globalThis as any;
const registry: Map<string, HeaderAction> =
    g.__or3HeaderActionsRegistry || (g.__or3HeaderActionsRegistry = new Map());

const reactiveList = reactive<{ items: HeaderAction[] }>({ items: [] });

function sync() {
    reactiveList.items = Array.from(registry.values());
}

export function registerHeaderAction(action: HeaderAction) {
    if (import.meta.dev && registry.has(action.id)) {
        console.warn(
            `[useHeaderActions] Overwriting existing action: ${action.id}`
        );
    }
    const frozen = Object.freeze({ ...action });
    registry.set(action.id, frozen);
    sync();
}

export function unregisterHeaderAction(id: string) {
    if (registry.delete(id)) sync();
}

export function useHeaderActions(
    context: () => HeaderActionContext = () => ({})
): ComputedRef<HeaderActionEntry[]> {
    return computed(() => {
        const ctx = context() || {};
        return reactiveList.items
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

export function listRegisteredHeaderActionIds(): string[] {
    return Array.from(registry.keys());
}
