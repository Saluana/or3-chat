import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClientAuthStatusResolver } from '~/composables/auth/useClientAuthStatus.client';
import {
    confirmClientSignedOut,
    DEFAULT_SIGNED_OUT_CONFIRM_MS,
} from '../confirmClientSignedOut';

describe('confirmClientSignedOut', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated: undefined,
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns false when auth status is not ready', async () => {
        registerClientAuthStatusResolver(() => ({
            ready: false,
            authenticated: undefined,
        }));

        const resultPromise = confirmClientSignedOut({ confirmMs: 400 });
        await vi.runAllTimersAsync();
        await expect(resultPromise).resolves.toBe(false);
    });

    it('returns false when authenticated is undefined', async () => {
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated: undefined,
        }));

        const resultPromise = confirmClientSignedOut({ confirmMs: 400 });
        await vi.runAllTimersAsync();
        await expect(resultPromise).resolves.toBe(false);
    });

    it('returns false when authenticated', async () => {
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated: true,
        }));

        const resultPromise = confirmClientSignedOut({ confirmMs: 400 });
        await vi.runAllTimersAsync();
        await expect(resultPromise).resolves.toBe(false);
    });

    it('returns true when signed-out is sustained across the confirm window', async () => {
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated: false,
        }));

        const resultPromise = confirmClientSignedOut({
            confirmMs: DEFAULT_SIGNED_OUT_CONFIRM_MS,
        });
        await vi.advanceTimersByTimeAsync(DEFAULT_SIGNED_OUT_CONFIRM_MS);
        await expect(resultPromise).resolves.toBe(true);
    });

    it('returns false when status flips back to authenticated mid-wait', async () => {
        let authenticated: boolean | undefined = false;
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated,
        }));

        const resultPromise = confirmClientSignedOut({ confirmMs: 400 });
        authenticated = true;
        await vi.advanceTimersByTimeAsync(400);
        await expect(resultPromise).resolves.toBe(false);
    });
});
