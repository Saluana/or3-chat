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
    SyncSubscribeOptions,
} from '~~/shared/sync/types';
import { OutboxManager } from '../outbox-manager';
import { createMockDb, createPendingOpsTable } from './sync-test-utils';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction,
    }),
}));

class SpyProvider implements SyncProvider {
    id = 'spy';
    mode = 'direct' as const;
    auth = undefined;
    push = vi.fn(async (batch: PushBatch): Promise<PushResult> => ({
        results: batch.ops.map((op) => ({
            opId: op.stamp.opId,
            success: false,
            error: 'fail',
        })),
        serverVersion: 0,
    }));

    async subscribe(
        _scope: SyncScope,
        _tables: string[],
        _onChanges: (changes: SyncChange[]) => void,
        _options?: SyncSubscribeOptions
    ): Promise<() => void> {
        return () => undefined;
    }

    async pull(_request: PullRequest): Promise<PullResponse> {
        return { changes: [], nextCursor: 0, hasMore: false };
    }

    async updateCursor(): Promise<void> {
        return;
    }

    async dispose(): Promise<void> {
        return;
    }
}

let opCounter = 0;

function createPendingOp(overrides: Partial<PendingOp> = {}): PendingOp {
    opCounter += 1;
    const fallbackId = `pending-${opCounter}`;
    const fallbackOpId = `op-${opCounter}`;
    return {
        id: overrides.id ?? fallbackId,
        tableName: overrides.tableName ?? 'messages',
        operation: overrides.operation ?? 'put',
        pk: overrides.pk ?? 'm1',
        payload: overrides.payload ?? { id: 'm1', text: 'hi' },
        stamp: overrides.stamp ?? {
            deviceId: 'device-1',
            opId: overrides.id ?? fallbackOpId,
            hlc: '0000000000001:0000:node',
            clock: 1,
        },
        createdAt: overrides.createdAt ?? 1,
        attempts: overrides.attempts ?? 0,
        status: overrides.status ?? 'pending',
        nextAttemptAt: overrides.nextAttemptAt,
    };
}

describe('OutboxManager', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        opCounter = 0;
    });

    it('coalesces multiple ops for the same record and drops stale entries', async () => {
        const op1 = createPendingOp({
            id: 'pending-1',
            pk: 'm1',
            createdAt: 1,
            stamp: {
                deviceId: 'device-1',
                opId: 'op-1',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const op2 = createPendingOp({
            id: 'pending-2',
            pk: 'm1',
            createdAt: 2,
            stamp: {
                deviceId: 'device-1',
                opId: 'op-2',
                hlc: '0000000000002:0000:node',
                clock: 2,
            },
        });
        const op3 = createPendingOp({
            id: 'pending-3',
            pk: 'm2',
            createdAt: 3,
            stamp: {
                deviceId: 'device-1',
                opId: 'op-3',
                hlc: '0000000000003:0000:node',
                clock: 1,
            },
        });

        const pendingOps = createPendingOpsTable([op1, op2, op3]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async (batch: PushBatch) => ({
            results: batch.ops.map((op) => ({
                opId: op.stamp.opId,
                success: true,
            })),
            serverVersion: 1,
        }));

        const outbox = new OutboxManager(db as any, provider, {
            workspaceId: 'workspace-1',
        });

        await outbox.flush();

        expect(provider.push).toHaveBeenCalledTimes(1);
        const pushedOps = provider.push.mock.calls[0]![0].ops;
        expect(pushedOps.map((op) => op.stamp.opId)).toEqual(['op-2', 'op-3']);
        expect(pendingOps.__rows.size).toBe(0);
    });

    it('schedules retry with exponential backoff on failure', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-retry',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-retry',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{ opId: 'op-retry', success: false, error: 'fail' }],
            serverVersion: 0,
        }));

        const outbox = new OutboxManager(
            db as any,
            provider,
            { workspaceId: 'workspace-1' },
            { retryDelays: [250, 1000] }
        );

        vi.spyOn(Date, 'now').mockReturnValue(1000);

        await outbox.flush();

        const stored = pendingOps.__rows.get('pending-retry');
        expect(stored?.status).toBe('pending');
        expect(stored?.attempts).toBe(1);
        expect(stored?.nextAttemptAt).toBe(1250);
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.retry:action'
            )
        ).toBe(true);
    });

    it('marks ops as failed after max attempts', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-fail',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-fail',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{ opId: 'op-fail', success: false, error: 'fail' }],
            serverVersion: 0,
        }));

        const outbox = new OutboxManager(
            db as any,
            provider,
            { workspaceId: 'workspace-1' },
            { retryDelays: [250] }
        );

        await outbox.flush();

        const stored = pendingOps.__rows.get('pending-fail');
        expect(stored?.status).toBe('failed');
        expect(stored?.attempts).toBe(1);
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.error:action'
            )
        ).toBe(true);
    });

    it('treats payload-too-large errors as permanent failures', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-oversized',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-oversized',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [
                {
                    opId: 'op-oversized',
                    success: false,
                    error: 'Payload too large for messages: exceeds 65536 bytes',
                },
            ],
            serverVersion: 0,
        }));

        const outbox = new OutboxManager(
            db as any,
            provider,
            { workspaceId: 'workspace-1' },
            { retryDelays: [250, 1000, 3000] }
        );

        await outbox.flush();

        const stored = pendingOps.__rows.get('pending-oversized');
        expect(stored?.status).toBe('failed');
        expect(stored?.attempts).toBe(1);
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.retry:action'
            )
        ).toBe(false);
    });

    it('recovers syncing ops once per start cycle', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-once',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-once',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const originalWhere = pendingOps.where.bind(pendingOps);
        const syncingModifySpy = vi.fn(async (patch: Partial<PendingOp>) => {
            const collection = originalWhere('status').equals('syncing');
            await collection.modify(patch);
        });

        pendingOps.where = ((field: keyof PendingOp) => {
            const chain = originalWhere(field);
            return {
                equals: (value: PendingOp[keyof PendingOp]) => {
                    const collection = chain.equals(value as never);
                    if (field === 'status' && value === 'syncing') {
                        return {
                            ...collection,
                            modify: syncingModifySpy,
                        };
                    }
                    return collection;
                },
            };
        }) as typeof pendingOps.where;

        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async (batch: PushBatch) => ({
            results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })),
            serverVersion: 1,
        }));

        const outbox = new OutboxManager(db as any, provider, {
            workspaceId: 'workspace-1',
        });

        outbox.start();
        await outbox.flush();
        await outbox.flush();

        expect(syncingModifySpy).toHaveBeenCalledTimes(1);
        outbox.stop();
    });
});
