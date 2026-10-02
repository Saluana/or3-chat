import type { Message, Post, Project, Thread } from '~/db/schema';
import { projectWorkspaceConversation } from './workspace-conversation';
import { normalizeMessageContent, tiptapToPlainText } from '~/core/search/command-palette/normalize';
import { settleWorkspaceDocumentEditors } from '~/composables/documents/useDocumentEditorSessions';
import type { WorkspaceOperationScope } from './workspace-access';
import type { ToolExecutionContext } from './types';

export type WorkspaceItemKind = 'chat' | 'document' | 'project' | 'file';
export interface WorkspaceItemRef { kind: WorkspaceItemKind; id: string }
export interface WorkspaceSource extends WorkspaceItemRef { title: string; revision: string }
export const WORKSPACE_RECEIPT_VERSION = 1;
const READ_PAGE_BYTES = 12 * 1024;

/** Revision fingerprints detect content changes even when timestamps tie. */
export async function workspaceRevision(row: unknown): Promise<string> {
    let canonical = row;
    if (row && typeof row === 'object' && !Array.isArray(row) && 'postType' in row) {
        const { document_reference_key: _localIndex, ...fields } = row as Record<string, unknown>;
        canonical = fields;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(canonical));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readWorkspaceItem(scope: WorkspaceOperationScope, item: WorkspaceItemRef): Promise<{
    source: WorkspaceSource; content: string; row: Post | Project | Thread; messages?: Message[];
}> {
    scope.assertCurrent();
    if (item.kind === 'document') {
        // Refuse disagreement through the existing session owner; no arbitrary editor selection.
        await settleWorkspaceDocumentEditors(item.id, scope.db);
        scope.assertCurrent();
        const post = await scope.db.posts.get(item.id);
        if (!post || post.deleted || post.postType !== 'doc') throw new Error('That document is unavailable.');
        const revision = await workspaceRevision(post);
        scope.assertCurrent();
        if (JSON.stringify(await scope.db.posts.get(item.id)) !== JSON.stringify(post)) throw new Error('This source changed. Read it again.');
        scope.assertCurrent();
        return { source: { ...item, title: post.title, revision }, content: tiptapToPlainText(post.content), row: post };
    }
    if (item.kind === 'project') {
        const project = await scope.db.projects.get(item.id);
        if (!project || project.deleted) throw new Error('That project is unavailable.');
        const revision = await workspaceRevision(project);
        scope.assertCurrent();
        if (JSON.stringify(await scope.db.projects.get(item.id)) !== JSON.stringify(project)) throw new Error('This source changed. Read it again.');
        scope.assertCurrent();
        const { preservedProjectEntries, projectEntryIdentity } = await import('./workspace-projects');
        const entries = preservedProjectEntries(project.data).map(projectEntryIdentity)
            .filter((identity): identity is string => identity !== null)
            .map((identity) => ({ kind: identity.slice(0, identity.indexOf(':')), id: identity.slice(identity.indexOf(':') + 1) }));
        scope.assertCurrent();
        return { source: { ...item, title: project.name, revision },
            content: JSON.stringify({ description: project.description ?? '', entries }), row: project };
    }
    if (item.kind === 'chat') {
        const thread = await scope.db.threads.get(item.id);
        if (!thread || thread.deleted) throw new Error('That chat is unavailable.');
        const threads = new Map<string, Thread>();
        const messages = new Map<string, Message[]>();
        let current: Thread | undefined = thread;
        while (current) {
            if (threads.has(current.id)) throw new Error('Conversation lineage is incomplete.');
            threads.set(current.id, current);
            messages.set(current.id, await scope.db.messages.where('thread_id').equals(current.id).toArray());
            scope.assertCurrent();
            if (current.branch_mode !== 'reference' || !current.parent_thread_id) break;
            current = await scope.db.threads.get(current.parent_thread_id);
            scope.assertCurrent();
            if (!current || current.deleted) throw new Error('Conversation source is unavailable.');
        }
        const rows = projectWorkspaceConversation(item.id, threads, messages);
        const content = rows.map((row) => `[${row.id} ${row.role}] ${normalizeMessageContent(row)}`).join('\n');
        const revision = await workspaceRevision({ thread, rows });
        await scope.db.transaction('r', ['threads', 'messages'], async () => {
            for (const [id, ancestor] of threads) {
                if (JSON.stringify(await scope.db.threads.get(id)) !== JSON.stringify(ancestor)
                    || JSON.stringify(await scope.db.messages.where('thread_id').equals(id).toArray()) !== JSON.stringify(messages.get(id))) {
                    throw new Error('This source changed. Read it again.');
                }
            }
        });
        scope.assertCurrent();
        return { source: { ...item, title: thread.title?.trim() || 'Untitled chat', revision }, content, row: thread, messages: rows };
    }
    throw new Error('Saved-file reading is unavailable until the Files catalog is enabled.');
}

/** Continuations are bound to identity and revision; they cannot change scope. */
export async function workspaceRead(scope: WorkspaceOperationScope, item: WorkspaceItemRef, continuation?: string, context?: ToolExecutionContext) {
    const loaded = await readWorkspaceItem(scope, item);
    if (item.kind === 'document') {
        const { readWorkspaceDocumentPage } = await import('./workspace-document-read');
        return readWorkspaceDocumentPage(scope, { row: loaded.row as Post, source: loaded.source }, continuation, context);
    }
    let offset = 0;
    if (continuation) {
        let cursor: { id?: unknown; kind?: unknown; revision?: unknown; offset?: unknown };
        try {
            const parsed: unknown = JSON.parse(continuation);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            cursor = parsed as typeof cursor;
        } catch { throw new Error('Invalid read continuation.'); }
        if (cursor.id !== item.id || cursor.kind !== item.kind || cursor.revision !== loaded.source.revision
            || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0 || Number(cursor.offset) > loaded.content.length) {
            throw new Error('This source changed. Read it again from the beginning.');
        }
        offset = Number(cursor.offset);
    }
    // Bound encoded output without cutting a Unicode code point; continuation keeps every byte retrievable.
    let content = '';
    let bytes = 0;
    for (const character of loaded.content.slice(offset)) {
        const size = new TextEncoder().encode(JSON.stringify(character).slice(1, -1)).byteLength;
        if (bytes + size > READ_PAGE_BYTES) break;
        content += character; bytes += size;
    }
    const next = offset + content.length;
    scope.assertCurrent();
    return {
        version: WORKSPACE_RECEIPT_VERSION, workspaceId: scope.workspaceId,
        source: loaded.source, content, offset,
        coverage: next < loaded.content.length ? 'partial' : 'complete',
        continuation: next < loaded.content.length
            ? JSON.stringify({ ...item, revision: loaded.source.revision, offset: next }) : null,
        referenceOnly: true,
    };
}
