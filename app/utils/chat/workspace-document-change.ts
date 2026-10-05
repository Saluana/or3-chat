import type { Post } from '~/db/schema';
import type { TipTapDocument } from '~/types/database';
import type { DocumentAiOperation } from '~/utils/documents/document-ai-operations';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from './workspace-access';
import type { ToolExecutionContext } from './types';
import { readWorkspaceItem, workspaceRevision, type WorkspaceSource } from './workspace-items';
import { messageData, persistWorkspaceReceipt, readIdentity, type WorkspaceDocumentRead } from './workspace-document-read';
import { prepareDocumentUpdate } from '~/db/documents';
import { prepareDocumentRevision, listCompleteDocumentRevisions } from '~/db/document-revisions';
import { getWriteTxTableNames, nextClock, nowSec } from '~/db/util';
import { MessageSchema, type Message } from '~/db/schema';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { serializeDocumentFileHashes } from '~/utils/documents/document-content';
import { leaseWorkspaceDocumentEditors } from '~/composables/documents/useDocumentEditorSessions';

export const WORKSPACE_CHANGE_KEY = 'or3.workspace-change:';
interface ChangeIdentity { version: 1; documentId: string; inputDigest: string }
export type WorkspaceDocumentChange = ChangeIdentity & (
    | { status: 'pending'; readId: string; baseRevision: string; operations: DocumentAiOperation[] }
    | { status: 'applied'; beforeRevisionId: string; afterRevision: string }
    | { status: 'discarded' | 'stale' | 'undone' }
);
export interface WorkspaceDocumentChangeRef { workspaceId: string; messageId: string; changeId: string; documentId: string }

// Stored receipts are untrusted until their version has been checked.
type StoredReceipt<T> = T extends unknown ? Omit<T, 'version'> & { version?: unknown } : never;

async function readManifest(scope: WorkspaceOperationScope, readId: string, threadId: string): Promise<WorkspaceDocumentRead> {
    const identity = readIdentity(readId);
    const message = await scope.db.messages.get(identity.messageId);
    scope.assertCurrent();
    if (!message || message.deleted || message.role !== 'assistant' || message.thread_id !== threadId) {
        throw new Error('The document read receipt is unavailable in this chat.');
    }
    const value = messageData(message)[identity.key] as StoredReceipt<WorkspaceDocumentRead> | undefined;
    if (!value || value.version !== 1 || typeof value.documentId !== 'string' || typeof value.revision !== 'string'
        || !Array.isArray(value.refs) || !value.refs.every((ref) => typeof ref === 'string')) {
        throw new Error('A host document read receipt is required. Read this document first.');
    }
    return value as WorkspaceDocumentRead;
}

/** Reconstruct only the matching source; no second complete snapshot is stored in chat. */
export async function prepareWorkspaceDocumentChange(
    scope: WorkspaceOperationScope, change: Extract<WorkspaceDocumentChange, { status: 'pending' }>, threadId: string,
) {
    const manifest = await readManifest(scope, change.readId, threadId);
    if (manifest.documentId !== change.documentId || manifest.revision !== change.baseRevision) {
        throw new Error('The proposal does not match its document read receipt.');
    }
    const loaded = await readWorkspaceItem(scope, { kind: 'document', id: change.documentId });
    if (loaded.source.revision !== change.baseRevision) throw new Error('This document changed. Update the proposal from a new read.');
    const [{ loadDocumentEditorSchema }, operationsModule, { validateDocumentContent }, { describeDocumentAiOperation }] = await Promise.all([
        import('~/utils/documents/document-editor-schema'), import('~/utils/documents/document-ai-operations'),
        import('~/utils/documents/validate-document-content'), import('~/utils/documents/document-ai-hunks'),
    ]);
    const schema = await loadDocumentEditorSchema();
    scope.assertCurrent();
    const snapshot = operationsModule.freezeDocumentContentForAi(JSON.parse((loaded.row as Post).content) as TipTapDocument);
    const exposed = new Set(manifest.refs);
    for (const operation of change.operations) {
        if (operation.kind === 'replace_selection') throw new Error('Use the document editor to edit a selected range.');
        if (operation.kind === 'insert_end') {
            if (!manifest.reachedEnd) throw new Error('Read the document end before adding content there.');
        } else if (!exposed.has(operation.ref)) throw new Error('Only block references exposed in this read can be changed.');
    }
    const candidate = await validateDocumentContent(schema, operationsModule.buildDocumentAiCandidate({ schema }, snapshot, change.operations), scope.db);
    scope.assertCurrent();
    if (JSON.stringify(await scope.db.posts.get(change.documentId)) !== JSON.stringify(loaded.row)) {
        throw new Error('This document changed. Update the proposal from a new read.');
    }
    scope.assertCurrent();
    return { base: loaded.row as Post, source: loaded.source, content: candidate, schema,
        changes: change.operations.map((operation) => describeDocumentAiOperation(operation, snapshot)) };
}

function changeReceipt(context: ToolExecutionContext, scope: WorkspaceOperationScope, changeId: string,
    change: WorkspaceDocumentChange, source: WorkspaceSource) {
    return { version: 1, workspaceId: scope.workspaceId, messageId: context.messageId, changeId,
        documentId: change.documentId, source, status: change.status === 'pending' ? 'pending_review' : change.status,
        saved: change.status === 'applied' };
}

export async function proposeWorkspaceDocumentEdit(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
    const scope = captureWorkspaceOperation(context);
    scope.assertCurrent('write');
    if (!context.messageId || !context.threadId) throw new Error('This message is unavailable for a reviewable change.');
    const changeId = await workspaceRevision({ requestId: context.requestId, callId: context.callId });
    const inputDigest = await workspaceRevision(args);
    scope.assertCurrent('write');
    const message = await scope.db.messages.get(context.messageId);
    if (!message || message.deleted || message.role !== 'assistant' || message.thread_id !== context.threadId) {
        throw new Error('The originating message is unavailable.');
    }
    const key = WORKSPACE_CHANGE_KEY + changeId;
    const stored = messageData(message)[key] as StoredReceipt<WorkspaceDocumentChange> | undefined;
    const previous = stored as WorkspaceDocumentChange | undefined;
    if (previous) {
        if (stored?.version !== 1 || previous.inputDigest !== inputDigest || previous.documentId !== args.documentId) {
            throw new Error('This execution already staged a different change.');
        }
        const loaded = await readWorkspaceItem(scope, { kind: 'document', id: previous.documentId });
        if (previous.status === 'pending') await prepareWorkspaceDocumentChange(scope, previous, context.threadId);
        return JSON.stringify(changeReceipt(context, scope, changeId, previous, loaded.source));
    }
    const { parseDocumentAiOperations } = await import('~/utils/documents/document-ai-operations');
    const change: Extract<WorkspaceDocumentChange, { status: 'pending' }> = { version: 1, inputDigest,
        status: 'pending', documentId: String(args.documentId), readId: String(args.readId),
        baseRevision: (await readManifest(scope, String(args.readId), context.threadId)).revision,
        operations: parseDocumentAiOperations(args) };
    const prepared = await prepareWorkspaceDocumentChange(scope, change, context.threadId);
    await persistWorkspaceReceipt(scope, context, key, change);
    scope.assertCurrent('write');
    if (JSON.stringify(await scope.db.posts.get(change.documentId)) !== JSON.stringify(prepared.base)) {
        throw new Error('This document changed. Update the proposal from a new read.');
    }
    scope.assertCurrent('write');
    return JSON.stringify(changeReceipt(context, scope, changeId, change, prepared.source));
}

function changeValue(message: Message, ref: WorkspaceDocumentChangeRef): WorkspaceDocumentChange {
    const value = messageData(message)[WORKSPACE_CHANGE_KEY + ref.changeId] as StoredReceipt<WorkspaceDocumentChange> | undefined;
    if (message.deleted || message.role !== 'assistant' || !value || value.version !== 1 || value.documentId !== ref.documentId
        || typeof value.inputDigest !== 'string' || !['pending', 'applied', 'discarded', 'stale', 'undone'].includes(value.status)) {
        throw new Error('This document change is unavailable.');
    }
    return value as WorkspaceDocumentChange;
}

export async function loadWorkspaceDocumentChange(ref: WorkspaceDocumentChangeRef) {
    if (!/^[a-f0-9]{64}$/u.test(ref.changeId)) throw new Error('Invalid document change receipt.');
    const scope = captureWorkspaceOperation({ subject: null, workspaceId: ref.workspaceId,
        threadId: 'document-review', messageId: ref.messageId, callId: ref.changeId, requestId: ref.changeId,
        abortSignal: new AbortController().signal });
    const message = await scope.db.messages.get(ref.messageId);
    scope.assertCurrent();
    if (!message) throw new Error('The originating message is unavailable.');
    return { scope, message, change: changeValue(message, ref) };
}

function receiptRow(message: Message, key: string, change: WorkspaceDocumentChange): Message {
    const row = MessageSchema.parse({ ...message, data: { ...messageData(message), [key]: change },
        clock: nextClock(message.clock), updated_at: nowSec() });
    // The actual provider row ceiling applies to the entire message; never silently compact this action.
    const wire = sanitizePayloadForSync('messages', row, 'put');
    if (JSON.stringify((wire?.data as Record<string, unknown> | undefined)?.[key]) !== JSON.stringify(change)) {
        throw new Error('This proposal cannot be preserved by the current storage format. Use a smaller edit.');
    }
    return row;
}

async function persistDocumentAction(
    ref: WorkspaceDocumentChangeRef, mode: 'apply' | 'undo',
): Promise<WorkspaceDocumentChange> {
    const { scope, message, change } = await loadWorkspaceDocumentChange(ref);
    scope.assertCurrent('write');
    if (mode === 'apply' && change.status === 'applied' || mode === 'undo' && change.status === 'undone') return change;
    const key = WORKSPACE_CHANGE_KEY + ref.changeId;
    let base: Post;
    let content: TipTapDocument;
    let title: string;
    if (mode === 'apply') {
        if (change.status !== 'pending') throw new Error('This proposal is no longer pending.');
        const prepared = await prepareWorkspaceDocumentChange(scope, change, message.thread_id);
        base = prepared.base; content = prepared.content; title = base.title;
    } else {
        if (change.status !== 'applied') throw new Error('This change cannot be undone.');
        const current = await readWorkspaceItem(scope, { kind: 'document', id: ref.documentId });
        if (current.source.revision !== change.afterRevision) throw new Error('This document has later changes. View history to recover earlier content.');
        const before = (await listCompleteDocumentRevisions(ref.documentId, scope.db))
            .find((revision) => revision.manifest.revisionId === change.beforeRevisionId);
        scope.assertCurrent('write');
        if (!before) throw new Error('This checkpoint is unavailable. View history.');
        base = current.row as Post; content = before.snapshot.content; title = before.snapshot.title;
    }
    const prepared = await prepareDocumentUpdate(base, { title, content });
    if (prepared.row.id !== base.id) throw new Error('A document hook changed the operation identity.');
    const [{ loadDocumentEditorSchema }, { validateDocumentContent }] = await Promise.all([
        import('~/utils/documents/document-editor-schema'), import('~/utils/documents/validate-document-content'),
    ]);
    const schema = await loadDocumentEditorSchema();
    const normalized = await validateDocumentContent(schema, JSON.parse(prepared.row.content), scope.db);
    prepared.row.content = JSON.stringify(normalized);
    prepared.row.file_hashes = serializeDocumentFileHashes(normalized);
    prepared.row.clock = nextClock(base.clock);
    const checkpoint = await prepareDocumentRevision({ documentId: base.id, title: base.title,
        content: JSON.parse(base.content) as TipTapDocument, source: mode === 'apply' ? 'ai' : 'restore' });
    const next: WorkspaceDocumentChange = mode === 'apply'
        ? { version: 1, inputDigest: change.inputDigest, documentId: base.id, status: 'applied',
            beforeRevisionId: checkpoint.manifest.revisionId, afterRevision: await workspaceRevision(prepared.row) }
        : { version: 1, inputDigest: change.inputDigest, documentId: base.id, status: 'undone' };
    scope.assertCurrent('write');
    const lease = leaseWorkspaceDocumentEditors(base.id, scope.db, { title: base.title, content: JSON.parse(base.content) as TipTapDocument });
    let committed = false;
    try {
        const result = await scope.db.transaction('rw', getWriteTxTableNames(scope.db, ['posts', 'messages'], { include: ['file_meta'] }), async () => {
            scope.assertCurrent('write');
            const currentMessage = await scope.db.messages.get(ref.messageId);
            if (!currentMessage || currentMessage.thread_id !== message.thread_id) throw new Error('The originating message is unavailable.');
            const currentChange = changeValue(currentMessage, ref);
            if (mode === 'apply' && currentChange.status === 'applied' || mode === 'undo' && currentChange.status === 'undone') return currentChange;
            if (JSON.stringify(currentChange) !== JSON.stringify(change)
                || JSON.stringify(await scope.db.posts.get(base.id)) !== JSON.stringify(base)) {
                throw new Error('This document changed. Update the proposal or view history.');
            }
            for (const hash of JSON.parse(prepared.row.file_hashes || '[]') as string[]) {
                const file = await scope.db.file_meta.get(hash);
                if (!file || file.deleted) throw new Error('A referenced workspace image is unavailable.');
            }
            scope.assertCurrent('write');
            const action = receiptRow(currentMessage, key, next);
            await scope.db.posts.bulkPut(checkpoint.rows);
            scope.assertCurrent('write');
            await scope.db.posts.put(prepared.row);
            await scope.db.messages.put(action);
            scope.assertCurrent('write');
            return next;
        });
        committed = result === next;
        if (committed) {
            // Accept synchronously before notification hooks can navigate or initiate another read.
            lease.accept(prepared.row);
            try { await prepared.afterCommit(); } catch (error) { console.warn('Document change saved; notification failed.', error); }
        }
        return result;
    } finally { lease.release(); }
}

export async function applyWorkspaceDocumentChange(ref: WorkspaceDocumentChangeRef): Promise<WorkspaceDocumentChange> {
    return persistDocumentAction(ref, 'apply');
}
export async function undoWorkspaceDocumentChange(ref: WorkspaceDocumentChangeRef): Promise<WorkspaceDocumentChange> {
    return persistDocumentAction(ref, 'undo');
}

export async function discardWorkspaceDocumentChange(ref: WorkspaceDocumentChangeRef): Promise<WorkspaceDocumentChange> {
    const { scope, message } = await loadWorkspaceDocumentChange(ref);
    scope.assertCurrent('write');
    return scope.db.transaction('rw', getWriteTxTableNames(scope.db, 'messages'), async () => {
        const current = await scope.db.messages.get(message.id);
        scope.assertCurrent('write');
        if (!current || current.thread_id !== message.thread_id) throw new Error('The originating message is unavailable.');
        const change = changeValue(current, ref);
        if (change.status !== 'pending') return change;
        const discarded: WorkspaceDocumentChange = { version: 1, inputDigest: change.inputDigest,
            documentId: change.documentId, status: 'discarded' };
        await scope.db.messages.put(receiptRow(current, WORKSPACE_CHANGE_KEY + ref.changeId, discarded));
        return discarded;
    });
}
