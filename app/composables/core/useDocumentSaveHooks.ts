import { onScopeDispose } from 'vue';
import { getDb } from '~/db/client';
import { useHooks } from '~/core/hooks/useHooks';
import { subscribeDocumentSaves } from '~/composables/documents/useDocumentsStore';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import type { UseMultiPaneApi } from './useMultiPane';

/** Bridge successful local writes to the currently mounted workspace's pane hooks. */
export function useDocumentSaveHooks(workspace: UseMultiPaneApi): void {
    if (typeof window === 'undefined') return;
    const hooks = useHooks();
    const unsubscribe = subscribeDocumentSaves((db, id) => {
        if (db !== getDb() || getGlobalMultiPaneApi() !== workspace) return;
        workspace.panes.value.forEach((pane, paneIndex) => {
            if (pane.mode === 'doc' && pane.documentId === id) {
                void hooks.doAction('ui.pane.doc:action:saved', {
                    pane, oldDocumentId: id, newDocumentId: id, paneIndex,
                    meta: { reason: 'docStoreFlush' },
                });
            }
        });
    });
    onScopeDispose(unsubscribe);
}
