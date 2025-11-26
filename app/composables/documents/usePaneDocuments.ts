// Composable to manage per-pane document operations (create/select) abstracted from UI.
// Assumes panes follow the PaneState contract from useMultiPane.

import type { Ref } from 'vue';
import type { MultiPaneState } from '~/composables/core/useMultiPane';
import {
    releaseDocument,
    useDocumentState,
} from '~/composables/documents/useDocumentsStore';
import { useHooks } from '../../core/hooks/useHooks';

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

    async function newDocumentInActive(initial?: { title?: string }) {
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        try {
            if (pane.mode === 'doc' && pane.documentId) {
                // Detect pending changes before flush
                const prevState = useDocumentState(pane.documentId);
                const hadPending =
                    prevState.pendingTitle !== undefined ||
                    prevState.pendingContent !== undefined;
                await flushDocument(pane.documentId);
                // Emit saved hook if pending changes existed (defensive for test scenarios)
                if (hadPending && pane.documentId) {
                    void hooks.doAction('ui.pane.doc:action:saved', {
                        pane,
                        oldDocumentId: pane.documentId,
                        newDocumentId: pane.documentId,
                        paneIndex: activePaneIndex.value,
                        meta: { reason: 'flushPending' },
                    });
                }
                await releaseDocument(pane.documentId, { flush: false });
            }
            const doc = await createNewDoc(initial);
            const oldId = pane.documentId || '';
            let newId: string | false = doc.id;
            try {
                newId = (await hooks.applyFilters(
                    'ui.pane.doc:filter:select',
                    newId,
                    pane,
                    oldId
                )) as string | false;
            } catch { /* ignore filter errors */ }
            if (newId === false) return undefined; // veto
            pane.mode = 'doc';
            pane.documentId = newId || undefined;
            pane.threadId = '';
            pane.messages = [];
            if (oldId !== newId)
                void hooks.doAction('ui.pane.doc:action:changed', {
                    pane,
                    oldDocumentId: oldId,
                    newDocumentId: (newId || ''),
                    paneIndex: activePaneIndex.value,
                    meta: { created: true },
                });
            return doc;
        } catch (err) {
            console.error('[usePaneDocuments] Failed to create document:', err);
            return undefined;
        }
    }

    async function selectDocumentInActive(id: string) {
        if (!id) return;
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        const oldId = pane.documentId || '';
        let requested: string | false = id;
        try {
            requested = (await hooks.applyFilters(
                'ui.pane.doc:filter:select',
                requested,
                pane,
                oldId
            )) as string | false;
        } catch { /* ignore filter errors */ }
        if (requested === false) return; // veto
        if (pane.mode === 'doc' && pane.documentId && pane.documentId !== id) {
            try {
                const prevState = useDocumentState(pane.documentId);
                const hadPending =
                    prevState.pendingTitle !== undefined ||
                    prevState.pendingContent !== undefined;
                await flushDocument(pane.documentId);
                // Emit saved hook if pending changes existed (defensive for test scenarios)
                if (hadPending && pane.documentId) {
                    void hooks.doAction('ui.pane.doc:action:saved', {
                        pane,
                        oldDocumentId: pane.documentId,
                        newDocumentId: pane.documentId,
                        paneIndex: activePaneIndex.value,
                        meta: { reason: 'flushPending' },
                    });
                }
            } catch (err) {
                console.error('[usePaneDocuments] Failed to flush document:', err);
            }
            // Always release the previous doc state after switching
            await releaseDocument(pane.documentId, { flush: false });
        }
        pane.mode = 'doc';
        pane.documentId = (requested) || undefined;
        pane.threadId = '';
        pane.messages = [];
        if (oldId !== requested)
            void hooks.doAction('ui.pane.doc:action:changed', {
                pane,
                oldDocumentId: oldId,
                newDocumentId: (requested || ''),
                paneIndex: activePaneIndex.value,
                meta: { reason: 'select' },
            });
    }

    return { newDocumentInActive, selectDocumentInActive };
}
