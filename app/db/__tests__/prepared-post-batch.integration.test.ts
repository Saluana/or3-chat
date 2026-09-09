import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { getHookBridge, _resetHookBridge } from '~/core/sync/hook-bridge';
import { _resetHLC } from '~/core/sync/hlc';
import { getWriteTxTableNames } from '~/db/util';
import type { FileMeta, Post } from '../schema';
import { commitPreparedPostBatch } from '../posts';

const hooksMock = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
    applyFilters: vi.fn(async (_name: string, value: unknown) => value),
    applyFiltersSync: vi.fn((_: string, value: string[]) => value),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hooksMock.doAction,
        applyFilters: hooksMock.applyFilters,
        _engine: {
            applyFiltersSync: hooksMock.applyFiltersSync,
        },
    }),
}));

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const ROOT_ID = 'stonewatch';
const CONTENT_ID = 'tactics-content-content-1';
const REVISION_ID = 'tactics-revision-revision-1';
const INITIAL_ROOT_CONTENT = JSON.stringify({
    formatVersion: 2,
    projectId: ROOT_ID,
    title: 'Stonewatch Pass',
    activeRevisionId: 'tactics-revision-old',
    archived: false,
});

function fileMeta(hash: string, refCount = 0): FileMeta {
    return {
        hash,
        name: `${hash.slice(-8)}.png`,
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 128,
        ref_count: refCount,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
    };
}

function post(
    id: string,
    postType: string,
    content: string,
    fileHashes: string[] = []
): Post {
    return {
        id,
        title: id,
        content,
        postType,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
        meta: '',
        file_hashes: JSON.stringify([...new Set(fileHashes)].sort()),
    };
}

function preparedBatch(rootContent = INITIAL_ROOT_CONTENT) {
    const content = post(
        CONTENT_ID,
        'or3-tactics:content',
        JSON.stringify({
            formatVersion: 2,
            projectId: ROOT_ID,
            documentId: 'doc-1',
            name: 'Stonewatch Pass',
        }),
        [HASH_A, HASH_A]
    );
    const manifest = post(
        REVISION_ID,
        'or3-tactics:revision',
        JSON.stringify({
            formatVersion: 2,
            projectId: ROOT_ID,
            parentRevisionId: null,
            documents: [{
                documentId: 'doc-1',
                postId: CONTENT_ID,
                sha256: HASH_A,
            }],
        }),
        [HASH_B]
    );
    const root = post(ROOT_ID, 'or3-tactics:project', rootContent);
    return { content, manifest, root, posts: [content, manifest, root] };
}

async function seed(
    db: Or3DB,
    options: { root?: Post; hashes?: string[] } = {}
): Promise<void> {
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, ['posts', 'file_meta']),
        async () => {
            if (options.hashes?.length) {
                await db.file_meta.bulkPut(options.hashes.map((hash) => fileMeta(hash)));
            }
            if (options.root) {
                await db.posts.put(options.root);
            }
        }
    );
    await db.pending_ops.clear();
}

async function expectNoBatchRows(db: Or3DB, hashes = [HASH_A, HASH_B]): Promise<void> {
    expect(await db.posts.get(CONTENT_ID)).toBeUndefined();
    expect(await db.posts.get(REVISION_ID)).toBeUndefined();
    for (const hash of hashes) {
        expect(await db.file_meta.get(hash)).toMatchObject({ ref_count: 0, clock: 0 });
    }
    expect(await db.pending_ops.toArray()).toEqual([]);
}

describe('prepared post batch (fake-indexeddb emulated Dexie)', () => {
    let db: Or3DB;

    beforeEach(async () => {
        hooksMock.doAction.mockClear();
        hooksMock.applyFilters.mockClear();
        hooksMock.applyFiltersSync.mockClear();
        _resetHLC();
        _resetHookBridge();
        db = new Or3DB(`or3-test-prepared-post-batch-${crypto.randomUUID()}`);
        await db.open();
        getHookBridge(db).start();
    });

    afterEach(async () => {
        _resetHookBridge();
        _resetHLC();
        db.close();
        await Dexie.delete(db.name);
    });

    it('commits content, manifest, and root together with file references and pending ops', async () => {
        const batch = preparedBatch();
        await seed(db, { hashes: [HASH_A, HASH_B] });

        await commitPreparedPostBatch({
            db,
            assertCurrent: () => undefined,
            expected: { id: ROOT_ID, content: null },
            posts: batch.posts,
            immutableIds: [CONTENT_ID, REVISION_ID],
        });

        expect(await db.posts.get(CONTENT_ID)).toMatchObject({
            postType: 'or3-tactics:content',
            content: batch.content.content,
        });
        expect(await db.posts.get(REVISION_ID)).toMatchObject({
            postType: 'or3-tactics:revision',
            content: batch.manifest.content,
        });
        expect(await db.posts.get(ROOT_ID)).toMatchObject({
            postType: 'or3-tactics:project',
            content: batch.root.content,
        });
        expect(await db.file_meta.get(HASH_A)).toMatchObject({ ref_count: 1 });
        expect(await db.file_meta.get(HASH_B)).toMatchObject({ ref_count: 1 });

        const ops = await db.pending_ops.toArray();
        expect(ops).toHaveLength(5);
        expect(ops.filter((op) => op.tableName === 'posts')).toHaveLength(3);
        expect(ops.filter((op) => op.tableName === 'file_meta')).toHaveLength(2);
        expect(ops.every((op) => op.status === 'pending')).toBe(true);
        for (const op of ops) {
            const row = await db.table(op.tableName).get(op.pk) as Record<string, unknown>;
            expect(row).toMatchObject({
                clock: op.stamp.clock,
                hlc: op.stamp.hlc,
                op_id: op.stamp.opId,
            });
        }
    });

    it('rolls back the prepared rows and references when the expected root is stale', async () => {
        const batch = preparedBatch();
        await seed(db, {
            root: post(ROOT_ID, 'or3-tactics:project', INITIAL_ROOT_CONTENT),
            hashes: [HASH_A, HASH_B],
        });

        await expect(commitPreparedPostBatch({
            db,
            assertCurrent: () => undefined,
            expected: { id: ROOT_ID, content: '{"activeRevisionId":"different"}' },
            posts: batch.posts,
            immutableIds: [CONTENT_ID, REVISION_ID],
        })).rejects.toThrow('STALE_REVISION');

        expect(await db.posts.get(ROOT_ID)).toMatchObject({ content: INITIAL_ROOT_CONTENT });
        await expectNoBatchRows(db);
    });

    it('rejects a duplicate immutable content version without changing the current commit', async () => {
        const first = preparedBatch();
        await seed(db, { hashes: [HASH_A, HASH_B] });
        await commitPreparedPostBatch({
            db,
            assertCurrent: () => undefined,
            expected: { id: ROOT_ID, content: null },
            posts: first.posts,
            immutableIds: [CONTENT_ID, REVISION_ID],
        });

        const beforeRoot = await db.posts.get(ROOT_ID);
        const beforeContent = await db.posts.get(CONTENT_ID);
        const beforeManifest = await db.posts.get(REVISION_ID);
        const beforeA = await db.file_meta.get(HASH_A);
        const beforeB = await db.file_meta.get(HASH_B);
        await db.pending_ops.clear();

        const duplicate = preparedBatch(JSON.stringify({
            formatVersion: 2,
            projectId: ROOT_ID,
            title: 'Stonewatch Pass revised',
            activeRevisionId: REVISION_ID,
            archived: false,
        }));
        await expect(commitPreparedPostBatch({
            db,
            assertCurrent: () => undefined,
            expected: { id: ROOT_ID, content: beforeRoot!.content },
            posts: duplicate.posts,
            immutableIds: [CONTENT_ID, REVISION_ID],
        })).rejects.toThrow('IMMUTABLE_RECORD');

        expect(await db.posts.get(ROOT_ID)).toEqual(beforeRoot);
        expect(await db.posts.get(CONTENT_ID)).toEqual(beforeContent);
        expect(await db.posts.get(REVISION_ID)).toEqual(beforeManifest);
        expect(await db.file_meta.get(HASH_A)).toEqual(beforeA);
        expect(await db.file_meta.get(HASH_B)).toEqual(beforeB);
        expect(await db.pending_ops.toArray()).toEqual([]);
    });

    it('rolls back content, manifest, references, and pending ops when the root write fails late', async () => {
        const batch = preparedBatch();
        const existingRoot = post(ROOT_ID, 'or3-tactics:project', INITIAL_ROOT_CONTENT);
        await seed(db, { root: existingRoot, hashes: [HASH_A, HASH_B] });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const failOnHeadWrite = ((_: unknown, primKey: unknown) => {
            if (primKey === ROOT_ID) throw new Error('INJECTED_HEAD_WRITE');
        }) as never;
        db.posts.hook('updating', failOnHeadWrite);
        try {
            await expect(commitPreparedPostBatch({
                db,
                assertCurrent: () => undefined,
                expected: { id: ROOT_ID, content: INITIAL_ROOT_CONTENT },
                posts: batch.posts,
                immutableIds: [CONTENT_ID, REVISION_ID],
            })).rejects.toThrow('INJECTED_HEAD_WRITE');
        } finally {
            (db.posts.hook('updating') as {
                unsubscribe: (listener: typeof failOnHeadWrite) => void;
            }).unsubscribe(failOnHeadWrite);
            errorSpy.mockRestore();
        }

        expect(await db.posts.get(ROOT_ID)).toEqual(existingRoot);
        await expectNoBatchRows(db);
    });

    it('rejects a changed approval record without publishing the new head', async () => {
        const batch = preparedBatch();
        await seed(db, { hashes: [HASH_A, HASH_B] });
        await expect(commitPreparedPostBatch({
            db, assertCurrent: () => undefined,
            expected: { id: ROOT_ID, content: null },
            expectedRecords: [{ id: 'proposal-review', content: 'reviewed-content' }],
            posts: batch.posts, immutableIds: [CONTENT_ID, REVISION_ID],
        })).rejects.toThrow('STALE_REVISION');
        await expectNoBatchRows(db);
        expect(await db.posts.get(ROOT_ID)).toBeUndefined();
    });

    it('rejects a stale context before opening the transaction without writing anything', async () => {
        const batch = preparedBatch();
        let calls = 0;

        await expect(commitPreparedPostBatch({
            db,
            assertCurrent: () => {
                calls += 1;
                throw new Error('STALE_CONTEXT_BEFORE');
            },
            expected: { id: ROOT_ID, content: null },
            posts: batch.posts,
            immutableIds: [CONTENT_ID, REVISION_ID],
        })).rejects.toThrow('STALE_CONTEXT_BEFORE');

        expect(calls).toBe(1);
        expect(await db.posts.count()).toBe(0);
        expect(await db.file_meta.count()).toBe(0);
        expect(await db.pending_ops.toArray()).toEqual([]);
    });

    it('rolls back the transaction when context becomes stale after the prepared writes', async () => {
        const batch = preparedBatch();
        await seed(db, { hashes: [HASH_A, HASH_B] });
        let calls = 0;

        await expect(commitPreparedPostBatch({
            db,
            assertCurrent: () => {
                calls += 1;
                if (calls === 3) throw new Error('STALE_CONTEXT_DURING');
            },
            expected: { id: ROOT_ID, content: null },
            posts: batch.posts,
            immutableIds: [CONTENT_ID, REVISION_ID],
        })).rejects.toThrow('STALE_CONTEXT_DURING');

        expect(calls).toBe(3);
        await expectNoBatchRows(db);
        expect(await db.posts.get(ROOT_ID)).toBeUndefined();
    });
});
