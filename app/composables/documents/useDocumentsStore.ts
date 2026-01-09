import { reactive } from 'vue';
import { useNuxtApp } from '#app';
import { useDebounceFn } from '@vueuse/core';
import {
    createDocument,
    updateDocument,
    getDocument,
    type Document,
} from '~/db/documents';
import { useToast } from '#imports';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

import type { TipTapDocument } from '~/types/database';

interface DocState {
    record: Document | null;
    status: 'idle' | 'saving' | 'saved' | 'error' | 'loading';
    lastError?: unknown;
    pendingTitle?: string; // Added this back as it was missing in the diff but used in flush
    pendingContent?: TipTapDocument | null; // TipTap JSON
    flushPromise?: Promise<void>; // Track active flush operation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debouncedSave?: any;
}

const documentsMap = reactive(new Map<string, DocState>());

function ensure(id: string): DocState {
    let st = documentsMap.get(id);
    if (!st) {
        st = { record: null, status: 'loading' } as DocState;
        st.debouncedSave = useDebounceFn(() => flush(id), 750);
        documentsMap.set(id, st);
    }
    return st;
}

function scheduleSave(id: string) {
    const st = documentsMap.get(id);
    if (!st || !st.debouncedSave) return;
    st.debouncedSave();
}

export async function flush(id: string) {
    const st = documentsMap.get(id);
    if (!st || !st.record) return;

    // If a flush is already in progress, wait for it
    if (st.flushPromise) {
        return st.flushPromise;
    }

    if (!st.pendingTitle && !st.pendingContent) return; // nothing to persist

    // Cancel any pending debounced save
    // Cancel any pending debounced save
    if (st.debouncedSave?.cancel) {
        st.debouncedSave.cancel();
    }

    st.flushPromise = (async () => {
        const patch: Partial<Pick<Document, 'title' | 'content'>> = {};
        if (st.pendingTitle !== undefined) patch.title = st.pendingTitle;
        if (st.pendingContent !== undefined) patch.content = st.pendingContent;
        st.status = 'saving';
        try {
            const updated = await updateDocument(id, patch);
            if (updated) {
                st.record = updated;
                st.status = 'saved';
            } else {
                st.status = 'error';
            }
        } catch (e) {
            st.status = 'error';
            st.lastError = e;
            useToast().add({ color: 'error', title: 'Document: save failed' });
        } finally {
            st.pendingTitle = undefined;
            st.pendingContent = undefined;
            st.flushPromise = undefined;
            // Emit pane-scoped saved hook for any panes displaying this doc.
            try {
                if (typeof window !== 'undefined') {
                    const nuxt = useNuxtApp();
                    interface NuxtWithHooks { $hooks?: { doAction: (name: string, payload: unknown) => void } }
                    const hooks = (nuxt as NuxtWithHooks).$hooks;
                    const mpApi = getGlobalMultiPaneApi();
                    const panes = mpApi?.panes.value ?? [];
                    if (hooks && panes.length) {
                        panes.forEach((p, paneIndex: number) => {
                            if (p.mode === 'doc' && p.documentId === id) {
                                hooks.doAction(
                                    'ui.pane.doc:action:saved',
                                    {
                                        pane: p,
                                        oldDocumentId: id,
                                        newDocumentId: id,
                                        paneIndex,
                                        meta: { reason: 'docStoreFlush' },
                                    }
                                );
                            }
                        });
                    }
                }
            } catch { /* Silently ignore hook errors */ }
        }
    })();

    return st.flushPromise;
}

export async function loadDocument(id: string) {
    const st = ensure(id);
    st.status = 'loading';
    try {
        const rec = await getDocument(id);
        st.record = rec || null;
        st.status = rec ? 'idle' : 'error';
        if (!rec) {
            useToast().add({ color: 'error', title: 'Document: not found' });
        }
    } catch (e) {
        st.status = 'error';
        st.lastError = e;
        useToast().add({ color: 'error', title: 'Document: load failed' });
    }
    return st.record;
}

export async function newDocument(initial?: {
    title?: string;
    content?: TipTapDocument | null;
}) {
    try {
        const rec = await createDocument(initial);
        const st = ensure(rec.id);
        st.record = rec;
        st.status = 'idle';
        return rec;
    } catch (e) {
        useToast().add({ color: 'error', title: 'Document: create failed' });
        throw e;
    }
}

export function setDocumentTitle(id: string, title: string) {
    const st = ensure(id);
    if (st.record) {
        st.pendingTitle = title;
        scheduleSave(id);
    }
}

export function setDocumentContent(id: string, content: TipTapDocument | null) {
    const st = ensure(id);
    if (st.record) {
        st.pendingContent = content;
        scheduleSave(id);
    }
}

export function useDocumentState(id: string) {
    return documentsMap.get(id) || ensure(id);
}

export function useAllDocumentsState() {
    return documentsMap;
}

// ---- Minimal internal peek helpers for multi-pane hook integration ----
// Whether there are staged (pending) changes that would trigger a save on flush.
export function __hasPendingDocumentChanges(id: string): boolean {
    const st = documentsMap.get(id);
    return !!(
        st &&
        st.record &&
        (st.pendingTitle !== undefined || st.pendingContent !== undefined)
    );
}

// Read current status (used to confirm a flush produced a saved state).
export function __peekDocumentStatus(
    id: string
): DocState['status'] | undefined {
    return documentsMap.get(id)?.status;
}

// Release a document's in-memory state (after ensuring pending changes flushed).
// This lets GC reclaim large TipTap JSON payloads when switching away.
export async function releaseDocument(
    id: string,
    opts: { flush?: boolean; deleteEntry?: boolean } = {}
) {
    // Rename to avoid shadowing the exported flush(id) function above.
    const { flush: shouldFlush = true, deleteEntry = true } = opts;
    const st = documentsMap.get(id);
    if (!st) return;
    // Cancel any pending debounced save
    if (st.debouncedSave?.cancel) {
        st.debouncedSave.cancel();
    }

    if (shouldFlush) {
        try {
            await flush(id);
        } catch { /* Silently ignore flush errors during release */ }
    }
    // Null record to drop heavy content reference; then optionally drop entry entirely.
    if (st.record) {
        try {
            // Remove large nested content tree reference if present.
            if (st.record.content) {
                (st.record as { content?: unknown }).content = undefined;
            }
        } catch { /* Silently ignore content cleanup errors */ }
        st.record = null;
    }
    st.pendingTitle = undefined;
    st.pendingContent = undefined;
    if (deleteEntry) {
        documentsMap.delete(id);
    }
}

// HMR cleanup: clear all pending timers on module disposal
// HMR cleanup: clear all pending timers on module disposal
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        for (const [, st] of documentsMap) {
            if (st.debouncedSave?.cancel) {
                st.debouncedSave.cancel();
            }
        }
    });
}
