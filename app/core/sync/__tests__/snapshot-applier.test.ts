import { afterEach, describe, expect, it } from 'vitest';
import { Or3DB } from '~/db/client';
import type { SnapshotResponse } from '~~/shared/sync/types';
import { applySnapshotChain } from '../snapshot-applier';

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
});
