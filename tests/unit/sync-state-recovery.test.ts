import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingOp } from '../../shared/sync/types';

// Mock the outbox syncing state recovery behavior
// This tests the logic that was added to fix Issue 8

describe('Outbox Syncing State Recovery (Issue 8)', () => {
    // Simulated pending ops database
    let pendingOps: PendingOp[] = [];

    beforeEach(() => {
        pendingOps = [];
    });

    function createMockPendingOp(overrides: Partial<PendingOp> = {}): PendingOp {
        return {
            id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            tableName: 'messages',
            pk: 'msg-123',
            operation: 'put',
            payload: { content: 'test' },
            stamp: {
                opId: `stamp-${Date.now()}`,
                hlc: `${Date.now()}:0:device1`,
                clock: 1,
                deviceId: 'device1',
            },
            status: 'pending',
            createdAt: Date.now(),
            attempts: 0,
            ...overrides,
        };
    }

    /**
     * Simulates the fix for Issue 8: Reset stale 'syncing' ops to 'pending' on startup
     */
    async function resetSyncingOpsOnStartup(): Promise<void> {
        // This is the fix that was added to outbox-manager.ts
        // Lines 123-127: Reset any syncing ops (e.g., after a crash) back to pending
        pendingOps = pendingOps.map((op) => {
            if (op.status === 'syncing') {
                return {
                    ...op,
                    status: 'pending' as const,
                    nextAttemptAt: Date.now(),
                };
            }
            return op;
        });
    }

    it('should reset syncing ops to pending on startup', async () => {
        // Simulate ops that got stuck in 'syncing' due to crash
        pendingOps = [
            createMockPendingOp({ id: 'op1', status: 'syncing' }),
            createMockPendingOp({ id: 'op2', status: 'syncing' }),
            createMockPendingOp({ id: 'op3', status: 'pending' }),
        ];

        await resetSyncingOpsOnStartup();

        expect(pendingOps[0]?.status).toBe('pending');
        expect(pendingOps[1]?.status).toBe('pending');
        expect(pendingOps[2]?.status).toBe('pending');
    });

    it('should set nextAttemptAt for recovered ops', async () => {
        const before = Date.now();
        
        pendingOps = [
            createMockPendingOp({ id: 'op1', status: 'syncing', nextAttemptAt: undefined }),
        ];

        await resetSyncingOpsOnStartup();

        const after = Date.now();
        const nextAttemptAt = pendingOps[0]?.nextAttemptAt;

        expect(nextAttemptAt).toBeDefined();
        expect(nextAttemptAt).toBeGreaterThanOrEqual(before);
        expect(nextAttemptAt).toBeLessThanOrEqual(after);
    });

    it('should not modify already pending ops', async () => {
        const originalOp = createMockPendingOp({ 
            id: 'op1', 
            status: 'pending',
            nextAttemptAt: Date.now() + 5000 // Already scheduled for future
        });
        pendingOps = [originalOp];

        await resetSyncingOpsOnStartup();

        expect(pendingOps[0]?.status).toBe('pending');
        expect(pendingOps[0]?.nextAttemptAt).toBe(originalOp.nextAttemptAt);
    });

    it('should not modify failed ops', async () => {
        pendingOps = [
            createMockPendingOp({ id: 'op1', status: 'failed', attempts: 5 }),
        ];

        await resetSyncingOpsOnStartup();

        expect(pendingOps[0]?.status).toBe('failed');
        expect(pendingOps[0]?.attempts).toBe(5);
    });
});

describe('Circuit Breaker Per-Workspace (Issue 4)', () => {
    type CircuitState = 'closed' | 'open' | 'half-open';
    
    class MockCircuitBreaker {
        private failureCount = 0;
        private lastFailureTime = 0;
        private openedAt = 0;
        private state: CircuitState = 'closed';
        private failureThreshold = 5;
        private openDurationMs = 30000;

        canRetry(): boolean {
            this.updateState();
            return this.state !== 'open';
        }

        recordSuccess(): void {
            this.failureCount = 0;
            this.state = 'closed';
            this.openedAt = 0;
        }

        recordFailure(): void {
            this.failureCount++;
            this.lastFailureTime = Date.now();

            if (this.failureCount >= this.failureThreshold) {
                this.state = 'open';
                this.openedAt = Date.now();
            }
        }

        getState(): CircuitState {
            this.updateState();
            return this.state;
        }

        private updateState(): void {
            const now = Date.now();
            if (this.state === 'open' && now - this.openedAt > this.openDurationMs) {
                this.state = 'half-open';
            }
        }
    }

    const breakers = new Map<string, MockCircuitBreaker>();

    function getCircuitBreaker(key: string): MockCircuitBreaker {
        if (!breakers.has(key)) {
            breakers.set(key, new MockCircuitBreaker());
        }
        return breakers.get(key)!;
    }

    beforeEach(() => {
        breakers.clear();
    });

    it('should create separate circuit breakers per workspace', () => {
        const ws1Breaker = getCircuitBreaker('workspace1:convex');
        const ws2Breaker = getCircuitBreaker('workspace2:convex');

        expect(ws1Breaker).not.toBe(ws2Breaker);
    });

    it('should isolate failures between workspaces', () => {
        const ws1Breaker = getCircuitBreaker('workspace1:convex');
        const ws2Breaker = getCircuitBreaker('workspace2:convex');

        // Fail workspace1 5 times (enough to trip breaker)
        for (let i = 0; i < 5; i++) {
            ws1Breaker.recordFailure();
        }

        // Workspace1 should be open (blocked)
        expect(ws1Breaker.getState()).toBe('open');
        expect(ws1Breaker.canRetry()).toBe(false);

        // Workspace2 should still be closed (working)
        expect(ws2Breaker.getState()).toBe('closed');
        expect(ws2Breaker.canRetry()).toBe(true);
    });

    it('should return same breaker for same key', () => {
        const breaker1 = getCircuitBreaker('workspace1:convex');
        const breaker2 = getCircuitBreaker('workspace1:convex');

        expect(breaker1).toBe(breaker2);
    });
});
