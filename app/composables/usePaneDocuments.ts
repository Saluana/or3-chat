// Composable to manage per-pane document operations (create/select) abstracted from UI.
// Assumes panes follow the PaneState contract from useMultiPane.

import type { Ref } from 'vue';
import type { MultiPaneState } from '~/composables/useMultiPane';
import {
    releaseDocument,
    useDocumentState,
} from '~/composables/useDocumentsStore';
import { useHooks } from './useHooks';

export interface UsePaneDocumentsOptions {
    panes: Ref<MultiPaneState[]>;
    activePaneIndex: Ref<number>;
    createNewDoc: (initial?: { title?: string }) => Promise<{ id: string }>;
    flushDocument: (id: string) => Promise<void> | void;
}

export interface UsePaneDocumentsApi {
    newDocumentInActive: (initial?: {
        title?: string;
    }) => Promise<{ id: string } | undefined>;
    selectDocumentInActive: (id: string) => Promise<void>;
}

export function usePaneDocuments(
    opts: UsePaneDocumentsOptions
): UsePaneDocumentsApi {
    const { panes, activePaneIndex, createNewDoc, flushDocument } = opts;
    const hooks = useHooks();

    function findPaneByDoc(id: string) {
        return panes.value.find((p) => p.mode === 'doc' && p.documentId === id);
    }

    async function newDocumentInActive(initial?: { title?: string }) {
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        try {
            if (pane.mode === 'doc' && pane.documentId) {
                // Detect pending changes before flush.
                const prevState = useDocumentState(pane.documentId);
                // Proper grouping: consider pending if either pendingTitle or pendingContent exists
                const hadPending = !!(
                    prevState &&
                    ((prevState as any).pendingTitle !== undefined ||
                        (prevState as any).pendingContent !== undefined)
                );
                await flushDocument(pane.documentId);
                if (hadPending) {
                    hooks.doAction(
                        'ui.pane.doc:action:saved',
                        pane,
                        pane.documentId,
                        {}
                    );
                }
                await releaseDocument(pane.documentId, { flush: false });
            }
            const doc = await createNewDoc(initial);
            const oldId = pane.documentId;
            let newId: string | '' | false = doc.id;
            try {
                newId = (await hooks.applyFilters(
                    'ui.pane.doc:filter:select',
                    newId,
                    pane,
                    oldId
                )) as any;
            } catch {}
            if (newId === false) return undefined; // veto
            pane.mode = 'doc';
            pane.documentId = newId || undefined;
            pane.threadId = '';
            pane.messages = [];
            if (oldId !== newId)
                hooks.doAction(
                    'ui.pane.doc:action:changed',
                    pane,
                    oldId,
                    newId || ''
                );
            return doc;
        } catch {
            return undefined;
        }
    }

    async function selectDocumentInActive(id: string) {
        if (!id) return;
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        const oldId = pane.documentId || '';
        let requested: string | '' | false = id;
        try {
            requested = (await hooks.applyFilters(
                'ui.pane.doc:filter:select',
                requested,
                pane,
                oldId
            )) as any;
        } catch {}
        if (requested === false) return; // veto
        if (pane.mode === 'doc' && pane.documentId && pane.documentId !== id) {
            try {
                const prevState = useDocumentState(pane.documentId);
                const hadPending = !!(
                    prevState &&
                    ((prevState as any).pendingTitle !== undefined ||
                        (prevState as any).pendingContent !== undefined)
                );
                await flushDocument(pane.documentId);
                if (hadPending) {
                    hooks.doAction(
                        'ui.pane.doc:action:saved',
                        pane,
                        pane.documentId,
                        {}
                    );
                }
            } catch {}
            // Always release the previous doc state after switching.
            await releaseDocument(pane.documentId, { flush: false });
        }
        pane.mode = 'doc';
        pane.documentId = (requested as string) || undefined;
        pane.threadId = '';
        pane.messages = [];
        if (oldId !== requested)
            hooks.doAction(
                'ui.pane.doc:action:changed',
                pane,
                oldId,
                requested || ''
            );
    }

    return { newDocumentInActive, selectDocumentInActive };
}
