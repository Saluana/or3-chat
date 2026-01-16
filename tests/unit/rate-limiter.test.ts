import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    resetSyncRateLimits,
    STORAGE_RATE_LIMITS,
} from '../../server/utils/sync/rate-limiter';

describe('Rate Limiter', () => {
    const userId = 'user-123';

    beforeEach(() => {
        resetSyncRateLimits();
    });

    it('should allow requests within limit for storage:upload', () => {
        const operation = 'storage:upload';
        const limit = STORAGE_RATE_LIMITS[operation].maxRequests;

        for (let i = 0; i < limit; i++) {
            const result = checkSyncRateLimit(userId, operation);
            expect(result.allowed).toBe(true);
            recordSyncRequest(userId, operation);
        }
    });

    it('should block requests exceeding limit for storage:upload', () => {
        const operation = 'storage:upload';
        const limit = STORAGE_RATE_LIMITS[operation].maxRequests;

        for (let i = 0; i < limit; i++) {
            recordSyncRequest(userId, operation);
        }

        const result = checkSyncRateLimit(userId, operation);
        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should respect storage:download limit', () => {
        const operation = 'storage:download';
        const limit = STORAGE_RATE_LIMITS[operation].maxRequests;

        // Fill up to limit
        for (let i = 0; i < limit; i++) {
            recordSyncRequest(userId, operation);
        }

        const result = checkSyncRateLimit(userId, operation);
        expect(result.allowed).toBe(false);
    });

    it('should operate independently for different users', () => {
        const operation = 'storage:upload';
        const limit = STORAGE_RATE_LIMITS[operation].maxRequests;
        const user2 = 'user-456';

        // Fill up user1
        for (let i = 0; i < limit; i++) {
            recordSyncRequest(userId, operation);
        }

        expect(checkSyncRateLimit(userId, operation).allowed).toBe(false);
        expect(checkSyncRateLimit(user2, operation).allowed).toBe(true);
    });
});
