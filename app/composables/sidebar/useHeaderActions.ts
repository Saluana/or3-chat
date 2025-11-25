/**
 * Composable for managing header actions in the application header.
 * Provides registration system and reactive access to header toolbar actions.
 * Actions can be conditionally visible and disabled based on route and mobile context.
 */
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ChromeActionColor } from './useSidebarSections';
import { createRegistry } from '../_registry';
import type { RegistryItem } from '../_registry';

/**
 * Context object provided to header action handlers and visibility functions.
 * Contains information about the current route and device context.
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
 * Interface defining a header action that can be registered in the application header.
 * Extends the base RegistryItem with header-specific properties and behavior.
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
 * Interface for header action entries with computed disabled state.
 * Used in the reactive list returned by useHeaderActions.
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
 * Ensures actions persist across component instances.
 */
const registry = createRegistry<HeaderAction>('__or3HeaderActionsRegistry');

/**
 * Register a new header action.
 * Adds the action to the global registry for reactive access.
 * 
 * @param action - The header action to register
 */
export function registerHeaderAction(action: HeaderAction) {
    registry.register(action);
}

/**
 * Unregister a header action by ID.
 * Removes the action from the global registry.
 * 
 * @param id - The ID of the action to unregister
 */
export function unregisterHeaderAction(id: string) {
    registry.unregister(id);
}

/**
 * Composable for accessing header actions with context-aware filtering.
 * Returns a reactive list of actions filtered by visibility and computed disabled state.
 * 
 * @param context - Function that returns the current header action context
 * @returns ComputedRef containing filtered and sorted header action entries
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
 * Get a list of all registered header action IDs.
 * Useful for debugging and registry inspection.
 * 
 * @returns Array of registered header action IDs
 */
export function listRegisteredHeaderActionIds(): string[] {
    return registry.listIds();
}
