/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWebhookRateLimit, resetWebhookRateLimits } from '../rate-limit';

afterEach(() => {
    resetWebhookRateLimits();
    vi.useRealTimers();
});

describe('webhook rate limiter', () => {
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
