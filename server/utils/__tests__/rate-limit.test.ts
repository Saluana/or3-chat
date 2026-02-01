/* @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, getRateLimitStatus } from '../rate-limit';

describe('checkRateLimit', () => {
    beforeEach(() => {
        // Reset module state
        vi.resetModules();
    });

    it('allows first request within limit', async () => {
        const allowed = await checkRateLimit('user-1', { max: 5, window: 60 });
        expect(allowed).toBe(true);
    });

    it('blocks requests exceeding limit', async () => {
        const key = 'user-2';
        const options = { max: 2, window: 60 };

        // First two requests allowed
        expect(await checkRateLimit(key, options)).toBe(true);
        expect(await checkRateLimit(key, options)).toBe(true);

        // Third request blocked
        expect(await checkRateLimit(key, options)).toBe(false);
    });

    it('resets counter after window expires', async () => {
        const key = 'user-3';
        const options = { max: 1, window: 0.001 }; // 1ms window

        // First request allowed
        expect(await checkRateLimit(key, options)).toBe(true);

        // Second request blocked
        expect(await checkRateLimit(key, options)).toBe(false);

        // Wait for window to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Request allowed again after window reset
        expect(await checkRateLimit(key, options)).toBe(true);
    });

    it('tracks different keys independently', async () => {
        const options = { max: 1, window: 60 };

        expect(await checkRateLimit('user-a', options)).toBe(true);
        expect(await checkRateLimit('user-b', options)).toBe(true);

        // Both should be blocked on second request
        expect(await checkRateLimit('user-a', options)).toBe(false);
        expect(await checkRateLimit('user-b', options)).toBe(false);
    });

    it('returns status for active entry', async () => {
        const key = 'user-4';
        await checkRateLimit(key, { max: 5, window: 60 });

        const status = getRateLimitStatus(key);
        expect(status).not.toBeNull();
        expect(status?.remaining).toBe(1);
        expect(status?.resetAt).toBeGreaterThan(Date.now());
    });

    it('returns null for unknown key', () => {
        const status = getRateLimitStatus('unknown-key');
        expect(status).toBeNull();
    });
});
