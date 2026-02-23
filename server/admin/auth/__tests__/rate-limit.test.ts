import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useRuntimeConfigMock = vi.hoisted(() => vi.fn(() => ({
    security: {
        proxy: {
            trustProxy: false,
            forwardedForHeader: 'x-forwarded-for',
            forwardedHostHeader: 'x-forwarded-host',
        },
    },
})));

const normalizeProxyTrustConfigMock = vi.hoisted(() =>
    vi.fn((input: unknown) => input)
);
const getProxyAwareClientIpMock = vi.hoisted(() => vi.fn(() => '203.0.113.7'));

vi.mock('h3', async () => {
    const actual = await vi.importActual<typeof import('h3')>('h3');
    return {
        ...actual,
    };
});

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock,
}));

vi.mock('../../../utils/net/request-identity', () => ({
    normalizeProxyTrustConfig: normalizeProxyTrustConfigMock,
    getClientIp: getProxyAwareClientIpMock,
}));

import {
    checkRateLimit,
    checkGenericRateLimit,
    getClientIp,
    recordFailedAttempt,
} from '../rate-limit';

describe('admin auth rate limiter', () => {
    beforeEach(() => {
        vi.stubEnv('DISABLE_RATE_LIMIT', '0');
        useRuntimeConfigMock.mockClear();
        normalizeProxyTrustConfigMock.mockClear();
        getProxyAwareClientIpMock.mockClear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('resolves client IP via proxy-aware request identity helpers', () => {
        const event = {} as any;
        const ip = getClientIp(event);

        expect(ip).toBe('203.0.113.7');
        expect(useRuntimeConfigMock).toHaveBeenCalledWith(event);
        expect(normalizeProxyTrustConfigMock).toHaveBeenCalledWith({
            trustProxy: false,
            forwardedForHeader: 'x-forwarded-for',
            forwardedHostHeader: 'x-forwarded-host',
        });
        expect(getProxyAwareClientIpMock).toHaveBeenCalledWith(
            event,
            expect.objectContaining({ trustProxy: false })
        );
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

    it('persists first generic rate-limit request state', () => {
        const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
        const category = `admin-api-${Date.now()}`;

        const first = checkGenericRateLimit(ip, category);
        const second = checkGenericRateLimit(ip, category);
        const third = checkGenericRateLimit(ip, category);

        expect(first.allowed).toBe(true);
        expect(first.remaining).toBe(19);
        expect(second.allowed).toBe(true);
        expect(second.remaining).toBe(18);
        expect(third.allowed).toBe(true);
        expect(third.remaining).toBe(17);
    });
});
