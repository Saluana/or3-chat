/**
 * Editor Marks Adapter
 *
 * Wraps the TipTap editor marks registry.
 */

import {
    registerEditorMark,
    unregisterEditorMark,
    listEditorMarks,
    listRegisteredEditorMarkIds,
    type EditorMark,
} from '~/composables/editor/useEditorNodes';
import type { EditorMarksAdapter } from '../client';

/**
 * Creates the editor marks adapter.
 * Preserves ordering behavior.
 */
export function createEditorMarksAdapter(): EditorMarksAdapter {
    return {
        register: registerEditorMark,
        unregister: unregisterEditorMark,
        get: (id) => listEditorMarks().find((m) => m.id === id),
        list: listEditorMarks,
        listIds: listRegisteredEditorMarkIds,
    };
}
