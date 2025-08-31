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
