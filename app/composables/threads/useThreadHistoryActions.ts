/**
 * Thread History Actions Registry
 *
 * Provides a global registry for extending thread history UI with custom actions.
 * Actions appear in the thread item dropdown menu in the sidebar.
 *
 * ## Usage
 *
 * ```ts
 * // Register a custom action (typically in a plugin)
 * registerThreadHistoryAction({
 *   id: 'my-plugin:export-thread',
 *   icon: 'i-carbon-download',
 *   label: 'Export Thread',
 *   order: 250, // Optional: controls position (default: 200)
 *   handler: async ({ document }) => {
 *     // document is the Thread object
 *     console.log('Exporting thread:', document.id);
 *     // Your export logic here
 *   }
 * });
 *
 * // Use in a component
 * const actions = useThreadHistoryActions();
 * // actions.value is a sorted array of ThreadHistoryAction
 * ```
 *
 * ## Order & Positioning
 *
 * - **Default order: 200** - Actions without an explicit order appear after built-in actions
 * - **Lower values appear first** - Use order < 200 to appear before built-ins
 * - **Higher values appear last** - Use order > 200 to appear after built-ins
 * - Built-in actions typically use order 100-150
 *
 * ## ID Collision
 *
 * - **IDs must be unique** - Use a namespace prefix (e.g., 'my-plugin:action-name')
 * - **Duplicate IDs replace** - Registering the same ID overwrites the previous action
 * - **Dev warning** - In development, a console warning is shown on duplicate registration
 * - Use `listRegisteredThreadHistoryActionIds()` to check existing IDs
 *
 * ## HMR Safety
 *
 * The registry is stored on `globalThis` and survives Hot Module Replacement.
 * Always unregister actions in cleanup/unmount hooks to prevent duplicates:
 *
 * ```ts
 * onUnmounted(() => {
 *   unregisterThreadHistoryAction('my-plugin:export-thread');
 * });
 * ```
 *
 * Or use `useHookEffect` which handles cleanup automatically:
 *
 * ```ts
 * useHookEffect('plugin:init', () => {
 *   registerThreadHistoryAction({ ... });
 *   return () => unregisterThreadHistoryAction('my-plugin:export-thread');
 * });
 * ```
 */

import type { Thread } from '~/db';
import { createRegistry } from '../_registry';

/** Definition for an extendable chat message action button. */
export interface ThreadHistoryAction {
    /** Unique id (stable across reloads). */
    id: string;
    /** Icon name (passed to UButton icon prop). */
    icon: string;
    /** Label text. */
    label: string;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
    /** Handler invoked on click. */
    handler: (ctx: { document: Thread }) => void | Promise<void>;
}

const registry = createRegistry<ThreadHistoryAction>(
    '__or3ThreadHistoryActionsRegistry'
);

/** Register (or replace) a message action. */
export function registerThreadHistoryAction(action: ThreadHistoryAction) {
    registry.register(action);
}

/** Unregister an action by id (optional utility). */
export function unregisterThreadHistoryAction(id: string) {
    registry.unregister(id);
}

/** Accessor for actions applicable to a specific message. */
export function useThreadHistoryActions() {
    return registry.useItems();
}

/** Convenience for plugin authors to check existing action ids. */
export function listRegisteredThreadHistoryActionIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) actions remain hard-coded in ChatThreadHistory.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
