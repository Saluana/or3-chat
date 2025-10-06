import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ChromeActionColor } from './useSidebarSections';
import { createRegistry } from '../ui-extensions/_registry';
import type { RegistryItem } from '../ui-extensions/_registry';

export interface HeaderActionContext {
    route?: RouteLocationNormalizedLoaded | null;
    isMobile?: boolean;
    [key: string]: unknown;
}

export interface HeaderAction extends RegistryItem {
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

// Create registry using factory
const registry = createRegistry<HeaderAction>('__or3HeaderActionsRegistry');

export function registerHeaderAction(action: HeaderAction) {
    registry.register(action);
}

export function unregisterHeaderAction(id: string) {
    registry.unregister(id);
}

export function useHeaderActions(
    context: () => HeaderActionContext = () => ({})
): ComputedRef<HeaderActionEntry[]> {
    const items = registry.useItems();
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

export function listRegisteredHeaderActionIds(): string[] {
    return registry.listIds();
}
