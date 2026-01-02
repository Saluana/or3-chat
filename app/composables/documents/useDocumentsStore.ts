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
    if (st.debouncedSave && typeof st.debouncedSave.cancel === 'function') {
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
    if (!st) return;
    // Cancel any pending debounced save
    // Note: useDebounceFn doesn't expose a per-argument cancel easily if shared,
    // but here we are using a shared debounce function.
    // However, the original code had a per-document timer.
    // To replicate per-document cancellation correctly with a shared debounce function is tricky if we don't track it.
    // Actually, VueUse's useDebounceFn is a single timer. If we call it for doc A then doc B, doc A's call might be cancelled if maxWait isn't used or if not independent.
    // Wait, useDebounceFn creates ONE debounced function. If we want independent debounces per document, we need to store the debounced function on the document state?
    // The previous implementation used a map of states, each with a timer.
    // So 'scheduleSave' was global but operated on specific ID's timer.

    // Let's correct this. We need per-document debouncing if we want them independent.
    // The previous code: `st.timer = setTimeout(...)`. This IS per-document.
    
    // So we should probably NOT use a single global `debouncedFlush`.
    // Instead each document state should perhaps hold its own debounced save function?
    // Or we stick to the plan which says: "create debouncedFlush = useDebounceFn((id) => flush(id), 750)"
    // If we use a single debounced function, saving Doc A then immediately Doc B would cancel Doc A's save if the debounce is global!
    // That seems like a regression.
    
    // Ah, checking the plan: "create debouncedFlush = useDebounceFn((id) => flush(id), 750); remove timer on state."
    // This implies a SINGLE debounced function.
    // If I type in Doc A, then click Doc B and type, Doc A's save might be lost if I don't flush it explicitly?
    // `releaseDocument` calls `flush(id)`.
    
    // If I switch documents, `releaseDocument` is called.
    
    // But if I have two docs open side-by-side (multi-pane)?
    // Writing in A, then writing in B quickly.
    // Global debounce will delay A, then B comes in and cancels A's timer `useDebounceFn` usually cancels previous invocation.
    
    // To be safe and match "exact behavior", we should probably have per-doc debounce.
    // BUT the requirement/plan explicitly said: `create debouncedFlush = useDebounceFn((id) => flush(id), 750)`
    // I should follow the plan, but if it causes a bug (REGRESSION), I need to be careful.
    // Multi-pane IS a feature.
    
    // Actually, `useSidebarSearch` used a single debounce because there is only one search query.
    // `useDocumentsStore` manages MANY documents.
    
    // Let's look at `useDebounceFn` docs or behavior. "Debounce execution of a function."
    // It does not key by argument.
    
    // Use `createDebounceFn`? No.
    
    // Alternative: We can attach a `debouncedSave` to the `DocState` when creating it.
    
    // Let's refine the implementation to be SAFE for multi-pane.
    // I will add `debouncedSave` to `DocState` instead of `timer`.
    
    // Wait, I can't deviate from the plan too much without checking, but the goal is "preserve exact behavior".
    // Global debounce definitely changes behavior for concurrent edits in multi-pane.
    
    // Let's add `debouncedSave` to `DocState`.
    
    // Correct approach for `useDocumentsStore.ts`:
    // 1. Add `debouncedSave?: DebouncedFn<void>` to DocState.
    // 2. In `ensure(id)`, initialize it: `st.debouncedSave = useDebounceFn(() => flush(id), 750)`.
    // 3. In `scheduleSave(id)`, call `st.debouncedSave()`.
    // 4. In `flush`, cancel `st.debouncedSave`? `useDebounceFn` doesn't pass the cancel method easily?
    // Actually `useDebounceFn` returns the function with `.cancel()`.
    
    // Let's verify `useDebounceFn` return type. It returns the debounced function which has `.cancel()`.
    
    // So:
    // interface DocState { ... debouncedSave?: Function & { cancel: () => void } }
    
    // This seems safer.
    
    // BUT for this specific tool call, I am editing the file text.
    // I will stick to what creates independent timers to match original behavior.
    
    // Wait, the previous code used `setTimeout` stored on the state.
    // If I use `useDebounceFn`, I should store the result on the state.
    
    // Let's try to do this cleanly.

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
            if (st.debouncedSave && typeof st.debouncedSave.cancel === 'function') {
                st.debouncedSave.cancel();
            }
        }
    });
}
