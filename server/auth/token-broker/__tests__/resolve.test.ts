import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';
import {
    resolveProviderToken,
    _resetProviderTokenCache,
} from '../resolve';

const getProviderTokenMock = vi.hoisted(() => vi.fn());

vi.mock('../registry', () => ({
    getProviderTokenBroker: vi.fn(() => ({
        getProviderToken: getProviderTokenMock,
    })),
}));

function makeEvent(cookie?: string): H3Event {
    return {
        context: {},
        node: {
            req: {
                headers: cookie ? { cookie } : {},
            },
        },
    } as H3Event;
}

describe('resolveProviderToken caching', () => {
    beforeEach(() => {
        _resetProviderTokenCache();
        getProviderTokenMock.mockReset().mockResolvedValue('token-1');
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                tokenCacheTtlMs: 10_000,
            },
        };
    });

    it('reuses broker token for equivalent request scope', async () => {
        const request = { providerId: 'convex', template: 'convex-sync' };

        const tokenA = await resolveProviderToken(makeEvent('session=a'), request);
        const tokenB = await resolveProviderToken(makeEvent('session=a'), request);

        expect(tokenA).toBe('token-1');
        expect(tokenB).toBe('token-1');
        expect(getProviderTokenMock).toHaveBeenCalledTimes(1);
    });

    it('does not reuse cache across different request scopes', async () => {
        const request = { providerId: 'convex', template: 'convex-sync' };

        await resolveProviderToken(makeEvent('session=a'), request);
        await resolveProviderToken(makeEvent('session=b'), request);

        expect(getProviderTokenMock).toHaveBeenCalledTimes(2);
    });

    it('expires cached tokens after ttl', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                tokenCacheTtlMs: 100,
            },
        };
        const request = { providerId: 'convex', template: 'convex-sync' };

        await resolveProviderToken(makeEvent('session=a'), request);
        vi.setSystemTime(new Date('2026-01-01T00:00:00.200Z'));
        await resolveProviderToken(makeEvent('session=a'), request);

        expect(getProviderTokenMock).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });
});
