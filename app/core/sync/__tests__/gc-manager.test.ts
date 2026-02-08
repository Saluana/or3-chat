import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GcManager } from '../gc-manager';

const nowSecMock = vi.hoisted(() => vi.fn(() => 1_000));
const doActionMock = vi.hoisted(() => vi.fn(async () => undefined));
const canRetryMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('~/db/util', () => ({
    nowSec: nowSecMock as any,
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: doActionMock as any,
    }),
}));

vi.mock('~~/shared/sync/circuit-breaker', () => ({
    getSyncCircuitBreaker: () => ({
        canRetry: canRetryMock as any,
    }),
}));

type TombstoneRow = {
    id: string;
    deletedAt: number;
    syncedAt?: number;
};

function makeDb(rows: TombstoneRow[] = []) {
    const tableRows = [...rows];
    const bulkDeleteMock = vi.fn(async (ids: string[]) => {
        for (const id of ids) {
            const idx = tableRows.findIndex((r) => r.id === id);
            if (idx >= 0) tableRows.splice(idx, 1);
        }
    });

    const toArrayMock = vi.fn(async () =>
        tableRows.filter((r) => r.deletedAt <= (makeDbState.cutoff ?? Infinity))
    );

    const makeDbState = {
        cutoff: undefined as number | undefined,
    };

    const db = {
        tombstones: {
            where: (_field: string) => ({
                belowOrEqual: (cutoff: number) => {
                    makeDbState.cutoff = cutoff;
                    return {
                        toArray: toArrayMock,
                    };
                },
            }),
            bulkDelete: bulkDeleteMock,
        },
    };

    return {
        db,
        bulkDeleteMock,
        toArrayMock,
        rows: tableRows,
    };
}

function makeProvider(overrides?: Partial<Record<string, unknown>>) {
    return {
        id: 'provider-1',
        mode: 'gateway' as const,
        subscribe: vi.fn(async () => vi.fn()),
        pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
        push: vi.fn(async () => ({ results: [], serverVersion: 0 })),
        updateCursor: vi.fn(async () => undefined),
        gcTombstones: vi.fn(async () => undefined),
        gcChangeLog: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
        ...overrides,
    };
}

describe('GcManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        nowSecMock.mockReset().mockReturnValue(1_000);
        doActionMock.mockReset();
        canRetryMock.mockReset().mockReturnValue(true);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('start schedules immediate run and periodic interval', async () => {
        const { db } = makeDb();
        const provider = makeProvider();

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            intervalMs: 100,
            idleTimeoutMs: 10,
            retentionSeconds: 100,
        });

        manager.start();

        await vi.advanceTimersByTimeAsync(10);
        expect(provider.gcTombstones).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(10);
        expect(provider.gcTombstones).toHaveBeenCalledTimes(2);
    });

    it('stop clears scheduled interval and idle timeout', async () => {
        const { db } = makeDb();
        const provider = makeProvider();

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            intervalMs: 100,
            idleTimeoutMs: 20,
        });

        manager.start();
        manager.stop();

        await vi.advanceTimersByTimeAsync(1000);
        expect(provider.gcTombstones).toHaveBeenCalledTimes(0);
    });

    it('deletes only tombstones older than cutoff with syncedAt <= cutoff', async () => {
        const { db, bulkDeleteMock } = makeDb([
            { id: 'eligible', deletedAt: 800, syncedAt: 700 },
            { id: 'not-synced', deletedAt: 800 },
            { id: 'too-new', deletedAt: 950, syncedAt: 940 },
        ]);
        const provider = makeProvider();

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            retentionSeconds: 100,
            idleTimeoutMs: 0,
            intervalMs: 10_000,
        });

        manager.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(bulkDeleteMock).toHaveBeenCalledWith(['eligible']);
    });

    it('skips provider GC calls when circuit breaker denies retry', async () => {
        canRetryMock.mockReturnValue(false);
        const { db } = makeDb();
        const provider = makeProvider();

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            idleTimeoutMs: 0,
        });

        manager.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(provider.gcTombstones).not.toHaveBeenCalled();
        expect(provider.gcChangeLog).not.toHaveBeenCalled();
    });

    it('handles optional provider GC capabilities', async () => {
        const { db } = makeDb();
        const provider = makeProvider({ gcTombstones: undefined, gcChangeLog: undefined });

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            idleTimeoutMs: 0,
        });

        manager.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(doActionMock).not.toHaveBeenCalledWith('sync.gc:action:error', expect.anything());
    });

    it('emits sync.gc:action:error when GC fails', async () => {
        const { db } = makeDb();
        const provider = makeProvider({
            gcTombstones: vi.fn(async () => {
                throw new Error('boom');
            }),
        });

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            idleTimeoutMs: 0,
        });

        manager.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(doActionMock).toHaveBeenCalledWith('sync.gc:action:error', {
            error: 'boom',
        });
    });

    it('prevents overlapping runs with re-entrancy guard', async () => {
        const gate = (() => {
            let resolve: () => void = () => undefined;
            const promise = new Promise<void>((r) => {
                resolve = () => r();
            });
            return { promise, resolve };
        })();

        const { db } = makeDb();
        const provider = makeProvider({
            gcTombstones: vi.fn(async () => {
                await gate.promise;
            }),
        });

        const manager = new GcManager(db as any, provider as any, { workspaceId: 'ws-1' }, {
            intervalMs: 10,
            idleTimeoutMs: 0,
        });

        manager.start();
        await vi.advanceTimersByTimeAsync(0);

        // Trigger several intervals while first run is still blocked.
        await vi.advanceTimersByTimeAsync(50);
        expect(provider.gcTombstones).toHaveBeenCalledTimes(1);

        gate.resolve();
        await Promise.resolve();
    });
});
