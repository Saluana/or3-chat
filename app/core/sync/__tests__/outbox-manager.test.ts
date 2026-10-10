import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
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
import { Or3DB } from '~/db/client';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import {
    createMemoryTable,
    createMockDb,
    createPendingOpsTable,
    testUuid,
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
        expect(stored?.lastError).toBe('This change exceeds sync limits. Reduce its size before trying again.');
        expect(stored?.lastErrorDetails).toMatchObject({ code: 'ERR_SYNC_PAYLOAD_TOO_LARGE', retryable: false });
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
        const originalWhere = pendingOps.where.bind(pendingOps) as unknown as (
            field: string
        ) => {
            equals: (value: unknown) => { modify: (patch: unknown) => Promise<void> };
            between: (...args: unknown[]) => unknown;
        };
        const syncingModifySpy = vi.fn(async (patch: Partial<PendingOp>) => {
            const collection = originalWhere('status').equals('syncing');
            await collection.modify(patch);
        });
        const inFlightModifySpy = vi.fn(async (patch: Partial<PendingOp>) => {
            const collection = originalWhere('status').equals('in_flight');
            await collection.modify(patch);
        });

        pendingOps.where = ((field: string) => {
            const chain = (originalWhere as (f: string) => any)(field);
            if (field === '[status+readyAt+createdAt+id]') {
                return chain;
            }
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
        const winner = {
            id: 'm1', thread_id: 'thread-1', role: 'user', index: 0,
            order_key: '0000000000009:0000:node', text: 'remote-winner',
            deleted: false, created_at: 1, updated_at: 9, clock: 9,
        };
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

    it('does not invent a tombstone winner for a losing delete with no winner state', async () => {
        const pending = createPendingOp({
            id: 'missing-delete-winner',
            pk: 'm-delete',
            operation: 'delete',
            stamp: { deviceId: 'device-1', opId: 'op-delete', hlc: '1000-a', clock: 1 },
        });
        const pendingOps = createPendingOpsTable([pending]);
        const messages = createMemoryTable('id', [{
            id: 'm-delete', text: 'local-newer', clock: 2, hlc: '2000-b', op_id: 'local-put',
        }]);
        const tombstones = createMemoryTable('id');
        const db = createMockDb({ pending_ops: pendingOps, messages, tombstones });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{ opId: 'op-delete', success: true, applied: false }],
            serverVersion: 3,
        }));
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(pendingOps.__rows.get(pending.id)?.status).toBe('retry_wait');
        expect(messages.__rows.get('m-delete')).toMatchObject({
            text: 'local-newer', clock: 2, op_id: 'local-put',
        });
        expect(tombstones.__rows.size).toBe(0);
    });

    it('acknowledges a replay superseded by a newer live winner', async () => {
        const pending = createPendingOp({
            id: 'lost-ack', pk: 'm-replay', payload: { id: 'm-replay', text: 'old' },
            stamp: { deviceId: 'a', opId: 'old-op', hlc: '1000-a', clock: 1 },
        });
        const pendingOps = createPendingOpsTable([pending]);
        const messages = createMemoryTable('id', [{ id: 'm-replay', text: 'old', clock: 1, hlc: '1000-a', op_id: 'old-op' }]);
        const db = createMockDb({ pending_ops: pendingOps, messages, tombstones: createMemoryTable('id') });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{
                opId: 'old-op', success: true, replayed: true, applied: false, serverVersion: 1,
                winner: {
                    kind: 'put' as const,
                    payload: {
                        id: 'm-replay', thread_id: 'thread-1', role: 'user',
                        index: 0, order_key: '2000-b', text: 'newer',
                        deleted: false, created_at: 1, updated_at: 2, clock: 2,
                    },
                    revision: { clock: 2, hlc: '2000-b', opId: 'new-op' },
                },
            }],
            serverVersion: 2,
        }));
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(pendingOps.__rows.size).toBe(0);
        expect(messages.__rows.get('m-replay')).toMatchObject({
            text: 'newer', clock: 2, hlc: '2000-b', op_id: 'new-op',
        });
        expect(provider.push).toHaveBeenCalledTimes(1);
    });

    it('acknowledges a replay superseded by a tombstone with its own revision', async () => {
        const pending = createPendingOp({
            id: 'lost-ack-delete', pk: 'm-deleted',
            stamp: { deviceId: 'a', opId: 'old-put', hlc: '1000-a', clock: 1 },
        });
        const pendingOps = createPendingOpsTable([pending]);
        const messages = createMemoryTable('id', [{ id: 'm-deleted', clock: 1, hlc: '1000-a', op_id: 'old-put' }]);
        const tombstones = createMemoryTable('id');
        const db = createMockDb({ pending_ops: pendingOps, messages, tombstones });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{
                opId: 'old-put', success: true, replayed: true, applied: false, serverVersion: 1,
                winner: {
                    kind: 'delete' as const,
                    revision: { clock: 3, hlc: '3000-b', opId: 'new-delete' },
                    serverDeletedAt: 123,
                },
            }],
            serverVersion: 3,
        }));
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(pendingOps.__rows.size).toBe(0);
        expect(messages.__rows.has('m-deleted')).toBe(false);
        expect(tombstones.__rows.get('messages:m-deleted')).toMatchObject({
            clock: 3, hlc: '3000-b', opId: 'new-delete', deletedAt: 123,
        });
    });

    it('keeps a newer local put when an older push returns a tombstone winner', async () => {
        const pending = createPendingOp({
            id: 'older-due', pk: 'm-newer',
            stamp: { deviceId: 'a', opId: 'old-put', hlc: '1000-a', clock: 1 },
        });
        const pendingOps = createPendingOpsTable([pending]);
        const messages = createMemoryTable('id', [{
            id: 'm-newer', text: 'local-newer', clock: 4, hlc: '4000-a', op_id: 'local-new',
        }]);
        const tombstones = createMemoryTable('id');
        const db = createMockDb({ pending_ops: pendingOps, messages, tombstones });
        const provider = new SpyProvider();
        provider.push = vi.fn(async () => ({
            results: [{
                opId: 'old-put', success: true, replayed: true, applied: false,
                winner: {
                    kind: 'delete' as const,
                    revision: { clock: 3, hlc: '3000-b', opId: 'server-delete' },
                },
            }],
            serverVersion: 3,
        }));
        const outbox = new OutboxManager(db as any, provider, { workspaceId: 'workspace-1' });

        await outbox.flush();

        expect(pendingOps.__rows.size).toBe(0);
        expect(messages.__rows.get('m-newer')).toMatchObject({
            text: 'local-newer', clock: 4, op_id: 'local-new',
        });
        expect(tombstones.__rows.size).toBe(0);
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

describe('OutboxManager fairness (real Dexie)', () => {
    const databases: Or3DB[] = [];
    const NOW = 1_000_000;
    let counter = 0;

    beforeEach(() => {
        hookState.doAction.mockClear();
        counter = 0;
        _resetSyncCircuitBreaker();
    });

    afterEach(async () => {
        for (const db of databases.splice(0)) {
            try {
                db.close();
            } catch {
                // Ignore close errors during teardown.
            }
            await Dexie.delete(db.name);
        }
        vi.restoreAllMocks();
    });

    async function freshDb(): Promise<Or3DB> {
        const db = new Or3DB(`or3-test-outbox-${crypto.randomUUID()}`);
        await db.open();
        databases.push(db);
        return db;
    }

    function realPendingOp(overrides: Partial<PendingOp> = {}): PendingOp {
        counter += 1;
        const id = overrides.id ?? `real-${counter}`;
        return {
            id,
            tableName: overrides.tableName ?? 'messages',
            operation: overrides.operation ?? 'put',
            pk: overrides.pk ?? id,
            payload: overrides.payload ?? { id: overrides.pk ?? id },
            stamp: overrides.stamp ?? {
                deviceId: 'device-1',
                opId: overrides.id ? `${overrides.id}-op` : `op-${counter}`,
                hlc: `${String(1000 + counter).padStart(13, '0')}:0000:node`,
                clock: 1,
            },
            createdAt: overrides.createdAt ?? counter,
            attempts: overrides.attempts ?? 0,
            status: overrides.status ?? 'pending',
            nextAttemptAt: overrides.nextAttemptAt,
        };
    }

    function successProvider(seen: string[][] = []) {
        const provider = new SpyProvider();
        provider.push = vi.fn(async (batch: PushBatch) => {
            seen.push(batch.ops.map((op) => op.stamp.opId));
            for (const op of batch.ops) {
                expect(op).not.toHaveProperty('readyAt');
            }
            return {
                results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })),
                serverVersion: 1,
            };
        });
        return provider;
    }

    it('attempts a due retry within two flushes while a 500-row pending window stays full', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            const pendingSeed: PendingOp[] = [];
            for (let i = 0; i < 500; i += 1) {
                pendingSeed.push(
                    realPendingOp({
                        id: `pending-${i}`,
                        pk: `pending-${i}`,
                        createdAt: i + 1,
                        status: 'pending',
                    })
                );
            }
            const retry = realPendingOp({
                id: 'retry-due',
                pk: 'retry-1',
                createdAt: 10_000,
                status: 'retry_wait',
                nextAttemptAt: NOW - 1000,
                stamp: { deviceId: 'device-1', opId: 'op-retry-due', hlc: '0000002000000:0000:node', clock: 1 },
            });
            await db.pending_ops.bulkPut([...pendingSeed, retry]);

            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-sustained' });

            let retrySeenAt: number | null = null;
            let extraCounter = 500;
            for (let flushIndex = 0; flushIndex < 2; flushIndex += 1) {
                const pendingCount = await db.pending_ops.where('status').equals('pending').count();
                expect(pendingCount).toBeGreaterThanOrEqual(500);
                await outbox.flush();
                if (seen.flat().includes('op-retry-due') && retrySeenAt === null) {
                    retrySeenAt = flushIndex;
                }
                // Replenish successful pending rows so the window stays full.
                const afterPending = await db.pending_ops.where('status').equals('pending').count();
                const topUp: PendingOp[] = [];
                for (let i = afterPending; i < 500; i += 1) {
                    extraCounter += 1;
                    topUp.push(
                        realPendingOp({
                            id: `pending-topup-${extraCounter}`,
                            pk: `pending-topup-${extraCounter}`,
                            createdAt: 20_000 + extraCounter,
                            status: 'pending',
                        })
                    );
                }
                if (topUp.length) await db.pending_ops.bulkPut(topUp);
            }

            expect(retrySeenAt).not.toBeNull();
            expect(retrySeenAt!).toBeLessThanOrEqual(1);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('selects due rows hidden behind a full window of future-due rows in each status', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            const seed: PendingOp[] = [];
            for (let i = 0; i < 50; i += 1) {
                seed.push(
                    realPendingOp({
                        id: `pending-future-${i}`,
                        pk: `pending-future-${i}`,
                        createdAt: i + 1,
                        status: 'pending',
                        nextAttemptAt: NOW + 10_000,
                    })
                );
            }
            for (let i = 0; i < 50; i += 1) {
                seed.push(
                    realPendingOp({
                        id: `retry-future-${i}`,
                        pk: `retry-future-${i}`,
                        createdAt: i + 1,
                        status: 'retry_wait',
                        attempts: 1,
                        nextAttemptAt: NOW + 10_000,
                    })
                );
            }
            const pendingDue = realPendingOp({
                id: 'pending-due-hidden',
                pk: 'pending-due-hidden',
                createdAt: 1000,
                status: 'pending',
                stamp: { deviceId: 'device-1', opId: 'op-pending-due-hidden', hlc: '0000003000000:0000:node', clock: 1 },
            });
            const retryDue = realPendingOp({
                id: 'retry-due-hidden',
                pk: 'retry-due-hidden',
                createdAt: 1000,
                status: 'retry_wait',
                attempts: 1,
                nextAttemptAt: NOW,
                stamp: { deviceId: 'device-1', opId: 'op-retry-due-hidden', hlc: '0000003000001:0000:node', clock: 1 },
            });
            await db.pending_ops.bulkPut([...seed, pendingDue, retryDue]);

            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-hidden' }, { maxBatchSize: 5 });

            await outbox.flush();

            const pushed = seen.flat();
            expect(pushed).toContain('op-pending-due-hidden');
            expect(pushed).toContain('op-retry-due-hidden');
            // Future-due rows stay queued with their stamps intact.
            expect(await db.pending_ops.get('pending-future-0')).toMatchObject({
                nextAttemptAt: NOW + 10_000,
                attempts: 0,
            });
            expect(await db.pending_ops.get('retry-future-0')).toMatchObject({
                nextAttemptAt: NOW + 10_000,
                attempts: 1,
            });
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('enforces eligibility boundaries and makes no request when nothing is due or terminal', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            await db.pending_ops.bulkPut([
                realPendingOp({
                    id: 'missing-time',
                    pk: 'missing-time',
                    status: 'pending',
                    stamp: { deviceId: 'device-1', opId: 'op-missing', hlc: '0000004000000:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'exact-now',
                    pk: 'exact-now',
                    status: 'pending',
                    nextAttemptAt: NOW,
                    stamp: { deviceId: 'device-1', opId: 'op-exact', hlc: '0000004000001:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'future-one',
                    pk: 'future-one',
                    status: 'pending',
                    nextAttemptAt: NOW + 1,
                    stamp: { deviceId: 'device-1', opId: 'op-future', hlc: '0000004000002:0000:node', clock: 1 },
                }),
            ]);
            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-boundary' });

            await outbox.flush();
            expect(seen.flat().sort()).toEqual(['op-exact', 'op-missing'].sort());
            expect(await db.pending_ops.get('future-one')).toBeDefined();

            // All-future queue makes no request.
            const dbFuture = await freshDb();
            await dbFuture.pending_ops.bulkPut([
                realPendingOp({ id: 'only-future', pk: 'only-future', status: 'pending', nextAttemptAt: NOW + 5000 }),
            ]);
            const seenFuture: string[][] = [];
            const futureProvider = successProvider(seenFuture);
            const futureOutbox = new OutboxManager(dbFuture, futureProvider as never, { workspaceId: 'fairness-all-future' });
            await expect(futureOutbox.flush()).resolves.toBe(false);
            expect(seenFuture).toHaveLength(0);

            // Empty and terminal-only queues make no request.
            const dbTerminal = await freshDb();
            await dbTerminal.pending_ops.bulkPut([
                realPendingOp({ id: 'terminal-retryable', pk: 't1', status: 'failed_retryable' }),
                realPendingOp({ id: 'terminal-permanent', pk: 't2', status: 'failed_permanent' }),
                realPendingOp({ id: 'terminal-discarded', pk: 't3', status: 'discarded' }),
            ]);
            const seenTerminal: string[][] = [];
            const terminalProvider = successProvider(seenTerminal);
            const terminalOutbox = new OutboxManager(dbTerminal, terminalProvider as never, { workspaceId: 'fairness-terminal' });
            await expect(terminalOutbox.flush()).resolves.toBe(false);
            expect(seenTerminal).toHaveLength(0);

            const dbEmpty = await freshDb();
            const seenEmpty: string[][] = [];
            const emptyProvider = successProvider(seenEmpty);
            const emptyOutbox = new OutboxManager(dbEmpty, emptyProvider as never, { workspaceId: 'fairness-empty' });
            await expect(emptyOutbox.flush()).resolves.toBe(false);
            expect(seenEmpty).toHaveLength(0);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('reads eligible work through the due index in scheduling order within limits', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            const rows: PendingOp[] = [];
            for (let i = 0; i < 20; i += 1) {
                rows.push(
                    realPendingOp({
                        id: `ordered-${i}`,
                        pk: `ordered-${i}`,
                        createdAt: 100 - i,
                        status: 'pending',
                        nextAttemptAt: i < 10 ? NOW - (10 - i) : NOW + 10_000,
                    })
                );
            }
            await db.pending_ops.bulkPut(rows);

            const page = await db.pending_ops
                .where('[status+readyAt+createdAt+id]')
                .between(['pending', 0, 0, ''], ['pending', NOW, Number.MAX_SAFE_INTEGER, '\uffff'], true, true)
                .limit(5)
                .toArray();
            expect(page).toHaveLength(5);
            // Already-due rows ordered by (readyAt, createdAt, id).
            const keys = page.map((op) => [op.readyAt, op.createdAt, op.id]);
            expect([...keys].sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number) || String(a[2]).localeCompare(String(b[2])))).toEqual(keys);
            expect(page.every((op) => (op.readyAt ?? NOW + 1) <= NOW)).toBe(true);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('shares single-operation requests between groups across two flushes', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            await db.pending_ops.bulkPut([
                realPendingOp({
                    id: 'single-pending',
                    pk: 'single-pending',
                    status: 'pending',
                    stamp: { deviceId: 'device-1', opId: 'op-single-pending', hlc: '0000005000000:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'single-retry',
                    pk: 'single-retry',
                    status: 'retry_wait',
                    nextAttemptAt: NOW - 10,
                    stamp: { deviceId: 'device-1', opId: 'op-single-retry', hlc: '0000005000001:0000:node', clock: 1 },
                }),
            ]);
            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-single' }, { maxBatchSize: 1 });

            await outbox.flush();
            await outbox.flush();

            expect(seen).toHaveLength(2);
            expect(seen.every((batch) => batch.length === 1)).toBe(true);
            expect(seen.flat().sort()).toEqual(['op-single-pending', 'op-single-retry'].sort());
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('shares byte-limited requests between groups without exceeding the wire ceiling', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            const bigPayload = (id: string) => ({
                id,
                title: 'Post',
                content: 'x'.repeat(1_400_000),
                post_type: 'markdown',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            });
            await db.pending_ops.bulkPut([
                realPendingOp({
                    id: 'byte-pending',
                    pk: 'byte-pending',
                    tableName: 'posts',
                    status: 'pending',
                    payload: bigPayload('byte-pending'),
                    stamp: { deviceId: 'device-1', opId: 'op-byte-pending', hlc: '0000006000000:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'byte-retry',
                    pk: 'byte-retry',
                    tableName: 'posts',
                    status: 'retry_wait',
                    nextAttemptAt: NOW - 10,
                    payload: bigPayload('byte-retry'),
                    stamp: { deviceId: 'device-1', opId: 'op-byte-retry', hlc: '0000006000001:0000:node', clock: 1 },
                }),
            ]);
            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-bytes' });

            await outbox.flush();
            await outbox.flush();

            expect(seen.flat().sort()).toEqual(['op-byte-pending', 'op-byte-retry'].sort());
            expect(seen.every((batch) => batch.length === 1)).toBe(true);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('lets a lone group fill available request capacity', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            const rows = [0, 1, 2, 3, 4].map((i) =>
                realPendingOp({ id: `lone-${i}`, pk: `lone-${i}`, status: 'pending' })
            );
            await db.pending_ops.bulkPut(rows);
            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-lone' }, { maxBatchSize: 3 });

            await outbox.flush();
            expect(seen).toHaveLength(1);
            expect(seen[0]).toHaveLength(3);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('keeps the compareSyncRevision winner across statuses and preserves deferred siblings', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            await db.pending_ops.bulkPut([
                realPendingOp({
                    id: 'cross-pending-old',
                    pk: 'shared-1',
                    status: 'pending',
                    createdAt: 1,
                    stamp: { deviceId: 'device-1', opId: 'op-shared-old', hlc: '0000007000000:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'cross-retry-new',
                    pk: 'shared-1',
                    status: 'retry_wait',
                    createdAt: 2,
                    nextAttemptAt: NOW - 5,
                    stamp: { deviceId: 'device-1', opId: 'op-shared-new', hlc: '0000007000001:0000:node', clock: 2 },
                }),
                realPendingOp({
                    id: 'sibling-due-old',
                    pk: 'shared-2',
                    status: 'pending',
                    createdAt: 3,
                    stamp: { deviceId: 'device-1', opId: 'op-sibling-due', hlc: '0000007000002:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'sibling-deferred-new',
                    pk: 'shared-2',
                    status: 'pending',
                    createdAt: 4,
                    nextAttemptAt: NOW + 50_000,
                    stamp: { deviceId: 'device-1', opId: 'op-sibling-deferred', hlc: '0000007000003:0000:node', clock: 2 },
                }),
            ]);
            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-revision' });

            await outbox.flush();

            const pushed = seen.flat();
            expect(pushed).toContain('op-shared-new');
            expect(pushed).not.toContain('op-shared-old');
            expect(pushed).toContain('op-sibling-due');
            expect(await db.pending_ops.get('cross-pending-old')).toBeUndefined();

            // Deferred newer sibling survives with its stamp and stays eligible later.
            const survivor = await db.pending_ops.get('sibling-deferred-new');
            expect(survivor).toMatchObject({
                status: 'pending',
                nextAttemptAt: NOW + 50_000,
                stamp: { opId: 'op-sibling-deferred', clock: 2 },
            });

            vi.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
            const seenLater: string[][] = [];
            provider.push = vi.fn(async (batch: PushBatch) => {
                seenLater.push(batch.ops.map((op) => op.stamp.opId));
                return {
                    results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })),
                    serverVersion: 2,
                };
            });
            await outbox.flush();
            expect(seenLater.flat()).toContain('op-sibling-deferred');
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('keeps the later logical operation for equal-time cross-status put/delete sequences', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            await db.pending_ops.bulkPut([
                realPendingOp({
                    id: 'equal-put',
                    pk: 'equal-1',
                    operation: 'put',
                    status: 'pending',
                    createdAt: NOW,
                    stamp: { deviceId: 'device-1', opId: 'op-equal-put', hlc: '0000008000000:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'equal-delete',
                    pk: 'equal-1',
                    operation: 'delete',
                    status: 'retry_wait',
                    createdAt: NOW,
                    nextAttemptAt: NOW - 1,
                    stamp: { deviceId: 'device-1', opId: 'op-equal-delete', hlc: '0000008000000:0001:node', clock: 2 },
                }),
            ]);
            const seen: string[][] = [];
            const provider = successProvider(seen);
            const tombstones = await db.tombstones.count().catch(() => 0);
            void tombstones;
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-equal' });

            await outbox.flush();
            expect(seen).toHaveLength(1);
            expect(seen[0]).toEqual(['op-equal-delete']);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('does not let a stale server winner overwrite newer local state', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            // Local materialized state is revision 3 (newest).
            await db.messages.put({
                id: 'm-winner-guard',
                thread_id: 't1',
                role: 'user',
                index: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
                clock: 3,
                hlc: '0000009000003:0000:node',
                op_id: 'op-local-new',
            } as never);
            // Outbox holds due revision 1 while revision 3 stays deferred.
            await db.pending_ops.bulkPut([
                realPendingOp({
                    id: 'winner-old-due',
                    pk: 'm-winner-guard',
                    status: 'pending',
                    createdAt: 1,
                    stamp: { deviceId: 'device-1', opId: 'op-old-due', hlc: '0000009000001:0000:node', clock: 1 },
                }),
                realPendingOp({
                    id: 'winner-new-deferred',
                    pk: 'm-winner-guard',
                    status: 'pending',
                    createdAt: 2,
                    nextAttemptAt: NOW + 50_000,
                    stamp: { deviceId: 'device-1', opId: 'op-local-new', hlc: '0000009000003:0000:node', clock: 3 },
                }),
            ]);
            const provider = new SpyProvider();
            provider.push = vi.fn(async (batch: PushBatch) => {
                for (const op of batch.ops) {
                    expect(op).not.toHaveProperty('readyAt');
                }
                // Server winner is revision 2: newer than the pushed revision
                // 1 but older than local revision 3. Mirrors server data_json
                // (clock + op_id, no hlc).
                return {
                    results: batch.ops.map((op) => ({
                        opId: op.stamp.opId,
                        success: true,
                        applied: false,
                        payload: { id: 'm-winner-guard', clock: 2, op_id: 'op-server-winner' },
                    })),
                    serverVersion: 7,
                };
            });
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-winner-guard' });

            await outbox.flush();

            expect(provider.push).toHaveBeenCalledTimes(1);
            expect(provider.push.mock.calls[0]![0].ops.map((op) => op.stamp.opId)).toEqual(['op-old-due']);
            // Pushed revision is acknowledged without touching newer local state.
            expect(await db.pending_ops.get('winner-old-due')).toBeUndefined();
            expect(await db.messages.get('m-winner-guard')).toMatchObject({
                clock: 3,
                op_id: 'op-local-new',
            });
            // Deferred newer revision survives for later convergence.
            expect(await db.pending_ops.get('winner-new-deferred')).toMatchObject({
                stamp: { opId: 'op-local-new', clock: 3 },
            });
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('recovers in-flight work without a positive scheduling delay under a full pending window', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
        try {
            const db = await freshDb();
            const fresh: PendingOp[] = [];
            for (let i = 0; i < 500; i += 1) {
                fresh.push(
                    realPendingOp({
                        id: `recover-fresh-${i}`,
                        pk: `recover-fresh-${i}`,
                        createdAt: 2 + i,
                        status: 'pending',
                    })
                );
            }
            const recovered = realPendingOp({
                id: 'recovered-inflight',
                pk: 'recovered-1',
                createdAt: 1,
                status: 'in_flight',
                stamp: { deviceId: 'device-1', opId: 'op-recovered', hlc: '0000009500000:0000:node', clock: 1 },
            });
            await db.pending_ops.bulkPut([...fresh, recovered]);
            expect(await db.pending_ops.where('status').equals('pending').count()).toBe(500);

            const seen: string[][] = [];
            const provider = successProvider(seen);
            const outbox = new OutboxManager(db, provider as never, { workspaceId: 'fairness-recovery' });

            await outbox.flush();

            // Recovery clears the scheduling time (FIFO by createdAt) instead
            // of stamping `now`, so the recovered row is not sorted after
            // every fresh readyAt-0 row and starved by the full window.
            expect(seen.flat()).toContain('op-recovered');
        } finally {
            nowSpy.mockRestore();
        }
    });
});


describe('OutboxManager quarantine (real Dexie)', () => {
    const databases: Or3DB[] = [];
    const scope = { workspaceId: 'quarantine-ws' };

    beforeEach(() => {
        hookState.doAction.mockClear();
        _resetSyncCircuitBreaker();
    });

    afterEach(async () => {
        for (const db of databases.splice(0)) {
            db.close();
            await Dexie.delete(db.name);
        }
        vi.restoreAllMocks();
    });

    async function freshDb(): Promise<Or3DB> {
        const db = new Or3DB(`or3-test-quarantine-${crypto.randomUUID()}`);
        await db.open();
        databases.push(db);
        return db;
    }

    function message(id: string, content: string) {
        return {
            id, thread_id: 'thread-1', role: 'user' as const, index: 0, order_key: '2:0:local',
            data: { content }, deleted: false, created_at: 1, updated_at: 2,
            clock: 2, hlc: '2:0:local', op_id: testUuid(`${id}-op`),
        };
    }

    function document(id: string, title: string) {
        return {
            id, title, content: '{"type":"doc"}', postType: 'doc', deleted: false,
            created_at: 1, updated_at: 2, clock: 2, hlc: '2:0:local', op_id: testUuid(`${id}-op`),
        };
    }

    function corruptPut(tableName: 'messages' | 'posts', id: string, overrides: Partial<PendingOp> = {}): PendingOp {
        return {
            id: `pending-${id}`, tableName, operation: 'put', pk: id, payload: undefined,
            stamp: { clock: 2, hlc: '2:0:local', opId: testUuid(`${id}-op`), deviceId: 'local' },
            createdAt: 5, attempts: 0, status: 'pending', ...overrides,
        };
    }

    function manager(db: Or3DB, provider = new SpyProvider()) {
        return new OutboxManager(db, provider, scope);
    }

    it('preserves corrupt operations, rebuilds them from local rows and pushes the recovered content', async () => {
        const db = await freshDb();
        await db.messages.put(message('m1', 'my unsent reply'));
        await db.posts.put(document('d1', 'My notes'));
        const originals = [corruptPut('messages', 'm1'), corruptPut('posts', 'd1', { status: 'failed_permanent' })];
        await db.pending_ops.bulkPut(originals);

        const provider = new SpyProvider();
        const pushed: PushBatch['ops'] = [];
        provider.push = vi.fn(async (batch: PushBatch) => {
            pushed.push(...batch.ops);
            return { results: batch.ops.map((op) => ({ opId: op.stamp.opId, success: true })), serverVersion: 1 };
        });
        const outbox = manager(db, provider);

        await expect(outbox.quarantineCorruptOps()).resolves.toEqual({ quarantined: 2, repaired: 2 });

        // Nothing was lost: originals and local content are retained.
        const quarantined = await outbox.getQuarantined();
        expect(quarantined.map((entry) => entry.op)).toEqual(expect.arrayContaining(originals));
        expect(quarantined.every((entry) => entry.diagnostics.length > 0 && entry.localRow)).toBe(true);
        expect(await db.messages.get('m1')).toMatchObject({ data: { content: 'my unsent reply' } });

        // A second run finds nothing new and creates no duplicate recovery work.
        await expect(outbox.quarantineCorruptOps()).resolves.toEqual({ quarantined: 0, repaired: 0 });
        const queued = await db.pending_ops.toArray();
        expect(queued).toHaveLength(2);
        expect(queued.every((op) => op.status === 'pending' && !originals.some((o) => o.stamp.opId === op.stamp.opId))).toBe(true);

        // The rebuilt operations actually reach the provider with the real content.
        await outbox.flush();
        const byPk = new Map(pushed.map((op) => [op.pk, op]));
        expect(byPk.get('m1')?.payload).toMatchObject({ data: { content: 'my unsent reply' } });
        expect(byPk.get('d1')?.payload).toMatchObject({ title: 'My notes' });
        expect(byPk.get('m1')?.stamp.opId).toBe((await db.messages.get('m1'))?.op_id);
    });

    it('keeps ambiguous operations unresolved and exportable until explicitly discarded', async () => {
        const db = await freshDb();
        const orphan = corruptPut('messages', 'orphan');
        const stale = corruptPut('messages', 'stale');
        await db.messages.put({ ...message('stale', 'edited on another device'), clock: 9, hlc: '9:0:remote', op_id: testUuid('remote-op') });
        await db.pending_ops.bulkPut([orphan, stale]);
        const outbox = manager(db);

        await expect(outbox.quarantineCorruptOps()).resolves.toEqual({ quarantined: 2, repaired: 0 });

        expect(await db.pending_ops.count()).toBe(0);
        const exported = JSON.parse(await outbox.exportQuarantined()) as { entries: Array<{ id: string; status: string; op: PendingOp; localRow?: unknown }> };
        expect(exported.entries.map((entry) => [entry.id, entry.status]).sort()).toEqual([
            ['pending-orphan', 'quarantined'], ['pending-stale', 'quarantined'],
        ]);
        expect(exported.entries.find((entry) => entry.id === 'pending-stale')?.localRow).toMatchObject({ op_id: testUuid('remote-op') });
        // The local row is untouched by an ambiguous outcome.
        expect(await db.messages.get('stale')).toMatchObject({ op_id: testUuid('remote-op'), clock: 9 });

        await expect(outbox.discardQuarantined('pending-orphan')).resolves.toBe(true);
        await expect(outbox.discardQuarantined('pending-orphan')).resolves.toBe(false);
        expect((await db.sync_quarantine.get('pending-orphan'))?.status).toBe('discarded');
        expect((await db.sync_quarantine.get('pending-stale'))?.status).toBe('quarantined');
    });

    it('rebuilds a malformed delete under a new revision, re-stamps the tombstone, and leaves intact operations alone', async () => {
        const db = await freshDb();
        await db.tombstones.put({
            id: 'messages:gone', tableName: 'messages', pk: 'gone', deletedAt: 7,
            clock: 4, hlc: '4:0:local', opId: testUuid('gone-delete-op'),
        });
        const intact = {
            ...corruptPut('messages', 'fine'),
            payload: sanitizePayloadForSync('messages', message('fine', 'ok'), 'put'),
        };
        await db.pending_ops.bulkPut([
            { ...corruptPut('messages', 'gone'), operation: 'delete', stamp: { clock: 4, hlc: '', opId: testUuid('gone-delete-op'), deviceId: 'local' } },
            intact,
        ]);

        await expect(manager(db).quarantineCorruptOps()).resolves.toEqual({ quarantined: 1, repaired: 1 });

        const queued = await db.pending_ops.toArray();
        expect(queued.find((op) => op.id === intact.id)).toEqual(intact);
        const rebuilt = queued.find((op) => op.pk === 'gone')!;
        // The payload is rebuilt, so a server that already saw the original op_id must not see it again.
        expect(rebuilt).toMatchObject({ operation: 'delete', status: 'pending', stamp: { clock: 4 } });
        expect(rebuilt.stamp.opId).not.toBe(testUuid('gone-delete-op'));
        expect(rebuilt.stamp.hlc).not.toBe('');
        // The tombstone carries the same tuple, as live capture would leave it.
        expect(await db.tombstones.get('messages:gone')).toMatchObject({
            clock: 4, hlc: rebuilt.stamp.hlc, opId: rebuilt.stamp.opId,
        });
    });

    it('treats a stamp the push schema rejects as corrupt and rebuilds it from the local row', async () => {
        const db = await freshDb();
        const row = { ...message('m-legacy', 'legacy identity'), op_id: 'legacy-not-a-uuid' };
        await db.messages.put(row);
        const stamp = { clock: 2, hlc: '2:0:local', opId: 'legacy-not-a-uuid', deviceId: 'local' };
        const payload = sanitizePayloadForSync('messages', row, 'put');
        await db.pending_ops.bulkPut([
            { ...corruptPut('messages', 'm-legacy'), payload, stamp },
            { ...corruptPut('messages', 'm-nodevice'), payload: sanitizePayloadForSync('messages', message('m-nodevice', 'x'), 'put'),
                stamp: { clock: 2, hlc: '2:0:local', opId: testUuid('m-nodevice-op') } as never },
        ]);
        await db.messages.put(message('m-nodevice', 'no device on the stamp'));

        await expect(manager(db).quarantineCorruptOps()).resolves.toEqual({ quarantined: 2, repaired: 2 });

        const queued = await db.pending_ops.toArray();
        expect(queued).toHaveLength(2);
        for (const op of queued) {
            expect(op.stamp.opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(op.stamp.deviceId).toBeTruthy();
        }
        expect(await db.messages.get('m-legacy')).toMatchObject({ data: { content: 'legacy identity' } });
    });

    it('keeps an oversized message quarantined instead of failing the whole run', async () => {
        const db = await freshDb();
        await db.messages.put(message('m-huge', 'x'.repeat(300 * 1024)));
        await db.messages.put(message('m-fine', 'fine'));
        await db.pending_ops.bulkPut([corruptPut('messages', 'm-huge'), corruptPut('messages', 'm-fine')]);

        // Sanitizing the oversized row throws; that must not roll back the healthy repair next to it.
        await expect(manager(db).quarantineCorruptOps()).resolves.toEqual({ quarantined: 2, repaired: 1 });

        const huge = await db.sync_quarantine.get('pending-m-huge');
        expect(huge).toMatchObject({ status: 'quarantined' });
        expect(huge?.resolution).toMatch(/not valid for sync/);
        expect((huge?.localRow as { data: { content: string } }).data.content).toHaveLength(300 * 1024);
        expect(await db.messages.get('m-huge')).toBeDefined();
    });

    it('resolves a corrupt operation without new work when a newer queued operation already covers the record', async () => {
        const db = await freshDb();
        await db.messages.put({ ...message('m-newer', 'second edit'), clock: 3, hlc: '3:0:local', op_id: testUuid('second-op') });
        const newer: PendingOp = {
            ...corruptPut('messages', 'm-newer'), id: 'pending-newer',
            payload: sanitizePayloadForSync('messages', { ...message('m-newer', 'second edit'), clock: 3, hlc: '3:0:local', op_id: testUuid('second-op') }, 'put'),
            stamp: { clock: 3, hlc: '3:0:local', opId: testUuid('second-op'), deviceId: 'local' },
        };
        await db.pending_ops.bulkPut([corruptPut('messages', 'm-newer'), newer]);

        await expect(manager(db).quarantineCorruptOps()).resolves.toEqual({ quarantined: 1, repaired: 0 });

        expect(await db.pending_ops.toArray()).toEqual([newer]);
        expect(await db.sync_quarantine.get('pending-m-newer')).toMatchObject({ status: 'repaired' });
    });

    it('bounds resolved history but never prunes unresolved entries', async () => {
        const db = await freshDb();
        const now = Date.now();
        const entry = (id: string, status: 'repaired' | 'quarantined', resolvedAt?: number) => ({
            id, tableName: 'messages', pk: id, status, source: 'manual' as const, op: {}, diagnostics: ['x'],
            quarantinedAt: 1, resolvedAt,
        });
        await db.sync_quarantine.bulkPut([
            ...Array.from({ length: 205 }, (_, i) => entry(`resolved-${i}`, 'repaired', now - i)),
            entry('expired', 'repaired', now - 31 * 24 * 60 * 60 * 1000),
            entry('unresolved-old', 'quarantined'),
        ]);
        await db.pending_ops.put(corruptPut('messages', 'trigger'));

        await manager(db).quarantineCorruptOps();

        const ids = new Set((await db.sync_quarantine.toArray()).map((row) => row.id));
        expect(ids.has('unresolved-old')).toBe(true);
        expect(ids.has('expired')).toBe(false);
        expect([...ids].filter((id) => id.startsWith('resolved-'))).toHaveLength(200);
        expect(ids.has('resolved-0')).toBe(true);
        expect(ids.has('resolved-204')).toBe(false);
    });

    it('prunes resolved history after a discard and at startup, not only after a manual run', async () => {
        const db = await freshDb();
        const now = Date.now();
        const entry = (id: string, status: 'repaired' | 'quarantined', resolvedAt?: number) => ({
            id, tableName: 'messages', pk: id, status, source: 'manual' as const, op: {}, diagnostics: ['x'],
            quarantinedAt: 1, resolvedAt,
        });
        await db.sync_quarantine.bulkPut([
            ...Array.from({ length: 205 }, (_, i) => entry(`resolved-${i}`, 'repaired', now - i)),
            entry('open', 'quarantined'),
        ]);
        const resolved = async () => (await db.sync_quarantine.where('status').anyOf('repaired', 'discarded').count());
        const outbox = manager(db);

        await expect(outbox.discardQuarantined('open')).resolves.toBe(true);
        expect(await resolved()).toBe(200);

        // A later session starts with more resolved history than the bound allows.
        await db.sync_quarantine.bulkPut(Array.from({ length: 30 }, (_, i) => entry(`later-${i}`, 'repaired', now + 1 + i)));
        expect(await resolved()).toBe(230);
        await outbox.flush();
        expect(await resolved()).toBe(200);
    });

    it('refuses to run while a push owns the queue', async () => {
        const db = await freshDb();
        const outbox = manager(db);
        (outbox as unknown as { flushOwner: symbol | null }).flushOwner = Symbol('busy');
        await expect(outbox.quarantineCorruptOps()).rejects.toThrow(/push is running/);
    });
});
