import { computed, reactive, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';

/** Definition for an extendable editor toolbar button. */
export interface EditorToolbarButton {
    /** Unique id (stable across reloads). */
    id: string;
    /** Icon name (passed to UButton icon prop). */
    icon: string;
    /** Tooltip text. */
    tooltip?: string;
    /** Optional ordering (lower = earlier). Defaults to 200 (after built-ins). */
    order?: number;
    /** Check if button should be active/highlighted. */
    isActive?: (editor: Editor) => boolean;
    /** Handler invoked on click. */
    onClick: (editor: Editor) => void | Promise<void>;
    /** Optional visibility check. */
    visible?: (editor: Editor) => boolean;
}

// Global singleton registry (survives HMR) stored on globalThis to avoid duplication.
type EditorToolbarGlobals = typeof globalThis & {
    __or3EditorToolbarRegistry?: Map<string, EditorToolbarButton>;
};
const g = globalThis as EditorToolbarGlobals;
const registry: Map<string, EditorToolbarButton> =
    g.__or3EditorToolbarRegistry || (g.__or3EditorToolbarRegistry = new Map());

// Reactive wrapper list we maintain for computed filtering (Map itself not reactive).
const reactiveList = reactive<{ items: EditorToolbarButton[] }>({ items: [] });

function syncReactiveList() {
    reactiveList.items = Array.from(registry.values());
}

/** Register (or replace) an editor toolbar button. */
export function registerEditorToolbarButton(button: EditorToolbarButton) {
    if (import.meta.dev && registry.has(button.id)) {
        console.warn(
            `[useEditorToolbar] Overwriting existing button: ${button.id}`
        );
    }
    registry.set(button.id, button);
    syncReactiveList();
}

/** Unregister a toolbar button by id (optional utility). */
export function unregisterEditorToolbarButton(id: string) {
    if (registry.delete(id)) syncReactiveList();
}

/** Accessor for toolbar buttons applicable to the current editor. */
export function useEditorToolbarButtons(editorRef: Ref<Editor | null>) {
    return computed(() => {
        const editor = editorRef.value;
        if (!editor) return [];

        return reactiveList.items
            .filter((btn) => {
                if (!btn.visible) return true;
                try {
                    return btn.visible(editor);
                } catch (e) {
                    if (import.meta.dev) {
                        console.error(
                            `[useEditorToolbar] visible() threw for button ${btn.id}:`,
                            e
                        );
                    }
                    return false; // Hide button on error
                }
            })
            .sort((a, b) => {
                const orderDiff = (a.order ?? 200) - (b.order ?? 200);
                // Stable sort: tie-break by id
                return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
            });
    });
}

/** Convenience for plugin authors to check existing button ids. */
export function listRegisteredEditorToolbarButtonIds(): string[] {
    return Array.from(registry.keys());
}

// Note: Core (built-in) toolbar buttons remain hard-coded in DocumentEditor.vue;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
