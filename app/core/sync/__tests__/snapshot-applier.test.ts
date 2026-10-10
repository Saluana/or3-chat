import { afterEach, describe, expect, it } from 'vitest';
import { Or3DB } from '~/db/client';
import type { SnapshotResponse } from '~~/shared/sync/types';
import { applySnapshotChain, SnapshotStager } from '../snapshot-applier';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testUuid } from './sync-test-utils';
import type { PendingOp } from '~~/shared/sync/types';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';

const databases: Or3DB[] = [];

function createDb(): Or3DB {
    const db = new Or3DB(`snapshot-test-${crypto.randomUUID()}`);
    databases.push(db);
    return db;
}

function pages(): SnapshotResponse[] {
    return [
        {
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-1',
            highWatermark: 12,
            items: [{
                kind: 'row',
                tableName: 'messages',
                pk: 'message-1',
                payload: {
                    id: 'message-1',
                    thread_id: 'thread-1',
                    role: 'user',
                    index: 0,
                    order_key: '1:0:device',
                    data: { content: 'one' },
                    deleted: false,
                    created_at: 1,
                    updated_at: 1,
                    clock: 1,
                    hlc: '1:0:device',
                },
                revision: { clock: 1, hlc: '1:0:device', opId: 'op-1' },
            }],
            nextPageToken: 'page-2',
        },
        {
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-1',
            highWatermark: 12,
            items: [{
                kind: 'row',
                tableName: 'messages',
                pk: 'message-2',
                payload: {
                    id: 'message-2',
                    thread_id: 'thread-1',
                    role: 'user',
                    index: 1,
                    order_key: '2:0:device',
                    data: { content: 'two' },
                    deleted: false,
                    created_at: 2,
                    updated_at: 2,
                    clock: 1,
                    hlc: '2:0:device',
                },
                revision: { clock: 1, hlc: '2:0:device', opId: 'op-2' },
            }],
            nextPageToken: null,
        },
    ];
}

afterEach(async () => {
    setHookEngine(null);
    await Promise.all(databases.splice(0).map(async (db) => {
        await db.delete();
    }));
});

describe('applySnapshotChain', () => {
    it('installs every page and persists the replay watermark atomically', async () => {
        const db = createDb();
        await db.open();

        await expect(applySnapshotChain(
            db,
            pages(),
            { workspaceId: 'workspace-1' },
            'device-1'
        )).resolves.toBe(12);

        expect(await db.messages.count()).toBe(2);
        expect(await db.messages.get('message-1')).toMatchObject({
            clock: 1,
            hlc: '1:0:device',
            op_id: 'op-1',
        });
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({
            cursor: 12,
            deviceId: 'device-1',
        });
    });

    it('rolls back partial rows and the watermark when an apply write fails', async () => {
        const db = createDb();
        await db.open();
        const failingPages = pages();
        const second = failingPages[1]!.items[0]!;
        if (second.kind !== 'row') throw new Error('expected row fixture');
        second.payload = {
            ...(second.payload as Record<string, unknown>),
            cannotClone: () => undefined,
        };

        await expect(applySnapshotChain(
            db,
            failingPages,
            { workspaceId: 'workspace-1' },
            'device-1'
        )).rejects.toThrow();

        expect(await db.messages.count()).toBe(0);
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toBeUndefined();
    });

    it('rejects a page chain whose watermark changes before touching the DB', async () => {
        const db = createDb();
        await db.open();
        const invalid = pages();
        invalid[1] = { ...invalid[1]!, highWatermark: 13 };

        await expect(applySnapshotChain(
            db,
            invalid,
            { workspaceId: 'workspace-1' },
            'device-1'
        )).rejects.toThrow(
            'high-watermark changed'
        );
        expect(await db.messages.count()).toBe(0);
    });

    it('rejects contradictory row and tombstone entries before replacement mutation', async () => {
        const db = createDb();
        await db.open();
        await db.messages.put({
            id: 'existing-message',
            thread_id: 'thread-1',
            role: 'user',
            index: 1000,
            order_key: 'existing',
            data: { content: 'keep me' },
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });
        await db.sync_state.put({
            id: 'sync_state:workspace-1:default',
            cursor: 7,
            lastSyncAt: 1,
            deviceId: 'device-before',
        });

        const contradictory = pages();
        contradictory[1] = {
            ...contradictory[1]!,
            items: [
                {
                    kind: 'tombstone',
                    tableName: 'messages',
                    pk: 'message-1',
                    revision: {
                        clock: 2,
                        hlc: '2:0:device',
                        opId: 'op-delete-message-1',
                    },
                    serverDeletedAt: 2,
                },
            ],
        };

        await expect(
            applySnapshotChain(
                db,
                contradictory,
                { workspaceId: 'workspace-1' },
                'device-1',
                () => true,
                ['messages']
            )
        ).rejects.toThrow('contradictory');

        expect(await db.messages.toArray()).toEqual([
            expect.objectContaining({
                id: 'existing-message',
                data: { content: 'keep me' },
            }),
        ]);
        expect(
            await db.sync_state.get('sync_state:workspace-1:default')
        ).toMatchObject({ cursor: 7, deviceId: 'device-before' });
        expect(await db.tombstones.count()).toBe(0);
    });

    it('rolls back rows and watermark when the lifecycle is invalidated during apply', async () => {
        const db = createDb();
        await db.open();
        let checks = 0;

        await expect(applySnapshotChain(
            db,
            pages(),
            { workspaceId: 'workspace-1' },
            'device-1',
            () => ++checks < 2
        )).rejects.toMatchObject({ name: 'AbortError' });

        expect(await db.messages.count()).toBe(0);
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toBeUndefined();
    });

    it('suppresses local outbox capture while installing remote snapshot rows', async () => {
        const db = createDb();
        await db.open();
        const { getHookBridge } = await import('../hook-bridge');
        getHookBridge(db).start();

        await applySnapshotChain(
            db,
            pages(),
            { workspaceId: 'workspace-1' },
            'device-1'
        );

        expect(await db.pending_ops.count()).toBe(0);
    });

    it('normalizes wire fields before writing rows used by Dexie indexes', async () => {
        const db = createDb();
        await db.open();
        const postPages: SnapshotResponse[] = [{
            workspaceId: 'workspace-1',
            snapshotId: 'snapshot-posts',
            highWatermark: 13,
            items: [{
                kind: 'row',
                tableName: 'posts',
                pk: 'document-1',
                payload: {
                    id: 'document-1',
                    title: 'Synced document',
                    content: '',
                    post_type: 'doc',
                    deleted: false,
                    created_at: 1,
                    updated_at: 1,
                    clock: 2,
                    hlc: '2:0:remote',
                },
                revision: {
                    clock: 2,
                    hlc: '2:0:remote',
                    opId: 'op-document-1',
                },
            }],
            nextPageToken: null,
        }];

        await applySnapshotChain(
            db,
            postPages,
            { workspaceId: 'workspace-1' },
            'device-1'
        );

        expect(await db.posts.get('document-1')).toMatchObject({
            postType: 'doc',
            clock: 2,
            hlc: '2:0:remote',
            op_id: 'op-document-1',
        });
        expect(await db.posts.get('document-1')).not.toHaveProperty('post_type');
        expect(
            await db.posts.where('postType').equals('doc').count()
        ).toBe(1);
    });

    it('preserves built-in and plugin-excluded KV values while replacing stale synced keys', async () => {
        const db = createDb();
        await db.open();
        setHookEngine({
            _engine: {
                applyFiltersSync: (_name: string, names: string[]) => [...names, 'plugin.secret'],
            },
        } as unknown as Parameters<typeof setHookEngine>[0]);
        const kv = (name: string, value: string) => ({
            id: `kv:${name}`, name, value, deleted: false,
            created_at: 1, updated_at: 1, clock: 1,
        });
        await db.kv.bulkPut([
            kv('openrouter_api_key', 'secret'),
            kv('MODELS_CATALOG', 'cached'),
            kv('workspace.manager.cache', 'local'),
            kv('plugin.secret', 'plugin-local'),
            kv('stale.synced', 'old'),
        ]);
        await applySnapshotChain(db, [{
            workspaceId: 'workspace-1',
            snapshotId: 'kv-snapshot',
            highWatermark: 10,
            items: [{
                kind: 'row', tableName: 'kv', pk: 'kv:server.synced',
                payload: kv('server.synced', 'new'),
                revision: { clock: 2, hlc: '2:0:remote', opId: 'server-kv' },
            }],
            nextPageToken: null,
        }], { workspaceId: 'workspace-1' }, 'device-1', () => true, ['kv']);

        expect((await db.kv.get('kv:openrouter_api_key'))?.value).toBe('secret');
        expect((await db.kv.get('kv:MODELS_CATALOG'))?.value).toBe('cached');
        expect((await db.kv.get('kv:workspace.manager.cache'))?.value).toBe('local');
        expect((await db.kv.get('kv:plugin.secret'))?.value).toBe('plugin-local');
        expect(await db.kv.get('kv:stale.synced')).toBeUndefined();
        expect((await db.kv.get('kv:server.synced'))?.value).toBe('new');
    });

    it('preserves the built-in KV secret even when a plugin filter returns an empty list', async () => {
        const db = createDb();
        await db.open();
        setHookEngine({
            _engine: { applyFiltersSync: () => [] },
        } as unknown as Parameters<typeof setHookEngine>[0]);
        await db.kv.put({
            id: 'kv:openrouter_api_key', name: 'openrouter_api_key',
            value: 'secret', deleted: false, created_at: 1, updated_at: 1, clock: 1,
        });
        await applySnapshotChain(db, [{
            workspaceId: 'workspace-1', snapshotId: 'empty-kv',
            highWatermark: 10, items: [], nextPageToken: null,
        }], { workspaceId: 'workspace-1' }, 'device-1', () => true, ['kv']);

        expect((await db.kv.get('kv:openrouter_api_key'))?.value).toBe('secret');
    });

    it('atomically restores a local edit made after staging and keeps its wire fields indexed', async () => {
        const db = createDb();
        await db.open();
        const stager = new SnapshotStager(db, { workspaceId: 'workspace-1' }, ['posts']);
        await stager.start();
        const remotePost = {
            id: 'post-1', title: 'Remote', content: '', post_type: 'doc',
            deleted: false, created_at: 1, updated_at: 1, clock: 1,
        };
        await stager.appendPage({
            workspaceId: 'workspace-1', snapshotId: 'post-snapshot',
            highWatermark: 10, nextPageToken: null,
            items: [{
                kind: 'row', tableName: 'posts', pk: 'post-1',
                payload: remotePost,
                revision: { clock: 1, hlc: '1:0:remote', opId: 'remote-post' },
            }],
        });
        expect(await db.posts.get('post-1')).toBeUndefined();
        const localPost = {
            ...remotePost, title: 'Edited locally', postType: 'doc',
            clock: 2, hlc: '2:0:local', op_id: testUuid('local-post'),
        };
        await db.posts.put(localPost);
        await db.pending_ops.put({
            id: 'pending-post', tableName: 'posts', operation: 'put', pk: 'post-1',
            payload: { ...remotePost, title: 'Edited locally', clock: 2 },
            stamp: { clock: 2, hlc: '2:0:local', opId: testUuid('local-post'), deviceId: 'local' },
            createdAt: 2, attempts: 0, status: 'pending',
        });
        try {
            await stager.apply('device-1', () => true, ['posts']);
        } finally {
            await stager.dispose();
        }
        expect(await db.posts.get('post-1')).toMatchObject({
            title: 'Edited locally', postType: 'doc', clock: 2,
            hlc: '2:0:local', op_id: testUuid('local-post'),
        });
        expect(await db.posts.where('postType').equals('doc').count()).toBe(1);
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ cursor: 10 });
        expect(await db.snapshot_staging.count()).toBe(0);
    });

    it('replays pending operations for a requested table absent from an empty server snapshot', async () => {
        const db = createDb();
        await db.open();
        const stager = new SnapshotStager(db, { workspaceId: 'workspace-1' }, ['messages']);
        await stager.start();
        await stager.appendPage({
            workspaceId: 'workspace-1', snapshotId: 'empty-snapshot',
            highWatermark: 10, items: [], nextPageToken: null,
        });
        const local = {
            id: 'local-message', thread_id: 'thread-1', role: 'user' as const,
            index: 0, order_key: '2:0:local', data: { content: 'local' },
            deleted: false, created_at: 1, updated_at: 2, clock: 2,
            hlc: '2:0:local', op_id: testUuid('local-message-op'),
        };
        await db.messages.put(local);
        await db.pending_ops.bulkPut([
            {
                id: 'pending-local-put', tableName: 'messages', operation: 'put',
                pk: 'local-message', payload: local,
                stamp: { clock: 2, hlc: '2:0:local', opId: testUuid('local-message-op'), deviceId: 'local' },
                createdAt: 1, attempts: 0, status: 'pending',
            },
            {
                id: 'pending-local-delete', tableName: 'messages', operation: 'delete',
                pk: 'deleted-message', payload: { deleted_at: 2 },
                stamp: { clock: 3, hlc: '3:0:local', opId: testUuid('local-delete-op'), deviceId: 'local' },
                createdAt: 2, attempts: 0, status: 'pending',
            },
        ]);
        try {
            await stager.apply('device-1');
        } finally {
            await stager.dispose();
        }
        expect(await db.messages.get('local-message')).toMatchObject({ data: { content: 'local' } });
        expect(await db.tombstones.get('messages:deleted-message')).toMatchObject({
            clock: 3, opId: testUuid('local-delete-op'),
        });
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ cursor: 10 });
    });

    it('rejects a superseded staging generation without clearing the newer attempt', async () => {
        const db = createDb();
        await db.open();
        const scope = { workspaceId: 'workspace-1' };
        const oldStager = new SnapshotStager(db, scope, ['messages']);
        await oldStager.start();
        const oldPage = {
            ...pages()[0]!,
            snapshotId: 'old',
            nextPageToken: null,
        };
        await oldStager.appendPage(oldPage);

        const newStager = new SnapshotStager(db, scope, ['messages']);
        await newStager.start();
        const newPage = {
            ...pages()[1]!,
            snapshotId: 'new',
        };
        await newStager.appendPage(newPage);

        await expect(oldStager.apply('device-old', () => true, ['messages']))
            .rejects.toMatchObject({ name: 'AbortError' });
        await oldStager.dispose();
        expect(await db.snapshot_staging.count()).toBe(2); // sentinel + new row
        expect(await db.messages.count()).toBe(0);

        try {
            await expect(newStager.apply('device-new', () => true, ['messages']))
                .resolves.toBe(12);
        } finally {
            await newStager.dispose();
        }
        expect(await db.messages.get('message-1')).toBeUndefined();
        expect(await db.messages.get('message-2')).toBeDefined();
        expect(await db.sync_state.get('sync_state:workspace-1:default'))
            .toMatchObject({ cursor: 12, deviceId: 'device-new' });
    });
});


describe('snapshot recovery of unsynced local content', () => {
    const scope = { workspaceId: 'workspace-1' };

    function localMessage(id: string, content: string) {
        return {
            id, thread_id: 'thread-1', role: 'user' as const, index: 0,
            order_key: '2:0:local', data: { content }, deleted: false,
            created_at: 1, updated_at: 2, clock: 2, hlc: '2:0:local', op_id: testUuid(`${id}-op`),
        };
    }

    function localDocument(id: string, title: string) {
        return {
            id, title, content: '{"type":"doc"}', postType: 'doc', deleted: false,
            created_at: 1, updated_at: 2, clock: 2, hlc: '2:0:local', op_id: testUuid(`${id}-op`),
        };
    }

    function putOp(
        tableName: 'messages' | 'posts',
        row: { id: string; clock: number; hlc: string; op_id: string },
        overrides: Partial<PendingOp> = {}
    ): PendingOp {
        return {
            id: `pending-${row.id}`, tableName, operation: 'put', pk: row.id,
            payload: sanitizePayloadForSync(tableName, row, 'put'),
            stamp: { clock: row.clock, hlc: row.hlc, opId: row.op_id, deviceId: 'local' },
            createdAt: 5, attempts: 0, status: 'pending', ...overrides,
        };
    }

    async function recoverFromEmptySnapshot(db: Or3DB): Promise<void> {
        const stager = new SnapshotStager(db, scope, ['messages', 'posts']);
        await stager.start();
        await stager.appendPage({
            workspaceId: scope.workspaceId, snapshotId: 'empty', highWatermark: 20,
            items: [], nextPageToken: null,
        });
        try {
            await stager.apply('device-1', () => true, ['messages', 'posts']);
        } finally {
            await stager.dispose();
        }
    }

    it('keeps the message and document behind permanently failed operations', async () => {
        const db = createDb();
        await db.open();
        const message = localMessage('message-failed', 'unsent words');
        const document = localDocument('doc-failed', 'Unsent draft');
        await db.messages.put(message);
        await db.posts.put(document);
        await db.pending_ops.bulkPut([
            putOp('messages', message, { status: 'failed_permanent', failureKind: 'permanent' }),
            putOp('posts', document, { status: 'failed' }),
        ]);

        await recoverFromEmptySnapshot(db);

        expect(await db.messages.get('message-failed')).toMatchObject({ data: { content: 'unsent words' } });
        expect(await db.posts.get('doc-failed')).toMatchObject({ title: 'Unsent draft' });
        // The operations stay terminal so the user can still retry or discard them.
        expect((await db.pending_ops.get('pending-message-failed'))?.status).toBe('failed_permanent');
        expect((await db.pending_ops.get('pending-doc-failed'))?.status).toBe('failed');
    });

    it('does not resurrect content whose failed operation the user discarded', async () => {
        const db = createDb();
        await db.open();
        const message = localMessage('message-discarded', 'dropped on purpose');
        await db.messages.put(message);
        await db.pending_ops.put(putOp('messages', message, { status: 'discarded' }));

        await recoverFromEmptySnapshot(db);

        expect(await db.messages.get('message-discarded')).toBeUndefined();
    });

    it('quarantines corrupt operations and rebuilds them from the local rows', async () => {
        const db = createDb();
        await db.open();
        const message = localMessage('message-corrupt', 'still here');
        const document = localDocument('doc-corrupt', 'Still here too');
        await db.messages.put(message);
        await db.posts.put(document);
        const corruptMessage = putOp('messages', message, { payload: undefined });
        const corruptDocument = putOp('posts', document, { payload: { id: 'doc-corrupt' } });
        await db.pending_ops.bulkPut([corruptMessage, corruptDocument]);

        await recoverFromEmptySnapshot(db);

        expect(await db.messages.get('message-corrupt')).toMatchObject({ data: { content: 'still here' } });
        expect(await db.posts.get('doc-corrupt')).toMatchObject({ title: 'Still here too' });
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ cursor: 20 });

        const entries = await db.sync_quarantine.toArray();
        expect(entries.map((entry) => entry.id).sort()).toEqual(['pending-doc-corrupt', 'pending-message-corrupt']);
        for (const entry of entries) {
            expect(entry.status).toBe('repaired');
            expect(entry.source).toBe('snapshot_apply');
            expect(entry.diagnostics.length).toBeGreaterThan(0);
            expect(entry.repairedOpId).toBeTruthy();
        }
        // The original operation is preserved verbatim, not merely counted.
        expect(entries.find((entry) => entry.id === 'pending-doc-corrupt')?.op).toMatchObject({ payload: { id: 'doc-corrupt' } });

        // Recovery work replaces the corrupt operation and never reuses its identity.
        const queued = await db.pending_ops.toArray();
        expect(queued.map((op) => op.id)).not.toContain('pending-message-corrupt');
        expect(queued).toHaveLength(2);
        for (const op of queued) {
            expect(op.status).toBe('pending');
            expect(op.stamp.opId).not.toBe(testUuid(`${op.pk}-op`));
            const row = op.tableName === 'messages'
                ? await db.messages.get(op.pk)
                : await db.posts.get(op.pk);
            expect(row?.op_id).toBe(op.stamp.opId);
            expect(row?.hlc).toBe(op.stamp.hlc);
        }
    });

    it('keeps ambiguous corrupt operations quarantined and exportable without blocking the snapshot', async () => {
        const db = createDb();
        await db.open();
        const message = localMessage('message-orphan', 'no local row');
        await db.pending_ops.put(putOp('messages', message, { payload: undefined }));

        await recoverFromEmptySnapshot(db);

        const entry = await db.sync_quarantine.get('pending-message-orphan');
        expect(entry).toMatchObject({ status: 'quarantined', tableName: 'messages', pk: 'message-orphan' });
        expect(entry?.op).toMatchObject({ id: 'pending-message-orphan', operation: 'put' });
        expect(await db.pending_ops.get('pending-message-orphan')).toBeUndefined();
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ cursor: 20 });
    });

    it('applies quarantine retention after a committed recovery', async () => {
        const db = createDb();
        await db.open();
        const now = Date.now();
        await db.sync_quarantine.bulkPut(Array.from({ length: 205 }, (_, i) => ({
            id: `resolved-${i}`, tableName: 'messages', pk: `resolved-${i}`, status: 'repaired' as const,
            source: 'snapshot_apply' as const, op: {}, diagnostics: ['x'], quarantinedAt: 1, resolvedAt: now - i,
        })));

        await recoverFromEmptySnapshot(db);

        expect(await db.sync_quarantine.count()).toBe(200);
    });

    it('leaves intact operations exactly as queued', async () => {
        const db = createDb();
        await db.open();
        const message = localMessage('message-intact', 'fine');
        await db.messages.put(message);
        const op = putOp('messages', message);
        await db.pending_ops.put(op);

        await recoverFromEmptySnapshot(db);

        expect(await db.pending_ops.get(op.id)).toMatchObject({ stamp: op.stamp, status: 'pending' });
        expect(await db.sync_quarantine.count()).toBe(0);
        expect(await db.messages.get('message-intact')).toMatchObject({ op_id: testUuid('message-intact-op') });
    });
});
