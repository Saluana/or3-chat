/**
 * Editor Nodes Adapter
 *
 * Wraps the TipTap editor nodes registry.
 */

import {
    registerEditorNode,
    unregisterEditorNode,
    listEditorNodes,
    listRegisteredEditorNodeIds,
    type EditorNode,
} from '~/composables/editor/useEditorNodes';
import type { EditorNodesAdapter } from '../client';

/**
 * Creates the editor nodes adapter.
 * Preserves ordering behavior.
 */
export function createEditorNodesAdapter(): EditorNodesAdapter {
    return {
        register: registerEditorNode,
        unregister: unregisterEditorNode,
        get: (id) => listEditorNodes().find((n) => n.id === id),
        list: listEditorNodes,
        listIds: listRegisteredEditorNodeIds,
    };
}
