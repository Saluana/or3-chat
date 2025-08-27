// Composable to manage per-pane document operations (create/select) abstracted from UI.
// Assumes panes follow the PaneState contract from useMultiPane.

import type { Ref } from 'vue';
import type { MultiPaneState } from '~/composables/useMultiPane';

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

    async function newDocumentInActive(initial?: { title?: string }) {
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        try {
            if (pane.mode === 'doc' && pane.documentId) {
                await flushDocument(pane.documentId);
            }
            const doc = await createNewDoc(initial);
            pane.mode = 'doc';
            pane.documentId = doc.id;
            pane.threadId = '';
            pane.messages = [];
            return doc;
        } catch {
            return undefined;
        }
    }

    async function selectDocumentInActive(id: string) {
        if (!id) return;
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        if (pane.mode === 'doc' && pane.documentId && pane.documentId !== id) {
            try {
                await flushDocument(pane.documentId);
            } catch {}
        }
        pane.mode = 'doc';
        pane.documentId = id;
        pane.threadId = '';
        pane.messages = [];
    }

    return { newDocumentInActive, selectDocumentInActive };
}
