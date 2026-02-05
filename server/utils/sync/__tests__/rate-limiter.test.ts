/**
 * @module server/utils/sync/__tests__/rate-limiter.test
 *
 * Purpose:
 * Validate sync, storage, and auth rate limit behavior.
 *
 * Behavior:
 * - Enforces sliding window limits per subject and operation.
 * - Isolates subjects and operations from each other.
 * - Handles unknown operations by allowing requests.
 *
 * Non-Goals:
 * - Distributed rate limit verification.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    resetSyncRateLimits,
    getSyncRateLimitStats,
    SYNC_RATE_LIMITS,
    AUTH_RATE_LIMITS,
    STORAGE_RATE_LIMITS,
    ALL_RATE_LIMITS,
} from '../rate-limiter';

describe('sync rate limiter', () => {
    beforeEach(() => {
        // Reset all rate limits before each test
        resetSyncRateLimits();
        // Rate limiter bypasses checks in non-production; mock to production for tests
        vi.stubEnv('NODE_ENV', 'production');
    });

    describe('checkSyncRateLimit', () => {
        it('should allow first request', () => {
            const result = checkSyncRateLimit('user-1', 'sync:push');

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests);
        });

        it('should return allowed=true for unknown operations', () => {
            const result = checkSyncRateLimit('user-1', 'unknown:operation');

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(Infinity);
        });

        it('should track remaining requests correctly', () => {
            // Record some requests
            recordSyncRequest('user-1', 'sync:push');
            recordSyncRequest('user-1', 'sync:push');
            recordSyncRequest('user-1', 'sync:push');

            const result = checkSyncRateLimit('user-1', 'sync:push');

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests - 3);
        });

        it('should block when limit is exceeded', () => {
            const limit = SYNC_RATE_LIMITS['sync:push']!.maxRequests;

            // Record requests up to the limit
            for (let i = 0; i < limit; i++) {
                recordSyncRequest('user-1', 'sync:push');
            }

            const result = checkSyncRateLimit('user-1', 'sync:push');

            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
            expect(result.retryAfterMs).toBeGreaterThan(0);
        });

        it('should isolate rate limits between users', () => {
            const limit = SYNC_RATE_LIMITS['sync:push']!.maxRequests;

            // Max out user-1
            for (let i = 0; i < limit; i++) {
                recordSyncRequest('user-1', 'sync:push');
            }

            // User-2 should still be allowed
            const result = checkSyncRateLimit('user-2', 'sync:push');

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(limit);
        });

        it('should isolate rate limits between operations', () => {
            const pushLimit = SYNC_RATE_LIMITS['sync:push']!.maxRequests;

            // Max out push
            for (let i = 0; i < pushLimit; i++) {
                recordSyncRequest('user-1', 'sync:push');
            }

            // Pull should still be allowed
            const result = checkSyncRateLimit('user-1', 'sync:pull');

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(SYNC_RATE_LIMITS['sync:pull']!.maxRequests);
        });
    });

    describe('recordSyncRequest', () => {
        it('should not throw for unknown operations', () => {
            expect(() => recordSyncRequest('user-1', 'unknown:operation')).not.toThrow();
        });

        it('should record requests that affect subsequent checks', () => {
            const before = checkSyncRateLimit('user-1', 'sync:push');

            recordSyncRequest('user-1', 'sync:push');

            const after = checkSyncRateLimit('user-1', 'sync:push');

            expect(after.remaining).toBe(before.remaining - 1);
        });
    });

    describe('resetSyncRateLimits', () => {
        it('should reset limits for specific user', () => {
            recordSyncRequest('user-1', 'sync:push');
            recordSyncRequest('user-2', 'sync:push');

            resetSyncRateLimits('user-1');

            const user1Result = checkSyncRateLimit('user-1', 'sync:push');
            const user2Result = checkSyncRateLimit('user-2', 'sync:push');

            expect(user1Result.remaining).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests);
            expect(user2Result.remaining).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests - 1);
        });

        it('should reset all limits when no user specified', () => {
            recordSyncRequest('user-1', 'sync:push');
            recordSyncRequest('user-2', 'sync:pull');

            resetSyncRateLimits();

            const user1Result = checkSyncRateLimit('user-1', 'sync:push');
            const user2Result = checkSyncRateLimit('user-2', 'sync:pull');

            expect(user1Result.remaining).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests);
            expect(user2Result.remaining).toBe(SYNC_RATE_LIMITS['sync:pull']!.maxRequests);
        });
    });

    describe('getSyncRateLimitStats', () => {
        it('should return stats for known operations', () => {
            recordSyncRequest('user-1', 'sync:push');

            const stats = getSyncRateLimitStats('user-1', 'sync:push');

            expect(stats).not.toBeNull();
            expect(stats!.limit).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests);
            expect(stats!.remaining).toBe(SYNC_RATE_LIMITS['sync:push']!.maxRequests - 1);
            expect(stats!.resetMs).toBe(SYNC_RATE_LIMITS['sync:push']!.windowMs);
        });

        it('should return null for unknown operations', () => {
            const stats = getSyncRateLimitStats('user-1', 'unknown:operation');

            expect(stats).toBeNull();
        });
    });

    describe('sliding window behavior', () => {
        it('should allow requests after window expires', async () => {
            // Use a mock timer to avoid actual waiting
            vi.useFakeTimers();

            const limit = SYNC_RATE_LIMITS['sync:cursor']!.maxRequests; // Use cursor (smallest limit)
            const windowMs = SYNC_RATE_LIMITS['sync:cursor']!.windowMs;

            // Max out the limit
            for (let i = 0; i < limit; i++) {
                recordSyncRequest('user-1', 'sync:cursor');
            }

            // Should be blocked
            expect(checkSyncRateLimit('user-1', 'sync:cursor').allowed).toBe(false);

            // Advance time past the window
            vi.advanceTimersByTime(windowMs + 1000);

            // Should be allowed again
            expect(checkSyncRateLimit('user-1', 'sync:cursor').allowed).toBe(true);

            vi.useRealTimers();
        });
    });

    describe('auth rate limits', () => {
        it('should enforce auth:session rate limit', () => {
            const limit = AUTH_RATE_LIMITS['auth:session']!.maxRequests;

            // Record requests up to the limit
            for (let i = 0; i < limit; i++) {
                recordSyncRequest('ip-192.168.1.1', 'auth:session');
            }

            const result = checkSyncRateLimit('ip-192.168.1.1', 'auth:session');

            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should treat auth:session subject as generic key (IP)', () => {
            const result = checkSyncRateLimit('192.168.1.1', 'auth:session');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(AUTH_RATE_LIMITS['auth:session']!.maxRequests);
        });
    });

    describe('storage rate limits', () => {
        it('should enforce storage:commit rate limit', () => {
            const limit = STORAGE_RATE_LIMITS['storage:commit']!.maxRequests;

            // Record requests up to the limit
            for (let i = 0; i < limit; i++) {
                recordSyncRequest('user-1', 'storage:commit');
            }

            const result = checkSyncRateLimit('user-1', 'storage:commit');

            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should treat storage:commit subject as generic key (userId)', () => {
            const result = checkSyncRateLimit('user-123', 'storage:commit');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(STORAGE_RATE_LIMITS['storage:commit']!.maxRequests);
        });
    });

    describe('rate limit configuration', () => {
        it('should have auth:session in ALL_RATE_LIMITS', () => {
            expect(ALL_RATE_LIMITS['auth:session']).toBeDefined();
            expect(ALL_RATE_LIMITS['auth:session']!.maxRequests).toBe(60);
            expect(ALL_RATE_LIMITS['auth:session']!.windowMs).toBe(60000);
        });

        it('should have storage:commit in ALL_RATE_LIMITS', () => {
            expect(ALL_RATE_LIMITS['storage:commit']).toBeDefined();
            expect(ALL_RATE_LIMITS['storage:commit']!.maxRequests).toBe(30);
            expect(ALL_RATE_LIMITS['storage:commit']!.windowMs).toBe(60000);
        });

        it('should allow unknown operations (no limit configured)', () => {
            const result = checkSyncRateLimit('user-1', 'unknown:new-operation');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(Infinity);
        });
    });
});
