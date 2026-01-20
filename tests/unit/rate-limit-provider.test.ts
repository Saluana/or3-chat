/**
 * Rate Limit Provider Unit Tests
 *
 * Tests the memory provider and rate limit logic.
 * Convex provider is tested via integration tests.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MemoryRateLimitProvider } from '../../server/utils/rate-limit/providers/memory';

describe('MemoryRateLimitProvider', () => {
    let provider: MemoryRateLimitProvider;

    beforeEach(() => {
        // Create fresh provider for each test
        provider = new MemoryRateLimitProvider();
    });

    const config = {
        windowMs: 60_000, // 1 minute
        maxRequests: 5,
    };

    it('allows first request', async () => {
        const result = await provider.checkAndRecord('test:user1', config);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4);
    });

    it('tracks remaining requests correctly', async () => {
        const key = 'test:user2';

        for (let i = 0; i < 4; i++) {
            await provider.checkAndRecord(key, config);
        }

        const result = await provider.checkAndRecord(key, config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(0);
    });

    it('blocks requests after limit exceeded', async () => {
        const key = 'test:user3';

        // Use up all requests
        for (let i = 0; i < 5; i++) {
            await provider.checkAndRecord(key, config);
        }

        // Next request should be blocked
        const result = await provider.checkAndRecord(key, config);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
        expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('isolates different keys', async () => {
        // Exhaust limit for user1
        for (let i = 0; i < 5; i++) {
            await provider.checkAndRecord('test:user4a', config);
        }

        // user2 should still be allowed
        const result = await provider.checkAndRecord('test:user4b', config);
        expect(result.allowed).toBe(true);
    });

    it('resets after window expires', async () => {
        const key = 'test:user5';
        const shortConfig = { windowMs: 50, maxRequests: 2 };

        // Use up limit
        await provider.checkAndRecord(key, shortConfig);
        await provider.checkAndRecord(key, shortConfig);

        // Should be blocked
        let result = await provider.checkAndRecord(key, shortConfig);
        expect(result.allowed).toBe(false);

        // Wait for window to expire
        await new Promise((r) => setTimeout(r, 60));

        // Should be allowed again
        result = await provider.checkAndRecord(key, shortConfig);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(1);
    });

    it('getStats returns correct values', async () => {
        const key = 'test:user6';

        await provider.checkAndRecord(key, config);
        await provider.checkAndRecord(key, config);

        const stats = await provider.getStats(key, config);
        expect(stats).not.toBeNull();
        expect(stats!.limit).toBe(5);
        expect(stats!.remaining).toBe(3);
        expect(stats!.resetMs).toBeGreaterThan(0);
    });

    it('getStats returns full remaining for unknown key', async () => {
        const stats = await provider.getStats('test:unknown', config);
        expect(stats).not.toBeNull();
        expect(stats!.remaining).toBe(5);
    });
});
