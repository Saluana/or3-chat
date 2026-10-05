import type { Post } from '~/db/schema';
import type { WorkspaceOperationScope } from './workspace-access';
import type { WorkspaceSource } from './workspace-items';
import { workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import { parseFileHashes } from '~/db/files-util';

const PAGE_BYTES = 2048; // JSON escaping still fits the existing 16 KiB result bound.

export async function readWorkspaceFilePage(scope: WorkspaceOperationScope,
    post: Post, source: WorkspaceSource, continuation?: string) {
    const hash = parseFileHashes(post.file_hashes)[0];
    const meta = hash ? await scope.db.file_meta.get(hash) : undefined;
    scope.assertCurrent();
    if (!meta || meta.deleted) throw new Error('That saved file is unavailable.');
    const assertFileCurrent = async () => {
        if (JSON.stringify(await scope.db.posts.get(post.id)) !== JSON.stringify(post)) throw new Error('This source changed. Read it again.');
        const currentMeta = await scope.db.file_meta.get(meta.hash);
        scope.assertCurrent();
        if (!currentMeta || currentMeta.deleted) throw new Error('That saved file is unavailable.');
        if (currentMeta.size_bytes !== meta.size_bytes) throw new Error('Original file size changed. Read it again.');
    };
    const text = workspaceItemMetadata(post.meta)?.text;
    let offset = 0;
    if (continuation) {
        let value: unknown;
        try { value = JSON.parse(continuation); } catch { throw new Error('Invalid file continuation.'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid file continuation.');
        const cursor = value as Record<string, unknown>;
        if (cursor.id !== post.id || cursor.kind !== 'file' || cursor.revision !== source.revision
            || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0 || Number(cursor.offset) > meta.size_bytes) {
            throw new Error('This source changed. Read it again from the beginning.');
        }
        offset = Number(cursor.offset);
    }
    if (!text || text.coverage === 'none') {
        await assertFileCurrent();
        return { version: 1, workspaceId: scope.workspaceId, source, content: '', offset: 0,
            coverage: 'unavailable', textCoverage: 'none', limitation: 'Stored file; text search has not been enabled or this format is unsupported.',
            continuation: null, referenceOnly: true };
    }
    const indexed = new TextEncoder().encode(post.content);
    let buffer: Uint8Array;
    let end: number;
    if (offset < indexed.byteLength) {
        end = Math.min(indexed.byteLength, offset + PAGE_BYTES);
        buffer = indexed.slice(offset, end);
    } else {
        const { getFileBlob } = await import('~/db/files');
        const blob = await getFileBlob(meta.hash, scope.db);
        scope.assertCurrent();
        if (!blob) throw new Error('Original file unavailable offline. Connect and retry this page.');
        if (blob.size !== meta.size_bytes) throw new Error('Original file size changed. Read it again.');
        end = Math.min(blob.size, offset + PAGE_BYTES);
        buffer = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
        scope.assertCurrent();
    }
    let content: string;
    try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer, { stream: end < meta.size_bytes });
    } catch { throw new Error('This page is not valid UTF-8. The original file remains downloadable.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)) throw new Error('This page contains binary content. Download the original file.');
    const next = offset + new TextEncoder().encode(content).byteLength;
    if (next === offset && offset < meta.size_bytes) throw new Error('File text is unavailable at this position. Download the original file.');
    await assertFileCurrent();
    return { version: 1, workspaceId: scope.workspaceId, source, content, offset,
        coverage: next < meta.size_bytes ? 'partial' : 'complete', textCoverage: text.coverage,
        continuation: next < meta.size_bytes ? JSON.stringify({ kind: 'file', id: post.id, revision: source.revision, offset: next }) : null,
        referenceOnly: true };
}
