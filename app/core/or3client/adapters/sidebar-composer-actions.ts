/**
 * Composer Actions Adapter
 *
 * Wraps the composer actions registry with TipTap context-aware filtering.
 * Note: This uses a manual Map, not createRegistry.
 */

import {
    registerComposerAction,
    unregisterComposerAction,
    useComposerActions,
    listRegisteredComposerActionIds,
    type ComposerAction,
    type ComposerActionContext,
    type ComposerActionEntry,
} from '~/composables/sidebar/useComposerActions';
import type { ComposerActionsAdapter } from '../client';

/**
 * Creates the composer actions adapter.
 * Preserves TipTap editor context filtering for visibility/disabled state.
 */
export function createComposerActionsAdapter(): ComposerActionsAdapter {
    // Get the list of all actions for get/list operations
    const allActions = useComposerActions();

    return {
        register: registerComposerAction,
        unregister: unregisterComposerAction,
        get: (id) => allActions.value.find((e) => e.action.id === id)?.action,
        list: () => allActions.value.map((e) => e.action),
        listIds: listRegisteredComposerActionIds,

        // Reactive list with TipTap context-aware disabled state
        useItems: (context = () => ({})) => useComposerActions(context),
    };
}
