import type { Post } from '~/db/schema';
import type { WorkspaceOperationScope } from './workspace-access';
import { workspaceRevision, type WorkspaceSource } from './workspace-items';
import type { ToolExecutionContext } from './types';
import { workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import { parseFileHashes } from '~/db/files-util';
import { getFileBlob } from '~/db/files';
import { resolveChatProject } from '~/db/project-workspace';
import { PROJECT_POST_TYPES, ProjectSourceSchema, readPersistedProjectRecord } from '~~/shared/projects/workspace';

const PAGE_BYTES = 2048; // JSON escaping still fits the existing 16 KiB result bound.

export async function readWorkspaceFilePage(scope: WorkspaceOperationScope,
    post: Post, source: WorkspaceSource, continuation?: string, context?: ToolExecutionContext) {
    const hash = parseFileHashes(post.file_hashes)[0];
    const meta = hash ? await scope.db.file_meta.get(hash) : undefined;
    scope.assertCurrent();
    if (!meta || meta.deleted) throw new Error('That saved file is unavailable.');
    const owner = context?.threadId ? await resolveChatProject(scope.db, context.threadId) : null;
    scope.assertCurrent();
    let extractionRow: Post | undefined;
    let extractionHash: string | undefined;
    let bytes: Blob | Uint8Array = new TextEncoder().encode(post.content);
    let textCoverage = workspaceItemMetadata(post.meta)?.text?.coverage ?? 'none';
    let limitation: string | undefined;
    if (owner) {
        const rows = await scope.db.posts.where('[postType+title]').equals([PROJECT_POST_TYPES.source, owner]).toArray();
        for (const row of rows) {
            if (row.deleted) continue;
            const binding = readPersistedProjectRecord(ProjectSourceSchema, row.content);
            if (!binding || binding.kind !== 'file' || binding.item_id !== post.id || binding.mode === 'off') continue;
            const revision = binding.revisions.find(r => r.id === binding.current_revision_id)!;
            if (!revision.text_hash || !['ready', 'partial'].includes(revision.status)) continue;
            const extractedMeta = await scope.db.file_meta.get(revision.text_hash);
            if (!extractedMeta || extractedMeta.deleted) throw new Error('Extracted text is unavailable. Retry extraction.');
            const blob = await getFileBlob(revision.text_hash, scope.db);
            scope.assertCurrent();
            if (!blob) throw new Error('Extracted text unavailable offline. Connect and retry this page.');
            bytes = blob;
            textCoverage = revision.coverage;
            extractionRow = row;
            extractionHash = revision.text_hash;
            source = { ...source, revision: await workspaceRevision({ catalog: source.revision,
                binding: row.id, revision: revision.id, text_hash: revision.text_hash,
                status: revision.status, coverage: revision.coverage }) };
            break;
        }
    }
    if (!extractionRow && textCoverage === 'prefix') {
        // Only catalog text decoded from a plain-text original shares its byte
        // offsets. Extracted PDF/DOCX text never shares offsets with the upload.
        if (/\.(txt|md|csv)$/iu.test(meta.name)) {
            const blob = await getFileBlob(meta.hash, scope.db);
            scope.assertCurrent();
            if (!blob) throw new Error('Original file unavailable offline. Connect and retry this page.');
            if (blob.size !== meta.size_bytes) throw new Error('Original file size changed. Read it again.');
            bytes = blob;
            textCoverage = 'full';
        } else limitation = 'Only the indexed text prefix is available; the original upload is not text.';
    }
    if (textCoverage === 'prefix' && !limitation) limitation = 'Extraction is partial; these pages cover only the readable text.';
    const size = bytes instanceof Uint8Array ? bytes.byteLength : bytes.size;
    const assertFileCurrent = async () => {
        if (JSON.stringify(await scope.db.posts.get(post.id)) !== JSON.stringify(post)) throw new Error('This source changed. Read it again.');
        const currentMeta = await scope.db.file_meta.get(meta.hash);
        scope.assertCurrent();
        if (!currentMeta || currentMeta.deleted) throw new Error('That saved file is unavailable.');
        if (currentMeta.size_bytes !== meta.size_bytes || currentMeta.name !== meta.name) throw new Error('Original file changed. Read it again.');
        if (extractionRow && JSON.stringify(await scope.db.posts.get(extractionRow.id)) !== JSON.stringify(extractionRow))
            throw new Error('This extraction changed. Read it again.');
        if (extractionHash) {
            const extractedMeta = await scope.db.file_meta.get(extractionHash);
            if (!extractedMeta || extractedMeta.deleted) throw new Error('Extracted text is unavailable. Retry extraction.');
        }
        if (context?.threadId && await resolveChatProject(scope.db, context.threadId) !== owner)
            throw new Error('The chat’s owning project changed during the read.');
        scope.assertCurrent();
    };
    let offset = 0;
    if (continuation) {
        let value: unknown;
        try { value = JSON.parse(continuation); } catch { throw new Error('Invalid file continuation.'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid file continuation.');
        const cursor = value as Record<string, unknown>;
        if (cursor.id !== post.id || cursor.kind !== 'file' || cursor.revision !== source.revision
            || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0 || Number(cursor.offset) > size) {
            throw new Error('This source changed. Read it again from the beginning.');
        }
        offset = Number(cursor.offset);
    }
    if (textCoverage === 'none') {
        await assertFileCurrent();
        return { version: 1, workspaceId: scope.workspaceId, source, content: '', offset: 0,
            coverage: 'unavailable', textCoverage, limitation: 'Stored file; text search has not been enabled or this format is unsupported.',
            continuation: null, referenceOnly: true };
    }
    const end = Math.min(size, offset + PAGE_BYTES);
    const buffer = bytes instanceof Uint8Array ? bytes.slice(offset, end)
        : new Uint8Array(await bytes.slice(offset, end).arrayBuffer());
    scope.assertCurrent();
    let content: string;
    try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer, { stream: end < size });
    } catch { throw new Error('This page is not valid UTF-8. The original file remains downloadable.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)) throw new Error('This page contains binary content. Download the original file.');
    const next = offset + new TextEncoder().encode(content).byteLength;
    if (next === offset && offset < size) throw new Error('File text is unavailable at this position. Download the original file.');
    await assertFileCurrent();
    return { version: 1, workspaceId: scope.workspaceId, source, content, offset,
        coverage: next < size || textCoverage === 'prefix' ? 'partial' : 'complete', textCoverage, limitation,
        continuation: next < size ? JSON.stringify({ kind: 'file', id: post.id, revision: source.revision, offset: next }) : null,
        referenceOnly: true };
}
