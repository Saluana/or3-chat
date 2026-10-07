import { PostSchema, type Post } from './schema';
import { createOrRefFile, changeRefCount, changeFileRefRows, notifyFileRefChanges, type FileRefNotification, getFileBlob } from './files';
import { parseFileHashes } from './files-util';
import { getWriteTxTableNames, nextClock, nowSec } from './util';
import { useHooks } from '~/core/hooks/useHooks';
import { classifyFileKind } from '~~/shared/files/file-kind';
import { isValidHash } from '~/utils/hash';
import type { TipTapDocument } from '~/types/database';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { workspaceRevision } from '~/utils/chat/workspace-items';
import {
    FILE_CATALOG_POST_TYPE, mergeWorkspaceItemMetadata, workspaceItemMetadata,
    type WorkspaceItemMetadata,
} from '~~/shared/posts/workspace-item';

const TEXT_BYTES = 64 * 1024;
type ExtractedText = { text: string; coverage: 'full' | 'prefix' | 'none'; indexed_bytes: number };

/** Decode a bounded prefix; stream mode retains an incomplete final code point. */
export async function extractWorkspaceFileText(blob: Blob, name: string): Promise<ExtractedText> {
    const unavailable: ExtractedText = { text: '', coverage: 'none', indexed_bytes: 0 };
    if (!/\.(txt|md|csv)$/iu.test(name)) return unavailable;
    try {
        const slice = blob.slice(0, TEXT_BYTES);
        const buffer = typeof slice.arrayBuffer === 'function' ? await slice.arrayBuffer()
            : await new Promise<ArrayBuffer>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.readAsArrayBuffer(slice);
            });
        const prefix = blob.size > TEXT_BYTES;
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer, { stream: prefix });
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) return unavailable;
        return { text, coverage: prefix ? 'prefix' : 'full', indexed_bytes: new TextEncoder().encode(text).byteLength };
    } catch { return unavailable; }
}

export function workspaceFileId(hash: string): string {
    if (!isValidHash(hash)) throw new Error('Invalid file hash.');
    // Preserve the exact storage key and existing catalog IDs, including bare MD5.
    return `workspace-file-${hash.replace(':', '-')}`;
}

async function notify(post: Post): Promise<void> {
    try {
        await useHooks().doAction('db.posts.upsert:action:after', {
            entity: post, tableName: 'posts',
        });
    } catch (error) { console.warn('[files] Catalog committed; notification failed', error); }
}

/** Atomically establish ownership without renaming an existing catalog entry. */
export async function catalogWorkspaceFile(scope: WorkspaceOperationScope, hash: string,
    options: { text?: ExtractedText; restore?: boolean; expected?: Post } = {}) {
    scope.assertCurrent('write');
    const id = workspaceFileId(hash);
    const referenceChanges: FileRefNotification[] = [];
    const result = await scope.db.transaction('rw', getWriteTxTableNames(scope.db, ['posts', 'file_meta']), async () => {
        const meta = await scope.db.file_meta.get(hash);
        scope.assertCurrent('write');
        if (!meta || meta.deleted) throw new Error('This file is unavailable.');
        const existing = await scope.db.posts.get(id);
        scope.assertCurrent('write');
        if (options.expected && JSON.stringify(existing) !== JSON.stringify(options.expected)) throw new Error('This item changed. Read it again.');
        if (existing && (existing.postType !== FILE_CATALOG_POST_TYPE || parseFileHashes(existing.file_hashes).join() !== hash)) {
            throw new Error('File catalog identity conflict.');
        }
        const state = workspaceItemMetadata(existing?.meta);
        // Validate an existing namespace before any idempotent success return.
        mergeWorkspaceItemMetadata(existing?.meta, state ?? { version: 1, trashed_at: null });
        const restored = !!existing && (existing.deleted || state?.trashed_at != null) && options.restore === true;
        if (existing && !restored && !options.text) return { post: existing, duplicate: true, restored: false };
        // Explicit legacy import does not restore Trash or permanent tombstones.
        if (existing?.deleted && !options.restore) return { post: existing, duplicate: true, restored: false };
        const text = options.text ?? { text: existing?.content ?? '', coverage: state?.text?.coverage ?? 'none', indexed_bytes: state?.text?.indexed_bytes ?? 0 };
        const post = PostSchema.parse({ ...(existing ?? {}), id, title: existing?.title ?? meta.name,
            postType: FILE_CATALOG_POST_TYPE, content: text.text, file_hashes: JSON.stringify([hash]),
            meta: mergeWorkspaceItemMetadata(existing?.meta, { version: 1,
                trashed_at: restored ? null : state?.trashed_at ?? null,
                text: { coverage: text.coverage, indexed_bytes: text.indexed_bytes } }),
            created_at: existing?.created_at ?? nowSec(), updated_at: nowSec(), deleted: false, clock: nextClock(existing?.clock) });
        if (!existing || existing.deleted) {
            const changed = await changeFileRefRows(hash, 1, scope.db);
            if (changed) referenceChanges.push(changed.notification);
        }
        scope.assertCurrent('write');
        await scope.db.posts.put(post);
        scope.assertCurrent('write');
        return { post, duplicate: !!existing, restored };
    });
    await notifyFileRefChanges(referenceChanges);
    await notify(result.post);
    scope.assertCurrent();
    return result;
}

export async function importWorkspaceFile(scope: WorkspaceOperationScope, blob: Blob, name: string) {
    scope.assertCurrent('write');
    if (!name.trim()) throw new Error('Enter a filename.');
    const filtered = await useHooks().applyFilters('files.attach:filter:input', {
        file: blob as File, name, mime: blob.type, size: blob.size, kind: classifyFileKind(blob.type),
    });
    scope.assertCurrent('write');
    if (filtered === false) throw new Error('File upload was rejected by policy.');
    blob = filtered.file; name = filtered.name;
    if (!name.trim()) throw new Error('Enter a filename.');
    const text = await extractWorkspaceFileText(blob, name);
    scope.assertCurrent('write');
    const meta = await createOrRefFile(blob, name, { assertCurrent: () => scope.assertCurrent('write') });
    // createOrRefFile holds an intake reference. Transfer it to catalog ownership
    // without removing immutable bytes, including on failed/cancelled intake.
    try {
        scope.assertCurrent('write');
        const existing = await scope.db.posts.get(workspaceFileId(meta.hash));
        scope.assertCurrent('write');
        return await catalogWorkspaceFile(scope, meta.hash, { restore: true, ...(!existing ? { text } : {}) });
    } finally { await changeRefCount(meta.hash, -1, scope.db); }
}

export async function enableWorkspaceFileText(scope: WorkspaceOperationScope, id: string, revision: string): Promise<Post> {
    scope.assertCurrent('write');
    const post = await scope.db.posts.get(id);
    scope.assertCurrent('write');
    if (!post || post.deleted || post.postType !== FILE_CATALOG_POST_TYPE || workspaceItemMetadata(post.meta)?.trashed_at != null) throw new Error('This file is unavailable.');
    if (await workspaceRevision(post) !== revision) throw new Error('This item changed. Read it again.');
    scope.assertCurrent('write');
    const hashes = parseFileHashes(post.file_hashes);
    if (hashes.length !== 1) throw new Error('Invalid file catalog reference.');
    const meta = await scope.db.file_meta.get(hashes[0]!);
    scope.assertCurrent('write');
    if (!meta || meta.deleted) throw new Error('This file is unavailable.');
    const blob = await getFileBlob(meta.hash, scope.db);
    scope.assertCurrent('write');
    if (!blob) throw new Error('Original file unavailable offline. Connect and retry.');
    const text = await extractWorkspaceFileText(blob, meta.name);
    scope.assertCurrent('write');
    return (await catalogWorkspaceFile(scope, meta.hash, { text, expected: post })).post;
}

export async function updateWorkspaceFile(scope: WorkspaceOperationScope, id: string, revision: string,
    changes: { title?: string; trashed?: boolean }): Promise<Post> {
    scope.assertCurrent('write');
    if (changes.trashed === true || changes.title !== undefined) {
        const { settleWorkspaceDocumentEditors } = await import('~/composables/documents/useDocumentEditorSessions');
        const candidate = await scope.db.posts.get(id);
        scope.assertCurrent('write');
        if (candidate?.postType === 'doc') await settleWorkspaceDocumentEditors(id, scope.db);
        scope.assertCurrent('write');
    }
    const base = await scope.db.posts.get(id);
    scope.assertCurrent('write');
    if (!base || base.deleted || ![FILE_CATALOG_POST_TYPE, 'doc'].includes(base.postType)) throw new Error('This item is unavailable.');
    if (await workspaceRevision(base) !== revision) throw new Error('This item changed. Read it again.');
    scope.assertCurrent('write');
    if (changes.title !== undefined && (!changes.title.trim() || changes.title.length > 500)) throw new Error('Enter a title of at most 500 characters.');
    const documentUpdate = base.postType === 'doc' && changes.title !== undefined
        ? await (await import('./documents')).prepareDocumentUpdate(base, { title: changes.title.trim() }) : null;
    scope.assertCurrent('write');
    if (documentUpdate && (documentUpdate.row.id !== id || documentUpdate.row.postType !== 'doc' || documentUpdate.row.deleted)) {
        throw new Error('A document hook changed the operation target.');
    }
    const state: WorkspaceItemMetadata = workspaceItemMetadata(base.meta) ?? { version: 1, trashed_at: null };
    const post = PostSchema.parse({ ...(documentUpdate?.row ?? base), title: documentUpdate?.row.title ?? changes.title?.trim() ?? base.title,
        meta: mergeWorkspaceItemMetadata(base.meta, { ...state,
            trashed_at: changes.trashed === undefined ? state.trashed_at : changes.trashed ? nowSec() : null }),
        updated_at: documentUpdate?.row.updated_at ?? nowSec(), clock: documentUpdate?.row.clock ?? nextClock(base.clock) });
    const editorSessions = documentUpdate ? await import('~/composables/documents/useDocumentEditorSessions') : null;
    scope.assertCurrent('write');
    const lease = editorSessions?.leaseWorkspaceDocumentEditors(id, scope.db, {
        title: base.title, content: JSON.parse(base.content) as TipTapDocument,
    });
    try {
        await scope.db.transaction('rw', getWriteTxTableNames(scope.db, 'posts'), async () => {
            const current = await scope.db.posts.get(id);
            scope.assertCurrent('write');
            if (JSON.stringify(current) !== JSON.stringify(base)) throw new Error('This item changed. Read it again.');
            await scope.db.posts.put(post);
            scope.assertCurrent('write');
        });
        // Update mounted buffers before notification hooks can trigger another save.
        lease?.accept(post);
        if (documentUpdate) {
            try { await documentUpdate.afterCommit(); }
            catch (error) { console.warn('[files] Document renamed; notification failed', error); }
        }
        await notify(post);
        scope.assertCurrent();
        return post;
    } finally { lease?.release(); }
}

/** Remove item ownership, never original bytes or retained history. */
export async function removeWorkspaceFile(scope: WorkspaceOperationScope, id: string, revision: string): Promise<void> {
    scope.assertCurrent('write');
    const base = await scope.db.posts.get(id);
    scope.assertCurrent('write');
    if (!base || base.deleted || ![FILE_CATALOG_POST_TYPE, 'doc'].includes(base.postType)) throw new Error('This item is unavailable.');
    if (workspaceItemMetadata(base.meta)?.trashed_at == null) throw new Error('Move this entry to Trash before removing it.');
    if (await workspaceRevision(base) !== revision) throw new Error('This item changed. Read it again.');
    scope.assertCurrent('write');
    const hashes = parseFileHashes(base.file_hashes);
    if (base.postType === FILE_CATALOG_POST_TYPE && hashes.length !== 1) throw new Error('Invalid file catalog reference.');
    const removed = PostSchema.parse({ ...base, deleted: true, updated_at: nowSec(), clock: nextClock(base.clock) });
    const referenceChanges: FileRefNotification[] = [];
    await scope.db.transaction('rw', getWriteTxTableNames(scope.db, ['posts', 'file_meta']), async () => {
        const current = await scope.db.posts.get(id);
        scope.assertCurrent('write');
        if (JSON.stringify(current) !== JSON.stringify(base)) throw new Error('This item changed. Read it again.');
        await scope.db.posts.put(removed);
        for (const hash of new Set(hashes)) {
            const changed = await changeFileRefRows(hash, -1, scope.db);
            if (changed) referenceChanges.push(changed.notification);
            scope.assertCurrent('write');
        }
        scope.assertCurrent('write');
    });
    await notifyFileRefChanges(referenceChanges);
    await notify(removed);
    scope.assertCurrent();
}
