/**
 * Document History Actions Registry
 *
 * Provides a global registry for extending document history UI with custom actions.
 * Actions appear in the document item dropdown menu in the sidebar.
 *
 * ## Usage
 *
 * ```ts
 * // Register a custom action (typically in a plugin)
 * registerDocumentHistoryAction({
 *   id: 'my-plugin:export-doc',
 *   icon: 'i-carbon-download',
 *   label: 'Export Document',
 *   order: 250, // Optional: controls position (default: 200)
 *   handler: async ({ document }) => {
 *     // document is the Post object
 *     console.log('Exporting document:', document.id);
 *     // Your export logic here
 *   }
 * });
 *
 * // Use in a component
 * const actions = useDocumentHistoryActions();
 * // actions.value is a sorted array of DocumentHistoryAction
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
 * - Use `listRegisteredDocumentHistoryActionIds()` to check existing IDs
 *
 * ## HMR Safety
 *
 * The registry is stored on `globalThis` and survives Hot Module Replacement.
 * Always unregister actions in cleanup/unmount hooks to prevent duplicates:
 *
 * ```ts
 * onUnmounted(() => {
 *   unregisterDocumentHistoryAction('my-plugin:export-doc');
 * });
 * ```
 *
 * Or use `useHookEffect` which handles cleanup automatically:
 *
 * ```ts
 * useHookEffect('plugin:init', () => {
 *   registerDocumentHistoryAction({ ... });
 *   return () => unregisterDocumentHistoryAction('my-plugin:export-doc');
 * });
 * ```
 */

import type { Post } from '~/db';
import { createRegistry } from '../_registry';

/** Definition for an extendable chat message action button. */
export interface DocumentHistoryAction {
    /** Unique id (stable across reloads). */
    id: string;
    /** Icon name (passed to UButton icon prop). */
    icon: string;
    /** Label text. */
    label: string;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
    /** Handler invoked on click. */
    handler: (ctx: { document: Post }) => void | Promise<void>;
}

const registry = createRegistry<DocumentHistoryAction>(
    '__or3DocumentHistoryActionsRegistry'
);

/**
 * Purpose:
 * Add or replace a document history action in the global registry.
 *
 * Behavior:
 * Registers the action by ID, replacing any existing entry.
 *
 * Constraints:
 * - IDs must be unique across actions
 * - Registry is shared across the app and survives HMR
 *
 * Non-Goals:
 * - Ordering enforcement beyond the shared registry sort rules
 *
 * @example
 * ```ts
 * registerDocumentHistoryAction({
 *   id: 'my-plugin:export-doc',
 *   icon: 'i-carbon-download',
 *   label: 'Export Document',
 *   order: 250,
 *   handler: async ({ document }) => {
 *     await exportDocument(document.id);
 *   },
 * });
 * ```
 */
export function registerDocumentHistoryAction(action: DocumentHistoryAction) {
    registry.register(action);
}

/**
 * Purpose:
 * Remove a previously registered document history action.
 *
 * Behavior:
 * Deletes the entry if it exists and leaves the registry intact.
 *
 * Constraints:
 * - No-op when the ID does not exist
 *
 * Non-Goals:
 * - Resetting registry state for other actions
 *
 * @example
 * ```ts
 * unregisterDocumentHistoryAction('my-plugin:export-doc');
 * ```
 */
export function unregisterDocumentHistoryAction(id: string) {
    registry.unregister(id);
}

/**
 * Purpose:
 * Read the reactive list of registered document history actions.
 *
 * Behavior:
 * Returns a computed list sorted by the registry rules.
 *
 * Constraints:
 * - Sorting is managed by the registry helper
 *
 * Non-Goals:
 * - Filtering by document type or state
 *
 * @example
 * ```ts
 * const actions = useDocumentHistoryActions();
 * ```
 */
export function useDocumentHistoryActions() {
    return registry.useItems();
}

/**
 * Purpose:
 * Inspect the registry by ID for debugging or collision checks.
 *
 * Behavior:
 * Returns the action IDs in registration order.
 *
 * Constraints:
 * - Intended for tooling and debugging
 *
 * Non-Goals:
 * - Sorting by action order
 *
 * @example
 * ```ts
 * const ids = listRegisteredDocumentHistoryActionIds();
 * ```
 */
export function listRegisteredDocumentHistoryActionIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) actions remain hard-coded in ChatDocumentHistory.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
