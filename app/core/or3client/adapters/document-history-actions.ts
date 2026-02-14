/**
 * Document History Actions Adapter
 *
 * Wraps the document history actions registry for sidebar document list.
 */

import {
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
    listRegisteredDocumentHistoryActionIds,
    useDocumentHistoryActions,
    type DocumentHistoryAction,
} from '~/composables/documents/useDocumentHistoryActions';
import type { RegistryAdapter } from '../utils';

/**
 * Creates the document history actions adapter.
 */
export function createDocumentHistoryActionsAdapter(): RegistryAdapter<DocumentHistoryAction> {
    const items = useDocumentHistoryActions();

    return {
        register: registerDocumentHistoryAction,
        unregister: unregisterDocumentHistoryAction,
        get: (id) => items.value.find((a) => a.id === id),
        list: () => [...items.value],
        useItems: () => items,
        listIds: listRegisteredDocumentHistoryActionIds,
    };
}
