import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB, getDefaultDb } from '~/db/client';
import { getHookBridge, _resetHookBridge } from '~/core/sync/hook-bridge';
import { _resetHLC } from '~/core/sync/hlc';
import { applySnapshotChain } from '~/core/sync/snapshot-applier';
import { getWriteTxTableNames } from '~/db/util';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import {
    importWorkspaceStream,
    WORKSPACE_BACKUP_FORMAT,
    WORKSPACE_BACKUP_VERSION,
} from '~/utils/workspace-backup-stream';
import type { SnapshotResponse } from '~~/shared/sync/types';
import type { FileMeta, Post } from '../schema';

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

const V15_POSTS_STORES =
    'id, title, postType, [postType+title], deleted, created_at, updated_at';
const V15_FILE_META_STORES =
    'hash, [kind+deleted], mime_type, clock, created_at, updated_at';

function docPost(
    id: string,
    overrides: Partial<Post> & { post_type?: string } = {}
): Post & { post_type?: string } {
    return {
        id,
        title: id,
        content: JSON.stringify({ type: 'doc', content: [] }),
        postType: 'doc',
        created_at: 10,
        updated_at: 10,
        deleted: false,
        clock: 1,
        meta: '',
        file_hashes: JSON.stringify([HASH_A]),
        ...overrides,
    };
}

function fileMeta(
    hash: string,
    overrides: Partial<FileMeta> & { kind?: string } = {}
): FileMeta {
    return {
        hash,
        name: `${hash.slice(-4)}.png`,
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 100,
        ref_count: 0,
        created_at: 10,
        updated_at: 10,
        deleted: false,
        clock: 1,
        ...overrides,
    } as FileMeta;
}

async function openFreshDb(): Promise<Or3DB> {
    const db = new Or3DB(`or3-test-derived-${crypto.randomUUID()}`);
    await db.open();
    return db;
}

describe('derived index maintenance', () => {
    const databases: Or3DB[] = [];

    beforeEach(() => {
        hooksMock.doAction.mockClear();
        hooksMock.applyFilters.mockClear();
        _resetHLC();
        _resetHookBridge();
    });

    afterEach(async () => {
        _resetHookBridge();
        _resetHLC();
        for (const db of databases.splice(0)) {
            db.close();
            await Dexie.delete(db.name);
        }
    });

    async function freshDb(): Promise<Or3DB> {
        const db = await openFreshDb();
        databases.push(db);
        return db;
    }

    it('upgrades a real v14 database without touching canonical fields', async () => {
        const name = `or3-test-derived-upgrade-${crypto.randomUUID()}`;
        const legacy = new Dexie(name);
        legacy.version(14).stores({
            posts: V15_POSTS_STORES,
            file_meta: V15_FILE_META_STORES,
        });
        await legacy.open();

        const activeDoc = docPost('doc-active');
        const deletedDoc = docPost('doc-deleted', { deleted: true });
        const snapshotDoc = {
            ...docPost('doc-snapshot'),
            postType: undefined,
            post_type: 'doc',
        } as unknown as Post;
        const promptPost = docPost('prompt-1', { postType: 'prompt' });
        const emptyHashesDoc = docPost('doc-empty', { file_hashes: '' });
        const malformedDoc = docPost('doc-malformed', {
            file_hashes: '{not-json',
        });
        // Legacy rows must survive untouched, including source clocks.
        await legacy.table('posts').bulkPut([
            activeDoc,
            deletedDoc,
            snapshotDoc,
            promptPost,
            emptyHashesDoc,
            malformedDoc,
        ]);
        await legacy.table('file_meta').bulkPut([
            fileMeta(HASH_A),
            fileMeta(HASH_B, { deleted: true }),
            fileMeta(`sha256:${'c'.repeat(64)}`, {
                kind: 'file',
                mime_type: 'image/png',
            }),
            fileMeta(`sha256:${'d'.repeat(64)}`, { kind: undefined }),
            fileMeta(`sha256:${'e'.repeat(64)}`, {
                mime_type: 'image/svg+xml',
            }),
        ]);
        legacy.close();

        const db = new Or3DB(name);
        databases.push(db);
        await db.open();
        expect(db.verno).toBe(17);

        const storedActive = await db.posts.get('doc-active');
        expect(storedActive?.document_reference_key).toEqual([
            activeDoc.file_hashes,
            'doc-active',
        ]);
        expect(storedActive?.content).toBe(activeDoc.content);
        expect(storedActive?.clock).toBe(activeDoc.clock);
        expect(storedActive?.created_at).toBe(activeDoc.created_at);

        const storedDeleted = await db.posts.get('doc-deleted');
        expect(storedDeleted?.document_reference_key).toBeUndefined();
        expect(storedDeleted?.content).toBe(deletedDoc.content);

        const storedSnapshot = await db.posts.get('doc-snapshot');
        expect(storedSnapshot?.postType).toBe('doc');
        expect(storedSnapshot?.document_reference_key).toEqual([
            snapshotDoc.file_hashes,
            'doc-snapshot',
        ]);

        const storedPrompt = await db.posts.get('prompt-1');
        expect(storedPrompt?.document_reference_key).toBeUndefined();

        const storedEmpty = await db.posts.get('doc-empty');
        expect(storedEmpty?.document_reference_key).toBeUndefined();

        const storedMalformed = await db.posts.get('doc-malformed');
        expect(storedMalformed?.document_reference_key).toEqual([
            '{not-json',
            'doc-malformed',
        ]);
        // Malformed serialized hashes parse to no references.
        expect(await db.posts.orderBy('document_reference_key').keys()).toEqual([
            [activeDoc.file_hashes, 'doc-active'],
            [snapshotDoc.file_hashes, 'doc-snapshot'],
            ['{not-json', 'doc-malformed'],
        ]);

        const legacyRaster = await db.file_meta.get(`sha256:${'d'.repeat(64)}`);
        expect(legacyRaster?.gallery_state).toBe('active');
        expect(await db.file_meta.get(HASH_A)).toMatchObject({
            gallery_state: 'active',
        });
        expect(await db.file_meta.get(HASH_B)).toMatchObject({
            gallery_state: 'trash',
        });
        expect(
            await db.file_meta.get(`sha256:${'c'.repeat(64)}`)
        ).toMatchObject({ kind: 'file' });
        expect(
            (
                await db.file_meta.get(`sha256:${'c'.repeat(64)}`)
            )?.gallery_state
        ).toBeUndefined();
        expect(
            (await db.file_meta.get(`sha256:${'e'.repeat(64)}`))?.gallery_state
        ).toBeUndefined();

        expect(await db.pending_ops.count()).toBe(0);
        expect(
            await db.file_meta
                .orderBy(
                    '[gallery_state+name+mime_type+created_at+size_bytes+hash]'
                )
                .keys()
        ).toHaveLength(3);
    });

    it('maintains derived keys across put, update, delete, and bulk writes', async () => {
        const db = await freshDb();

        await db.posts.put(docPost('doc-1'));
        expect((await db.posts.get('doc-1'))?.document_reference_key).toEqual([
            JSON.stringify([HASH_A]),
            'doc-1',
        ]);

        await db.posts.put(docPost('doc-1', { file_hashes: JSON.stringify([HASH_B]) }));
        expect((await db.posts.get('doc-1'))?.document_reference_key).toEqual([
            JSON.stringify([HASH_B]),
            'doc-1',
        ]);

        await db.posts.update('doc-1', { deleted: true });
        expect(
            (await db.posts.get('doc-1'))?.document_reference_key
        ).toBeUndefined();

        await db.posts.update('doc-1', { deleted: false });
        expect((await db.posts.get('doc-1'))?.document_reference_key).toEqual([
            JSON.stringify([HASH_B]),
            'doc-1',
        ]);

        await db.posts.delete('doc-1');
        expect((await db.posts.get('doc-1'))?.document_reference_key).toBeUndefined();

        await db.posts.bulkPut([
            docPost('doc-2'),
            docPost('doc-3', { postType: 'prompt', file_hashes: JSON.stringify([HASH_A]) }),
        ]);
        expect(
            await db.posts.orderBy('document_reference_key').primaryKeys()
        ).toEqual(['doc-2']);

        await db.file_meta.bulkPut([
            fileMeta(HASH_A),
            fileMeta(HASH_B, { deleted: true }),
        ]);
        await db.file_meta.update(HASH_A, { deleted: true });
        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('trash');
        await db.file_meta.update(HASH_A, { deleted: false });
        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('active');

        await db.file_meta.put(fileMeta(HASH_A, { mime_type: 'image/svg+xml' }));
        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBeUndefined();

        await db.file_meta.delete(HASH_B);
        expect(await db.file_meta.where('gallery_state').equals('trash').count()).toBe(0);
    });

    it('ignores supplied derived values and never parses document bodies', async () => {
        const db = await freshDb();
        const body = 'x'.repeat(1_000_000);
        await db.posts.put({
            ...docPost('doc-big', {
                content: body,
                file_hashes: JSON.stringify([HASH_A]),
            }),
            document_reference_key: ['bogus', 'bogus'],
        } as Post);
        expect((await db.posts.get('doc-big'))?.document_reference_key).toEqual([
            JSON.stringify([HASH_A]),
            'doc-big',
        ]);

        await db.file_meta.put({
            ...fileMeta(HASH_A),
            gallery_state: 'bogus',
        } as unknown as FileMeta);
        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('active');
    });

    it('recomputes on remote-applied writes even when sync capture is suppressed', async () => {
        const db = await freshDb();
        getHookBridge(db).start();

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, ['posts', 'file_meta']),
            async (tx) => {
                getHookBridge(db).markSyncTransaction(tx);
                await tx.table('posts').put({
                    ...docPost('remote-doc'),
                    document_reference_key: ['stale', 'stale'],
                });
                await tx.table('file_meta').put({
                    ...fileMeta(HASH_A, { deleted: true }),
                    gallery_state: 'active',
                });
            }
        );

        expect((await db.posts.get('remote-doc'))?.document_reference_key).toEqual([
            JSON.stringify([HASH_A]),
            'remote-doc',
        ]);
        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('trash');
        expect(await db.pending_ops.count()).toBe(0);
    });

    it('captures sanitized outbox payloads without derived fields', async () => {
        const db = await freshDb();
        getHookBridge(db).start();

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, ['posts', 'file_meta']),
            async () => {
                await db.posts.put(docPost('local-doc'));
                await db.file_meta.put(fileMeta(HASH_A));
            }
        );

        const ops = await db.pending_ops.toArray();
        expect(ops).toHaveLength(2);
        for (const op of ops) {
            const payload = op.payload as Record<string, unknown>;
            expect(payload.document_reference_key).toBeUndefined();
            expect(payload.gallery_state).toBeUndefined();
            if (op.tableName === 'posts') {
                expect(payload.post_type).toBe('doc');
                expect(payload.postType).toBeUndefined();
            }
            if (op.tableName === 'file_meta') {
                expect(payload.ref_count).toBeUndefined();
            }
        }
    });

    it('rolls back derived keys with the source transaction', async () => {
        const db = await freshDb();
        await expect(
            db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
                await db.file_meta.put(fileMeta(HASH_A));
                expect(
                    (await db.file_meta.get(HASH_A))?.gallery_state
                ).toBe('active');
                throw new Error('ROLLBACK');
            })
        ).rejects.toThrow('ROLLBACK');
        expect(await db.file_meta.count()).toBe(0);
        expect(
            await db.file_meta.where('gallery_state').equals('active').count()
        ).toBe(0);
    });

    it('sanitizes derived fields from direct wire payloads', () => {
        const post = sanitizePayloadForSync(
            'posts',
            {
                id: 'doc-1',
                postType: 'doc',
                document_reference_key: [HASH_A, 'doc-1'],
                file_hashes: JSON.stringify([HASH_A]),
            },
            'put'
        );
        expect(post?.document_reference_key).toBeUndefined();
        expect(post?.postType).toBeUndefined();
        expect(post?.post_type).toBe('doc');

        const meta = sanitizePayloadForSync(
            'file_meta',
            {
                hash: HASH_A,
                ref_count: 3,
                gallery_state: 'active',
            },
            'put'
        );
        expect(meta?.gallery_state).toBeUndefined();
        expect(meta?.ref_count).toBeUndefined();
    });

    it('rebuilds derived keys for restored rows', async () => {
        const db = await freshDb();
        // Direct bulkPut with stale derived values mimics a restore/import path.
        await db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
            await db.file_meta.bulkPut([
                {
                    ...fileMeta(HASH_A),
                    gallery_state: 'trash',
                } as FileMeta,
            ]);
        });
        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('active');
    });

    it('recomputes derived keys when a snapshot chain installs rows', async () => {
        const db = await freshDb();
        const revision = { clock: 1, hlc: '1:0:device', opId: 'op-1' };
        const pages: SnapshotResponse[] = [
            {
                workspaceId: 'workspace-1',
                snapshotId: 'snapshot-1',
                highWatermark: 7,
                items: [
                    {
                        kind: 'row',
                        tableName: 'file_meta',
                        pk: HASH_A,
                        payload: {
                            hash: HASH_A,
                            kind: 'image',
                            mime_type: 'image/png',
                            size_bytes: 10,
                            gallery_state: 'trash',
                            deleted: false,
                            created_at: 1,
                            updated_at: 1,
                            clock: 1,
                        },
                        revision,
                    },
                    {
                        kind: 'row',
                        tableName: 'file_meta',
                        pk: HASH_B,
                        payload: {
                            hash: HASH_B,
                            kind: 'image',
                            mime_type: 'image/png',
                            size_bytes: 10,
                            gallery_state: 'active',
                            deleted: true,
                            created_at: 1,
                            updated_at: 1,
                            clock: 1,
                        },
                        revision,
                    },
                    {
                        kind: 'row',
                        tableName: 'posts',
                        pk: 'snapshot-doc',
                        payload: {
                            id: 'snapshot-doc',
                            title: 'Snapshot doc',
                            content: JSON.stringify({ type: 'doc', content: [] }),
                            post_type: 'doc',
                            file_hashes: JSON.stringify([HASH_A]),
                            document_reference_key: ['bogus', 'bogus'],
                            deleted: false,
                            created_at: 1,
                            updated_at: 1,
                            clock: 1,
                        },
                        revision,
                    },
                ],
                nextPageToken: null,
            },
        ];

        await applySnapshotChain(
            db,
            pages,
            { workspaceId: 'workspace-1' },
            'device-1'
        );

        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('active');
        expect((await db.file_meta.get(HASH_B))?.gallery_state).toBe('trash');
        expect(
            (await db.posts.get('snapshot-doc'))?.document_reference_key
        ).toEqual([JSON.stringify([HASH_A]), 'snapshot-doc']);
        expect(await db.pending_ops.count()).toBe(0);
    });

    it('rebuilds derived keys through the workspace backup import path', async () => {
        const db = await freshDb();
        const backupLines = [
            {
                type: 'meta',
                format: WORKSPACE_BACKUP_FORMAT,
                version: WORKSPACE_BACKUP_VERSION,
                databaseName: db.name,
                databaseVersion: db.verno,
                createdAt: new Date().toISOString(),
                tables: [
                    { name: 'file_meta', rowCount: 1, inbound: true },
                    { name: 'posts', rowCount: 1, inbound: true },
                ],
            },
            { type: 'table-start', table: 'file_meta' },
            {
                type: 'rows',
                table: 'file_meta',
                rows: [
                    {
                        hash: HASH_A,
                        name: 'restored.png',
                        mime_type: 'image/png',
                        kind: 'image',
                        size_bytes: 10,
                        ref_count: 0,
                        gallery_state: 'trash',
                        created_at: 1,
                        updated_at: 1,
                        clock: 1,
                        deleted: false,
                    },
                ],
            },
            { type: 'table-end', table: 'file_meta' },
            { type: 'table-start', table: 'posts' },
            {
                type: 'rows',
                table: 'posts',
                rows: [
                    {
                        id: 'restored-doc',
                        title: 'Restored doc',
                        content: JSON.stringify({ type: 'doc', content: [] }),
                        postType: 'doc',
                        file_hashes: JSON.stringify([HASH_A]),
                        document_reference_key: ['bogus', 'bogus'],
                        created_at: 1,
                        updated_at: 1,
                        clock: 1,
                        deleted: false,
                    },
                ],
            },
            { type: 'table-end', table: 'posts' },
            { type: 'end' },
        ];
        const file = new NodeBlob([
            `${backupLines.map((line) => JSON.stringify(line)).join('\n')}\n`,
        ]) as unknown as Blob;

        await importWorkspaceStream({
            db,
            file,
            clearTables: false,
            overwriteValues: true,
        });

        expect((await db.file_meta.get(HASH_A))?.gallery_state).toBe('active');
        expect(
            (await db.posts.get('restored-doc'))?.document_reference_key
        ).toEqual([JSON.stringify([HASH_A]), 'restored-doc']);
        expect(await db.pending_ops.count()).toBe(0);
    });

    it('backfills readyAt for legacy outbox rows and keeps them queryable across reopen', async () => {
        const name = `or3-test-readyat-upgrade-${crypto.randomUUID()}`;
        const legacy = new Dexie(name);
        legacy.version(16).stores({
            pending_ops: 'id, tableName, status, createdAt, [tableName+pk]',
        });
        await legacy.open();
        await legacy.table('pending_ops').bulkPut([
            {
                id: 'legacy-missing-time',
                tableName: 'messages',
                operation: 'put',
                pk: 'm-missing',
                payload: { id: 'm-missing' },
                stamp: { deviceId: 'd1', opId: 'op-missing', hlc: '1:0:d1', clock: 1 },
                createdAt: 5,
                attempts: 2,
                status: 'pending',
            },
            {
                id: 'legacy-due',
                tableName: 'messages',
                operation: 'put',
                pk: 'm-due',
                payload: { id: 'm-due' },
                stamp: { deviceId: 'd1', opId: 'op-due', hlc: '2:0:d1', clock: 2 },
                createdAt: 6,
                attempts: 1,
                status: 'retry_wait',
                nextAttemptAt: 1000,
            },
            {
                id: 'legacy-future',
                tableName: 'messages',
                operation: 'put',
                pk: 'm-future',
                payload: { id: 'm-future' },
                stamp: { deviceId: 'd1', opId: 'op-future', hlc: '3:0:d1', clock: 3 },
                createdAt: 7,
                attempts: 0,
                status: 'pending',
                nextAttemptAt: 9_999_999,
            },
        ]);
        legacy.close();

        const db = new Or3DB(name);
        databases.push(db);
        await db.open();
        expect(db.verno).toBe(17);

        // IDs, revisions, attempts, statuses, and payloads are preserved.
        expect(await db.pending_ops.get('legacy-missing-time')).toMatchObject({
            id: 'legacy-missing-time',
            status: 'pending',
            attempts: 2,
            stamp: { opId: 'op-missing', clock: 1 },
            payload: { id: 'm-missing' },
            readyAt: 0,
        });
        expect(await db.pending_ops.get('legacy-due')).toMatchObject({
            status: 'retry_wait',
            attempts: 1,
            nextAttemptAt: 1000,
            readyAt: 1000,
        });
        expect(await db.pending_ops.get('legacy-future')).toMatchObject({
            readyAt: 9_999_999,
        });

        // Missing-time and due rows are discoverable via the due index.
        const duePending = await db.pending_ops
            .where('[status+readyAt+createdAt+id]')
            .between(
                ['pending', 0, 0, ''],
                ['pending', 2000, Number.MAX_SAFE_INTEGER, '\uffff'],
                true,
                true
            )
            .toArray();
        expect(duePending.map((op) => op.id)).toEqual(['legacy-missing-time']);
        const dueRetry = await db.pending_ops
            .where('[status+readyAt+createdAt+id]')
            .between(
                ['retry_wait', 0, 0, ''],
                ['retry_wait', 2000, Number.MAX_SAFE_INTEGER, '\uffff'],
                true,
                true
            )
            .toArray();
        expect(dueRetry.map((op) => op.id)).toEqual(['legacy-due']);

        db.close();
        const reopened = new Or3DB(name);
        databases.push(reopened);
        await reopened.open();
        expect(await reopened.pending_ops.get('legacy-missing-time')).toMatchObject({
            readyAt: 0,
        });
        expect(await reopened.pending_ops.get('legacy-future')).toMatchObject({
            readyAt: 9_999_999,
        });
    });

    it('keeps readyAt current across add, put, bulkPut, update, and modify', async () => {
        const db = await freshDb();

        await db.pending_ops.add({
            id: 'ready-add',
            tableName: 'messages',
            operation: 'put',
            pk: 'm-add',
            stamp: { deviceId: 'd1', opId: 'op-add', hlc: '1:0:d1', clock: 1 },
            createdAt: 10,
            attempts: 0,
            status: 'pending',
            readyAt: 9999,
        } as never);
        expect((await db.pending_ops.get('ready-add'))?.readyAt).toBe(0);

        await db.pending_ops.put({
            id: 'ready-add',
            tableName: 'messages',
            operation: 'put',
            pk: 'm-add',
            stamp: { deviceId: 'd1', opId: 'op-add', hlc: '1:0:d1', clock: 1 },
            createdAt: 10,
            attempts: 0,
            status: 'retry_wait',
            nextAttemptAt: 5000,
            readyAt: 0,
        } as never);
        expect((await db.pending_ops.get('ready-add'))?.readyAt).toBe(5000);

        await db.pending_ops.bulkPut([
            {
                id: 'ready-bulk-due',
                tableName: 'messages',
                operation: 'put',
                pk: 'm-bulk-due',
                stamp: { deviceId: 'd1', opId: 'op-bulk-due', hlc: '2:0:d1', clock: 1 },
                createdAt: 11,
                attempts: 0,
                status: 'pending',
            },
            {
                id: 'ready-bulk-future',
                tableName: 'messages',
                operation: 'put',
                pk: 'm-bulk-future',
                stamp: { deviceId: 'd1', opId: 'op-bulk-future', hlc: '3:0:d1', clock: 1 },
                createdAt: 12,
                attempts: 0,
                status: 'pending',
                nextAttemptAt: 8000,
                readyAt: 1,
            },
        ] as never);
        expect((await db.pending_ops.get('ready-bulk-due'))?.readyAt).toBe(0);
        expect((await db.pending_ops.get('ready-bulk-future'))?.readyAt).toBe(8000);

        await db.pending_ops.update('ready-bulk-future', { nextAttemptAt: undefined } as never);
        expect((await db.pending_ops.get('ready-bulk-future'))?.readyAt).toBe(0);

        await db.pending_ops.where('status').equals('pending').modify({ nextAttemptAt: 7000 } as never);
        expect((await db.pending_ops.get('ready-bulk-due'))?.readyAt).toBe(7000);

        await db.pending_ops.update('ready-bulk-due', { status: 'retry_wait' } as never);
        expect(await db.pending_ops.get('ready-bulk-due')).toMatchObject({
            status: 'retry_wait',
            nextAttemptAt: 7000,
            readyAt: 7000,
        });
    });
});

describe('default database hooks', () => {
    it('installs derived hooks on the module default database', async () => {
        const db = getDefaultDb();
        await db.open();
        try {
            await db.file_meta.put(fileMeta(`sha256:${'f'.repeat(64)}`));
            expect(
                (await db.file_meta.get(`sha256:${'f'.repeat(64)}`))
                    ?.gallery_state
            ).toBe('active');
        } finally {
            await db.file_meta.delete(`sha256:${'f'.repeat(64)}`);
        }
    });
});
