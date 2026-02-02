/**
 * @module app/composables/sidebar/useHeaderActions
 *
 * Purpose:
 * Provides a registry and composable interface for header actions.
 *
 * Responsibilities:
 * - Registers actions for the application header
 * - Exposes a context-aware list for rendering
 *
 * Non-responsibilities:
 * - Does not render header UI
 * - Does not manage routing or navigation
 */
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ChromeActionColor } from './useSidebarSections';
import { createRegistry } from '../_registry';
import type { RegistryItem } from '../_registry';

/**
 * `HeaderActionContext`
 *
 * Purpose:
 * Supplies header action handlers with route and device context.
 *
 * Behavior:
 * Carries optional route and device metadata for visibility and behavior.
 *
 * Constraints:
 * - Values may be undefined depending on the current app shell
 *
 * Non-Goals:
 * - Does not resolve routing or navigation itself
 */
export interface HeaderActionContext {
    /** The current Vue Router route object */
    route?: RouteLocationNormalizedLoaded | null;
    /** Whether the application is in mobile view */
    isMobile?: boolean;
    /** Additional context properties for extensibility */
    [key: string]: unknown;
}

/**
 * `HeaderAction`
 *
 * Purpose:
 * Describes a header toolbar action and its visibility/disabled rules.
 *
 * Behavior:
 * Provides metadata for rendering and a handler for execution.
 *
 * Constraints:
 * - `id` must be unique in the registry
 * - `handler` should be safe to call multiple times
 *
 * Non-Goals:
 * - Does not impose specific UI styling or layout
 */
export interface HeaderAction extends RegistryItem {
    /** Unique identifier for the action */
    id: string;
    /** Icon name displayed in the header button */
    icon: string;
    /** Optional tooltip shown on hover/focus */
    tooltip?: string;
    /** Optional visible label (text inside button) */
    label?: string;
    /** Optional ordering (lower first). Defaults to 200. */
    order?: number;
    /** Optional color variant for the button */
    color?: ChromeActionColor;
    /** Handler called when the action button is clicked */
    handler: (ctx: HeaderActionContext) => void | Promise<void>;
    /** Optional function to determine if action should be visible */
    visible?: (ctx: HeaderActionContext) => boolean;
    /** Optional function to determine if action should be disabled */
    disabled?: (ctx: HeaderActionContext) => boolean;
}

/**
 * `HeaderActionEntry`
 *
 * Purpose:
 * Represents a resolved header action with computed disabled state.
 *
 * Behavior:
 * Combines the action definition with a context-derived disabled flag.
 *
 * Constraints:
 * - Disabled state is recalculated on each reactive update
 *
 * Non-Goals:
 * - Does not include visibility logic; that is handled in `useHeaderActions`
 */
export interface HeaderActionEntry {
    /** The header action definition */
    action: HeaderAction;
    /** Whether the action is currently disabled based on context */
    disabled: boolean;
}

/**
 * Default order value for actions that don't specify an order.
 */
const DEFAULT_ORDER = 200;

/**
 * Global registry for header actions using the factory pattern.
 *
 * Ensures actions persist across component instances.
 */
const registry = createRegistry<HeaderAction>('__or3HeaderActionsRegistry');

/**
 * `registerHeaderAction`
 *
 * Purpose:
 * Adds a header action to the global registry.
 *
 * Behavior:
 * Stores the action for later retrieval by `useHeaderActions`.
 *
 * Constraints:
 * - Registry keys must be unique per action ID
 *
 * Non-Goals:
 * - Does not validate action payload beyond the registry behavior
 */
export function registerHeaderAction(action: HeaderAction) {
    registry.register(action);
}

/**
 * `unregisterHeaderAction`
 *
 * Purpose:
 * Removes a header action from the global registry.
 *
 * Behavior:
 * Deletes the action entry if it exists.
 *
 * Constraints:
 * - No-op when the ID is not present
 *
 * Non-Goals:
 * - Does not run teardown callbacks
 */
export function unregisterHeaderAction(id: string) {
    registry.unregister(id);
}

/**
 * `useHeaderActions`
 *
 * Purpose:
 * Provides a reactive list of header actions filtered by context.
 *
 * Behavior:
 * Applies visibility filters, sorts by order, and computes disabled state.
 *
 * Constraints:
 * - Must be called during component setup for reactivity
 *
 * Non-Goals:
 * - Does not memoize results across distinct context functions
 */
export function useHeaderActions(
    context: () => HeaderActionContext = () => ({})
): ComputedRef<HeaderActionEntry[]> {
    const items = registry.useItems();
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
 * `listRegisteredHeaderActionIds`
 *
 * Purpose:
 * Lists registered header action IDs for inspection.
 *
 * Behavior:
 * Returns action IDs in registry order.
 *
 * Constraints:
 * - Intended for debugging or diagnostics
 *
 * Non-Goals:
 * - Does not reflect visibility or ordering in the UI
 */
export function listRegisteredHeaderActionIds(): string[] {
    return registry.listIds();
}
