import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PendingOp,
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
    SyncChange,
    SyncProvider,
    SyncScope,
} from '~~/shared/sync/types';
import { ConflictResolver } from '../conflict-resolver';
import { OutboxManager } from '../outbox-manager';
import {
    createMemoryTable,
    createMockDb,
    createPendingOpsTable,
} from './sync-test-utils';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(),
}));

const hookBridgeState = vi.hoisted(() => ({
    markSyncTransaction: vi.fn(),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction,
    }),
}));

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => ({
        markSyncTransaction: hookBridgeState.markSyncTransaction,
    }),
}));

type MessageRow = {
    id: string;
    clock: number;
    hlc?: string;
    thread_id?: string;
    role?: string;
    index?: number;
    order_key?: string;
    deleted?: boolean;
    created_at?: number;
    updated_at?: number;
};

/**
 * Build a complete message payload with all required fields
 */
function buildMessagePayload(partial: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'm1',
        thread_id: 't1',
        role: 'user',
        index: 0,
        order_key: '0000000000001:0000:node',
        deleted: false,
        created_at: 1000,
        updated_at: 1000,
        clock: 1,
        ...partial,
    };
}

class FakeSyncProvider implements SyncProvider {
    id = 'fake';
    mode = 'direct' as const;
    auth = undefined;
    private serverVersion = 0;
    private changeLog: SyncChange[] = [];

    async subscribe(
        _scope: SyncScope,
        _tables: string[],
        _onChanges: (changes: SyncChange[]) => void
    ): Promise<() => void> {
        return () => undefined;
    }

    async pull(request: PullRequest): Promise<PullResponse> {
        const changes = this.changeLog.filter(
            (change) => change.serverVersion > request.cursor
        );
        const window = changes.slice(0, request.limit + 1);
        const hasMore = window.length > request.limit;
        const slice = hasMore ? window.slice(0, -1) : window;
        const nextCursor =
            slice.length > 0
                ? slice[slice.length - 1]!.serverVersion
                : request.cursor;
        return {
            changes: slice,
            nextCursor,
            hasMore,
        };
    }

    async push(batch: PushBatch): Promise<PushResult> {
        const results: PushResult['results'] = [];
        for (const op of batch.ops) {
            this.serverVersion += 1;
            this.changeLog.push({
                serverVersion: this.serverVersion,
                tableName: op.tableName,
                pk: op.pk,
                op: op.operation,
                payload: op.payload,
                stamp: op.stamp,
            });
            results.push({ opId: op.stamp.opId, success: true });
        }
        return { results, serverVersion: this.serverVersion };
    }

    seedChanges(changes: SyncChange[]) {
        this.changeLog = [...changes];
        this.serverVersion = changes.reduce(
            (max, change) => Math.max(max, change.serverVersion),
            0
        );
    }

    async updateCursor(): Promise<void> {
        return;
    }

    async dispose(): Promise<void> {
        return;
    }
}

function createPendingOp(overrides: Partial<PendingOp> = {}): PendingOp {
    return {
        id: overrides.id ?? 'pending-1',
        tableName: overrides.tableName ?? 'messages',
        operation: overrides.operation ?? 'put',
        pk: overrides.pk ?? 'm1',
        payload: overrides.payload ?? buildMessagePayload({ id: 'm1', text: 'hi' }),
        stamp: overrides.stamp ?? {
            deviceId: 'device-1',
            opId: 'op-1',
            hlc: '0000000000001:0000:node',
            clock: 1,
        },
        createdAt: overrides.createdAt ?? 1,
        attempts: overrides.attempts ?? 0,
        status: overrides.status ?? 'pending',
        nextAttemptAt: overrides.nextAttemptAt,
    };
}

describe('sync push/pull flow', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        hookBridgeState.markSyncTransaction.mockClear();
    });

    it('pushes pending ops and applies pulled changes to another db', async () => {
        const provider = new FakeSyncProvider();
        const pendingOps = createPendingOpsTable([createPendingOp()]);
        const dbA = createMockDb({ pending_ops: pendingOps });
        const scope: SyncScope = { workspaceId: 'workspace-1' };

        const outbox = new OutboxManager(dbA as any, provider, scope, {
            flushIntervalMs: 999999,
        });

        await outbox.flush();

        expect(pendingOps.__rows.size).toBe(0);

        const pull = await provider.pull({
            scope,
            cursor: 0,
            limit: 50,
        });

        expect(pull.changes).toHaveLength(1);
        expect(pull.nextCursor).toBeGreaterThan(0);

        const messages = createMemoryTable<MessageRow>('id');
        const tombstones = createMemoryTable<any>('id');
        const dbB = createMockDb({ messages, tombstones });
        const resolver = new ConflictResolver(dbB as any);

        await resolver.applyChanges(pull.changes);

        const stored = await messages.get('m1');
        expect(stored?.clock).toBe(1);
        expect(stored?.hlc).toBe('0000000000001:0000:node');
    });

    it('resolves conflicts on pull when local record wins tie-break', async () => {
        const provider = new FakeSyncProvider();
        provider.seedChanges([
            {
                serverVersion: 1,
                tableName: 'messages',
                pk: 'm1',
                op: 'put',
                payload: buildMessagePayload({ id: 'm1', text: 'remote', clock: 2 }),
                stamp: {
                    clock: 2,
                    hlc: '0000000000002:0001:node',
                    deviceId: 'device-remote',
                    opId: 'op-remote',
                },
            },
        ]);

        const messages = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 2, hlc: '0000000000002:0002:node' },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages, tombstones });
        const resolver = new ConflictResolver(db as any);

        const pull = await provider.pull({
            scope: { workspaceId: 'workspace-1' },
            cursor: 0,
            limit: 50,
        });

        const result = await resolver.applyChanges(pull.changes);
        const stored = await messages.get('m1');

        expect(result.conflicts).toBe(1);
        expect(stored?.hlc).toBe('0000000000002:0002:node');
    });
});
