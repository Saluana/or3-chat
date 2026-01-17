/**
 * Thread History Actions Adapter
 *
 * Wraps the thread history actions registry for sidebar thread list.
 */

import {
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
    listRegisteredThreadHistoryActionIds,
    useThreadHistoryActions,
    type ThreadHistoryAction,
} from '~/composables/threads/useThreadHistoryActions';
import type { RegistryAdapter } from '../utils';

/**
 * Creates the thread history actions adapter.
 */
export function createThreadHistoryActionsAdapter(): RegistryAdapter<ThreadHistoryAction> {
    const items = useThreadHistoryActions();

    return {
        register: registerThreadHistoryAction,
        unregister: unregisterThreadHistoryAction,
        get: (id) => items.value.find((a) => a.id === id),
        list: () => [...items.value],
        useItems: () => items,
        listIds: listRegisteredThreadHistoryActionIds,
    };
}
