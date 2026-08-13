import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import type {
    PendingOp,
    PullRequest,
    PullResponse,
    SnapshotRequest,
    SnapshotResponse,
    SyncChange,
    SyncProvider,
    SyncScope,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';
import { _resetCursorManagers } from '../cursor-manager';
import { _resetHookBridge } from '../hook-bridge';
import { SubscriptionManager } from '../subscription-manager';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: hookState.doAction }),
}));

const scope: SyncScope = { workspaceId: 'workspace-expired-snapshot' };

function messagePayload(
    id: string,
    content: string,
    clock: number,
    deviceId = 'remote'
) {
    return {
        id,
        thread_id: 'thread-1',
        role: 'assistant' as const,
        index: clock,
        order_key: `${clock}:0:${deviceId}`,
        data: { content },
        pending: false,
        error: null,
        file_hashes: null,
        deleted: false,
        created_at: 1,
        updated_at: clock,
        clock,
        hlc: `${clock}:0:${deviceId}`,
        op_id: `op-${id}-${clock}`,
    };
}

function messageChange(
    serverVersion: number,
    id: string,
    content: string
): SyncChange {
    const payload = messagePayload(id, content, serverVersion);
    return {
        serverVersion,
        tableName: 'messages',
        pk: id,
        op: 'put',
        payload,
        stamp: {
            clock: serverVersion,
            hlc: payload.hlc,
            deviceId: 'remote',
            opId: payload.op_id,
        },
    };
}

function pendingPut(id: string, content: string, clock: number): PendingOp {
    const payload = messagePayload(id, content, clock, 'local');
    return {
        id: `pending-put-${id}`,
        tableName: 'messages',
        operation: 'put',
        pk: id,
        payload,
        stamp: {
            clock,
            hlc: payload.hlc,
            deviceId: 'local',
            opId: payload.op_id,
        },
        createdAt: 1,
        attempts: 0,
        status: 'pending',
    };
}

function pendingDelete(id: string, clock: number): PendingOp {
    return {
        id: `pending-delete-${id}`,
        tableName: 'messages',
        operation: 'delete',
        pk: id,
        payload: { id, deleted: true, deleted_at: clock },
        stamp: {
            clock,
            hlc: `${clock}:0:local`,
            deviceId: 'local',
            opId: `op-delete-${id}-${clock}`,
        },
        createdAt: 2,
        attempts: 0,
        status: 'pending',
    };
}

class ExpiredCursorSnapshotProvider implements SyncProvider {
    id = 'expired-cursor-snapshot-provider';
    mode = 'direct' as const;
    pullCursors: number[] = [];
    snapshotRequests: SnapshotRequest[] = [];
    subscribeCursors: number[] = [];

    async snapshot(request: SnapshotRequest): Promise<SnapshotResponse> {
        this.snapshotRequests.push(request);
        return {
            workspaceId: scope.workspaceId,
            snapshotId: 'canonical-at-50',
            highWatermark: 50,
            items: [
                {
                    kind: 'row',
                    tableName: 'messages',
                    pk: 'canonical',
                    payload: messagePayload(
                        'canonical',
                        'canonical snapshot value',
                        40
                    ),
                    revision: {
                        clock: 40,
                        hlc: '40:0:remote',
                        opId: 'op-canonical-40',
                    },
                },
                {
                    kind: 'row',
                    tableName: 'messages',
                    pk: 'pending-delete',
                    payload: messagePayload(
                        'pending-delete',
                        'server value restored by snapshot',
                        41
                    ),
                    revision: {
                        clock: 41,
                        hlc: '41:0:remote',
                        opId: 'op-pending-delete-41',
                    },
                },
                {
                    kind: 'tombstone',
                    tableName: 'messages',
                    pk: 'server-deleted',
                    revision: {
                        clock: 42,
                        hlc: '42:0:remote',
                        opId: 'op-server-deleted-42',
                    },
                    serverDeletedAt: 42,
                },
            ],
            nextPageToken: null,
        };
    }

    async pull(request: PullRequest): Promise<PullResponse> {
        this.pullCursors.push(request.cursor);
        if (request.cursor < 50) {
            throw new Error('expired client attempted to read pruned history');
        }
        if (request.cursor === 50) {
            return {
                changes: [
                    messageChange(
                        51,
                        'after-watermark',
                        'committed after snapshot'
                    ),
                ],
                nextCursor: 51,
                hasMore: false,
            };
        }
        return {
            changes: [],
            nextCursor: request.cursor,
            hasMore: false,
        };
    }

    async subscribe(
        _scope: SyncScope,
        _tables: string[],
        _onChanges: (changes: SyncChange[]) => void | Promise<void>,
        options?: SyncSubscribeOptions
    ): Promise<() => void> {
        this.subscribeCursors.push(options?.cursor ?? 0);
        return () => undefined;
    }

    async push(): Promise<never> {
        throw new Error('push is not used by this fixture');
    }

    async updateCursor(): Promise<void> {}
    async dispose(): Promise<void> {}
}

describe('expired-cursor snapshot recovery', () => {
    let db: Or3DB;
    let manager: SubscriptionManager | null;

    beforeEach(async () => {
        hookState.doAction.mockClear();
        _resetCursorManagers();
        _resetHookBridge();
        db = new Or3DB(`snapshot-recovery-${crypto.randomUUID()}`);
        manager = null;
        await db.open();
    });

    afterEach(async () => {
        await manager?.stop();
        _resetCursorManagers();
        _resetHookBridge();
        db.close();
        await db.delete();
    });

    it('replaces stale materialized state, reapplies pending work, and resumes after the snapshot watermark', async () => {
        await db.messages.bulkPut([
            messagePayload('canonical', 'stale local value', 2, 'local'),
            messagePayload('stale-only', 'not on the server', 3, 'local'),
            messagePayload('server-deleted', 'deleted remotely', 4, 'local'),
            messagePayload('pending-put', 'unsynced local edit', 60, 'local'),
        ]);
        await db.tombstones.put({
            id: 'messages:stale-tombstone',
            tableName: 'messages',
            pk: 'stale-tombstone',
            deletedAt: 3,
            clock: 3,
            hlc: '3:0:local',
            opId: 'op-stale-tombstone',
        });
        const localPut = pendingPut('pending-put', 'unsynced local edit', 60);
        const localDelete = pendingDelete('pending-delete', 61);
        await db.pending_ops.bulkPut([localPut, localDelete]);
        await db.sync_state.put({
            id: 'sync_state:workspace-expired-snapshot:default',
            cursor: 7,
            lastSyncAt: Date.now() - 25 * 60 * 60 * 1000,
            deviceId: 'local',
        });

        const provider = new ExpiredCursorSnapshotProvider();
        manager = new SubscriptionManager(db, provider, scope, {
            tables: ['messages'],
            bootstrapPageSize: 20,
        });

        await manager.start();

        expect(provider.snapshotRequests).toHaveLength(1);
        expect(provider.pullCursors.filter((cursor) => cursor >= 50)).toEqual([50]);
        expect(provider.subscribeCursors).toEqual([51]);
        expect(await db.sync_state.get(
            'sync_state:workspace-expired-snapshot:default'
        )).toMatchObject({ cursor: 51 });

        expect(await db.messages.get('canonical')).toMatchObject({
            data: { content: 'canonical snapshot value' },
            clock: 40,
        });
        expect(await db.messages.get('after-watermark')).toMatchObject({
            data: { content: 'committed after snapshot' },
            clock: 51,
        });
        expect(await db.messages.get('stale-only')).toBeUndefined();
        expect(await db.messages.get('server-deleted')).toBeUndefined();
        expect(await db.tombstones.get('messages:server-deleted'))
            .toMatchObject({ clock: 42, opId: 'op-server-deleted-42' });
        expect(await db.tombstones.get('messages:stale-tombstone'))
            .toBeUndefined();

        expect(await db.messages.get('pending-put')).toEqual(localPut.payload);
        expect(await db.messages.get('pending-delete')).toBeUndefined();
        expect(await db.tombstones.get('messages:pending-delete')).toMatchObject({
            clock: 61,
            hlc: '61:0:local',
            opId: 'op-delete-pending-delete-61',
        });
        expect(
            (await db.pending_ops.toArray()).sort(
                (left, right) => left.createdAt - right.createdAt
            )
        ).toEqual([localPut, localDelete]);
    });
});
