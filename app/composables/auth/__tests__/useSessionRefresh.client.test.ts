import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVEX_JWT_TEMPLATE, CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

const getProviderTokenMock = vi.fn();
const onUnmountedMock = vi.hoisted(() => vi.fn());

vi.mock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue');
    return {
        ...actual,
        onUnmounted: (fn: () => void) => onUnmountedMock(fn),
    };
});

vi.mock('../useAuthTokenBroker.client', () => ({
    useAuthTokenBroker: () => ({
        getProviderToken: getProviderTokenMock as any,
    }),
}));

describe('useSessionRefresh.client', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getProviderTokenMock.mockReset().mockResolvedValue('token');
        onUnmountedMock.mockClear();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('starts timer once and does not duplicate intervals', async () => {
        const { useSessionRefresh } = await import('../useSessionRefresh.client');
        const { startRefresh } = useSessionRefresh();

        startRefresh(1000);
        startRefresh(1000);

        vi.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(getProviderTokenMock).toHaveBeenCalledTimes(1);
    });

    it('uses provider/template constants for refresh requests', async () => {
        const { useSessionRefresh } = await import('../useSessionRefresh.client');
        const { startRefresh } = useSessionRefresh();

        startRefresh(1000);
        vi.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(getProviderTokenMock).toHaveBeenCalledWith({
            providerId: CONVEX_PROVIDER_ID,
            template: CONVEX_JWT_TEMPLATE,
        });
    });

    it('logs warning when token refresh returns null', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        getProviderTokenMock.mockResolvedValue(null);

        const { useSessionRefresh } = await import('../useSessionRefresh.client');
        const { startRefresh } = useSessionRefresh();

        startRefresh(1000);
        vi.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(warnSpy).toHaveBeenCalledWith('[session-refresh] Failed to refresh token');
    });

    it('stopRefresh clears interval', async () => {
        const { useSessionRefresh } = await import('../useSessionRefresh.client');
        const { startRefresh, stopRefresh } = useSessionRefresh();

        startRefresh(1000);
        stopRefresh();

        vi.advanceTimersByTime(3000);
        await Promise.resolve();

        expect(getProviderTokenMock).toHaveBeenCalledTimes(0);
    });

    it('onUnmounted callback stops refresh interval', async () => {
        const { useSessionRefresh } = await import('../useSessionRefresh.client');
        const { startRefresh } = useSessionRefresh();

        startRefresh(1000);

        const callback = onUnmountedMock.mock.calls[0]?.[0] as (() => void) | undefined;
        expect(callback).toBeTypeOf('function');

        callback?.();
        vi.advanceTimersByTime(3000);
        await Promise.resolve();

        expect(getProviderTokenMock).toHaveBeenCalledTimes(0);
    });

    it('refresh errors are swallowed and do not crash caller', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getProviderTokenMock.mockRejectedValue(new Error('boom'));

        const { useSessionRefresh } = await import('../useSessionRefresh.client');
        const { startRefresh } = useSessionRefresh();

        expect(() => startRefresh(1000)).not.toThrow();

        vi.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalled();
    });
});
