import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    evictWorkspaceDb,
    getDb,
    setActiveWorkspaceDb,
} from '../client';
import type { FileMeta, Message } from '../schema';
import {
    addFilesToMessage,
    removeFileFromMessage,
} from '../message-files';
import { createOrRefFile } from '../files';
import { parseFileHashes } from '../files-util';

const hooks = vi.hoisted(() => {
    const filters = new Map<
        string,
        Array<(value: unknown) => unknown | Promise<unknown>>
    >();
    return {
        addFilter(
            name: string,
            filter: (value: unknown) => unknown | Promise<unknown>
        ) {
            const registered = filters.get(name) ?? [];
            registered.push(filter);
            filters.set(name, registered);
        },
        clear() {
            filters.clear();
        },
        async applyFilters(name: string, initial: unknown) {
            let value = initial;
            for (const filter of filters.get(name) ?? []) {
                value = await filter(value);
            }
            return value;
        },
        doAction: vi.fn(async (_name: string) => {}),
    };
});

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hooks,
}));

const TEST_HASH = `sha256:${'a'.repeat(64)}`;

const computeFileHashMock = vi.hoisted(() => vi.fn());

vi.mock('~/utils/hash', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/utils/hash')>();
    return {
        ...actual,
        computeFileHash: computeFileHashMock,
    };
});

let workspaceId = '';

function message(id: string, fileHashes?: string[]): Message {
    return {
        id,
        thread_id: 'thread-1',
        role: 'user',
        index: 0,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
        file_hashes: fileHashes ? JSON.stringify(fileHashes) : undefined,
    };
}

function fileMeta(
    hash = TEST_HASH,
    refCount = 0
): FileMeta {
    return {
        hash,
        name: 'attachment.txt',
        mime_type: 'text/plain',
        kind: 'image',
        size_bytes: 4,
        ref_count: refCount,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
    };
}

async function storedHashes(messageId: string): Promise<string[]> {
    const stored = await getDb().messages.get(messageId);
    return parseFileHashes(stored?.file_hashes);
}

beforeEach(async () => {
    vi.stubGlobal('Blob', NativeBlob);
    hooks.clear();
    hooks.doAction.mockReset();
    hooks.doAction.mockImplementation(async () => {});
    computeFileHashMock.mockReset();
    computeFileHashMock.mockResolvedValue(TEST_HASH);
    workspaceId = `file-ref-count-${crypto.randomUUID()}`;
    const db = setActiveWorkspaceDb(workspaceId);
    await db.open();
});

afterEach(async () => {
    vi.unstubAllGlobals();
    const dbName = `or3-db-${workspaceId}`;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspaceId);
    await Dexie.delete(dbName);
});

describe('message file ref_count integrity', () => {
    // Failure inventory: timed hooks expire catalog/message/batch transactions;
    // failed notifications cannot undo committed ownership or invite a retry.
    it.each(['new-file', 'duplicate', 'attach', 'detach', 'catalog', 'remove', 'batch'] as const)('commits %s before asynchronous file notifications', async path => {
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        if (path !== 'new-file') await db.file_meta.put(fileMeta(TEST_HASH, path === 'detach' || path === 'remove' ? 1 : 0));
        await db.messages.put(message('notify-message', path === 'detach' ? [TEST_HASH] : []));
        const observed: boolean[] = [];
        hooks.doAction.mockImplementation(async name => {
            if (!name.startsWith('db.files.')) return;
            await new Promise(resolve => setTimeout(resolve, 10));
            observed.push(Boolean(Dexie.currentTransaction));
            if (name.endsWith(':after')) throw new Error('Notification failed');
        });
        const { catalogWorkspaceFile, removeWorkspaceFile } = await import('../workspace-files');
        const { commitPreparedPostBatch } = await import('../posts');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const { mergeWorkspaceItemMetadata } = await import('~~/shared/posts/workspace-item');
        if (path === 'new-file' || path === 'duplicate') await createOrRefFile(new Blob(['test'], { type: 'text/plain' }), 'test.txt');
        else if (path === 'attach') await addFilesToMessage('notify-message', [{ type: 'hash', hash: TEST_HASH }]);
        else if (path === 'detach') await removeFileFromMessage('notify-message', TEST_HASH);
        else if (path === 'catalog') await catalogWorkspaceFile(scope, TEST_HASH);
        else {
            const row = { id: 'notify-post', title: 'File', postType: 'doc', content: '',
                file_hashes: JSON.stringify([TEST_HASH]), deleted: false, clock: 1, created_at: 1, updated_at: 1,
                meta: mergeWorkspaceItemMetadata(undefined, { version: 1, trashed_at: 1 }) };
            if (path === 'remove') {
                await db.posts.put(row);
                await removeWorkspaceFile(scope, row.id, await workspaceRevision(row));
            } else await commitPreparedPostBatch({ db, assertCurrent: () => {}, expected: { id: row.id, content: null }, posts: [row], immutableIds: [] });
        }
        expect(observed.length).toBeGreaterThan(0);
        expect(observed.every(transaction => !transaction)).toBe(true);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(path === 'detach' || path === 'remove' ? 0 : 1);
        if (path === 'attach') expect(await storedHashes('notify-message')).toEqual([TEST_HASH]);
        if (path === 'detach') expect(await storedHashes('notify-message')).toEqual([]);
    });
    it.each([false, true])('restores supplied local bytes on duplicate intake (Trash: %s)', async trashed => {
        const { importWorkspaceFile, updateWorkspaceFile } = await import('../workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        const original = new Blob(['offline original'], { type: 'text/plain' });
        const first = await importWorkspaceFile(scope, original, 'notes.txt');
        if (trashed) await updateWorkspaceFile(scope, first.post.id, await workspaceRevision(first.post), { trashed: true });
        await db.file_blobs.delete(TEST_HASH);
        const duplicate = await importWorkspaceFile(scope, original, 'uploaded-again.txt');
        expect(duplicate.post.id).toBe(first.post.id);
        expect(duplicate.restored).toBe(trashed);
        expect(await (await db.file_blobs.get(TEST_HASH))?.blob.text()).toBe('offline original');
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
    });

    it('permanently removes a trashed native document while retaining its checkpoint references', async () => {
        const { updateWorkspaceFile, removeWorkspaceFile } = await import('../workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        await db.file_meta.put(fileMeta(TEST_HASH, 2));
        await db.file_blobs.put({ hash: TEST_HASH, blob: new Blob(['original']) });
        const row = { id: 'removed-document', title: 'Removed document', postType: 'doc', content: '{"type":"doc","content":[]}',
            file_hashes: JSON.stringify([TEST_HASH]), deleted: false, clock: 1, created_at: 1, updated_at: 1 };
        await db.posts.bulkPut([row, { ...row, id: 'retained-checkpoint', postType: 'or3:document-revision' }]);
        const trashed = await updateWorkspaceFile(scope, row.id, await workspaceRevision(row), { trashed: true });
        await removeWorkspaceFile(scope, row.id, await workspaceRevision(trashed));
        expect((await db.posts.get(row.id))?.deleted).toBe(true);
        expect((await db.posts.get('retained-checkpoint'))?.deleted).toBe(false);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
        expect(await db.file_blobs.get(TEST_HASH)).toBeDefined();
        const { hardDeleteMany } = await import('../files');
        await expect(hardDeleteMany([TEST_HASH])).rejects.toThrow(/referenced/);
    });

    it('refuses to expose or overwrite an unsupported catalog state', async () => {
        const { catalogWorkspaceFile, updateWorkspaceFile } = await import('../workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const { isVisibleWorkspaceItem } = await import('~~/shared/posts/workspace-item');
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        await db.file_meta.put(fileMeta());
        const saved = await catalogWorkspaceFile(scope, TEST_HASH);
        const unsupported = { ...saved.post, meta: JSON.stringify({ 'or3.workspace-item': { version: 2, trashed_at: 1 } }) };
        await db.posts.put(unsupported);
        expect(isVisibleWorkspaceItem(unsupported)).toBe(false);
        await expect(catalogWorkspaceFile(scope, TEST_HASH)).rejects.toThrow(/unsupported/i);
        await expect(updateWorkspaceFile(scope, unsupported.id, await workspaceRevision(unsupported), { trashed: false })).rejects.toThrow(/unsupported/i);
        expect(await db.posts.get(unsupported.id)).toEqual(unsupported);
    });

    it('reads the unindexed remainder in bounded continuation pages without changing the original bytes', async () => {
        const { importWorkspaceFile } = await import('../workspace-files');
        const { workspaceRead } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        const original = 'a'.repeat(65535) + '😀tail';
        const imported = await importWorkspaceFile(scope, new Blob([original], { type: 'text/plain' }), 'continuation.txt');
        let continuation: string | undefined;
        let content = '';
        for (let page = 0; page < 100; page++) {
            const result = await workspaceRead(scope, { kind: 'file', id: imported.post.id }, continuation);
            expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(16 * 1024);
            content += result.content;
            if (!result.continuation) break;
            continuation = result.continuation;
        }
        expect(content).toBe(original);
        expect(await (await db.file_blobs.get(TEST_HASH))!.blob.text()).toBe(original);
    });
    it('imports existing metadata without fetching bytes or restoring Trash and explicitly enables text search', async () => {
        const { catalogWorkspaceFile, updateWorkspaceFile, enableWorkspaceFileText } = await import('../workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        await db.file_meta.put({ ...fileMeta(), name: 'existing.txt', kind: 'file' });
        const original = await catalogWorkspaceFile(scope, TEST_HASH);
        expect(original.post.content).toBe('');
        expect(await db.file_blobs.count()).toBe(0);
        const trashed = await updateWorkspaceFile(scope, original.post.id, await workspaceRevision(original.post), { trashed: true });
        const duplicate = await catalogWorkspaceFile(scope, TEST_HASH);
        expect(duplicate.restored).toBe(false);
        expect(duplicate.post.meta).toBe(trashed.meta);
        const restored = await updateWorkspaceFile(scope, original.post.id, await workspaceRevision(trashed), { trashed: false });
        await db.file_blobs.put({ hash: TEST_HASH, blob: new Blob(['explicit text']) });
        const enabled = await enableWorkspaceFileText(scope, restored.id, await workspaceRevision(restored));
        expect(enabled.content).toBe('explicit text');
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
    });
    it('rejects catalog intake through the existing attachment policy before persisting bytes', async () => {
        const { importWorkspaceFile } = await import('../workspace-files');
        const db = getDb();
        const scope = { db, workspaceId, signal: new AbortController().signal, writable: true, assertCurrent() {} } as never;
        hooks.addFilter('files.attach:filter:input', () => false);
        await expect(importWorkspaceFile(scope, new Blob(['private']), 'private.txt')).rejects.toThrow(/rejected/);
        expect(await db.file_meta.count()).toBe(0);
        expect(await db.posts.count()).toBe(0);
    });

    it('removes only trashed catalog ownership while preserving shared message bytes', async () => {
        const { catalogWorkspaceFile, updateWorkspaceFile, removeWorkspaceFile } = await import('../workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        await db.file_meta.put(fileMeta(TEST_HASH, 1));
        await db.file_blobs.put({ hash: TEST_HASH, blob: new Blob(['shared']) });
        await db.messages.put(message('shared-message', [TEST_HASH]));
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent() {} } as never;
        const saved = await catalogWorkspaceFile(scope, TEST_HASH);
        await expect(removeWorkspaceFile(scope, saved.post.id, await workspaceRevision(saved.post))).rejects.toThrow(/Trash/);
        const trashed = await updateWorkspaceFile(scope, saved.post.id, await workspaceRevision(saved.post), { trashed: true });
        await removeWorkspaceFile(scope, trashed.id, await workspaceRevision(trashed));
        expect((await db.posts.get(trashed.id))?.deleted).toBe(true);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
        expect(await db.file_blobs.get(TEST_HASH)).toBeDefined();
        expect(await storedHashes('shared-message')).toEqual([TEST_HASH]);
    });

    it.each(['message', 'catalog', 'trashed catalog', 'revision'])('refuses physical deletion retained by a %s', async (owner) => {
        const { hardDeleteMany, softDeleteFile } = await import('../files');
        const db = getDb();
        await db.file_meta.put(fileMeta(TEST_HASH, 0));
        await db.file_blobs.put({ hash: TEST_HASH, blob: new Blob(['retained']) });
        if (owner === 'message') await db.messages.put(message('retaining-message', [TEST_HASH]));
        else await db.posts.put({ id: 'retaining-post', title: 'Retained', content: '',
            postType: owner === 'revision' ? 'or3:document-revision' : 'or3:file',
            file_hashes: JSON.stringify([TEST_HASH]), meta: owner === 'trashed catalog'
                ? JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: 1 } }) : null,
            created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        await expect(softDeleteFile(TEST_HASH)).rejects.toThrow(/referenced/);
        await expect(hardDeleteMany([TEST_HASH])).rejects.toThrow(/referenced/);
        expect((await db.file_meta.get(TEST_HASH))?.deleted).toBe(false);
        expect((await db.file_blobs.get(TEST_HASH))?.blob).toBeDefined();
    });
    it('retains catalog ownership through duplicate import, rename and logical Trash', async () => {
        const { importWorkspaceFile, updateWorkspaceFile } = await import('../workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        const scope = { db, workspaceId, generation: 0, subject: null,
            signal: new AbortController().signal, writable: true, assertCurrent: () => {} };
        const first = await importWorkspaceFile(scope, new Blob(['saffron notes'], { type: 'text/plain' }), 'notes.txt');
        expect(first.post.content).toBe('saffron notes');
        const renamed = await updateWorkspaceFile(scope, first.post.id, await workspaceRevision(first.post), { title: 'My notes' });
        const trashed = await updateWorkspaceFile(scope, first.post.id, await workspaceRevision(renamed), { trashed: true });
        const { readWorkspaceItem } = await import('~/utils/chat/workspace-items');
        await expect(readWorkspaceItem(scope, { kind: 'file', id: first.post.id })).rejects.toThrow(/unavailable/);
        expect((await db.file_meta.get(TEST_HASH))?.deleted).toBe(false);
        expect((await db.file_blobs.get(TEST_HASH))?.blob).toBeDefined();
        const duplicate = await importWorkspaceFile(scope, new Blob(['saffron notes'], { type: 'text/plain' }), 'other.txt');
        expect(duplicate.post.id).toBe(trashed.id);
        expect(duplicate.post.title).toBe('My notes');
        expect(duplicate.restored).toBe(true);
        const read = await readWorkspaceItem(scope, { kind: 'file', id: first.post.id });
        expect(read.content).toBe('saffron notes');
        expect(await db.posts.where('postType').equals('or3:file').count()).toBe(1);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
    });

    it('refuses a saved-file read when its original metadata is removed during revision hashing', async () => {
        const { importWorkspaceFile } = await import('../workspace-files');
        const { readWorkspaceItem } = await import('~/utils/chat/workspace-items');
        const db = getDb();
        const scope = { db, workspaceId, signal: new AbortController().signal, writable: true, assertCurrent() {} } as never;
        const saved = await importWorkspaceFile(scope, new Blob(['private saved content']), 'notes.txt');
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        const hash = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
            await db.file_meta.update(TEST_HASH, { deleted: true });
            return digest(...args);
        });
        try {
            await expect(readWorkspaceItem(scope, { kind: 'file', id: saved.post.id })).rejects.toThrow(/unavailable/);
        } finally { hash.mockRestore(); }
    });

    it('indexes complete UTF-8 characters and keeps invalid text stored-only', async () => {
        const { extractWorkspaceFileText } = await import('../workspace-files');
        const prefix = await extractWorkspaceFileText(new Blob(['a'.repeat(65535) + '😀tail']), 'notes.md');
        expect(prefix.text).toBe('a'.repeat(65535));
        expect(prefix.coverage).toBe('prefix');
        expect(prefix.indexed_bytes).toBe(65535);
        const invalid = await extractWorkspaceFileText(new Blob([new Uint8Array([0xff, 0xfe, 0])]), 'notes.txt');
        expect(invalid).toEqual({ text: '', coverage: 'none', indexed_bytes: 0 });
    });
    it('rejects a stale workspace after hashing before writing metadata', async () => {
        const originalWorkspaceId = workspaceId;
        let releaseHash!: () => void;
        let hashStarted!: () => void;
        const hashGate = new Promise<void>((resolve) => {
            releaseHash = resolve;
        });
        const started = new Promise<void>((resolve) => {
            hashStarted = resolve;
        });
        computeFileHashMock.mockImplementationOnce(async () => {
            hashStarted();
            await hashGate;
            return TEST_HASH;
        });

        const pending = createOrRefFile(
            new Blob(['source'], { type: 'text/plain' }),
            'source.txt'
        );
        await started;

        const nextWorkspaceId = `file-ref-count-next-${crypto.randomUUID()}`;
        const nextDb = setActiveWorkspaceDb(nextWorkspaceId);
        await nextDb.open();
        releaseHash();

        await expect(pending).rejects.toThrow('workspace changed');

        setActiveWorkspaceDb(null);
        evictWorkspaceDb(nextWorkspaceId);
        await Dexie.delete(`or3-db-${nextWorkspaceId}`);
        workspaceId = originalWorkspaceId;
    });

    it('increments a hash attachment once and keeps duplicate attachment idempotent', async () => {
        const db = getDb();
        await db.messages.put(message('message-1'));
        await db.file_meta.put(fileMeta());

        await addFilesToMessage('message-1', [
            { type: 'hash', hash: TEST_HASH },
        ]);
        await addFilesToMessage('message-1', [
            { type: 'hash', hash: TEST_HASH },
        ]);

        expect(await storedHashes('message-1')).toEqual([TEST_HASH]);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
    });

    it('reconciles a hook-pruned Blob addition back to zero references', async () => {
        const db = getDb();
        await db.messages.put(message('message-1'));
        hooks.addFilter(
            'db.messages.files.validate:filter:hashes',
            () => []
        );

        await addFilesToMessage('message-1', [
            {
                type: 'blob',
                blob: new Blob(['same']),
                name: 'attachment.txt',
            },
        ]);

        expect(await storedHashes('message-1')).toEqual([]);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(0);
        expect(await db.file_blobs.count()).toBe(1);
    });

    it('serializes concurrent identical Blob creation into one row with one count per live edge', async () => {
        const db = getDb();
        await db.messages.bulkPut([
            message('message-1'),
            message('message-2'),
        ]);
        const blob = new Blob(['same']);

        await Promise.all([
            addFilesToMessage('message-1', [
                { type: 'blob', blob, name: 'one.txt' },
            ]),
            addFilesToMessage('message-2', [
                { type: 'blob', blob, name: 'two.txt' },
            ]),
        ]);

        expect(await db.file_meta.count()).toBe(1);
        expect(await db.file_blobs.count()).toBe(1);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(2);
        expect(await storedHashes('message-1')).toEqual([TEST_HASH]);
        expect(await storedHashes('message-2')).toEqual([TEST_HASH]);
    });

    it('decrements once per removed live edge and ignores repeated removal', async () => {
        const db = getDb();
        await db.messages.bulkPut([
            message('message-1', [TEST_HASH]),
            message('message-2', [TEST_HASH]),
        ]);
        await db.file_meta.put(fileMeta(TEST_HASH, 2));

        await removeFileFromMessage('message-1', TEST_HASH);
        await removeFileFromMessage('message-1', TEST_HASH);

        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
        expect(await storedHashes('message-1')).toEqual([]);

        await removeFileFromMessage('message-2', TEST_HASH);

        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(0);
        expect(await storedHashes('message-2')).toEqual([]);
    });
});
