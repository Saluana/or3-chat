import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRequestIPMock = vi.hoisted(() => vi.fn(() => '203.0.113.7'));

vi.mock('h3', async () => {
    const actual = await vi.importActual<typeof import('h3')>('h3');
    return {
        ...actual,
        getRequestIP: getRequestIPMock,
    };
});

import {
    checkRateLimit,
    getClientIp,
    recordFailedAttempt,
} from '../rate-limit';

describe('admin auth rate limiter', () => {
    beforeEach(() => {
        vi.stubEnv('DISABLE_RATE_LIMIT', '0');
        getRequestIPMock.mockClear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('uses getRequestIP with trusted forwarded-for handling', () => {
        const event = {} as any;
        const ip = getClientIp(event);

        expect(ip).toBe('203.0.113.7');
        expect(getRequestIPMock).toHaveBeenCalledWith(event, {
            xForwardedFor: true,
        });
    });

    it('supports explicit rate-limit disable flag', () => {
        vi.stubEnv('DISABLE_RATE_LIMIT', '1');

        const result = checkRateLimit('198.51.100.10', 'admin');

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThan(0);
    });

    it('enforces limits when disable flag is not set', () => {
        const ip = '198.51.100.11';
        const username = `admin-${Date.now()}`;

        for (let i = 0; i < 5; i++) {
            recordFailedAttempt(ip, username);
        }

        const result = checkRateLimit(ip, username);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });
});
