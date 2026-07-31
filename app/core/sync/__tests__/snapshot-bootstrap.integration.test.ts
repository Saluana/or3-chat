import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { _resetCursorManagers } from '../cursor-manager';
import { _resetHookBridge } from '../hook-bridge';
import { SubscriptionManager } from '../subscription-manager';
import type {
    PullRequest,
    PullResponse,
    SnapshotRequest,
    SnapshotResponse,
    SyncChange,
    SyncProvider,
    SyncScope,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: hookState.doAction }),
}));

const scope: SyncScope = { workspaceId: 'workspace-retained' };

function messageChange(version: number, content: string): SyncChange {
    return {
        serverVersion: version,
        tableName: 'messages',
        pk: 'message-retained',
        op: 'put',
        payload: {
            id: 'message-retained',
            thread_id: 'thread-1',
            role: 'assistant',
            index: 0,
            order_key: `${version}:0:remote`,
            data: { content },
            pending: false,
            error: null,
            file_hashes: null,
            deleted: false,
            created_at: 1,
            updated_at: version,
            clock: version,
            hlc: `${version}:0:remote`,
            op_id: `op-${version}`,
        },
        stamp: {
            clock: version,
            hlc: `${version}:0:remote`,
            deviceId: 'remote',
            opId: `op-${version}`,
        },
    };
}

class PrunedHistoryProvider implements SyncProvider {
    id: string;
    mode = 'direct' as const;
    pullCursors: number[] = [];
    snapshotRequests: SnapshotRequest[] = [];
    subscribeCursors: number[] = [];
    onChanges: ((changes: SyncChange[]) => void | Promise<void>) | null = null;
    private duringSnapshotChangeAvailable = false;

    constructor(providerName: string) {
        this.id = `${providerName}-pruned-history-fixture`;
    }

    async snapshot(request: SnapshotRequest): Promise<SnapshotResponse> {
        this.snapshotRequests.push(request);
        if (!request.pageToken) {
            // Version 11 commits while this bounded snapshot is being paged.
            this.duringSnapshotChangeAvailable = true;
            return {
                workspaceId: scope.workspaceId,
                snapshotId: `${this.id}-snapshot`,
                highWatermark: 10,
                items: [{
                    kind: 'row',
                    tableName: 'messages',
                    pk: 'message-retained',
                    payload: messageChange(10, 'before snapshot').payload,
                    revision: { clock: 10, hlc: '10:0:remote', opId: 'op-10' },
                }],
                nextPageToken: 'page-2',
            };
        }

        expect(request.pageToken).toBe('page-2');
        return {
            workspaceId: scope.workspaceId,
            snapshotId: `${this.id}-snapshot`,
            highWatermark: 10,
            items: [],
            nextPageToken: null,
        };
    }

    async pull(request: PullRequest): Promise<PullResponse> {
        this.pullCursors.push(request.cursor);
        if (request.cursor < 10) {
            throw new Error('fresh bootstrap attempted to read pruned change history');
        }
        if (request.cursor === 10 && this.duringSnapshotChangeAvailable) {
            return {
                // A defensive boundary duplicate proves replay is strictly > watermark.
                changes: [
                    messageChange(10, 'before snapshot'),
                    messageChange(11, 'during snapshot'),
                ],
                nextCursor: 11,
                hasMore: false,
            };
        }
        return { changes: [], nextCursor: request.cursor, hasMore: false };
    }

    async subscribe(
        _scope: SyncScope,
        _tables: string[],
        onChanges: (changes: SyncChange[]) => void | Promise<void>,
        options?: SyncSubscribeOptions
    ): Promise<() => void> {
        this.subscribeCursors.push(options?.cursor ?? 0);
        this.onChanges = onChanges;
        return () => undefined;
    }

    async push(): Promise<never> {
        throw new Error('push is not used by this fixture');
    }

    async updateCursor(): Promise<void> {}
    async dispose(): Promise<void> {}
}

describe('fresh-client snapshot bootstrap after history retention', () => {
    let db: Or3DB;
    let manager: SubscriptionManager | null;

    beforeEach(async () => {
        hookState.doAction.mockClear();
        _resetCursorManagers();
        _resetHookBridge();
        db = new Or3DB(`snapshot-bootstrap-${crypto.randomUUID()}`);
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

    it.each(['sqlite', 'convex'])(
        '%s bootstraps unchanged materialized rows without original log entries and applies boundary changes once',
        async (providerName) => {
            const writesByRevision = new Map<number, number>();
            const recordWrite = (clock: unknown) => {
                if (typeof clock === 'number') {
                    writesByRevision.set(clock, (writesByRevision.get(clock) ?? 0) + 1);
                }
            };
            db.messages.hook('creating', (_key, row) => recordWrite(row.clock));
            db.messages.hook('updating', (changes) => {
                recordWrite((changes as Record<string, unknown>).clock);
            });

            const provider = new PrunedHistoryProvider(providerName);
            manager = new SubscriptionManager(db, provider, scope, {
                tables: ['messages'],
                bootstrapPageSize: 1,
            });

            await manager.start();

            expect(provider.snapshotRequests.map((request) => request.pageToken ?? null))
                .toEqual([null, 'page-2']);
            expect(provider.pullCursors).toEqual([10]);
            expect(provider.subscribeCursors).toEqual([11]);
            expect(await db.sync_state.get('sync_state:workspace-retained:default'))
                .toMatchObject({ cursor: 11 });
            expect(await db.messages.get('message-retained')).toMatchObject({
                data: { content: 'during snapshot' },
                clock: 11,
                op_id: 'op-11',
            });

            // Version 12 commits after snapshot completion. Duplicate deliveries at
            // both replay boundaries must not cause a second local mutation.
            await provider.onChanges?.([
                messageChange(11, 'during snapshot'),
                messageChange(12, 'after snapshot'),
                messageChange(12, 'after snapshot'),
            ]);

            expect(await db.messages.get('message-retained')).toMatchObject({
                data: { content: 'after snapshot' },
                clock: 12,
                op_id: 'op-12',
            });
            expect(await db.sync_state.get('sync_state:workspace-retained:default'))
                .toMatchObject({ cursor: 12 });
            expect(provider.pullCursors.every((cursor) => cursor >= 10)).toBe(true);
            expect(writesByRevision).toEqual(new Map([
                [10, 1],
                [11, 1],
                [12, 1],
            ]));
            expect(await db.pending_ops.count()).toBe(0);
        }
    );
});
