import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { getWriteTxTableNames, nowSec } from '~/db/util';
import { getHookBridge, _resetHookBridge } from '../hook-bridge';
import { _resetHLC } from '../hlc';
import { ConflictResolver } from '../conflict-resolver';
import type { SyncChange } from '~~/shared/sync/types';

const hooksMock = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
    applyFiltersSync: vi.fn((_: string, value: string[]) => value),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hooksMock.doAction,
        _engine: {
            applyFiltersSync: hooksMock.applyFiltersSync,
        },
    }),
}));

describe('atomic sync capture integration', () => {
    let db: Or3DB;

    beforeEach(async () => {
        hooksMock.doAction.mockClear();
        hooksMock.applyFiltersSync.mockClear();
        _resetHLC();
        _resetHookBridge();
        db = new Or3DB(`or3-test-sync-${Date.now()}-${Math.random()}`);
        await db.open();
        const bridge = getHookBridge(db);
        bridge.start();
    });

    afterEach(async () => {
        _resetHookBridge();
        _resetHLC();
        if (db) {
            db.close();
            await db.delete();
        }
    });

    it('captures put operations atomically for synced tables', async () => {
        const now = nowSec();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'threads'),
            async () => {
                await db.threads.put({
                    id: 't-1',
                    title: 'Thread',
                    created_at: now,
                    updated_at: now,
                    status: 'ready',
                    deleted: false,
                    pinned: false,
                    clock: 1,
                    forked: false,
                    last_message_at: null,
                    parent_thread_id: null,
                    anchor_message_id: null,
                    anchor_index: null,
                    branch_mode: null,
                    project_id: null,
                    system_prompt_id: null,
                });
            }
        );

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages'),
            async () => {
                await db.messages.put({
                    id: 'm-1',
                    thread_id: 't-1',
                    role: 'assistant',
                    index: 0,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                    data: { content: 'hello' },
                    pending: false,
                    error: null,
                    file_hashes: null,
                });
            }
        );

        await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
            await db.kv.put({
                id: 'kv:theme_selection',
                name: 'theme_selection',
                value: 'retro',
                deleted: false,
                created_at: now,
                updated_at: now,
                clock: 1,
            });
        });

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'file_meta'),
            async () => {
                await db.file_meta.put({
                    hash: 'a'.repeat(64),
                    name: 'image.png',
                    mime_type: 'image/png',
                    kind: 'image',
                    size_bytes: 100,
                    width: 10,
                    height: 10,
                    ref_count: 1,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                });
            }
        );

        const ops = await db.pending_ops.toArray();
        expect(ops).toHaveLength(4);
        expect(new Set(ops.map((op) => op.tableName))).toEqual(
            new Set(['threads', 'messages', 'kv', 'file_meta'])
        );
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

    it('captures delete operations with tombstones when transaction includes tombstones', async () => {
        const now = nowSec();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages'),
            async () => {
                await db.messages.put({
                    id: 'm-delete',
                    thread_id: 't-1',
                    role: 'assistant',
                    index: 1,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                    data: { content: 'bye' },
                    pending: false,
                    error: null,
                    file_hashes: null,
                });
            }
        );

        await db.pending_ops.clear();
        await db.tombstones.clear();

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages', { includeTombstones: true }),
            async () => {
                await db.messages.delete('m-delete');
            }
        );

        const ops = await db.pending_ops.toArray();
        const tombstones = await db.tombstones.toArray();
        expect(ops).toHaveLength(1);
        expect(ops[0]?.operation).toBe('delete');
        expect(ops[0]?.pk).toBe('m-delete');
        expect(tombstones).toHaveLength(1);
        expect(tombstones[0]?.id).toBe('messages:m-delete');
        expect(tombstones[0]).toMatchObject({
            clock: ops[0]!.stamp.clock,
            hlc: ops[0]!.stamp.hlc,
            opId: ops[0]!.stamp.opId,
        });
    });

    it('captures a soft-delete update with delete transport semantics and a tombstone', async () => {
        const now = nowSec();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages'),
            async () => {
                await db.messages.put({
                    id: 'm-soft-delete',
                    thread_id: 't-1',
                    role: 'assistant',
                    index: 1,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 3,
                    data: { content: 'delete me' },
                    pending: false,
                    error: null,
                    file_hashes: null,
                });
            }
        );
        await db.pending_ops.clear();
        await db.tombstones.clear();

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages', { includeTombstones: true }),
            async () => {
                await db.messages.update('m-soft-delete', {
                    deleted: true,
                    updated_at: now + 1,
                    clock: 4,
                });
            }
        );

        const [op] = await db.pending_ops.toArray();
        const row = await db.messages.get('m-soft-delete');
        const [tombstone] = await db.tombstones.toArray();
        expect(op).toMatchObject({
            tableName: 'messages',
            operation: 'delete',
            pk: 'm-soft-delete',
            payload: { deleted: true, deleted_at: expect.any(Number) },
            stamp: { clock: 4 },
        });
        expect(row).toMatchObject({
            deleted: true,
            deleted_at: expect.any(Number),
            clock: op!.stamp.clock,
            hlc: op!.stamp.hlc,
            op_id: op!.stamp.opId,
        });
        expect(tombstone).toMatchObject({
            id: 'messages:m-soft-delete',
            clock: op!.stamp.clock,
            hlc: op!.stamp.hlc,
            opId: op!.stamp.opId,
        });

        const stalePut: SyncChange = {
            serverVersion: 50,
            tableName: 'messages',
            pk: 'm-soft-delete',
            op: 'put',
            payload: {
                id: 'm-soft-delete',
                thread_id: 't-1',
                role: 'assistant',
                index: 1,
                created_at: now,
                updated_at: now,
                deleted: false,
                clock: 3,
                data: { content: 'stale resurrection' },
                pending: false,
                error: null,
                file_hashes: null,
            },
            stamp: {
                clock: 3,
                hlc: '0000000000003:0000:stale-device',
                deviceId: 'stale-device',
                opId: 'stale-put-after-soft-delete',
            },
        };
        const applyResult = await new ConflictResolver(db).applyChanges([stalePut]);
        expect(applyResult.applied).toBe(0);
        expect(await db.messages.get('m-soft-delete')).toMatchObject({
            deleted: true,
            clock: op!.stamp.clock,
            op_id: op!.stamp.opId,
        });
    });

    it('rolls back the row revision when the matching outbox write fails', async () => {
        const fixedId = '00000000-0000-4000-8000-000000000001';
        const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(fixedId);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const now = nowSec();
        try {
            await db.transaction('rw', getWriteTxTableNames(db, 'messages'), async () => {
                await db.messages.put({
                    id: 'm-rollback', thread_id: 't-1', role: 'assistant', index: 0,
                    created_at: now, updated_at: now, deleted: false, clock: 1,
                    data: { content: 'before' }, pending: false, error: null, file_hashes: null,
                });
            });
            const before = await db.messages.get('m-rollback');
            const beforeOps = await db.pending_ops.toArray();
            expect(beforeOps).toHaveLength(1);

            await expect(db.transaction(
                'rw',
                getWriteTxTableNames(db, 'messages'),
                async () => {
                    await db.messages.update('m-rollback', {
                        data: { content: 'after' },
                        clock: 2,
                        updated_at: now + 1,
                    });
                }
            )).rejects.toThrow();

            expect(await db.messages.get('m-rollback')).toEqual(before);
            expect(await db.pending_ops.toArray()).toEqual(beforeOps);
        } finally {
            uuidSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });

    it('does not enqueue pending_ops when applying remote deletes', async () => {
        const now = nowSec();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages'),
            async () => {
                await db.messages.put({
                    id: 'm-remote-delete',
                    thread_id: 't-1',
                    role: 'assistant',
                    index: 1,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                    hlc: '0000000000001:0000:node',
                    data: { content: 'bye' },
                    pending: false,
                    error: null,
                    file_hashes: null,
                });
            }
        );

        await db.pending_ops.clear();
        await db.tombstones.clear();

        const resolver = new ConflictResolver(db);
        const remoteDelete: SyncChange = {
            serverVersion: 100,
            tableName: 'messages',
            pk: 'm-remote-delete',
            op: 'delete',
            payload: {
                id: 'm-remote-delete',
                deleted_at: now + 1,
                deleted: true,
            },
            stamp: {
                clock: 2,
                hlc: '0000000000002:0000:node',
                deviceId: 'remote-device',
                opId: 'remote-op-1',
            },
        };

        const result = await resolver.applyChanges([remoteDelete]);
        const ops = await db.pending_ops.toArray();
        const tombstones = await db.tombstones.toArray();
        const updated = await db.messages.get('m-remote-delete');

        expect(result.applied).toBe(1);
        expect(ops).toHaveLength(0);
        expect(updated?.deleted).toBe(true);
        expect(updated?.clock).toBe(2);
        expect(tombstones).toHaveLength(1);
        expect(tombstones[0]?.id).toBe('messages:m-remote-delete');
    });
});
