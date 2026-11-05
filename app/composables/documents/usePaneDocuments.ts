// Composable to manage per-pane document operations (create/select) abstracted from UI.
// Assumes panes follow the PaneState contract from useMultiPane.

import { getCurrentScope, onScopeDispose, type Ref } from 'vue';
import { getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import type { MultiPaneState } from '~/composables/core/useMultiPane';
import {
    releaseDocument,
    useDocumentState,
} from '~/composables/documents/useDocumentsStore';
import { useToast } from '#imports';
import { useHooks } from '../../core/hooks/useHooks';

/**
 * Purpose:
 * Configure pane-aware document helpers with pane state and handlers.
 *
 * Behavior:
 * Supplies pane references and creation or flush callbacks.
 *
 * Constraints:
 * - Requires multi-pane state refs
 *
 * Non-Goals:
 * - Persisting documents directly
 */
export interface UsePaneDocumentsOptions {
    panes: Ref<MultiPaneState[]>;
    activePaneIndex: Ref<number>;
    createNewDoc: (initial?: { title?: string }) => Promise<{ id: string }>;
    flushDocument: (id: string) => Promise<void> | void;
}

/**
 * Purpose:
 * Expose pane-aware document operations.
 *
 * Behavior:
 * Provides create and select helpers for the active pane.
 *
 * Constraints:
 * - Helpers assume pane state is mutable
 *
 * Non-Goals:
 * - Pane rendering or layout control
 */
export interface UsePaneDocumentsApi {
    newDocumentInActive: (initial?: {
        title?: string;
    }) => Promise<{ id: string } | undefined>;
    selectDocumentInActive: (id: string) => Promise<void>;
}

function reportFlushFailure(
    id: string,
    error: unknown,
    previousError: unknown,
    toast: ReturnType<typeof useToast>,
    db: Or3DB,
) {
    const state = useDocumentState(id, db);
    console.error('[usePaneDocuments] Failed to flush document:', error);
    // The document store already shows a toast when it records a thrown
    // persistence error. Only add feedback when this guard found no new error
    // there (including the store's silent `status: 'error'` result).
    if (state.lastError === previousError) {
        toast.add({
            color: 'error',
            title: 'Document: save failed',
            description: 'Your changes are still open. Please try saving again.',
        });
    }
}

/**
 * Flush a document before leaving it, preserving the pane when persistence
 * reports a failure. The document store reports some write failures through
 * its error status instead of rejecting, so checking the state is required
 * in addition to handling a rejected flush callback.
 */
async function flushBeforeNavigation(
    id: string,
    flushDocument: UsePaneDocumentsOptions['flushDocument'],
    toast: ReturnType<typeof useToast>,
    db: Or3DB,
    isCurrent: () => boolean,
): Promise<boolean> {
    const previousError = useDocumentState(id, db).lastError;
    try {
        await flushDocument(id);
    } catch (error) {
        if (isCurrent()) reportFlushFailure(id, error, previousError, toast, db);
        return false;
    }

    if (!isCurrent()) return false;
    const state = useDocumentState(id, db);
    if (state.status === 'error') {
        reportFlushFailure(id, state.lastError, previousError, toast, db);
        return false;
    }
    return true;
}

/**
 * Purpose:
 * Coordinate document creation and selection within the active pane.
 *
 * Behavior:
 * Flushes pending edits, applies selection filters, and emits pane hooks.
 *
 * Constraints:
 * - Relies on hook filters for veto logic
 * - Flush errors keep the current document active and preserve its edits
 *
 * Non-Goals:
 * - Persisting pane layouts
 *
 * @example
 * ```ts
 * const paneDocs = usePaneDocuments({
 *   panes,
 *   activePaneIndex,
 *   createNewDoc: newDocument,
 *   flushDocument: flush,
 * });
 * await paneDocs.selectDocumentInActive(documentId);
 * ```
 */
export function usePaneDocuments(
    opts: UsePaneDocumentsOptions
): UsePaneDocumentsApi {
    const { panes, activePaneIndex, createNewDoc, flushDocument } = opts;
    const hooks = useHooks();
    const toast = useToast();
    const navigations = new WeakMap<MultiPaneState, symbol>();
    let disposed = false;
    if (getCurrentScope()) onScopeDispose(() => { disposed = true; });

    function beginNavigation(pane: MultiPaneState) {
        const token = Symbol();
        navigations.set(pane, token);
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const { mode, documentId, threadId } = pane;
        return { db, current: () => !disposed && navigations.get(pane) === token
            && panes.value[activePaneIndex.value] === pane && getDb() === db && getWorkspaceGeneration() === generation
            && pane.mode === mode && pane.documentId === documentId && pane.threadId === threadId };
    }

    async function newDocumentInActive(initial?: { title?: string }) {
        const pane = panes.value[activePaneIndex.value];
        if (!pane || disposed) return;
        const { db, current } = beginNavigation(pane);
        try {
            if (pane.mode === 'doc' && pane.documentId) {
                // Detect pending changes before flush
                const previousDocumentId = pane.documentId;
                const prevState = useDocumentState(previousDocumentId, db);
                const hadPending =
                    prevState.pendingTitle !== undefined ||
                    prevState.pendingContent !== undefined;
                if (!(await flushBeforeNavigation(previousDocumentId, flushDocument, toast, db, current))) {
                    return undefined;
                }
                // Report the successfully flushed edits before leaving this pane.
                if (hadPending) {
                    void hooks.doAction('ui.pane.doc:action:saved', {
                        pane,
                        oldDocumentId: previousDocumentId,
                        newDocumentId: previousDocumentId,
                        paneIndex: activePaneIndex.value,
                        meta: { reason: 'flushPending' },
                    });
                }
            }
            if (!current()) return;
            const doc = await createNewDoc(initial);
            if (!current()) return;
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
            if (!current() || newId === false) return undefined;
            if (pane.mode === 'doc' && oldId) {
                await releaseDocument(oldId, { flush: false }, db);
                if (!current()) return;
            }
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
        if (!pane || disposed) return;
        const { db, current } = beginNavigation(pane);
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
        if (!current() || requested === false) return;
        if (pane.mode === 'doc' && pane.documentId && pane.documentId !== requested) {
            const previousDocumentId = pane.documentId;
            const prevState = useDocumentState(previousDocumentId, db);
            const hadPending =
                prevState.pendingTitle !== undefined ||
                prevState.pendingContent !== undefined;
            if (!(await flushBeforeNavigation(previousDocumentId, flushDocument, toast, db, current))) {
                return;
            }
            // Report the successfully flushed edits before leaving this pane.
            if (hadPending) {
                void hooks.doAction('ui.pane.doc:action:saved', {
                    pane,
                    oldDocumentId: previousDocumentId,
                    newDocumentId: previousDocumentId,
                    paneIndex: activePaneIndex.value,
                    meta: { reason: 'flushPending' },
                });
            }
            await releaseDocument(previousDocumentId, { flush: false }, db);
            if (!current()) return;
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
