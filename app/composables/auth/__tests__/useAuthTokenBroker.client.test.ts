import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testRuntimeConfig } from '~~/tests/setup';
import { useAuthTokenBroker } from '../useAuthTokenBroker.client';

describe('useAuthTokenBroker.client', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const windowWithClerk = () => window as unknown as Record<string, unknown>;

    beforeEach(() => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                ssrAuthEnabled: true,
            },
        };
        warnSpy.mockClear();
        errorSpy.mockClear();
        Reflect.deleteProperty(windowWithClerk(), 'Clerk');
    });

    afterEach(() => {
        vi.useRealTimers();
        Reflect.deleteProperty(windowWithClerk(), 'Clerk');
    });

    it('returns null when ssrAuthEnabled is false', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                ssrAuthEnabled: false,
            },
        };

        const broker = useAuthTokenBroker();
        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBeNull();
    });

    it('waits for Clerk and times out cleanly', async () => {
        vi.useFakeTimers();
        const broker = useAuthTokenBroker();

        const tokenPromise = broker.getProviderToken({
            providerId: 'convex',
            template: 'convex-sync',
        });

        vi.advanceTimersByTime(5100);
        await expect(tokenPromise).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('[auth-token-broker] Clerk load timeout');
    });

    it('returns null when Clerk has no session', async () => {
        windowWithClerk().Clerk = { session: null };

        const broker = useAuthTokenBroker();
        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBeNull();
    });

    it('retrieves token and forwards template', async () => {
        const getTokenMock = vi.fn().mockResolvedValue('jwt-token');
        windowWithClerk().Clerk = {
            session: { getToken: getTokenMock },
        };

        const broker = useAuthTokenBroker();
        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBe('jwt-token');

        expect(getTokenMock).toHaveBeenCalledWith({ template: 'convex-sync' });
    });

    it('swallows thrown errors and logs, returning null', async () => {
        const getTokenMock = vi.fn().mockRejectedValue(new Error('boom'));
        windowWithClerk().Clerk = {
            session: { getToken: getTokenMock },
        };

        const broker = useAuthTokenBroker();
        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBeNull();

        expect(errorSpy).toHaveBeenCalled();
    });
});
