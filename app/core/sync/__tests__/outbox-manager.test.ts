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
import { FULL_HISTORY_PULL_RETENTION } from '~~/shared/sync/types';
import { OutboxManager } from '../outbox-manager';
import { _resetSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';
import { isRecentOpId, markRecentOpId } from '../recent-op-cache';
import {
    createMemoryTable,
    createMockDb,
    createPendingOpsTable,
} from './sync-test-utils';

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
        return {
            changes: [],
            nextCursor: 0,
            hasMore: false,
            ...FULL_HISTORY_PULL_RETENTION,
        };
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
        lastError: overrides.lastError,
        lastErrorCode: overrides.lastErrorCode,
        failureKind: overrides.failureKind,
        failedAt: overrides.failedAt,
        discardedAt: overrides.discardedAt,
        discardReason: overrides.discardReason,
    };
}

describe('OutboxManager', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        opCounter = 0;
        _resetSyncCircuitBreaker();
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
        const bulkPutSpy = vi.spyOn(pendingOps, 'bulkPut');
        const putSpy = vi.spyOn(pendingOps, 'put');
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
        expect(bulkPutSpy.mock.calls[0]![0].every((op) => op.status === 'in_flight')).toBe(true);
        expect(putSpy.mock.calls.filter(([op]) => op.status === 'applied')).toHaveLength(2);
        expect(pendingOps.__rows.size).toBe(0);
    });

    it.each([
        { olderOperation: 'put', newerOperation: 'delete' },
        { olderOperation: 'delete', newerOperation: 'put' },
    ] as const)(
        'keeps the later logical $newerOperation in a same-tick $olderOperation/$newerOperation sequence',
        async ({ olderOperation, newerOperation }) => {
            const older = createPendingOp({
                id: 'same-tick-older',
                operation: olderOperation,
                createdAt: 1000,
                stamp: {
                    deviceId: 'device-1',
                    opId: 'op-a',
                    hlc: '0000000001000:0000:node',
                    clock: 1,
                },
            });
            const newer = createPendingOp({
                id: 'same-tick-newer',
                operation: newerOperation,
                createdAt: 1000,
                stamp: {
                    deviceId: 'device-1',
                    opId: 'op-b',
                    hlc: '0000000001000:0001:node',
                    clock: 2,
                },
            });
            const pendingOps = createPendingOpsTable([older, newer]);
            const provider = new SpyProvider();
            provider.push = vi.fn(async (batch: PushBatch) => ({
                results: batch.ops.map((op) => ({
                    opId: op.stamp.opId,
                    success: true,
                })),
                serverVersion: 1,
            }));
            const outbox = new OutboxManager(
                createMockDb({
                    pending_ops: pendingOps,
                    tombstones: createMemoryTable('id'),
                }) as any,
                provider,
                { workspaceId: 'workspace-1' }
            );

            await outbox.flush();

            const pushed = provider.push.mock.calls[0]![0].ops;
            expect(pushed).toHaveLength(1);
            expect(pushed[0]!.operation).toBe(newerOperation);
            expect(pushed[0]!.stamp.opId).toBe('op-b');
        }
    );

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
        expect(stored?.status).toBe('retry_wait');
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
        expect(stored?.status).toBe('failed_retryable');
        expect(stored?.attempts).toBe(1);
        expect(stored?.lastError).toBe('fail');
        expect(stored?.failureKind).toBe('retry_exhausted');
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.error:action'
            )
        ).toBe(true);
    });

    it('preserves failed operations and payload metadata across startup', async () => {
        vi.useFakeTimers();
        const failed = createPendingOp({
            id: 'failed-before-reload',
            payload: { id: 'm1', text: 'unsynced user text' },
            status: 'failed_retryable',
            attempts: 4,
            lastError: 'network remained unavailable',
            failureKind: 'retry_exhausted',
            failedAt: 1234,
        });
        const pendingOps = createPendingOpsTable([failed]);
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as any,
            new SpyProvider(),
            { workspaceId: 'workspace-1' }
        );

        outbox.start();
        await vi.advanceTimersByTimeAsync(0);
        outbox.stop();

        expect(pendingOps.__rows.get(failed.id)).toEqual(failed);
        vi.useRealTimers();
    });

    it('explicitly retries one retained failure without losing its payload', async () => {
        const failed = createPendingOp({
            id: 'failed-retry',
            payload: { id: 'm1', text: 'retain me' },
            status: 'failed_retryable',
            attempts: 4,
            lastError: 'offline',
            failureKind: 'retry_exhausted',
        });
        const pendingOps = createPendingOpsTable([failed]);
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as any,
            new SpyProvider(),
            { workspaceId: 'workspace-1' }
        );

        await outbox.retryFailed(failed.id);

        expect(pendingOps.__rows.get(failed.id)).toMatchObject({
            status: 'pending',
            attempts: 0,
            payload: failed.payload,
        });
        expect(pendingOps.__rows.get(failed.id)?.lastError).toBeUndefined();
    });

    it('records an intentional discard instead of deleting the failed operation', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(9000);
        const failed = createPendingOp({
            id: 'failed-discard',
            status: 'failed_permanent',
            lastError: 'invalid',
            failureKind: 'permanent',
        });
        const pendingOps = createPendingOpsTable([failed]);
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as any,
            new SpyProvider(),
            { workspaceId: 'workspace-1' }
        );

        await expect(outbox.discardFailed(failed.stamp.opId, 'confirmed')).resolves.toBe(true);
        expect(pendingOps.__rows.get(failed.id)).toMatchObject({
            status: 'discarded',
            discardedAt: 9000,
            discardReason: 'confirmed',
            payload: failed.payload,
            lastError: 'invalid',
        });
    });

    it('defers retries on transport 429 without incrementing attempts', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-rate-limit',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-rate-limit',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => {
            const err = new Error('Rate limit exceeded. Retry after 4s') as Error & {
                status: number;
                retryAfterMs: number;
            };
            err.status = 429;
            err.retryAfterMs = 4000;
            throw err;
        });

        const outbox = new OutboxManager(
            db as any,
            provider,
            { workspaceId: 'workspace-1' },
            { retryDelays: [250, 1000] }
        );

        vi.spyOn(Date, 'now').mockReturnValue(1000);

        const didWork = await outbox.flush();

        expect(didWork).toBe(false);
        const stored = pendingOps.__rows.get('pending-rate-limit');
        expect(stored?.status).toBe('retry_wait');
        expect(stored?.attempts).toBe(0);
        expect(stored?.nextAttemptAt).toBe(5000);
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.error:action'
            )
        ).toBe(false);
    });

    it('preserves queued writes on session loss without logging or consuming attempts', async () => {
        const pendingOp = createPendingOp({ id: 'pending-session-loss' });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => {
            const error = new Error('Unauthorized') as Error & { status: number };
            error.status = 401;
            throw error;
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as any,
            provider,
            { workspaceId: 'workspace-1' },
            { retryDelays: [250] }
        );

        await expect(outbox.flush()).resolves.toBe(false);

        expect(pendingOps.__rows.get(pendingOp.id)).toMatchObject({
            status: 'retry_wait',
            attempts: 0,
            nextAttemptAt: 1250,
        });
        expect(consoleError).not.toHaveBeenCalled();
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.error:action'
            )
        ).toBe(false);
    });

    it('defers retries on transient upstream 503 without incrementing attempts', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-upstream-unavailable',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-upstream-unavailable',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => {
            const err = new Error('Service unavailable') as Error & {
                status: number;
                retryAfterMs: number;
            };
            err.status = 503;
            err.retryAfterMs = 3000;
            throw err;
        });

        const outbox = new OutboxManager(
            db as any,
            provider,
            { workspaceId: 'workspace-1' },
            { retryDelays: [250, 1000] }
        );

        vi.spyOn(Date, 'now').mockReturnValue(2000);

        const didWork = await outbox.flush();

        expect(didWork).toBe(false);
        const stored = pendingOps.__rows.get('pending-upstream-unavailable');
        expect(stored?.status).toBe('retry_wait');
        expect(stored?.attempts).toBe(0);
        expect(stored?.nextAttemptAt).toBe(5000);
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.error:action'
            )
        ).toBe(false);
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
        expect(stored?.status).toBe('failed_permanent');
        expect(stored?.attempts).toBe(1);
        expect(
            hookState.doAction.mock.calls.some(
                (call) => call[0] === 'sync.retry:action'
            )
        ).toBe(false);
    });

    it('retains the original message when local sanitization rejects its size', async () => {
        const content = 'x'.repeat(257 * 1024);
        const oversized = createPendingOp({
            id: 'local-oversized',
            payload: {
                id: 'm1',
                thread_id: 'thread-1',
                role: 'user',
                index: 0,
                order_key: '1:0:device',
                content,
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([oversized]);
        const provider = new SpyProvider();
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as any,
            provider,
            { workspaceId: 'workspace-1' }
        );

        await outbox.flush();

        expect(provider.push).not.toHaveBeenCalled();
        const stored = pendingOps.__rows.get(oversized.id);
        expect(stored?.status).toBe('failed_permanent');
        expect(stored?.failureKind).toBe('permanent');
        expect((stored?.payload as { content: string }).content).toBe(content);
        expect(stored?.lastError).toMatch(/Payload too large for messages/);
    });

    it('recovers legacy syncing and current in-flight ops once per start cycle', async () => {
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
        const inFlightModifySpy = vi.fn(async (patch: Partial<PendingOp>) => {
            const collection = originalWhere('status').equals('in_flight');
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
                    if (field === 'status' && value === 'in_flight') {
                        return {
                            ...collection,
                            modify: inFlightModifySpy,
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
        expect(inFlightModifySpy).toHaveBeenCalledTimes(1);
        outbox.stop();
    });

    it('ignores a push result after stop and recovers it on restart', async () => {
        const pending = createPendingOp({ id: 'stopped-push' });
        const pendingOps = createPendingOpsTable([pending]);
        let releasePush: ((result: PushResult) => void) | undefined;
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => new Promise<PushResult>((resolve) => {
            releasePush = resolve;
        }));
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as any,
            provider,
            { workspaceId: 'workspace-1' }
        );

        const flushing = outbox.flush();
        for (let i = 0; i < 20 && !provider.push.mock.calls.length; i++) await Promise.resolve();
        outbox.stop();
        releasePush?.({ results: [{ opId: pending.stamp.opId, success: true }], serverVersion: 1 });
        await flushing;

        expect(pendingOps.__rows.get(pending.id)?.status).toBe('in_flight');

        provider.push = vi.fn(async () => ({
            results: [{ opId: pending.stamp.opId, success: true }],
            serverVersion: 1,
        }));
        outbox.start();
        await outbox.flush();
        expect(pendingOps.__rows.has(pending.id)).toBe(false);
        expect(provider.push).toHaveBeenCalledTimes(1);
        outbox.stop();
    });

    it('applies the winner payload when push reports applied: false', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-loser',
            pk: 'm1',
            payload: { id: 'm1', text: 'local' },
            stamp: {
                deviceId: 'device-1',
                opId: 'op-local',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const messages = createMemoryTable('id', [{ id: 'm1', text: 'local' }]);
        const db = createMockDb({
            pending_ops: pendingOps,
            messages,
            tombstones: createMemoryTable('id'),
        });
        const provider = new SpyProvider();
        const winner = { id: 'm1', text: 'remote-winner', clock: 9 };
        provider.push = vi.fn(async () => ({
            results: [{
                opId: 'op-local',
                success: true,
                applied: false,
                payload: winner,
            }],
            serverVersion: 4,
        }));
        markRecentOpId('op-local');
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(pendingOps.__rows.size).toBe(0);
        expect(messages.__rows.get('m1')).toMatchObject(winner);
        expect(isRecentOpId('op-local')).toBe(false);
    });

    it('keeps the outbox row when applied: false has no winner payload', async () => {
        const pendingOp = createPendingOp({
            id: 'pending-missing-winner',
            stamp: {
                deviceId: 'device-1',
                opId: 'op-missing',
                hlc: '0000000000001:0000:node',
                clock: 1,
            },
        });
        const pendingOps = createPendingOpsTable([pendingOp]);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{
                opId: 'op-missing',
                success: true,
                applied: false,
            }],
            serverVersion: 4,
        }));
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(pendingOps.__rows.has('pending-missing-winner')).toBe(true);
        expect(pendingOps.__rows.get('pending-missing-winner')?.status).toBe('retry_wait');
    });

    it('packs batches under the byte ceiling across multiple flushes', async () => {
        const ops = [0, 1, 2].map((index) =>
            createPendingOp({
                id: `pending-big-${index}`,
                pk: `p${index}`,
                tableName: 'posts',
                payload: {
                    id: `p${index}`,
                    title: 'Post',
                    content: 'x'.repeat(800_000),
                    post_type: 'markdown',
                    deleted: false,
                    created_at: 1,
                    updated_at: 1,
                    clock: 1,
                },
                stamp: {
                    deviceId: 'device-1',
                    opId: `op-big-${index}`,
                    hlc: `000000000000${index}:0000:node`,
                    clock: 1,
                },
            })
        );
        const pendingOps = createPendingOpsTable(ops);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        const sizes: number[] = [];
        provider.push = vi.fn(async (batch: PushBatch) => {
            sizes.push(batch.ops.length);
            return {
                results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })),
                serverVersion: 1,
            };
        });
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();
        await outbox.flush();

        expect(sizes.length).toBeGreaterThan(1);
        expect(sizes.every((size) => size < 3)).toBe(true);
        expect(pendingOps.__rows.size).toBe(0);
    });

    it('binary-splits a whole-request 413 down to single ops', async () => {
        const ops = [0, 1].map((index) =>
            createPendingOp({
                id: `pending-split-${index}`,
                pk: `s${index}`,
                stamp: {
                    deviceId: 'device-1',
                    opId: `op-split-${index}`,
                    hlc: `000000000000${index}:0000:node`,
                    clock: 1,
                },
            })
        );
        const pendingOps = createPendingOpsTable(ops);
        const db = createMockDb({ pending_ops: pendingOps });
        const provider = new SpyProvider();
        provider.push = vi.fn(async (batch: PushBatch) => {
            if (batch.ops.length > 1) {
                const err = new Error('Payload too large') as Error & { statusCode: number };
                err.statusCode = 413;
                throw err;
            }
            return {
                results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })),
                serverVersion: 1,
            };
        });
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(provider.push.mock.calls.some((call) => call[0].ops.length === 1)).toBe(true);
        expect(pendingOps.__rows.size).toBe(0);
    });

    it('does not claim a half-open probe on an empty flush', async () => {
        const db = createMockDb({ pending_ops: createPendingOpsTable([]) });
        const provider = new SpyProvider();
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'empty-probe' });
        const breaker = (await import('~~/shared/sync/circuit-breaker')).getSyncCircuitBreaker(
            'empty-probe:spy'
        );
        for (let i = 0; i < 5; i++) breaker.recordFailure();
        vi.spyOn(Date, 'now').mockReturnValue(breaker.getTimeUntilRetry() + Date.now() + 1);
        // Force open duration to elapse
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
        expect(breaker.getState() === 'open' || breaker.getState() === 'half-open' || breaker.canRetry()).toBeTruthy();

        await outbox.flush();
        expect(provider.push).not.toHaveBeenCalled();
        expect(breaker.canRetry()).toBe(true);
    });
});
