import { computed, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { createRegistry } from '../_registry';

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

// Custom sort function for stable sort with id tie-breaking
function sortButtons(a: EditorToolbarButton, b: EditorToolbarButton): number {
    const orderDiff = (a.order ?? 200) - (b.order ?? 200);
    // Stable sort: tie-break by id
    return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
}

const registry = createRegistry<EditorToolbarButton>(
    '__or3EditorToolbarRegistry',
    sortButtons
);

/** Register (or replace) an editor toolbar button. */
export function registerEditorToolbarButton(button: EditorToolbarButton) {
    registry.register(button);
}

/** Unregister a toolbar button by id (optional utility). */
export function unregisterEditorToolbarButton(id: string) {
    registry.unregister(id);
}

/** Accessor for toolbar buttons applicable to the current editor. */
export function useEditorToolbarButtons(editorRef: Ref<Editor | null>) {
    const allButtons = registry.useItems();
    return computed(() => {
        const editor = editorRef.value;
        if (!editor) return [];

        return allButtons.value.filter((btn) => {
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
        });
    });
}

/** Convenience for plugin authors to check existing button ids. */
export function listRegisteredEditorToolbarButtonIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) toolbar buttons remain hard-coded in DocumentEditor.vue;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
