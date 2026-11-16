import Dexie from 'dexie';
import legacySchema from './fixtures/legacy-v31-schema.json';
import { HookBridge as LegacyHookBridge } from './fixtures/legacy-v31-hook-bridge';
import { getWriteTxTableNames } from '~/db/util';
import { ConflictResolver } from '../conflict-resolver';
import { discardQuarantined, exportQuarantined, listQuarantined, recoverHistoryPut } from '../sync-quarantine';
import { getSyncStateId, CursorManager } from '../cursor-manager';
import { readHistory, requestHistoryReset } from '../history-incarnation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Or3DB, databaseRecovery } from '~/db/client';
import type { SnapshotResponse, SyncProvider } from '~~/shared/sync/types';
import { applySnapshotChain, SnapshotStager } from '../snapshot-applier';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testUuid } from './sync-test-utils';
import type { PendingOp } from '~~/shared/sync/types';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { makeAssistantPersister } from '~/utils/chat/useAi-internal/persistence';
import { getHookBridge } from '../hook-bridge';
import { OutboxManager } from '../outbox-manager';
import { ThreadSchema } from '~/db/schema';
import type { StoredMessage } from '~/utils/chat/useAi-internal/types';

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
    it('quarantines malformed and unknown incoming rows durably while applying healthy siblings', async () => {
        const db = createDb(); await db.open();
        const row = pages()[0]!.items[0]!;
        if (row.kind !== 'row') throw new Error('fixture');
        const stamp = { ...row.revision, deviceId: 'remote', opId: testUuid('incoming') };
        const resolver = new ConflictResolver(db);
        await resolver.applyChanges([
            { tableName: 'messages', pk: 'bad', op: 'put', serverVersion: 1, stamp, payload: {} },
            { tableName: 'unknown', pk: 'unknown', op: 'delete', serverVersion: 2, stamp: { ...stamp, opId: testUuid('unknown') } },
            { tableName: 'messages', pk: 'oversized', op: 'put', serverVersion: 4, stamp, payload: { ...(row.payload as object), data: { content: 'x'.repeat(256 * 1024) } } },
            { tableName: 'messages', pk: row.pk, op: 'put', serverVersion: 3, stamp: { ...stamp, opId: testUuid('healthy') }, payload: row.payload },
        ]);
        expect(await db.messages.count()).toBe(1);
        expect(await db.sync_quarantine.count()).toBe(3);
        expect(JSON.parse(await exportQuarantined(db)).entries).toEqual(expect.arrayContaining([
            expect.objectContaining({ variant: 'incoming', pk: 'bad', status: 'quarantined' }),
            expect.objectContaining({ variant: 'incoming', tableName: 'unknown' }),
        ]));
        expect(await db.pending_ops.count()).toBe(0);
    });

    it.each(['server marker', 'client defect'] as const)('preserves rows, tombstones and pending intent for %s in a final all-unavailable snapshot', async mode => {
        const db = createDb(); await db.open();
        const local = { id: 'affected', name: 'affected', value: 'last good', deleted: false, created_at: 1, updated_at: 1, clock: 2 };
        const tombstone = { id: 'kv:affected', tableName: 'kv', pk: 'affected', deletedAt: 1, clock: 3, hlc: 'h', opId: 'legacy' };
        await db.kv.put(local);
        await db.tombstones.put(tombstone);
        const op: PendingOp = { id: 'intent', tableName: 'kv', pk: 'affected', operation: 'put', payload: local,
            stamp: { clock: 2, hlc: 'h', opId: testUuid('intent'), deviceId: 'local' }, createdAt: 1, attempts: 0, status: 'pending' };
        await db.pending_ops.put(op);
        const page: SnapshotResponse = { workspaceId: 'workspace-1', snapshotId: 'unavailable', highWatermark: 12, nextPageToken: null,
            items: mode === 'client defect' ? [{ kind: 'tombstone', tableName: 'kv', pk: 'affected',
                revision: { clock: -1, hlc: 'h', opId: 'bad' }, serverDeletedAt: 2 }] : [],
            ...(mode === 'server marker' ? { unavailable: [{ tableName: 'kv', pk: 'affected', originalKind: 'tombstone',
                snapshotId: 'unavailable', highWatermark: 12, evidenceRef: 'e1', reason: 'invalid_revision' }] } : {}) };
        await applySnapshotChain(db, [page], { workspaceId: 'workspace-1' }, 'device', () => true, ['kv']);
        expect(await db.kv.get('affected')).toEqual(local);
        expect(await db.tombstones.get('kv:affected')).toEqual(tombstone);
        expect(await db.pending_ops.get('intent')).toEqual(op);
        expect(await db.sync_quarantine.toArray()).toEqual([expect.objectContaining({ variant: 'incoming', localRow: local,
            localTombstone: tombstone, pendingIntent: [op], status: 'quarantined' })]);
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ cursor: 12 });
        expect(await db.snapshot_staging.count()).toBe(0);
    });

    it.each(['edit', 'delete'] as const)('preserves current local state when reinstalling the same unavailable snapshot after a local %s', async change => {
        const db = createDb(); await db.open();
        const original = { id: 'affected', name: 'affected', value: 'first copy', deleted: false, created_at: 1, updated_at: 1, clock: 1 };
        await db.kv.put(original);
        const page: SnapshotResponse = { workspaceId: 'workspace-1', snapshotId: 'reused', highWatermark: 12,
            items: [], nextPageToken: null, unavailable: [{ tableName: 'kv', pk: original.id, originalKind: 'row',
                snapshotId: 'reused', highWatermark: 12, evidenceRef: 'e1', reason: 'invalid_payload' }] };
        const install = () => applySnapshotChain(db, [page], { workspaceId: 'workspace-1' }, 'device', () => true, ['kv']);
        await install();
        const current = change === 'edit' ? { ...original, value: 'new local edit', clock: 2 } : undefined;
        const tombstone = { id: 'kv:affected', tableName: 'kv', pk: original.id, clock: 3, hlc: 'h', opId: testUuid('deleted'), deletedAt: 2 };
        if (current) await db.kv.put(current);
        else await db.kv.delete(original.id);
        await db.tombstones.put(tombstone);
        await install();
        expect(await db.kv.get(original.id)).toEqual(current);
        expect(await db.tombstones.get(tombstone.id)).toEqual(tombstone);
        expect(await db.sync_quarantine.count()).toBe(1);
        expect((await db.sync_quarantine.toArray())[0]!.localRow).toEqual(original);
    });

    it.each(['absent', 'older', 'expired lease'] as const)('preserves unqueued foreground progress through replacement (%s) and can finalize it', async canonical => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const db = createDb(); await db.open();
        const thread = ThreadSchema.parse({ id: 'thread-1', title: 'Chat', created_at: 1, updated_at: 1, clock: 1 });
        await db.threads.put(thread);
        const bridge = getHookBridge(db); bridge.start();
        const pending: StoredMessage = { id: 'foreground', thread_id: thread.id, role: 'assistant',
            index: 3, order_key: '3:0:local', pending: true, deleted: false,
            created_at: 1, updated_at: 3, clock: 3, hlc: '3:0:local',
            data: { content: 'saved partial', reasoning_text: 'private reasoning',
                generation_id: 'request', generation_lease_id: 'request',
                generation_heartbeat_at: canonical === 'expired lease' ? 1 : Date.now() } };
        await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => db.messages.put(pending));
        expect(await db.pending_ops.count()).toBe(0);
        const items: SnapshotResponse['items'] = [];
        if (canonical === 'older') items.push({ kind: 'row', tableName: 'messages', pk: pending.id,
            payload: { ...pending, pending: false, data: { content: 'previous completed turn' }, clock: 1, hlc: '1:0:remote' },
            revision: { clock: 1, hlc: '1:0:remote', opId: testUuid('previous-turn') } });
        items.push({ kind: 'row', tableName: 'threads', pk: thread.id, payload: thread,
            revision: { clock: 1, hlc: '1:0:remote', opId: testUuid('thread') } });
        await applySnapshotChain(db, [{ workspaceId: 'workspace-1', snapshotId: 'foreground-snapshot',
            highWatermark: 12, nextPageToken: null, items }], { workspaceId: 'workspace-1' }, 'device-1',
            () => true, ['messages', 'threads']);
        expect(await db.messages.get(pending.id)).toEqual(pending);
        expect(await db.pending_ops.count()).toBe(0);
        const persist = makeAssistantPersister(db, pending, [], 'request');
        await persist({ content: 'saved partial and more' });
        expect((await db.messages.get(pending.id))?.data).toMatchObject({ content: 'saved partial and more' });
        await persist({ content: 'saved partial and more', finalize: true });
        expect(await db.messages.get(pending.id)).toMatchObject({ pending: false, data: { content: 'saved partial and more' } });
        expect(await db.pending_ops.toArray()).toEqual([expect.objectContaining({ tableName: 'messages', pk: pending.id })]);
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ cursor: 12 });
        bridge.stop();
    });

    it.each(['newer reply', 'message tombstone', 'thread tombstone', 'missing thread', 'background', 'superseded'] as const)(
        'does not restore local foreground rows over %s', async scenario => {
            const db = createDb(); await db.open();
            const thread = ThreadSchema.parse({ id: 'thread-1', created_at: 1, updated_at: 1, clock: 1 });
            await db.threads.put(thread);
            const local: StoredMessage = { id: 'foreground', thread_id: thread.id, role: 'assistant',
                index: 3, pending: true, deleted: false, created_at: 1, updated_at: 3, clock: 3, hlc: '3:0:local',
                data: { content: 'local partial', generation_lease_id: 'request',
                    ...(scenario === 'background' ? { background_job_id: 'job' } : {}),
                    ...(scenario === 'superseded' ? { generation_state: 'superseded' } : {}) } };
            await db.messages.put(local);
            const items: SnapshotResponse['items'] = [];
            const revision = { clock: 4, hlc: '4:0:remote', opId: testUuid('canonical-newer') };
            if (scenario === 'newer reply') items.push({ kind: 'row', tableName: 'messages', pk: local.id,
                payload: { ...local, clock: 4, hlc: revision.hlc, pending: false, data: { content: 'new canonical reply' } }, revision });
            if (scenario === 'message tombstone') items.push({ kind: 'tombstone', tableName: 'messages', pk: local.id,
                serverDeletedAt: 4, revision });
            if (scenario === 'thread tombstone') items.push({ kind: 'tombstone', tableName: 'threads', pk: thread.id,
                serverDeletedAt: 4, revision });
            else if (scenario !== 'missing thread') items.push({ kind: 'row', tableName: 'threads', pk: thread.id, payload: thread,
                revision: { clock: 1, hlc: '1:0:remote', opId: testUuid('thread') } });
            await applySnapshotChain(db, [{ workspaceId: 'workspace-1', snapshotId: 'canonical', highWatermark: 12,
                nextPageToken: null, items }], { workspaceId: 'workspace-1' }, 'device-1', () => true, ['messages', 'threads']);
            if (scenario === 'newer reply') expect(await db.messages.get(local.id)).toMatchObject({ pending: false, data: { content: 'new canonical reply' } });
            else expect(await db.messages.get(local.id)).toBeUndefined();
            if (scenario.endsWith('tombstone')) expect(await db.tombstones.count()).toBe(1);
            expect(await db.pending_ops.count()).toBe(0);
        }
    );

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

describe('P0-5 history replacement', () => {
    it.each([0, 99, 100, 120].flatMap(cursor => [80, 105].map(watermark => [cursor, watermark] as const)))('holds old intent at I/%i and installs J/%i regardless of numeric comparison', async (cursor, watermark) => {
        const db = createDb(); await db.open();
        await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'I', phase: 'resetting', resetTarget: 'J', cursor: 0, lastSyncAt: 0, deviceId: '' });
        await db.sync_state.put({ id: 'sync_state:workspace-1:default', historyIncarnation: 'I', cursor, lastSyncAt: 1, deviceId: 'd' });
        await db.kv.put({ id: 'acknowledged', name: 'acknowledged', value: 'old', deleted: false, created_at: 1, updated_at: 1, clock: 1 });
        const stager = new SnapshotStager(db, { workspaceId: 'workspace-1' }); await stager.start();
        await stager.appendPage({ historyIncarnation: 'J', workspaceId: 'workspace-1', snapshotId: 'j', highWatermark: watermark, items: [], nextPageToken: null });
        const original = { id: 'lost-ack', tableName: 'messages', pk: 'orphan', operation: 'delete', stamp: { opId: testUuid('lost-ack'), deviceId: 'd', clock: 2, hlc: '2:d' }, createdAt: 1, attempts: 1, status: 'in_flight', claimId: 'claim' } as PendingOp;
        await db.pending_ops.put(original);
        await stager.apply('d', () => true, ['kv', 'messages']);
        expect(await db.pending_ops.count()).toBe(0);
        expect(await db.kv.get('acknowledged')).toBeUndefined();
        expect(await db.sync_quarantine.toArray()).toEqual(expect.arrayContaining([
            expect.objectContaining({ variant: 'history_reset', sourceIncarnation: 'I', op: original }),
            expect.objectContaining({ variant: 'history_reset', sourceIncarnation: 'I', localRow: expect.objectContaining({ value: 'old' }) }),
        ]));
        expect(await db.sync_state.get('sync_history')).toMatchObject({ historyIncarnation: 'J', phase: 'ready' });
        expect(await db.sync_state.get('sync_state:workspace-1:default')).toMatchObject({ historyIncarnation: 'J', cursor: watermark });
    });
    it.each(['I', null])('holds the full durable set from %s, clears other scope coverage, and keeps principal evidence private', async incarnation => {
        const db = createDb(); await db.open();
        const scope = { workspaceId: 'workspace-1', principalId: 'owner' };
        const other = { ...scope, principalId: 'other' };
        await db.sync_state.bulkPut([
            { id: 'sync_history', historyIncarnation: incarnation, phase: 'resetting', resetTarget: 'J', cursor: 0, lastSyncAt: 0, deviceId: 'd' },
            { id: getSyncStateId(other), historyIncarnation: incarnation, cursor: 120, lastSyncAt: 1, deviceId: 'd' },
        ]);
        const originals: PendingOp[] = ['pending', 'in_flight', 'retry_wait', 'failed_retryable', 'failed_permanent'].map((status, i) => ({
            id: `original-${i}`, tableName: 'messages', pk: `orphan-${i}`, operation: i === 2 ? 'delete' : 'put',
            payload: i === 2 ? undefined : { id: `orphan-${i}`, thread_id: 'parent-only-in-discarded-history', content: 'original' },
            stamp: { opId: testUuid(`original-${i}`), deviceId: 'd', clock: i + 1, hlc: `${i + 1}:d` },
            createdAt: 1, attempts: i, status: status as PendingOp['status'], claimId: status === 'in_flight' ? 'lost-ack' : undefined,
            nextAttemptAt: 99, lastError: 'original failure',
        }));
        await db.pending_ops.bulkPut(originals);
        await db.table('messages').bulkPut([
            { id: 'acknowledged', thread_id: 'old-parent', data: { content: 'saved acknowledged content' }, pending: false },
            { id: 'streaming', thread_id: 'old-parent', data: { content: 'saved partial generation' }, pending: true },
        ]);
        await db.table('tombstones').put({ id: 'messages:deleted', tableName: 'messages', pk: 'deleted', clock: 3 });
        await db.table('file_transfers').put({ id: 'upload', hash: 'attachment', state: 'uploading' });
        await db.table('notifications').put({ id: 'private-other', user_id: 'other', content: 'other account' });
        const existing = { id: 'previous-hold', variant: 'history_reset' as const, sourceIncarnation: 'earlier', tableName: 'kv', pk: 'old', accountId: 'owner',
            source: 'snapshot_apply' as const, status: 'quarantined' as const, op: { original: true }, diagnostics: [], quarantinedAt: 1 };
        await db.sync_quarantine.put(existing);
        const stager = new SnapshotStager(db, scope); await stager.start();
        await stager.appendPage({ historyIncarnation: 'J', workspaceId: scope.workspaceId, snapshotId: 'j', highWatermark: 105, items: [], nextPageToken: null });
        await stager.apply('d');
        const held = await db.sync_quarantine.toArray();
        for (const original of originals) expect(held).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceIncarnation: incarnation ?? 'unknown', op: original }),
        ]));
        for (const pk of ['acknowledged', 'streaming', 'deleted', 'upload']) expect(held.some(entry => entry.pk === pk)).toBe(true);
        expect(await db.sync_quarantine.get(existing.id)).toEqual(existing);
        expect(await db.pending_ops.count()).toBe(0); expect(await db.file_transfers.count()).toBe(0);
        expect(await db.sync_state.get(getSyncStateId(other))).toBeUndefined();
        expect(await db.sync_state.get(getSyncStateId(scope))).toMatchObject({ historyIncarnation: 'J', cursor: 105 });
        const privateEntry = held.find(entry => entry.pk === 'private-other')!;
        expect(await listQuarantined(db, 'owner')).not.toContainEqual(privateEntry);
        expect(await listQuarantined(db, 'other')).toContainEqual(privateEntry);
        expect(await discardQuarantined(db, privateEntry.id, 'owner')).toBe(false);
        expect(await recoverHistoryPut(db, { pull: async () => ({ historyIncarnation: 'J', changes: [], nextCursor: 105, hasMore: false }) } as unknown as SyncProvider,
            scope, privateEntry.id, 'J')).toBe(false);
        expect(JSON.parse(await exportQuarantined(db, 'owner')).entries).toEqual(await listQuarantined(db, 'owner'));
    });
    it('lets only the latest competing installer commit and retains its held evidence after stale disposal', async () => {
        const db = createDb(); await db.open();
        await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'I', phase: 'resetting', resetTarget: 'J', cursor: 0, lastSyncAt: 0, deviceId: 'd' });
        await db.kv.put({ id: 'original', name: 'original', value: 'saved', deleted: false, created_at: 1, updated_at: 1, clock: 1 });
        const first = new SnapshotStager(db, { workspaceId: 'workspace-1', principalId: 'owner' }); await first.start();
        const page = { historyIncarnation: 'J', workspaceId: 'workspace-1', snapshotId: 'j', highWatermark: 80, items: [], nextPageToken: null };
        await first.appendPage(page);
        const winner = new SnapshotStager(db, { workspaceId: 'workspace-1', principalId: 'other' }); await winner.start(); await winner.appendPage(page);
        await expect(first.apply('old')).rejects.toMatchObject({ name: 'AbortError' });
        await winner.apply('winner'); const evidence = await db.sync_quarantine.toArray();
        await first.dispose(); await expect(first.apply('old')).rejects.toMatchObject({ name: 'AbortError' });
        expect(await db.sync_quarantine.toArray()).toEqual(evidence);
        expect(evidence).toEqual(expect.arrayContaining([expect.objectContaining({ localRow: expect.objectContaining({ value: 'saved' }) })]));
        expect(await db.sync_state.get('sync_history')).toMatchObject({ historyIncarnation: 'J', phase: 'ready' });
        expect(await db.sync_state.get(getSyncStateId({ workspaceId: 'workspace-1', principalId: 'other' }))).toMatchObject({ cursor: 80, deviceId: 'winner' });
    });
    it('rejects a chain that changes incarnation even with identical snapshot ID and watermark', async () => {
        const db = createDb(); await db.open();
        const stager = new SnapshotStager(db, { workspaceId: 'workspace-1' }); await stager.start();
        const page = { ...pages()[0]!, historyIncarnation: 'I' }; await stager.appendPage(page);
        await expect(stager.appendPage({ ...pages()[1]!, historyIncarnation: 'J' })).rejects.toThrow(/history|incarnation/i);
        expect(await db.messages.count()).toBe(0);
    });
});


describe('P0-5 durable reset failures', () => {
    it('holds file metadata by hash across bounded archive pages', async () => {
        const db = createDb(); await db.open();
        await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'I', phase: 'resetting', resetTarget: 'J', cursor: 0, lastSyncAt: 0, deviceId: '' });
        await db.table('file_meta').bulkPut(Array.from({ length: 203 }, (_, i) => ({ hash: `hash-${String(i).padStart(3, '0')}`, name: 'file', deleted: false })));
        const stager = new SnapshotStager(db, { workspaceId: 'workspace-1' }); await stager.start();
        await stager.appendPage({ historyIncarnation: 'J', workspaceId: 'workspace-1', snapshotId: 'j', highWatermark: 80, items: [], nextPageToken: null });
        await stager.apply('d');
        const held = await db.sync_quarantine.toArray();
        expect(held.filter(row => row.tableName === 'file_meta')).toHaveLength(203);
        expect(held.some(row => row.pk === 'hash-202')).toBe(true);
    });
    it('rolls back archive, canonical replacement and cursor on quota while keeping reset closed', async () => {
        const db = createDb(); await db.open();
        const guard = { id: 'sync_history', historyIncarnation: 'I', phase: 'resetting' as const, resetTarget: 'J', cursor: 0, lastSyncAt: 0, deviceId: '' };
        await db.sync_state.put(guard);
        await db.kv.put({ id: 'old', name: 'old', value: 'bytes', deleted: false, created_at: 1, updated_at: 1, clock: 1 });
        const stager = new SnapshotStager(db, { workspaceId: 'workspace-1' }); await stager.start();
        await stager.appendPage({ historyIncarnation: 'J', workspaceId: 'workspace-1', snapshotId: 'j', highWatermark: 80, items: [], nextPageToken: null });
        const quota = () => { throw new DOMException('quota', 'QuotaExceededError'); };
        db.sync_quarantine.hook('creating', quota);
        await expect(stager.apply('d')).rejects.toMatchObject({ name: 'QuotaExceededError' });
        db.sync_quarantine.hook('creating').unsubscribe(quota);
        expect((await db.kv.get('old'))?.value).toBe('bytes');
        expect(await db.sync_quarantine.count()).toBe(0);
        expect(await db.sync_state.get('sync_history')).toEqual(guard);
        await stager.apply('d');
        expect(await db.sync_state.get('sync_history')).toMatchObject({ historyIncarnation: 'J', phase: 'ready' });
    });
    it('does not let a delayed old mismatch reset an installed new history', async () => {
        const { requestHistoryReset } = await import('../history-incarnation');
        const db = createDb(); await db.open();
        await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'J', phase: 'ready', resetTarget: null, cursor: 0, lastSyncAt: 0, deviceId: '' });
        expect(await requestHistoryReset(db, { historyIncarnation: 'I', phase: 'ready', resetTarget: null }, 'K')).toBe(false);
        expect(await db.sync_state.get('sync_history')).toMatchObject({ historyIncarnation: 'J', phase: 'ready' });
    });
});


describe('P0-5 browser connection boundaries', () => {
    it('fences an unmarked upgraded connection before engine initialization', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const db = createDb(); const old = new Dexie(db.name);
        old.version(31).stores(legacySchema); await old.open();
        await old.table('kv').put({ id: 'unknown', name: 'unknown', value: 'old view', clock: 1, deleted: false, created_at: 1, updated_at: 1 });
        old.close(); await db.open(); getHookBridge(db).start();
        const stager = new SnapshotStager(db, { workspaceId: db.name }); await stager.start();
        await stager.appendPage({ historyIncarnation: 'I', workspaceId: db.name, snapshotId: 'first', highWatermark: 0, items: [], nextPageToken: null });
        await stager.apply('local');
        await expect(db.transaction('rw', getWriteTxTableNames(db, 'kv'), () => db.kv.put({
            id: 'unknown', name: 'unknown', value: 'stale editor completion', clock: 2, deleted: false, created_at: 1, updated_at: 2,
        }))).rejects.toMatchObject({ name: 'AbortError' });
        expect(await db.kv.get('unknown')).toBeUndefined();
        expect(await db.pending_ops.count()).toBe(0);
        expect(await db.sync_quarantine.toArray()).toContainEqual(expect.objectContaining({ variant: 'history_reset', pk: 'unknown' }));
        expect((await readHistory(db)).firstBindEligible).not.toBe(true);
    });

    it('aborts stale local editor and foreground-generation writes after atomic installation', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const db = createDb(); await db.open();
        db.syncHistoryAtOpen = 'I'; getHookBridge(db).start();
        await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'I', phase: 'ready', resetTarget: null, cursor: 0, lastSyncAt: 0, deviceId: '' });
        const write = () => db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => db.messages.put({ id: 'stale', thread_id: 'thread-1', role: 'assistant', index: 0, order_key: '2:0:local', data: { content: 'old generation' }, pending: true, deleted: false, created_at: 1, updated_at: 2, clock: 2, hlc: '2:0:local', op_id: testUuid('stale') }));
        await write();
        await db.transaction('rw', db.sync_state, db.messages, db.pending_ops, async tx => {
            getHookBridge(db).markSyncTransaction(tx);
            await db.messages.clear(); await db.pending_ops.clear();
            await db.sync_state.update('sync_history', { historyIncarnation: 'J' });
        });
        await expect(write()).rejects.toMatchObject({ name: 'AbortError' });
        expect(await db.messages.get('stale')).toBeUndefined();
        expect(await db.pending_ops.count()).toBe(0);
    });
    it('waits for an old schema connection without clearing intent, then rejects its old native version', async () => {
        const db = createDb();
        const schema = legacySchema;
        const old = new Dexie(db.name); old.version(30).stores(schema);
        await old.open();
        await old.table('pending_ops').put({ id: 'legacy', status: 'pending', payload: { original: true } });
        old.on('versionchange', () => false);
        let blocked = false; db.on('blocked', () => { blocked = true; });
        const upgrade = db.open();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(blocked).toBe(true);
        expect(await old.table('pending_ops').count()).toBe(1);
        old.close(); await upgrade;
        expect(await db.sync_state.get('sync_history')).toMatchObject({ phase: 'unbound', historyIncarnation: null });
        expect((await readHistory(db)).firstBindEligible).not.toBe(true);
        expect(await db.pending_ops.get('legacy')).toMatchObject({ payload: { original: true } });
        const nativeReopen = new Promise((resolve, reject) => {
            const request = indexedDB.open(db.name, 300);
            request.onsuccess = () => { request.result.close(); resolve(undefined); };
            request.onerror = () => reject(request.error);
        });
        await expect(nativeReopen).rejects.toMatchObject({ name: 'VersionError' });
    });
});

// The frozen v31 schema and capture hooks are the actual pre-fence application,
// including streaming-without-an-op and sync-marked remote writes.
it('P0-5.9 reopened legacy Dexie cannot mutate, coalesce or launder installed history', async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    const db = createDb(); const old = new Dexie(db.name);
    old.version(31).stores(legacySchema);
    const bridge = new LegacyHookBridge(old as Or3DB); bridge.start({ coalesceUnsent: true });
    const versions: number[] = [];
    const nativeOpen = indexedDB.open.bind(indexedDB);
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
        const request = nativeOpen(...args);
        request.addEventListener('upgradeneeded', () => versions.push(request.result.version));
        return request;
    });
    try {
        await old.open(); old.close(); await db.open();
        expect((await readHistory(db)).firstBindEligible).not.toBe(true);
        await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'J', phase: 'ready', resetTarget: null, cursor: 80, deviceId: 'new', lastSyncAt: 1 });
        const row = { id: 'current', name: 'current', value: 'J', deleted: false, clock: 1, hlc: '1:0:new', created_at: 1, updated_at: 1 };
        await db.kv.put(row);
        await db.pending_ops.put({ id: 'current-op', tableName: 'kv', pk: 'current', operation: 'put', payload: row, status: 'pending', attempts: 0, createdAt: 1,
            stamp: { deviceId: 'new', opId: testUuid('J-op'), clock: 1, hlc: '1:0:new' } });
        await db.sync_quarantine.put({ id: 'evidence', tableName: 'kv', pk: 'current', source: 'manual', status: 'quarantined', op: { original: true }, diagnostics: [], quarantinedAt: 1 });
        await db.file_blobs.put({ hash: 'held-attachment', blob: new Blob(['immutable attachment']) });
        const state = () => Promise.all([db.kv.toArray(), db.messages.toArray(), db.pending_ops.toArray(), db.sync_state.toArray(), db.tombstones.toArray(), db.sync_quarantine.toArray(), db.file_blobs.toArray()]);
        const before = await state();
        // Dexie 4.4.6 is allowed to reopen without the declared version.
        await old.open();
        const scope = ['kv', 'messages', 'pending_ops', 'tombstones', 'sync_state'];
        const attempts = [
            () => old.transaction('rw', scope, () => old.table('kv').put({ ...row, value: 'stale', clock: 999 })),
            () => old.transaction('rw', scope, () => old.table('kv').delete('current')),
            () => old.transaction('rw', scope, () => old.table('messages').put({ id: 'stream', thread_id: 'thread', pending: true, data: { content: 'old stream' } })),
            () => old.transaction('rw', scope, async tx => {
                bridge.markSyncTransaction(tx);
                await old.table('kv').put({ ...row, value: 'late remote', clock: 999 });
                await old.table('pending_ops').clear();
            }),
            () => old.table('pending_ops').put({ id: 'injected', tableName: 'kv', pk: 'current', status: 'pending' }),
            () => old.table('sync_quarantine').delete('evidence'),
            () => old.table('file_blobs').delete('held-attachment'),
        ];
        for (const attempt of attempts) {
            // Dexie may recreate isolated legacy stores. Success or rejection is
            // immaterial; no write may reach current state.
            await Promise.resolve(attempt()).catch(() => undefined);
            expect(await state()).toEqual(before);
        }
        expect(await old.table('kv').get('current')).toMatchObject({ value: 'late remote' });
        // Coexisting/reopened clients must stabilize, not patch each other forever.
        for (let cycle = 0; cycle < 4; cycle++) {
            old.close(); await old.open(); db.close(); await db.open();
            await old.table('pending_ops').put({ id: `sink-${cycle}`, status: 'pending', payload: { value: 'never publish' } });
            await db.kv.put({ ...row, updated_at: cycle + 2 });
            expect(await db.pending_ops.count()).toBe(1);
            expect(await db.sync_state.get('sync_history')).toEqual(before[3]![0]);
            expect(await db.sync_quarantine.toArray()).toEqual(before[5]);
        }
        expect(versions).toEqual([310, 320, 321]);
        // A legitimate current edit cannot inherit stale fields/publication.
        db.syncHistoryAtOpen = 'J'; getHookBridge(db).start();
        await db.transaction('rw', getWriteTxTableNames(db, 'kv'), () => db.kv.update('current', { updated_at: 2 }));
        const queued = await db.pending_ops.toArray();
        expect(queued.every(op => (op.payload as { value?: string })?.value === 'J')).toBe(true);
        expect(await db.messages.count()).toBe(0);
        const published: PendingOp[] = [];
        const provider = { id: 'fence-proof', capabilities: { historyIncarnation: 'v1' }, push: async (batch: { ops: PendingOp[] }) => {
            published.push(...batch.ops);
            return { historyIncarnation: 'J', serverVersion: 81, results: batch.ops.map(op => ({ opId: op.stamp.opId, success: true })) };
        } } as unknown as SyncProvider;
        const manager = new OutboxManager(db, provider, { workspaceId: db.name });
        try { await manager.flush(); } finally { await manager.stop(); }
        expect(published.length).toBeGreaterThan(0);
        expect(published.every(op => (op.payload as { value?: string })?.value === 'J')).toBe(true);
        expect(await old.table('pending_ops').count()).toBeGreaterThan(0);
    } finally { spy.mockRestore(); bridge.stop(); old.close(); }
});

it('clears a later open failure on explicit retry after the one-shot ready hook has run', async () => {
    const db = createDb(); await db.open(); db.close();
    const unavailable = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('Storage temporarily unavailable', 'SecurityError');
    });
    try { await expect(db.open()).rejects.toBeDefined(); } finally { unavailable.mockRestore(); }
    expect(databaseRecovery.value?.phase).toBe('failed');
    await db.open();
    expect(databaseRecovery.value).toBeNull();
});

it('keeps a blocked workspace recoverable while another workspace finishes upgrading', async () => {
    const first = createDb(); const second = createDb();
    const oldFirst = new Dexie(first.name); oldFirst.version(31).stores(legacySchema);
    const oldSecond = new Dexie(second.name); oldSecond.version(31).stores(legacySchema);
    await oldFirst.open(); await oldSecond.open(); oldSecond.close();
    oldFirst.on('versionchange', () => false);
    const blocked = new Promise<void>(resolve => { first.on('blocked', () => resolve()); });
    const opening = first.open();
    try {
        await blocked;
        expect(databaseRecovery.value?.db).toBe(first);
        await second.open();
        expect(databaseRecovery.value?.db).toBe(first);
        expect(databaseRecovery.value?.phase).toBe('blocked');
    } finally { oldFirst.close(); oldSecond.close(); await opening; }
    expect(databaseRecovery.value).toBeNull();
});

it('namespace upgrade preserves every store/index without copying and rolls back interrupted renames before explicit retry', async () => {
    const db = createDb(); const old = new Dexie(db.name); old.version(31).stores(legacySchema);
    await old.open();
    const originals = new Map<string, unknown>();
    for (const table of old.tables) {
        const key = String(table.schema.primKey.keyPath);
        const row = { [key]: 'saved', name: 'saved', payload: { draft: 'original' }, readyAt: 7, secret: 'local only' };
        await table.put(row); originals.set(table.name, row);
    }
    old.close();
    // Interrupt the native upgrade after earlier stores (including blobs) moved.
    const nativeDelete = IDBDatabase.prototype.deleteObjectStore;
    const fault = vi.spyOn(IDBDatabase.prototype, 'deleteObjectStore').mockImplementation(function(this: IDBDatabase, name: string) {
        if (name === 'current_pending_ops') {
            throw new DOMException('Injected rename quota failure', 'QuotaExceededError');
        }
        return nativeDelete.call(this, name);
    });
    try { await expect(db.open()).rejects.toBeDefined(); } finally { fault.mockRestore(); }
    expect(databaseRecovery.value?.phase).toBe('failed');
    expect(databaseRecovery.value?.db).toBe(db);
    // Implicit reads must not retry a failed upgrade.
    await expect(db.kv.get('saved')).rejects.toMatchObject({ name: 'DatabaseClosedError' });
    const read = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(db.name); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    expect(read.version).toBe(310);
    expect([...read.objectStoreNames]).toEqual(Object.keys(legacySchema).sort());
    read.close(); await old.open();
    for (const [name, row] of originals) expect(await old.table(name).get('saved')).toEqual(row);
    old.close();
    const adding = vi.spyOn(IDBObjectStore.prototype, 'add');
    const putting = vi.spyOn(IDBObjectStore.prototype, 'put');
    const phases: Array<string | undefined> = [];
    const moving = vi.spyOn(IDBDatabase.prototype, 'deleteObjectStore').mockImplementation(function(this: IDBDatabase, name: string) {
        phases.push(databaseRecovery.value?.phase);
        return nativeDelete.call(this, name);
    });
    try {
        await db.open();
        expect(adding).not.toHaveBeenCalled();
        expect(putting).not.toHaveBeenCalled();
        expect(phases.length).toBeGreaterThan(0);
        expect(phases.every(phase => phase === 'upgrading')).toBe(true);
    } finally { adding.mockRestore(); putting.mockRestore(); moving.mockRestore(); }
    expect(databaseRecovery.value).toBeNull();
    for (const [name, row] of originals) {
        expect(await db.table(name).get('saved')).toEqual(row);
        const expected = old.table(name).schema;
        expect(db.table(name).schema.primKey.src).toBe(expected.primKey.src);
        expect(db.table(name).schema.indexes.map(index => index.src)).toEqual(expected.indexes.map(index => index.src));
    }
    expect([...db.backendDB().objectStoreNames]).not.toContain('messages');
    expect(db.file_blobs.name).toBe('current_file_blobs');
});

it('P0-5.3 explicit recovery checks parents, creates a new put and retains linked original evidence', async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    const db = createDb(); await db.open(); db.syncHistoryAtOpen = 'J'; getHookBridge(db).start();
    await db.sync_state.put({ id: 'sync_history', historyIncarnation: 'J', phase: 'ready', resetTarget: null, cursor: 0, lastSyncAt: 0, deviceId: '' });
    const provider = { pull: async () => ({ historyIncarnation: 'J', changes: [], nextCursor: 0, hasMore: false, requiresSnapshot: false }) } as unknown as SyncProvider;
    await db.sync_quarantine.put({ id: 'held-parent', variant: 'history_reset', sourceIncarnation: 'I', accountId: 'user',
        tableName: 'messages', pk: 'orphan', status: 'quarantined', source: 'snapshot_apply', diagnostics: [], quarantinedAt: 1,
        op: { operation: 'put', payload: { id: 'orphan', thread_id: 'missing-parent' } } });
    await expect(recoverHistoryPut(db, provider, { workspaceId: 'workspace-1', principalId: 'user' }, 'held-parent', 'J')).rejects.toThrow(/parent/);
    expect(await db.pending_ops.count()).toBe(0);
    const originalId = testUuid('original-held');
    await db.sync_quarantine.put({ id: 'held-put', variant: 'history_reset', sourceIncarnation: 'I', accountId: 'user',
        tableName: 'kv', pk: 'saved', status: 'quarantined', source: 'snapshot_apply', diagnostics: [], quarantinedAt: 1,
        op: { operation: 'put', stamp: { opId: originalId }, payload: { id: 'saved', name: 'saved', value: 'original', deleted: false, created_at: 1, updated_at: 1, clock: 9 } } });
    expect(await recoverHistoryPut(db, provider, { workspaceId: 'workspace-1', principalId: 'user' }, 'held-put', 'J')).toBe(true);
    const action = await db.pending_ops.toCollection().first();
    expect(action?.stamp.opId).not.toBe(originalId);
    expect(await db.kv.get('saved')).toMatchObject({ value: 'original' });
    expect(await db.sync_quarantine.get('held-put')).toMatchObject({ status: 'repaired', repairedOpId: action?.id, op: { stamp: { opId: originalId } } });
});


describe('proven first binding', () => {
    const scope = { workspaceId: 'workspace-1' };
    const local = (id: string, clock = 2) => ({ id, name: id, value: 'local', clock, hlc: `${clock}:0:local`,
        op_id: testUuid(id), deleted: false, created_at: 1, updated_at: 2 });
    const op = (row: ReturnType<typeof local>, operation: 'put' | 'delete' = 'put'): PendingOp => ({ id: row.op_id,
        tableName: 'kv', pk: row.id, operation, payload: operation === 'put' ? row : undefined,
        stamp: { opId: row.op_id, clock: row.clock, hlc: row.hlc, deviceId: 'local' },
        createdAt: 1, attempts: 0, status: 'pending' });
    const page = (historyIncarnation = 'I'): SnapshotResponse => ({ historyIncarnation, workspaceId: scope.workspaceId,
        snapshotId: historyIncarnation, highWatermark: 0, items: [], nextPageToken: null });

    it('preserves birth proof through reopen and discovery, replays local LWW edits/deletes, and consumes even at zero', async () => {
        const db = createDb(); await db.open();
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: true, historyIncarnation: null });
        db.close(); await db.open();
        expect(await requestHistoryReset(db, await readHistory(db), 'I')).toBe(true);
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: true });
        const stager = new SnapshotStager(db, scope); await stager.start();
        const remote = { ...local('conflict'), value: 'remote', clock: 3, hlc: '3:0:remote' };
        await stager.appendPage({ ...page(), items: [{ kind: 'row', tableName: 'kv', pk: remote.id, payload: remote,
            revision: { clock: 3, hlc: remote.hlc, opId: remote.op_id } }] });
        const originals = [op(local('during-download')), op(local('conflict')), op(local('deleted'), 'delete'),
            { ...op(local('permanent')), status: 'failed_permanent' as const }];
        await db.pending_ops.bulkPut(originals);
        await db.kv.bulkPut([local('during-download'), local('conflict'), local('permanent')]);
        const quota = () => { throw new DOMException('quota', 'QuotaExceededError'); };
        db.kv.hook('creating', quota);
        await expect(stager.apply('local')).rejects.toMatchObject({ name: 'QuotaExceededError' });
        db.kv.hook('creating').unsubscribe(quota);
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: true, historyIncarnation: null });
        expect(await db.pending_ops.toArray()).toEqual(expect.arrayContaining(originals));
        await stager.apply('local');
        expect((await db.kv.get('during-download'))?.value).toBe('local');
        expect((await db.kv.get('conflict'))?.value).toBe('remote');
        expect(await db.tombstones.get('kv:deleted')).toMatchObject({ clock: 2 });
        expect(await db.pending_ops.toArray()).toEqual(expect.arrayContaining(originals));
        expect(await db.sync_quarantine.count()).toBe(0);
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: false, historyIncarnation: 'I' });
        expect(await db.sync_state.get(getSyncStateId(scope))).toMatchObject({ cursor: 0 });
        const next = new SnapshotStager(db, scope); await next.start(); await next.appendPage(page('J')); await next.apply('local');
        expect(await db.pending_ops.count()).toBe(0);
        expect(await db.sync_quarantine.toArray()).toEqual(expect.arrayContaining(originals.map(original => expect.objectContaining({ variant: 'history_reset', op: original }))));
    });

    it('retains local-only provenance when I is replaced by J during private staging and lets only one installer bind', async () => {
        const db = createDb(); await db.open();
        const original = op(local('offline-before-I'));
        await db.pending_ops.put(original); await db.kv.put(original.payload as any);
        const stale = new SnapshotStager(db, scope); await stale.start(); await stale.appendPage(page('I'));
        await requestHistoryReset(db, await readHistory(db), 'J');
        const winner = new SnapshotStager(db, scope); await winner.start(); await winner.appendPage(page('J'));
        await expect(stale.apply('local')).rejects.toMatchObject({ name: 'AbortError' });
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: true });
        await winner.apply('local');
        expect(await db.pending_ops.get(original.id)).toEqual(original);
        expect(await db.kv.get(original.pk)).toBeDefined();
        expect(await db.sync_quarantine.count()).toBe(0);
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: false, historyIncarnation: 'J' });
    });

    it.each(['cursor', 'pulled-zero', 'lost-response', 'unmarked-zero'])('never grants birth proof to an upgraded legacy DB (%s)', async kind => {
        const db = createDb(); const legacy = new Dexie(db.name);
        legacy.version(31).stores(legacySchema);
        await legacy.open();
        await legacy.table('sync_state').put({ id: getSyncStateId(scope), cursor: kind === 'cursor' ? 12 : 0, lastSyncAt: 0, deviceId: '' });
        if (kind !== 'unmarked-zero') await legacy.table('kv').put(local(kind));
        legacy.close(); await db.open();
        expect((await readHistory(db) as any).firstBindEligible).not.toBe(true);
        const original = op(local('unknown'));
        await db.pending_ops.put(original);
        const stager = new SnapshotStager(db, scope); await stager.start(); await stager.appendPage(page()); await stager.apply('local');
        expect(await db.pending_ops.count()).toBe(0);
        expect(await db.sync_quarantine.toArray()).toContainEqual(expect.objectContaining({ variant: 'history_reset', op: original }));
    });

    it.each(['coverage', 'remote', 'unfenced-push', 'guard-deleted'])('irreversibly invalidates first-bind eligibility at %s', async boundary => {
        const db = createDb(); await db.open();
        expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: true });
        setHookEngine(createTypedHookEngine(createHookEngine()));
        if (boundary === 'coverage') {
            const cursor = new CursorManager(db, { workspaceId: 'other-scope' });
            await cursor.setCursor(1); await cursor.reset();
        } else if (boundary === 'remote') {
            const row = local('remote');
            await new ConflictResolver(db).applyChanges([{ tableName: 'kv', pk: row.id, op: 'put', payload: row,
                stamp: { ...op(row).stamp }, serverVersion: 1 }]);
        } else if (boundary === 'unfenced-push') {
            await db.pending_ops.put(op(local('lost-response')));
            let dispatched = false;
            const provider = { id: 'unqualified', mode: 'direct', push: async () => {
                dispatched = true;
                expect(await db.sync_state.get('sync_history')).toMatchObject({ firstBindEligible: false });
                throw new Error('committed but response lost');
            } } as unknown as SyncProvider;
            const outbox = new OutboxManager(db, provider, scope);
            try { await outbox.flush(); expect(dispatched).toBe(true); } finally { outbox.stop(); }
        } else await db.sync_state.delete('sync_history');
        db.close(); await db.open();
        expect((await readHistory(db) as any).firstBindEligible).not.toBe(true);
    });
});

it('explicit native legacy inspection is bounded, read-only and separate from current accessors', async () => {
    const { inspectLegacyStore } = await import('~/db/client');
    const db = createDb(); const old = new Dexie(db.name); old.version(31).stores(legacySchema);
    await old.open(); old.close(); await db.open(); await old.open();
    try {
        await old.table('kv').bulkPut([{ id: 'a', value: 'legacy a' }, { id: 'b', value: 'legacy b' }]);
        await db.kv.put({ id: 'a', name: 'a', value: 'protected' } as any);
        const version = db.backendDB().version;
        const first = await inspectLegacyStore(db, 'kv', { limit: 1 });
        expect(first.rows.map(row => row.value)).toEqual([{ id: 'a', value: 'legacy a' }]);
        const second = await inspectLegacyStore(db, 'kv', { after: first.nextAfter!, limit: 1 });
        expect(second.rows.map(row => row.value)).toEqual([{ id: 'b', value: 'legacy b' }]);
        expect(await db.kv.get('a')).toMatchObject({ value: 'protected' });
        expect(await old.table('kv').count()).toBe(2); expect(db.backendDB().version).toBe(version);
        await expect(inspectLegacyStore(db, 'current_kv')).rejects.toThrow();
        expect(db.table('kv').name).toBe('current_kv');
    } finally { old.close(); }
});

it('exports only authorized legacy evidence, retains private/unknown rows and verifies requested attachment bytes', async () => {
    vi.stubGlobal('Blob', (await import('node:buffer')).Blob);
    const { inspectLegacyEvidence, exportLegacyAttachment } = await import('../sync-quarantine');
    const auth = await import('~/composables/auth/useSessionContext');
    const workspaceId = `legacy-export-${crypto.randomUUID()}`;
    const db = new Or3DB(`or3-db-${workspaceId}`); databases.push(db);
    const old = new Dexie(db.name); old.version(31).stores(legacySchema); await old.open(); old.close(); await db.open(); await old.open();
    const session = { authenticated: true, workspace: { id: workspaceId, name: 'Legacy evidence' }, user: { id: 'owner' }, role: 'owner' as const, authorizationRevision: 1 };
    vi.spyOn(auth, 'getCachedSessionContext').mockImplementation(() => session);
    const scope = { workspaceId, principalId: 'owner' };
    try {
        await old.table('notifications').bulkPut([{ id: 'mine', user_id: 'owner' }, { id: 'private', user_id: 'other' }, { id: 'unknown' }, { id: 'wrong-workspace', user_id: 'owner', workspace_id: 'other-workspace' }]);
        await old.table('workspace_tab_drafts').bulkPut([{ id: 'mine', account_key: 'owner', draft: { text: 'my draft' } }, { id: 'private', account_key: 'other', draft: { text: 'secret' } }]);
        await old.table('kv').bulkPut([{ id: 'theme', name: 'theme_selection', value: 'dark' }, { id: 'secret', name: 'openrouter_api_key', value: 'secret' }]);
        const notifications = await inspectLegacyEvidence(db, scope, 'notifications');
        expect(notifications.rows.map(row => row.value.id)).toEqual(['mine']); expect(notifications.excluded).toBe(3);
        expect((await inspectLegacyEvidence(db, scope, 'workspace_tab_drafts')).rows.map(row => row.value.id)).toEqual(['mine']);
        expect((await inspectLegacyEvidence(db, scope, 'kv')).rows.map(row => row.value.id)).toEqual(['theme']);
        const bytes = new Blob(['legacy attachment']);
        const { computeHashHex } = await import('~/utils/hash');
        const hash = `sha256:${await computeHashHex(bytes, 'sha256')}`;
        await old.table('messages').put({ id: 'message', file_hashes: JSON.stringify([hash]) });
        await old.table('file_blobs').put({ hash, blob: bytes });
        const attachment = await exportLegacyAttachment(db, scope, 'messages', 'message', hash);
        expect(await attachment.blob.text()).toBe('legacy attachment'); expect(attachment.verified).toBe(true);
        await expect(exportLegacyAttachment(db, scope, 'notifications', 'private', hash)).rejects.toThrow();
        session.user.id = 'other';
        await expect(inspectLegacyEvidence(db, scope, 'messages')).rejects.toThrow(/access/i);
        expect(await old.table('notifications').count()).toBe(4); expect(await old.table('file_blobs').count()).toBe(1);
    } finally { old.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
