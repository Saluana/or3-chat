import type { Message, Post, Project, Thread } from '~/db/schema';
import { resolveThreadProjection } from './compaction/history';
import { normalizeMessageContent, tiptapToPlainText } from '~/core/search/command-palette/normalize';
import { settleWorkspaceDocumentEditors } from '~/composables/documents/useDocumentEditorSessions';
import type { WorkspaceOperationScope } from './workspace-access';
import type { ToolExecutionContext } from './types';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { parseFileHashes } from '~/db/files-util';

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
    if (item.kind === 'file') {
        const post = await scope.db.posts.get(item.id);
        scope.assertCurrent();
        if (!post || post.postType !== FILE_CATALOG_POST_TYPE || !isVisibleWorkspaceItem(post)) throw new Error('That saved file is unavailable.');
        const hashes = parseFileHashes(post.file_hashes);
        const meta = hashes.length === 1 ? await scope.db.file_meta.get(hashes[0]!) : undefined;
        scope.assertCurrent();
        if (!meta || meta.deleted) throw new Error('That saved file is unavailable.');
        const revision = await workspaceRevision(post);
        scope.assertCurrent();
        if (JSON.stringify(await scope.db.posts.get(item.id)) !== JSON.stringify(post)) throw new Error('This source changed. Read it again.');
        const currentMeta = await scope.db.file_meta.get(meta.hash);
        if (!currentMeta || currentMeta.deleted) throw new Error('That saved file is unavailable.');
        scope.assertCurrent();
        return { source: { ...item, title: post.title, revision }, content: post.content, row: post };
    }
    if (item.kind === 'document') {
        // Refuse disagreement through the existing session owner; no arbitrary editor selection.
        await settleWorkspaceDocumentEditors(item.id, scope.db);
        scope.assertCurrent();
        const post = await scope.db.posts.get(item.id);
        if (!post || !isVisibleWorkspaceItem(post) || post.postType !== 'doc') throw new Error('That document is unavailable.');
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
        const { readVisibleWorkspaceProjectEntries } = await import('./workspace-projects');
        const entries = await readVisibleWorkspaceProjectEntries(scope, project);
        scope.assertCurrent();
        return { source: { ...item, title: project.name, revision },
            content: JSON.stringify({ description: project.description ?? '', entries }), row: project };
    }
    // Retain the rejection boundary for untyped callers with an unknown kind.
    if ((item as { kind?: string }).kind === 'chat') {
        const thread = await scope.db.threads.get(item.id);
        if (!thread || thread.deleted) throw new Error('That chat is unavailable.');
        const projection = await resolveThreadProjection(item.id, scope.db);
        scope.assertCurrent();
        const rows = projection.messages.filter(row => row.role === 'user' || row.role === 'assistant');
        const content = rows.map((row) => `[${row.id} ${row.role}] ${normalizeMessageContent(row)}`).join('\n');
        const revision = await workspaceRevision({ thread, rows });
        const current = await resolveThreadProjection(item.id, scope.db);
        if (JSON.stringify(current) !== JSON.stringify(projection)) throw new Error('This source changed. Read it again.');
        scope.assertCurrent();
        return { source: { ...item, title: thread.title?.trim() || 'Untitled chat', revision }, content, row: thread, messages: rows };
    }
    throw new Error('Saved-file reading is unavailable until the Files catalog is enabled.');
}

/** Continuations are bound to identity and revision; they cannot change scope. */
export async function workspaceRead(scope: WorkspaceOperationScope, item: WorkspaceItemRef, continuation?: string, context?: ToolExecutionContext) {
    const loaded = await readWorkspaceItem(scope, item);
    if (item.kind === 'file') {
        const { readWorkspaceFilePage } = await import('./workspace-file-read');
        return readWorkspaceFilePage(scope, loaded.row as Post, loaded.source, continuation, context);
    }
    if (item.kind === 'document') {
        const { readWorkspaceDocumentPage } = await import('./workspace-document-read');
        return readWorkspaceDocumentPage(scope, { row: loaded.row as Post, source: loaded.source }, continuation, context);
    }
    // A write revision belongs to the project row; read pagination also includes
    // visible child membership, which can change without that row being updated.
    const readRevision = await workspaceRevision({ revision: loaded.source.revision, content: loaded.content });
    scope.assertCurrent();
    let offset = 0;
    if (continuation) {
        let cursor: { id?: unknown; kind?: unknown; revision?: unknown; offset?: unknown };
        try {
            const parsed: unknown = JSON.parse(continuation);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            cursor = parsed as typeof cursor;
        } catch { throw new Error('Invalid read continuation.'); }
        if (cursor.id !== item.id || cursor.kind !== item.kind || cursor.revision !== readRevision
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
            ? JSON.stringify({ ...item, revision: readRevision, offset: next }) : null,
        referenceOnly: true,
    };
}
