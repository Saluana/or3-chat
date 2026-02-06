import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testRuntimeConfig } from '~~/tests/setup';
import {
    registerAuthTokenBroker,
    useAuthTokenBroker,
} from '../useAuthTokenBroker.client';

describe('useAuthTokenBroker.client', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    beforeEach(() => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                ssrAuthEnabled: true,
            },
        };
        errorSpy.mockClear();
        registerAuthTokenBroker(() => ({
            async getProviderToken() {
                return null;
            },
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
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

    it('retrieves token and forwards template', async () => {
        const getTokenMock = vi.fn().mockResolvedValue('jwt-token');
        registerAuthTokenBroker(() => ({
            getProviderToken: getTokenMock,
        }));

        const broker = useAuthTokenBroker();
        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBe('jwt-token');

        expect(getTokenMock).toHaveBeenCalledWith({
            providerId: 'convex',
            template: 'convex-sync',
        });
    });

    it('uses the latest registered broker even if the instance was created earlier', async () => {
        const broker = useAuthTokenBroker();
        const lateGetTokenMock = vi.fn().mockResolvedValue('late-jwt-token');
        registerAuthTokenBroker(() => ({
            getProviderToken: lateGetTokenMock,
        }));

        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBe('late-jwt-token');
        expect(lateGetTokenMock).toHaveBeenCalledTimes(1);
    });

    it('swallows thrown errors and logs, returning null', async () => {
        const getTokenMock = vi.fn().mockRejectedValue(new Error('boom'));
        registerAuthTokenBroker(() => ({
            getProviderToken: getTokenMock,
        }));

        const broker = useAuthTokenBroker();
        await expect(
            broker.getProviderToken({ providerId: 'convex', template: 'convex-sync' })
        ).resolves.toBeNull();

        expect(errorSpy).toHaveBeenCalled();
    });
});
