/**
 * Editor Extensions Adapter
 *
 * Wraps the TipTap generic extensions registry.
 */

import {
    registerEditorExtension,
    unregisterEditorExtension,
    listEditorExtensions,
    listRegisteredEditorExtensionIds,
    type EditorExtension,
} from '~/composables/editor/useEditorNodes';
import type { EditorExtensionsAdapter } from '../client';

/**
 * Creates the editor extensions adapter.
 * Preserves lazy factory support and ordering.
 */
export function createEditorExtensionsAdapter(): EditorExtensionsAdapter {
    return {
        register: registerEditorExtension,
        unregister: unregisterEditorExtension,
        get: (id) => listEditorExtensions().find((e) => e.id === id),
        list: listEditorExtensions,
        listIds: listRegisteredEditorExtensionIds,
    };
}
