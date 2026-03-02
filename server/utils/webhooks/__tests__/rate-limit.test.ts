/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWebhookRateLimit, resetWebhookRateLimits } from '../rate-limit';

afterEach(() => {
    resetWebhookRateLimits();
    vi.useRealTimers();
});

describe('webhook rate limiter', () => {
    it('allows requests under the limit', () => {
        expect(checkWebhookRateLimit('wh_1', 2).allowed).toBe(true);
        expect(checkWebhookRateLimit('wh_1', 2).allowed).toBe(true);
    });

    it('blocks requests at the limit', () => {
        checkWebhookRateLimit('wh_1', 1);

        const result = checkWebhookRateLimit('wh_1', 1);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });

    it('resets after the window expires', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'));

        expect(checkWebhookRateLimit('wh_1', 1).allowed).toBe(true);
        expect(checkWebhookRateLimit('wh_1', 1).allowed).toBe(false);

        vi.advanceTimersByTime(60_000);

        expect(checkWebhookRateLimit('wh_1', 1).allowed).toBe(true);
    });

    it('resets a single webhook bucket without affecting others', () => {
        expect(checkWebhookRateLimit('wh_1', 1).allowed).toBe(true);
        expect(checkWebhookRateLimit('wh_2', 1).allowed).toBe(true);
        expect(checkWebhookRateLimit('wh_1', 1).allowed).toBe(false);
        expect(checkWebhookRateLimit('wh_2', 1).allowed).toBe(false);

        resetWebhookRateLimits('wh_1');

        expect(checkWebhookRateLimit('wh_1', 1).allowed).toBe(true);
        expect(checkWebhookRateLimit('wh_2', 1).allowed).toBe(false);
    });
});
