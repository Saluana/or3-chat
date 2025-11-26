/**
 * Composable for managing composer actions in the rich text editor.
 * Provides registration system and reactive access to editor toolbar actions.
 * Actions can be conditionally visible and disabled based on editor context.
 */
import { computed, reactive } from 'vue';
import type { ComputedRef } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { ChromeActionColor } from './useSidebarSections';

/**
 * Context object provided to composer action handlers and visibility functions.
 * Contains information about the current editor state and environment.
 */
export interface ComposerActionContext {
    /** The TipTap editor instance, if available */
    editor?: Editor | null;
    /** ID of the current thread, if any */
    threadId?: string | null;
    /** ID of the current pane, if any */
    paneId?: string | null;
    /** Whether AI content is currently streaming */
    isStreaming?: boolean;
    /** Additional context properties for extensibility */
    [key: string]: unknown;
}

/**
 * Interface defining a composer action that can be registered in the editor toolbar.
 * Actions provide buttons and functionality for the rich text editor.
 */
export interface ComposerAction {
    /** Unique identifier for the action */
    id: string;
    /** Icon name displayed in the toolbar button */
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
    handler: (ctx: ComposerActionContext) => void | Promise<void>;
    /** Optional function to determine if action should be visible */
    visible?: (ctx: ComposerActionContext) => boolean;
    /** Optional function to determine if action should be disabled */
    disabled?: (ctx: ComposerActionContext) => boolean;
}

/**
 * Interface for composer action entries with computed disabled state.
 * Used in the reactive list returned by useComposerActions.
 */
export interface ComposerActionEntry {
    /** The composer action definition */
    action: ComposerAction;
    /** Whether the action is currently disabled based on context */
    disabled: boolean;
}

/**
 * Default order value for actions that don't specify an order.
 */
const DEFAULT_ORDER = 200;

/**
 * Global registry for composer actions using the globalThis pattern.
 * Ensures actions persist across component instances.
 */
interface ComposerActionsGlobalThis {
    __or3ComposerActionsRegistry?: Map<string, ComposerAction>;
}
const g = globalThis as typeof globalThis & ComposerActionsGlobalThis;
const registry: Map<string, ComposerAction> =
    g.__or3ComposerActionsRegistry ??
    (g.__or3ComposerActionsRegistry = new Map<string, ComposerAction>());

/**
 * Reactive list that mirrors the registry for Vue reactivity.
 * Updated whenever the registry changes.
 */
const reactiveList = reactive<{ items: ComposerAction[] }>({ items: [] });

/**
 * Synchronize the reactive list with the registry.
 * Called whenever actions are registered or unregistered.
 */
function sync() {
    reactiveList.items = Array.from(registry.values());
}

/**
 * Register a new composer action.
 * Freezes the action object to prevent mutations and updates the reactive list.
 * 
 * @param action - The composer action to register
 */
export function registerComposerAction(action: ComposerAction) {
    if (import.meta.dev && registry.has(action.id)) {
        console.warn(
            `[useComposerActions] Overwriting existing action: ${action.id}`
        );
    }
    const frozen = Object.freeze({ ...action });
    registry.set(action.id, frozen);
    sync();
}

/**
 * Unregister a composer action by ID.
 * Removes the action from the registry and updates the reactive list.
 * 
 * @param id - The ID of the action to unregister
 */
export function unregisterComposerAction(id: string) {
    if (registry.delete(id)) sync();
}

/**
 * Composable for accessing composer actions with context-aware filtering.
 * Returns a reactive list of actions filtered by visibility and computed disabled state.
 * 
 * @param context - Function that returns the current composer action context
 * @returns ComputedRef containing filtered and sorted composer action entries
 */
export function useComposerActions(
    context: () => ComposerActionContext = () => ({})
): ComputedRef<ComposerActionEntry[]> {
    return computed(() => {
        const ctx = context();
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

/**
 * Get a list of all registered composer action IDs.
 * Useful for debugging and registry inspection.
 * 
 * @returns Array of registered composer action IDs
 */
export function listRegisteredComposerActionIds(): string[] {
    return Array.from(registry.keys());
}
