/**
 * Header Actions Adapter
 *
 * Wraps the header actions registry with context-aware filtering.
 */

import {
    registerHeaderAction,
    unregisterHeaderAction,
    useHeaderActions,
    listRegisteredHeaderActionIds,
    type HeaderAction,
    type HeaderActionContext,
    type HeaderActionEntry,
} from '~/composables/sidebar/useHeaderActions';
import type { HeaderActionsAdapter } from '../client';

/**
 * Creates the header actions adapter.
 * Preserves context-aware filtering (route + mobile context).
 */
export function createHeaderActionsAdapter(): HeaderActionsAdapter {
    // Get all actions (no context) for get/list
    const allActions = useHeaderActions();

    return {
        register: registerHeaderAction,
        unregister: unregisterHeaderAction,
        get: (id) => allActions.value.find((e) => e.action.id === id)?.action,
        list: () => allActions.value.map((e) => e.action),
        listIds: listRegisteredHeaderActionIds,

        // Reactive list with context-aware disabled state
        useItems: (context = () => ({})) => useHeaderActions(context),
    };
}
