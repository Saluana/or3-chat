/**
 * @module app/composables/sidebar/useComposerActions
 *
 * Purpose:
 * Provides a registry and composable interface for rich text editor actions.
 *
 * Responsibilities:
 * - Registers toolbar actions for the composer
 * - Exposes a reactive, context-aware list of actions
 *
 * Non-responsibilities:
 * - Does not render toolbar UI
 * - Does not manage editor lifecycle directly
 */
import { computed, reactive } from 'vue';
import type { ComputedRef } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { ChromeActionColor } from './useSidebarSections';

/**
 * `ComposerActionContext`
 *
 * Purpose:
 * Supplies action handlers with editor state and ambient UI context.
 *
 * Behavior:
 * Carries optional identifiers and streaming state needed for action decisions.
 *
 * Constraints:
 * - Values may be undefined depending on view state
 *
 * Non-Goals:
 * - Does not guarantee presence of an editor instance
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
 * `ComposerAction`
 *
 * Purpose:
 * Describes a toolbar action that can be registered for the composer.
 *
 * Behavior:
 * Provides metadata for display and handlers for invocation, visibility, and
 * disabled state.
 *
 * Constraints:
 * - `id` must be unique within the registry
 * - `handler` should be safe to call repeatedly
 *
 * Non-Goals:
 * - Does not enforce visual layout or placement rules
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
 * `ComposerActionEntry`
 *
 * Purpose:
 * Represents a resolved action plus its disabled state for rendering.
 *
 * Behavior:
 * Combines a registered action with the computed disabled flag for a context.
 *
 * Constraints:
 * - Disabled state is derived from the current context on each recompute
 *
 * Non-Goals:
 * - Does not compute visibility; that happens in `useComposerActions`
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
 *
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
 *
 * Updated whenever the registry changes.
 */
const reactiveList = reactive<{ items: ComposerAction[] }>({ items: [] });

/**
 * Synchronize the reactive list with the registry.
 *
 * Called whenever actions are registered or unregistered.
 */
function sync() {
    reactiveList.items = Array.from(registry.values());
}

/**
 * `registerComposerAction`
 *
 * Purpose:
 * Adds a composer action to the global registry.
 *
 * Behavior:
 * Freezes the action to discourage mutation and refreshes the reactive list.
 *
 * Constraints:
 * - Overwrites existing registrations with the same ID in dev mode
 *
 * Non-Goals:
 * - Does not validate action schemas beyond basic presence
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
 * `unregisterComposerAction`
 *
 * Purpose:
 * Removes a composer action from the registry.
 *
 * Behavior:
 * Deletes the action and refreshes the reactive list when the ID exists.
 *
 * Constraints:
 * - No-op when the ID is not registered
 *
 * Non-Goals:
 * - Does not run any teardown hook for removed actions
 */
export function unregisterComposerAction(id: string) {
    if (registry.delete(id)) sync();
}

/**
 * `useComposerActions`
 *
 * Purpose:
 * Provides a reactive list of composer actions filtered by context.
 *
 * Behavior:
 * Applies visibility filters, sorts by order, and computes disabled state on
 * each reactive update.
 *
 * Constraints:
 * - Must be called during component setup for reactivity
 *
 * Non-Goals:
 * - Does not cache results across different contexts
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
 * `listRegisteredComposerActionIds`
 *
 * Purpose:
 * Lists currently registered composer action IDs for inspection.
 *
 * Behavior:
 * Returns IDs in registry iteration order.
 *
 * Constraints:
 * - Intended for debugging or diagnostics only
 *
 * Non-Goals:
 * - Does not reflect sorting or visibility filters
 */
export function listRegisteredComposerActionIds(): string[] {
    return Array.from(registry.keys());
}
