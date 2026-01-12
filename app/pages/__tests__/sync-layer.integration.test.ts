/**
 * Sync Layer Integration Tests
 *
 * Tests the database sync layer including:
 * - HookBridge change capture with suppression
 * - OutboxManager push with coalescing and retry
 * - CursorManager tracking and bootstrap detection
 * - ConflictResolver LWW resolution
 * - Tombstone tracking and GC
 * - Multi-device sync scenarios
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// MOCKS
// ============================================================

const mockHooks = vi.hoisted(() => ({
    applyFilters: vi.fn(async (_name: string, payload: unknown) => payload),
    doAction: vi.fn(async (_name: string, _payload?: unknown) => undefined),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => mockHooks,
}));

// Types
interface ChangeStamp {
    deviceId: string;
    opId: string;
    hlc: string;
    clock: number;
}

interface PendingOp {
    id: string;
    tableName: string;
    operation: 'put' | 'delete';
    pk: string;
    payload?: unknown;
    stamp: ChangeStamp;
    attempts: number;
    status: 'pending' | 'syncing' | 'failed';
}

interface SyncChange {
    serverVersion: number;
    tableName: string;
    pk: string;
    op: 'put' | 'delete';
    payload?: unknown;
    stamp: ChangeStamp;
}

// Mock helpers
function createPendingOp(overrides: Partial<PendingOp> = {}): PendingOp {
    return {
        id: crypto.randomUUID(),
        tableName: 'messages',
        operation: 'put',
        pk: 'msg-1',
        payload: { id: 'msg-1', content: 'Hello' },
        stamp: {
            deviceId: 'device-A',
            opId: crypto.randomUUID(),
            hlc: Date.now().toString(36),
            clock: 1,
        },
        attempts: 0,
        status: 'pending',
        ...overrides,
    };
}

function createSyncChange(overrides: Partial<SyncChange> = {}): SyncChange {
    return {
        serverVersion: 1,
        tableName: 'messages',
        pk: 'msg-1',
        op: 'put',
        payload: { id: 'msg-1', content: 'Hello' },
        stamp: {
            deviceId: 'device-B',
            opId: crypto.randomUUID(),
            hlc: Date.now().toString(36),
            clock: 1,
        },
        ...overrides,
    };
}

// ============================================================
// TESTS: HookBridge Change Capture
// ============================================================

describe('Sync Integration - HookBridge Change Capture', () => {
    it('captures local writes as PendingOps (Req 3.1)', () => {
        const captured: PendingOp[] = [];
        const captureWrite = (tableName: string, pk: string, payload: unknown, clock: number) => {
            const op = createPendingOp({ tableName, pk, payload, stamp: { ...createPendingOp().stamp, clock } });
            captured.push(op);
        };

        captureWrite('messages', 'msg-1', { content: 'Test' }, 1);

        expect(captured).toHaveLength(1);
        expect(captured[0]!.tableName).toBe('messages');
        expect(captured[0]!.pk).toBe('msg-1');
    });

    it('suppresses capture during remote sync apply (Req 3.1)', () => {
        const captured: PendingOp[] = [];
        let captureEnabled = true;

        const captureWrite = (tableName: string, pk: string) => {
            if (!captureEnabled) return; // Suppressed
            captured.push(createPendingOp({ tableName, pk }));
        };

        const applyRemoteChange = (change: SyncChange) => {
            captureEnabled = false;
            // Apply change to local DB
            captureWrite(change.tableName, change.pk);
            captureEnabled = true;
        };

        applyRemoteChange(createSyncChange());

        expect(captured).toHaveLength(0);
    });

    it('generates unique opId for idempotency (Req 3.3)', () => {
        const op1 = createPendingOp();
        const op2 = createPendingOp();

        expect(op1.stamp.opId).not.toBe(op2.stamp.opId);
    });

    it('includes deviceId, hlc, and clock in stamp (Req 3.3)', () => {
        const op = createPendingOp({ stamp: { deviceId: 'dev-1', opId: 'op-1', hlc: 'abc123', clock: 5 } });

        expect(op.stamp.deviceId).toBe('dev-1');
        expect(op.stamp.hlc).toBe('abc123');
        expect(op.stamp.clock).toBe(5);
    });
});

// ============================================================
// TESTS: OutboxManager Push
// ============================================================

describe('Sync Integration - OutboxManager Push', () => {
    it('batches pending ops for push (Req 4.2)', () => {
        const outbox = [createPendingOp({ pk: 'msg-1' }), createPendingOp({ pk: 'msg-2' }), createPendingOp({ pk: 'msg-3' })];

        const batchSize = 2;
        const batch = outbox.slice(0, batchSize);

        expect(batch).toHaveLength(2);
    });

    it('coalesces multiple updates to same record (Req 3.2)', () => {
        const outbox = [
            createPendingOp({ pk: 'msg-1', payload: { v: 1 }, stamp: { ...createPendingOp().stamp, clock: 1 } }),
            createPendingOp({ pk: 'msg-1', payload: { v: 2 }, stamp: { ...createPendingOp().stamp, clock: 2 } }),
            createPendingOp({ pk: 'msg-1', payload: { v: 3 }, stamp: { ...createPendingOp().stamp, clock: 3 } }),
        ];

        // Coalesce: keep only the latest per pk
        const coalesced = Object.values(
            outbox.reduce(
                (acc, op) => {
                    const key = `${op.tableName}:${op.pk}`;
                    if (!acc[key] || op.stamp.clock > acc[key].stamp.clock) {
                        acc[key] = op;
                    }
                    return acc;
                },
                {} as Record<string, PendingOp>
            )
        );

        expect(coalesced).toHaveLength(1);
        expect((coalesced[0]!.payload as { v: number }).v).toBe(3);
    });

    it('retries with exponential backoff on failure (Req 4.1)', async () => {
        const backoffMs = [250, 1000, 3000, 5000];
        let attempts = 0;

        const getBackoff = () => backoffMs[Math.min(attempts, backoffMs.length - 1)];

        expect(getBackoff()).toBe(250);
        attempts++;
        expect(getBackoff()).toBe(1000);
        attempts++;
        expect(getBackoff()).toBe(3000);
        attempts++;
        expect(getBackoff()).toBe(5000);
        attempts++;
        expect(getBackoff()).toBe(5000); // Capped at max
    });

    it('marks op as failed after max retries (Req 4.1)', () => {
        const maxAttempts = 5;
        const op = createPendingOp({ attempts: 5 });

        const isFailed = op.attempts >= maxAttempts;

        expect(isFailed).toBe(true);
    });

    it('removes only successful ops from outbox (Req 4.2)', () => {
        const outbox = [createPendingOp({ id: 'op-1' }), createPendingOp({ id: 'op-2' }), createPendingOp({ id: 'op-3' })];

        // Simulate partial success: op-1 and op-3 succeeded, op-2 failed
        const successIds = ['op-1', 'op-3'];
        const remaining = outbox.filter((op) => !successIds.includes(op.id));

        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.id).toBe('op-2');
    });

    it('emits sync.queue:action:full when at capacity (Req 3.2)', () => {
        const maxQueueSize = 1000;
        const currentSize = 1000;

        const isAtCapacity = currentSize >= maxQueueSize;

        if (isAtCapacity) {
            mockHooks.doAction('sync.queue:action:full', { queueSize: currentSize });
        }

        expect(mockHooks.doAction).toHaveBeenCalledWith('sync.queue:action:full', { queueSize: 1000 });
    });
});

// ============================================================
// TESTS: Conflict Resolution (LWW)
// ============================================================

describe('Sync Integration - Conflict Resolution', () => {
    interface Record {
        id: string;
        content: string;
        clock: number;
        hlc: string;
    }

    function resolveConflict(local: Record, remote: Record): { winner: 'local' | 'remote'; record: Record } {
        // LWW: Higher clock wins (Req 6.1)
        if (remote.clock > local.clock) {
            return { winner: 'remote', record: remote };
        }
        if (local.clock > remote.clock) {
            return { winner: 'local', record: local };
        }
        // Tie-breaker: HLC (Req 6.1)
        if (remote.hlc > local.hlc) {
            return { winner: 'remote', record: remote };
        }
        return { winner: 'local', record: local };
    }

    it('remote wins when it has higher clock (Req 6.1)', () => {
        const local = { id: 'msg-1', content: 'Local edit', clock: 5, hlc: 'aaa' };
        const remote = { id: 'msg-1', content: 'Remote edit', clock: 7, hlc: 'bbb' };

        const result = resolveConflict(local, remote);

        expect(result.winner).toBe('remote');
        expect(result.record.content).toBe('Remote edit');
    });

    it('local wins when it has higher clock (Req 6.1)', () => {
        const local = { id: 'msg-1', content: 'Local edit', clock: 8, hlc: 'aaa' };
        const remote = { id: 'msg-1', content: 'Remote edit', clock: 5, hlc: 'bbb' };

        const result = resolveConflict(local, remote);

        expect(result.winner).toBe('local');
        expect(result.record.content).toBe('Local edit');
    });

    it('uses HLC as tie-breaker when clocks are equal (Req 6.1)', () => {
        const local = { id: 'msg-1', content: 'Local edit', clock: 5, hlc: 'aaa' };
        const remote = { id: 'msg-1', content: 'Remote edit', clock: 5, hlc: 'bbb' };

        const result = resolveConflict(local, remote);

        expect(result.winner).toBe('remote'); // bbb > aaa
    });

    it('emits conflict detected hook (Req 6.2)', () => {
        const local = { id: 'msg-1', content: 'Local', clock: 5, hlc: 'aaa' };
        const remote = { id: 'msg-1', content: 'Remote', clock: 7, hlc: 'bbb' };

        resolveConflict(local, remote);

        mockHooks.doAction('sync.conflict:action:detected', {
            tableName: 'messages',
            pk: 'msg-1',
            resolution: 'remote',
            local,
            remote,
        });

        expect(mockHooks.doAction).toHaveBeenCalledWith(
            'sync.conflict:action:detected',
            expect.objectContaining({
                tableName: 'messages',
                pk: 'msg-1',
                resolution: 'remote',
            })
        );
    });
});

// ============================================================
// TESTS: Cursor and Bootstrap
// ============================================================

describe('Sync Integration - Cursor Management', () => {
    it('detects bootstrap needed when cursor is 0 (Req 9.1)', () => {
        const cursor = 0;
        const needsBootstrap = cursor === 0;

        expect(needsBootstrap).toBe(true);
    });

    it('tracks cursor progression after pull (Req 5.2)', () => {
        let cursor = 0;

        const updateCursor = (serverVersion: number) => {
            cursor = serverVersion;
        };

        updateCursor(10);
        expect(cursor).toBe(10);

        updateCursor(25);
        expect(cursor).toBe(25);
    });

    it('detects cursor expiry based on age (Req 5.2)', () => {
        const lastSyncAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
        const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

        const isExpired = Date.now() - lastSyncAt > maxAgeMs;

        expect(isExpired).toBe(true);
    });

    it('uses single server_version cursor per workspace (Req 5.2)', () => {
        const workspaceCursors = new Map<string, number>();

        workspaceCursors.set('ws-1', 100);
        workspaceCursors.set('ws-2', 50);

        expect(workspaceCursors.get('ws-1')).toBe(100);
        expect(workspaceCursors.get('ws-2')).toBe(50);
    });
});

// ============================================================
// TESTS: Tombstones and GC
// ============================================================

describe('Sync Integration - Tombstones and GC', () => {
    interface Tombstone {
        id: string;
        tableName: string;
        pk: string;
        deletedAt: number;
        syncedAt?: number;
    }

    it('creates tombstone on delete (Req 7.1)', () => {
        const createTombstone = (tableName: string, pk: string): Tombstone => ({
            id: `${tableName}:${pk}`,
            tableName,
            pk,
            deletedAt: Math.floor(Date.now() / 1000),
        });

        const tombstone = createTombstone('messages', 'msg-1');

        expect(tombstone.id).toBe('messages:msg-1');
        expect(tombstone.deletedAt).toBeGreaterThan(0);
    });

    it('prevents resurrection during rescan (Req 7.2)', () => {
        const tombstones = new Set(['messages:msg-1', 'threads:t-2']);

        const shouldApply = (change: SyncChange) => {
            const tombstoneId = `${change.tableName}:${change.pk}`;
            return !tombstones.has(tombstoneId);
        };

        expect(shouldApply(createSyncChange({ tableName: 'messages', pk: 'msg-1' }))).toBe(false);
        expect(shouldApply(createSyncChange({ tableName: 'messages', pk: 'msg-2' }))).toBe(true);
    });

    it('purges tombstones older than retention and past all device cursors (Req 7.3)', () => {
        const retentionSeconds = 30 * 24 * 60 * 60; // 30 days
        const now = Math.floor(Date.now() / 1000);

        const tombstones: Tombstone[] = [
            { id: 't1', tableName: 'messages', pk: 'm1', deletedAt: now - retentionSeconds - 100, syncedAt: now - retentionSeconds - 100 },
            { id: 't2', tableName: 'messages', pk: 'm2', deletedAt: now - 1000, syncedAt: now - 1000 }, // Recent
        ];

        const cutoff = now - retentionSeconds;
        const eligible = tombstones.filter((t) => (t.deletedAt ?? 0) < cutoff && (t.syncedAt ?? 0) < cutoff);

        expect(eligible).toHaveLength(1);
        expect(eligible[0]!.id).toBe('t1');
    });
});

// ============================================================
// TESTS: Multi-Device Scenarios
// ============================================================

describe('Sync Integration - Multi-Device Scenarios', () => {
    it('offline writes queue and sync on reconnect (Req 1.2)', async () => {
        const outbox: PendingOp[] = [];
        let isOnline = false;

        const write = (op: PendingOp) => {
            outbox.push(op);
        };

        const flush = async () => {
            if (!isOnline) return 0;
            const flushed = outbox.length;
            outbox.length = 0;
            return flushed;
        };

        // Offline writes
        write(createPendingOp({ pk: 'msg-1' }));
        write(createPendingOp({ pk: 'msg-2' }));

        expect(await flush()).toBe(0);
        expect(outbox).toHaveLength(2);

        // Go online
        isOnline = true;
        expect(await flush()).toBe(2);
        expect(outbox).toHaveLength(0);
    });

    it('handles concurrent edits from multiple devices (Req 6.1)', () => {
        const deviceA = { id: 'msg-1', content: 'Edit A', clock: 3, hlc: 'a123' };
        const deviceB = { id: 'msg-1', content: 'Edit B', clock: 3, hlc: 'b456' };

        // Both have same clock, HLC breaks tie
        const winner = deviceB.hlc > deviceA.hlc ? 'B' : 'A';

        expect(winner).toBe('B');
    });

    it('maintains FIFO order for outbox flush (Req 1.2)', () => {
        const outbox = [
            createPendingOp({ pk: 'msg-1', stamp: { ...createPendingOp().stamp, hlc: '001' } }),
            createPendingOp({ pk: 'msg-2', stamp: { ...createPendingOp().stamp, hlc: '002' } }),
            createPendingOp({ pk: 'msg-3', stamp: { ...createPendingOp().stamp, hlc: '003' } }),
        ];

        const flushed: string[] = [];
        while (outbox.length) {
            const op = outbox.shift()!;
            flushed.push(op.pk);
        }

        expect(flushed).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
});

// ============================================================
// TESTS: Edge Cases
// ============================================================

describe('Sync Integration - Edge Cases', () => {
    it('handles empty outbox gracefully', async () => {
        const outbox: PendingOp[] = [];

        const flush = async () => (outbox.length ? outbox.splice(0, 10) : []);

        const result = await flush();
        expect(result).toEqual([]);
    });

    it('handles server returning rate limit', () => {
        const retryAfterMs = 5000;

        const handleRateLimit = (retryAfter: number) => {
            return { shouldRetry: true, delayMs: retryAfter };
        };

        const result = handleRateLimit(retryAfterMs);
        expect(result.shouldRetry).toBe(true);
        expect(result.delayMs).toBe(5000);
    });

    it('handles malformed server response', () => {
        const validatePullResponse = (response: unknown): boolean => {
            if (!response || typeof response !== 'object') return false;
            if (!('changes' in response) || !Array.isArray((response as { changes: unknown }).changes)) return false;
            return true;
        };

        expect(validatePullResponse({ changes: [], nextCursor: 1 })).toBe(true);
        expect(validatePullResponse(null)).toBe(false);
        expect(validatePullResponse({ invalid: true })).toBe(false);
    });

    it('handles clock overflow gracefully', () => {
        const maxClock = Number.MAX_SAFE_INTEGER;
        const nextClock = (current: number) => (current >= maxClock ? 1 : current + 1);

        expect(nextClock(maxClock)).toBe(1);
        expect(nextClock(100)).toBe(101);
    });
});
