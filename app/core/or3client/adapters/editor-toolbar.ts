/**
 * Editor Toolbar Adapter
 *
 * Wraps the editor toolbar buttons registry for document editor.
 */

import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
    type EditorToolbarButton,
} from '~/composables/editor/useEditorToolbar';
import { createRegistry } from '~/composables/_registry';
import type { RegistryAdapter } from '../utils';

// Get the underlying registry (same key as in useEditorToolbar.ts)
const registry = createRegistry<EditorToolbarButton>('__or3EditorToolbarRegistry');

/**
 * Creates the editor toolbar adapter.
 */
export function createEditorToolbarAdapter(): RegistryAdapter<EditorToolbarButton> {
    return {
        register: registerEditorToolbarButton,
        unregister: unregisterEditorToolbarButton,
        get: (id) => registry.snapshot().find((b) => b.id === id),
        list: () => registry.snapshot(),
        useItems: () => registry.useItems(),
        listIds: listRegisteredEditorToolbarButtonIds,
    };
}
