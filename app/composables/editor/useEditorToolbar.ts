import { computed, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { createRegistry } from '../_registry';

/**
 * @module app/composables/editor/useEditorToolbar
 *
 * Purpose:
 * Provide a registry-backed toolbar extension surface for the TipTap editor.
 *
 * Responsibilities:
 * - Define the toolbar button contract
 * - Register and unregister toolbar button extensions
 * - Provide a computed list of buttons valid for the active editor
 *
 * Non-responsibilities:
 * - Rendering toolbar UI
 * - Enforcing button ordering or grouping beyond consumer sorting
 * - Managing editor lifecycle or availability
 */

/**
 * Definition for an extendable editor toolbar button.
 *
 * Purpose:
 * Describe a toolbar button that can be contributed by plugins.
 *
 * Behavior:
 * Buttons can control visibility and active state based on the editor.
 *
 * Constraints:
 * - `id` must be stable across reloads
 * - `onClick` should be resilient to repeated calls
 *
 * Non-Goals:
 * - Automatic ordering or grouping
 */
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

const registry = createRegistry<EditorToolbarButton>(
    '__or3EditorToolbarRegistry'
);

/**
 * Register or replace an editor toolbar button.
 *
 * Purpose:
 * Allow plugins to contribute toolbar buttons through a shared registry.
 *
 * Behavior:
 * Replaces any existing button with the same id.
 *
 * Constraints:
 * - Intended for client usage where HMR can re-register buttons
 *
 * Non-Goals:
 * - Preventing id collisions across plugins
 */
export function registerEditorToolbarButton(button: EditorToolbarButton) {
    registry.register(button);
}

/**
 * Unregister a toolbar button by id.
 *
 * Purpose:
 * Remove a previously registered toolbar button.
 *
 * Behavior:
 * Deletes the button if it exists.
 *
 * Constraints:
 * - No effect if the id is not present
 *
 * Non-Goals:
 * - Cleaning up editor UI that already rendered the button
 */
export function unregisterEditorToolbarButton(id: string) {
    registry.unregister(id);
}

/**
 * Access toolbar buttons applicable to the current editor.
 *
 * Purpose:
 * Provide a reactive, filtered list of toolbar buttons for the active editor.
 *
 * Behavior:
 * Filters out buttons whose `visible` predicate returns false or throws.
 *
 * Constraints:
 * - Must be called during Vue setup to access reactive state
 * - Returns an empty array when no editor is available
 *
 * Non-Goals:
 * - Sorting buttons by order
 * - Handling editor initialization timing
 */
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

/**
 * Convenience helper for plugin authors to check existing toolbar button ids.
 *
 * Purpose:
 * Allow plugins to avoid id collisions before registering buttons.
 *
 * Behavior:
 * Returns the current registry keys.
 *
 * Constraints:
 * - Snapshot reflects current state at call time
 *
 * Non-Goals:
 * - Providing reactive updates
 */
export function listRegisteredEditorToolbarButtonIds(): string[] {
    return registry.listIds();
}

// Note: Core (built-in) toolbar buttons remain hard-coded in DocumentEditor.vue;
// external plugins should use order >= 200 to appear after them unless intentionally overriding.
