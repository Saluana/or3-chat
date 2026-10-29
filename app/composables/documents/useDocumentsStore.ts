import { reactive } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
    createDocumentInDb,
    updateDocumentInDb,
    getDocumentInDb,
    type Document,
} from '~/db/documents';
import { reportError } from '~/utils/errors';
import { getDb, type Or3DB } from '~/db/client';

import type { TipTapDocument } from '~/types/database';

interface EditorConflictDraft {
    title: string;
    content: TipTapDocument;
    baselineTitle: string;
    baselineContent: TipTapDocument;
}

interface DocState {
    record: Document | null;
    status: 'idle' | 'saving' | 'saved' | 'error' | 'loading' | 'unavailable';
    lastError?: unknown;
    pendingTitle?: string; // Added this back as it was missing in the diff but used in flush
    pendingContent?: TipTapDocument | null; // TipTap JSON
    pendingTitleGeneration?: number;
    pendingContentGeneration?: number;
    editorConflicts?: Map<string, EditorConflictDraft>;
    editorOwners?: number;
    nextGeneration: number;
    readGeneration?: number;
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
const saveListeners = new Set<(db: Or3DB, id: string) => void>();

/** Subscribe to completed local document writes. Returns an unsubscribe handle. */
export function subscribeDocumentSaves(listener: (db: Or3DB, id: string) => void): () => void {
    saveListeners.add(listener);
    return () => { saveListeners.delete(listener); };
}

function retainDocument(db: Or3DB, id: string, st: DocState) {
    let pending = retainedDocuments.get(db.name);
    if (!pending) {
        pending = new Map();
        retainedDocuments.set(db.name, pending);
    }
    pending.set(id, st);
}

function forgetRetainedDocument(db: Or3DB, id: string, st: DocState) {
    if (st.editorConflicts?.size) return;
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
 * Coalesces pending changes, updates the record, and reports successful writes.
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
                st.lastError = undefined;
                saveSucceeded = true;
            } else {
                st.status = 'error';
            }
        } catch (e) {
            st.status = 'error';
            st.lastError = e;
            reportError(e, { message: 'Document could not be saved locally.', tags: { domain: 'documents' } });
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
            if (saveSucceeded) {
                for (const listener of saveListeners) {
                    try { listener(db, id); } catch { /* Notification must not affect persistence. */ }
                }
            }
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
 * - Automatically rebasing unsaved changes over concurrent edits
 *
 * @example
 * ```ts
 * const doc = await loadDocument(documentId);
 * ```
 */
export async function loadDocument(id: string, db = getDb()) {
    return readDocument(id, db, false);
}

/** Refresh an open record without flashing its initial loading/saved status. */
export async function refreshDocument(id: string, db = getDb()) {
    return readDocument(id, db, true);
}

async function readDocument(id: string, db: Or3DB, background: boolean) {
    const st = ensure(id, db);
    const previousStatus = st.status;
    const readGeneration = st.readGeneration = (st.readGeneration ?? 0) + 1;
    const recordAtStart = st.record;
    const generationAtStart = st.nextGeneration;
    const hasPendingSave = () => st.pendingTitle !== undefined ||
        st.pendingContent !== undefined || !!st.flushPromise;
    const canAcceptRead = () => st.readGeneration === readGeneration && st.record === recordAtStart &&
        st.nextGeneration === generationAtStart && !hasPendingSave();
    if (!background && !hasPendingSave()) st.status = 'loading';
    try {
        const rec = await getDocumentInDb(db, id);
        // A read is not permission to acknowledge or rebase an unsaved edit.
        // Preserve its conflict baseline, and reject reads older than a save
        // or a new edit made while storage was being read.
        if (!canAcceptRead()) return st.record;
        st.record = rec || null;
        st.status = rec ? (background && previousStatus === 'saved' ? 'saved' : 'idle') : 'unavailable';
        st.lastError = undefined;
    } catch (e) {
        if (!canAcceptRead()) return st.record;
        st.status = 'error';
        st.lastError = e;
        reportError(e, { message: 'Document could not be loaded.', tags: { domain: 'documents' } });
    }
    return st.record;
}

/** Preserve an owned draft as a new document before rebasing its original buffer. */
export async function saveDocumentRecoveryCopy(
    id: string,
    draft: { title: string; content: TipTapDocument },
    options: { conflictOwner?: string; isCurrent: () => boolean },
    db = getDb(),
): Promise<Document> {
    const st = ensure(id, db);
    if (st.flushPromise) await st.flushPromise;
    if (!options.isCurrent()) throw new Error('The document changed. Your draft is still retained.');
    const generation = st.nextGeneration;
    const record = st.record;
    const conflict = options.conflictOwner ? st.editorConflicts?.get(options.conflictOwner) : undefined;
    const title = st.pendingTitle ?? record?.title ?? '';
    const content = st.pendingContent !== undefined ? st.pendingContent : record?.content;
    if (!conflict && (title !== draft.title || JSON.stringify(content) !== JSON.stringify(draft.content))) {
        throw new Error('The draft changed. Your edits are still retained.');
    }
    st.debouncedSave?.cancel?.();
    pendingSaves.delete(st);
    const copy = await createDocumentInDb(db, { title: `${draft.title || 'Untitled'} (recovered copy)`, content: draft.content });
    const latest = await getDocumentInDb(db, id);
    if (!options.isCurrent() || st.nextGeneration !== generation || st.record !== record || st.flushPromise
        || (options.conflictOwner && st.editorConflicts?.get(options.conflictOwner) !== conflict)) {
        throw new Error(`Recovery copy saved as “${copy.title}”. Newer edits remain in the original buffer.`);
    }
    if (!latest) throw new Error(`Recovery copy saved as “${copy.title}”. The original is unavailable.`);
    if (conflict && options.conflictOwner) {
        // This pane owns only its conflicting draft. Shared pending edits belong
        // to the other panes and must remain staged for their normal save path.
        setDocumentEditorConflict(id, options.conflictOwner, undefined, db);
    } else {
        st.pendingTitle = undefined;
        st.pendingContent = undefined;
        st.pendingTitleGeneration = undefined;
        st.pendingContentGeneration = undefined;
        st.nextGeneration++;
        st.readGeneration = (st.readGeneration ?? 0) + 1;
        st.record = latest;
        st.status = 'idle';
        st.lastError = undefined;
        forgetRetainedDocument(db, id, st);
    }
    return copy;
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
        reportError(e, { message: 'Document could not be created.', tags: { domain: 'documents' } });
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

/** Retain a competing pane's draft without replacing the shared pending save. */
export function setDocumentEditorConflict(id: string, key: string, draft: EditorConflictDraft | undefined, db = getDb()): void {
    const st = ensure(id, db);
    if (draft) {
        (st.editorConflicts ??= new Map()).set(key, draft);
        retainDocument(db, id, st);
    } else {
        st.editorConflicts?.delete(key);
        if (!st.flushPromise && st.pendingTitle === undefined && st.pendingContent === undefined) {
            forgetRetainedDocument(db, id, st);
        }
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
 * - Unsaved edits prevent release, including after a failed flush
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
    opts: { flush?: boolean; deleteEntry?: boolean } = {},
    db = getDb(),
) {
    // Rename to avoid shadowing the exported flush(id) function above.
    const { flush: shouldFlush = true, deleteEntry = true } = opts;
    const documentsMap = getDocumentsMap(db);
    const st = documentsMap.get(id);
    if (!st || st.editorOwners) return;
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
    // Release is cache eviction, not a user-authorized discard. A failed save
    // or an edit staged while release awaited storage must remain retryable.
    if (documentsMap.get(id) !== st || st.editorOwners || st.flushPromise || st.pendingTitle !== undefined || st.pendingContent !== undefined || st.editorConflicts?.size) {
        return;
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

/** Keep a pane's buffer alive until its final editor closes, in its originating workspace. */
export function retainDocumentEditor(id: string, db = getDb()): () => Promise<void> {
    const st = ensure(id, db);
    st.editorOwners = (st.editorOwners ?? 0) + 1;
    let released = false;
    return async () => {
        if (released) return;
        released = true;
        st.editorOwners = Math.max(0, (st.editorOwners ?? 1) - 1);
        if (!st.editorOwners) await releaseDocument(id, {}, db);
    };
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
