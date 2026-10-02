import { reactive } from 'vue';
import { useNuxtApp } from '#app';
import { useDebounceFn } from '@vueuse/core';
import {
    createDocumentInDb,
    updateDocumentInDb,
    getDocumentInDb,
    type Document,
} from '~/db/documents';
import { useToast } from '#imports';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { getDb, type Or3DB } from '~/db/client';

import type { TipTapDocument } from '~/types/database';

interface DocState {
    record: Document | null;
    status: 'idle' | 'saving' | 'saved' | 'error' | 'loading';
    lastError?: unknown;
    pendingTitle?: string; // Added this back as it was missing in the diff but used in flush
    pendingContent?: TipTapDocument | null; // TipTap JSON
    pendingTitleGeneration?: number;
    pendingContentGeneration?: number;
    nextGeneration: number;
    flushPromise?: Promise<void>; // Track active flush operation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debouncedSave?: any;
}

// A copied/imported document can have the same id in multiple workspaces.
// Cache and pending saves follow the actual originating DB, just like CRUD.
const documentScopes = new WeakMap<Or3DB, Map<string, DocState>>();
const pendingSaves = new Set<DocState>();
// Keep only unsaved edits alive when the workspace DB's LRU handle is closed.
// DB names identify the same local workspace across handle replacement.
const retainedDocuments = new Map<string, Map<string, DocState>>();
const saveDatabases = new WeakMap<DocState, Or3DB>();

function retainDocument(db: Or3DB, id: string, st: DocState) {
    let pending = retainedDocuments.get(db.name);
    if (!pending) {
        pending = new Map();
        retainedDocuments.set(db.name, pending);
    }
    pending.set(id, st);
}

function forgetRetainedDocument(db: Or3DB, id: string, st: DocState) {
    const pending = retainedDocuments.get(db.name);
    if (pending?.get(id) !== st) return;
    pending.delete(id);
    if (!pending.size) retainedDocuments.delete(db.name);
}

function getDocumentsMap(db = getDb()): Map<string, DocState> {
    let scope = documentScopes.get(db);
    if (!scope) {
        scope = reactive(new Map<string, DocState>(retainedDocuments.get(db.name)));
        documentScopes.set(db, scope);
        for (const st of scope.values()) saveDatabases.set(st, db);
    }
    return scope;
}

function ensure(id: string, db = getDb()): DocState {
    const documentsMap = getDocumentsMap(db);
    let st = documentsMap.get(id);
    if (!st) {
        st = reactive({ record: null, status: 'loading', nextGeneration: 0 }) as DocState;
        const state = st;
        st.debouncedSave = useDebounceFn(() => {
            pendingSaves.delete(state);
            return flushInDb(saveDatabases.get(state) ?? db, id);
        }, 750);
        documentsMap.set(id, st);
        saveDatabases.set(st, db);
    }
    return st;
}

function scheduleSave(id: string, db: Or3DB) {
    const st = getDocumentsMap(db).get(id);
    if (!st || !st.debouncedSave) return;
    pendingSaves.add(st);
    st.debouncedSave();
}

/**
 * Purpose:
 * Persist staged title or content updates to storage.
 *
 * Behavior:
 * Coalesces pending changes, updates the record, and emits pane-level
 * save hooks when appropriate.
 *
 * Constraints:
 * - No-op when there is nothing staged
 * - Serializes concurrent flush calls per document
 *
 * Non-Goals:
 * - Validation beyond the document schema
 *
 * @example
 * ```ts
 * await flush(documentId);
 * ```
 */
export async function flush(id: string, db = getDb()) {
    return flushInDb(db, id);
}

async function flushInDb(db: Or3DB, id: string) {
    const st = getDocumentsMap(db).get(id);
    if (!st || !st.record) return;

    // Wait for the active generation, then persist anything staged while it ran.
    if (st.flushPromise) {
        await st.flushPromise;
        if (st.pendingTitle !== undefined || st.pendingContent !== undefined) {
            return flushInDb(db, id);
        }
        return;
    }

    if (st.pendingTitle === undefined && st.pendingContent === undefined) {
        return; // nothing to persist
    }

    // Cancel any pending debounced save.
    if (st.debouncedSave?.cancel) {
        st.debouncedSave.cancel();
    }
    pendingSaves.delete(st);

    const capturedTitleGeneration = st.pendingTitleGeneration;
    const capturedContentGeneration = st.pendingContentGeneration;
    let saveSucceeded = false;
    const didSaveSucceed = (): boolean => saveSucceeded;

    st.flushPromise = (async () => {
        const patch: Partial<Pick<Document, 'title' | 'content'>> = {};
        if (st.pendingTitle !== undefined) patch.title = st.pendingTitle;
        if (st.pendingContent !== undefined) patch.content = st.pendingContent;
        st.status = 'saving';
        try {
            const expected = { title: st.record!.title,
                content: st.record!.content ? JSON.parse(JSON.stringify(st.record!.content)) as TipTapDocument : null };
            const updated = await updateDocumentInDb(db, id, patch, expected);
            if (updated) {
                st.record = updated;
                st.status = 'saved';
                saveSucceeded = true;
            } else {
                st.status = 'error';
            }
        } catch (e) {
            st.status = 'error';
            st.lastError = e;
            useToast().add({ color: 'error', title: 'Document: save failed' });
        } finally {
            // Clear only the exact generations that were persisted. New edits
            // made during the write remain staged for the next flush.
            if (
                didSaveSucceed() &&
                st.pendingTitleGeneration === capturedTitleGeneration
            ) {
                st.pendingTitle = undefined;
                st.pendingTitleGeneration = undefined;
            }
            if (
                didSaveSucceed() &&
                st.pendingContentGeneration === capturedContentGeneration
            ) {
                st.pendingContent = undefined;
                st.pendingContentGeneration = undefined;
            }
            st.flushPromise = undefined;
            if (st.pendingTitle === undefined && st.pendingContent === undefined) {
                forgetRetainedDocument(db, id, st);
            }
            // Emit pane-scoped saved hook for any panes displaying this doc.
            try {
                if (saveSucceeded && db === getDb() && typeof window !== 'undefined') {
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

    await st.flushPromise;
    if (
        didSaveSucceed() &&
        (st.pendingTitle !== undefined || st.pendingContent !== undefined)
    ) {
        return flushInDb(db, id);
    }
}

/**
 * Purpose:
 * Hydrate a document into the shared in-memory cache.
 *
 * Behavior:
 * Loads from storage, updates state, and reports missing records.
 *
 * Constraints:
 * - Emits toast notifications on failure
 *
 * Non-Goals:
 * - Retry logic or offline recovery
 *
 * @example
 * ```ts
 * const doc = await loadDocument(documentId);
 * ```
 */
export async function loadDocument(id: string, db = getDb()) {
    const st = ensure(id, db);
    st.status = 'loading';
    try {
        const rec = await getDocumentInDb(db, id);
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

/** Accept a committed host write only after its existing buffers have been settled. */
export function acceptCommittedDocument(record: Document, db: Or3DB): void {
    const st = ensure(record.id, db);
    if (st.flushPromise || st.pendingTitle !== undefined || st.pendingContent !== undefined) {
        throw new Error('An unsaved document buffer must be reconciled before accepting this change.');
    }
    if (st.debouncedSave?.cancel) st.debouncedSave.cancel();
    pendingSaves.delete(st);
    st.record = record;
    st.status = 'saved';
    st.lastError = undefined;
    forgetRetainedDocument(db, record.id, st);
}

/**
 * Purpose:
 * Create a new document and seed its cached state.
 *
 * Behavior:
 * Creates the record, caches it, and marks the state as idle.
 *
 * Constraints:
 * - Emits toast notifications on failure
 *
 * Non-Goals:
 * - Template selection or content generation
 *
 * @example
 * ```ts
 * const doc = await newDocument({ title: 'Plan' });
 * ```
 */
export async function newDocument(initial?: {
    title?: string;
    content?: TipTapDocument | null;
}) {
    try {
        const db = getDb();
        const rec = await createDocumentInDb(db, initial);
        const st = ensure(rec.id, db);
        st.record = rec;
        st.status = 'idle';
        return rec;
    } catch (e) {
        useToast().add({ color: 'error', title: 'Document: create failed' });
        throw e;
    }
}

/**
 * Purpose:
 * Stage a title change and schedule a debounced save.
 *
 * Behavior:
 * Updates pending title state and queues a flush.
 *
 * Constraints:
 * - Requires a loaded document record
 *
 * Non-Goals:
 * - Immediate persistence
 *
 * @example
 * ```ts
 * setDocumentTitle(documentId, 'New Title');
 * ```
 */
export function setDocumentTitle(id: string, title: string, db = getDb()) {
    const st = ensure(id, db);
    if (st.record) {
        st.pendingTitle = title;
        st.pendingTitleGeneration = ++st.nextGeneration;
        retainDocument(db, id, st);
        scheduleSave(id, db);
    }
}

/**
 * Purpose:
 * Stage content changes and schedule a debounced save.
 *
 * Behavior:
 * Updates pending content state and queues a flush.
 *
 * Constraints:
 * - Requires a loaded document record
 *
 * Non-Goals:
 * - Immediate persistence
 *
 * @example
 * ```ts
 * setDocumentContent(documentId, tiptapJson);
 * ```
 */
export function setDocumentContent(id: string, content: TipTapDocument | null, db = getDb()) {
    const st = ensure(id, db);
    if (st.record) {
        st.pendingContent = content;
        st.pendingContentGeneration = ++st.nextGeneration;
        retainDocument(db, id, st);
        scheduleSave(id, db);
    }
}

/**
 * Purpose:
 * Access the reactive state container for a document.
 *
 * Behavior:
 * Returns existing state or creates it lazily.
 *
 * Constraints:
 * - Creation sets status to loading
 *
 * Non-Goals:
 * - Fetching the record from storage
 *
 * @example
 * ```ts
 * const state = useDocumentState(documentId);
 * ```
 */
export function useDocumentState(id: string, db = getDb()) {
    return getDocumentsMap(db).get(id) || ensure(id, db);
}

/**
 * Purpose:
 * Inspect all cached document states.
 *
 * Behavior:
 * Returns the shared reactive map.
 *
 * Constraints:
 * - Mutating the map directly can break invariants
 *
 * Non-Goals:
 * - Access control or filtering
 *
 * @example
 * ```ts
 * const stateMap = useAllDocumentsState();
 * ```
 */
export function useAllDocumentsState() {
    return getDocumentsMap();
}

// ---- Minimal internal peek helpers for multi-pane hook integration ----
// Whether there are staged (pending) changes that would trigger a save on flush.
/**
 * Internal API.
 *
 * Purpose:
 * Detect whether a document has staged changes.
 *
 * Behavior:
 * Returns true when title or content is pending.
 *
 * Constraints:
 * - Requires state to be present
 *
 * Non-Goals:
 * - Triggering a save
 */
export function __hasPendingDocumentChanges(id: string): boolean {
    const st = getDocumentsMap().get(id);
    return !!(
        st &&
        st.record &&
        (st.pendingTitle !== undefined || st.pendingContent !== undefined)
    );
}

// Read current status (used to confirm a flush produced a saved state).
/**
 * Internal API.
 *
 * Purpose:
 * Read a document status without creating state.
 *
 * Behavior:
 * Returns the status value if the state exists.
 *
 * Constraints:
 * - Returns undefined when not cached
 *
 * Non-Goals:
 * - Loading or initializing state
 */
export function __peekDocumentStatus(
    id: string
): DocState['status'] | undefined {
    return getDocumentsMap().get(id)?.status;
}

// Release a document's in-memory state (after ensuring pending changes flushed).
// This lets GC reclaim large TipTap JSON payloads when switching away.
/**
 * Purpose:
 * Release cached state for a document to reduce memory usage.
 *
 * Behavior:
 * Optionally flushes pending changes, clears cached content, and
 * removes the entry from the state map.
 *
 * Constraints:
 * - Flush failures are swallowed during release
 *
 * Non-Goals:
 * - Deleting the document record from storage
 *
 * @example
 * ```ts
 * await releaseDocument(documentId, { flush: true });
 * ```
 */
export async function releaseDocument(
    id: string,
    opts: { flush?: boolean; deleteEntry?: boolean } = {}
) {
    // Rename to avoid shadowing the exported flush(id) function above.
    const { flush: shouldFlush = true, deleteEntry = true } = opts;
    const db = getDb();
    const documentsMap = getDocumentsMap(db);
    const st = documentsMap.get(id);
    if (!st) return;
    // Cancel any pending debounced save
    if (st.debouncedSave?.cancel) {
        st.debouncedSave.cancel();
    }
    pendingSaves.delete(st);

    if (shouldFlush) {
        try {
            await flushInDb(db, id);
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
    st.pendingTitleGeneration = undefined;
    st.pendingContentGeneration = undefined;
    forgetRetainedDocument(db, id, st);
    if (deleteEntry) {
        documentsMap.delete(id);
    }
}

// HMR cleanup: clear all pending timers on module disposal
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        for (const st of pendingSaves) {
            if (st.debouncedSave?.cancel) {
                st.debouncedSave.cancel();
            }
        }
        pendingSaves.clear();
    });
}
