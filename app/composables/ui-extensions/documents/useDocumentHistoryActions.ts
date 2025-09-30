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

import { computed, reactive } from 'vue';
import type { Post } from '~/db';

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

// Global singleton registry (survives HMR) stored on globalThis to avoid duplication.
const g: any = globalThis as any;
const registry: Map<string, DocumentHistoryAction> =
    g.__or3DocumentHistoryActionsRegistry ||
    (g.__or3DocumentHistoryActionsRegistry = new Map());

// Reactive wrapper list we maintain for computed filtering (Map itself not reactive).
const reactiveList = reactive<{ items: DocumentHistoryAction[] }>({
    items: [],
});

function syncReactiveList() {
    reactiveList.items = Array.from(registry.values());
}

/** Register (or replace) a message action. */
export function registerDocumentHistoryAction(action: DocumentHistoryAction) {
    registry.set(action.id, action);
    syncReactiveList();
}

/** Unregister an action by id (optional utility). */
export function unregisterDocumentHistoryAction(id: string) {
    if (registry.delete(id)) syncReactiveList();
}

/** Accessor for actions applicable to a specific message. */
export function useDocumentHistoryActions() {
    return computed(() =>
        reactiveList.items.sort((a, b) => (a.order ?? 200) - (b.order ?? 200))
    );
}

/** Convenience for plugin authors to check existing action ids. */
export function listRegisteredDocumentHistoryActionIds(): string[] {
    return Array.from(registry.keys());
}

// Note: Core (built-in) actions remain hard-coded in ChatDocumentHistory.vue so they always appear;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
