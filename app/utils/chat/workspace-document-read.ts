import type { JSONContent } from '@tiptap/core';
import type { Message, Post } from '~/db/schema';
import { patchMessageInDb } from '~/db/messages';
import { freezeDocumentContentForAi } from '~/utils/documents/document-ai-operations';
import { workspaceRevision, type WorkspaceSource } from './workspace-items';
import type { WorkspaceOperationScope } from './workspace-access';
import type { ToolExecutionContext } from './types';

const PAGE_BYTES = 12 * 1024;
export const WORKSPACE_READ_KEY = 'or3.workspace-read:';
export interface WorkspaceDocumentRead {
    version: 1; documentId: string; revision: string; refs: string[]; reachedEnd: boolean;
}
export function messageData(message: Message): Record<string, unknown> {
    return message.data && typeof message.data === 'object' && !Array.isArray(message.data)
        ? message.data as Record<string, unknown> : {};
}
export function readIdentity(readId: string): { messageId: string; key: string } {
    let parsed: unknown;
    try { parsed = JSON.parse(readId); } catch { throw new Error('Invalid document read receipt.'); }
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string'
        || !parsed[0] || typeof parsed[1] !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed[1])) {
        throw new Error('Invalid document read receipt.');
    }
    return { messageId: parsed[0], key: WORKSPACE_READ_KEY + parsed[1] };
}

/** Persist one owned key through the existing fresh-row merger, preserving generation writes. */
export async function persistWorkspaceReceipt(
    scope: WorkspaceOperationScope, context: ToolExecutionContext, key: string, value: unknown,
): Promise<void> {
    scope.assertCurrent('write');
    if (!context.messageId) throw new Error('This chat message is unavailable for a reviewable change.');
    let notificationError: unknown;
    try {
        await patchMessageInDb(scope.db, context.messageId, { data: { [key]: value } }, undefined, (message) => {
            scope.assertCurrent('write');
            return Boolean(message && !message.deleted && message.role === 'assistant' && message.thread_id === context.threadId
                && (!(key in messageData(message)) || JSON.stringify(messageData(message)[key]) === JSON.stringify(value)));
        }, { tables: ['projects', 'threads', 'posts', 'file_meta'], assertCurrent: async () => {
            scope.assertCurrent('write');
            await context.assertToolAuthorized?.();
            scope.assertCurrent('write');
        } });
    } catch (error) { notificationError = error; }
    scope.assertCurrent('write');
    const message = await scope.db.messages.get(context.messageId);
    if (!message || message.deleted || message.role !== 'assistant' || message.thread_id !== context.threadId
        || JSON.stringify(messageData(message)[key]) !== JSON.stringify(value)) {
        throw notificationError ?? new Error('The originating message changed. Try again.');
    }
    // A notification failure after a committed write is not an unsaved receipt.
    if (notificationError) console.warn('Workspace receipt saved; notification failed.', notificationError);
}

function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function textPage(text: string, offset: number, budget: number): string {
    let result = ''; let bytes = 0;
    for (const char of text.slice(offset)) {
        const size = new TextEncoder().encode(JSON.stringify(char).slice(1, -1)).byteLength;
        if (bytes + size > budget) break;
        result += char; bytes += size;
    }
    return result;
}

/** Page actual native blocks; a partial block never receives a writable reference. */
export async function readWorkspaceDocumentPage(
    scope: WorkspaceOperationScope, loaded: { row: Post; source: WorkspaceSource },
    continuation?: string, context?: ToolExecutionContext,
) {
    const snapshot = freezeDocumentContentForAi(JSON.parse(loaded.row.content) as JSONContent);
    let index = 0; let offset = 0;
    if (continuation) {
        let value: unknown;
        try { value = JSON.parse(continuation); } catch { throw new Error('Invalid read continuation.'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid read continuation.');
        const cursor = value as Record<string, unknown>;
        if (cursor.id !== loaded.row.id || cursor.kind !== 'document' || cursor.revision !== loaded.source.revision
            || !Number.isSafeInteger(cursor.block) || Number(cursor.block) < 0 || Number(cursor.block) >= snapshot.blocks.length
            || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0
            || Number(cursor.offset) > snapshot.blocks[Number(cursor.block)]!.text.length) {
            throw new Error('This source changed. Read it again from the beginning.');
        }
        index = Number(cursor.block); offset = Number(cursor.offset);
    }
    const blocks: Array<{ ref: string | null; type: string; text: string; node?: JSONContent; partial?: boolean }> = [];
    const refs: string[] = [];
    const startBlock = index;
    let selectionEditRequired = false;
    while (index < snapshot.blocks.length) {
        const block = snapshot.blocks[index]!;
        const complete = { ref: block.ref, type: block.type, text: block.text, node: block.node };
        if (offset === 0 && byteLength({ blocks: [...blocks, complete], content: [...blocks.map((entry) => entry.text), block.text].join('\n\n') }) <= PAGE_BYTES) {
            blocks.push(complete); refs.push(block.ref); index += 1;
            continue;
        }
        if (blocks.length) break;
        // Large structural blocks are readable as text pages, never replaceable unseen content.
        const text = textPage(block.text, offset, Math.floor(PAGE_BYTES / 2) - 512);
        blocks.push({ ref: null, type: block.type, text, partial: true });
        selectionEditRequired = true;
        offset += text.length;
        if (offset >= block.text.length) { index += 1; offset = 0; }
        break;
    }
    const reachedEnd = index >= snapshot.blocks.length;
    let readId: string | null = null;
    if (context?.messageId && scope.writable) {
        const execution = await workspaceRevision({ requestId: context.requestId, callId: context.callId,
            documentId: loaded.row.id, revision: loaded.source.revision, continuation: continuation ?? null });
        readId = JSON.stringify([context.messageId, execution]);
        const manifest: WorkspaceDocumentRead = { version: 1, documentId: loaded.row.id,
            revision: loaded.source.revision, refs, reachedEnd };
        await persistWorkspaceReceipt(scope, context, WORKSPACE_READ_KEY + execution, manifest);
    }
    scope.assertCurrent();
    if (JSON.stringify(await scope.db.posts.get(loaded.row.id)) !== JSON.stringify(loaded.row)) {
        throw new Error('This source changed. Read it again.');
    }
    scope.assertCurrent();
    return { version: 1, workspaceId: scope.workspaceId, source: loaded.source, readId, blocks,
        content: blocks.map((block) => block.text).join('\n\n'), offset: startBlock,
        coverage: reachedEnd ? 'complete' : 'partial', referenceOnly: true,
        selectionEditRequired,
        continuation: reachedEnd ? null : JSON.stringify({ kind: 'document', id: loaded.row.id,
            revision: loaded.source.revision, block: index, offset }),
    };
}
