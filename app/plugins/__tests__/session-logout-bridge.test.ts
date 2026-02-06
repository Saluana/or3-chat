import { beforeEach, describe, expect, it, vi } from 'vitest';

const logoutCleanup = vi.fn(async () => undefined);
vi.mock('~/utils/logout-cleanup', () => ({
    logoutCleanup,
}));

const sessionState = { value: { session: { authenticated: true } as any } };
const refresh = vi.fn(async () => {
    sessionState.value.session = null;
    return sessionState.value;
});
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({
        data: sessionState,
        refresh,
    }),
}));

let clerkListener: (() => void) | null = null;
const clerkClient = {
    loaded: true,
    session: null as unknown,
    addListener: (cb: () => void) => {
        clerkListener = cb;
        return () => {
            clerkListener = null;
        };
    },
};

describe('session logout bridge', () => {
    beforeEach(() => {
        vi.resetModules();
        logoutCleanup.mockClear();
        refresh.mockClear();
        sessionState.value.session = { authenticated: true };
        clerkClient.session = { id: 'sess-1' };
        (globalThis as typeof globalThis & { Clerk?: unknown }).Clerk =
            clerkClient;
        (globalThis as typeof globalThis & { defineNuxtPlugin?: unknown }).defineNuxtPlugin =
            (plugin: () => unknown) => plugin();
        (globalThis as typeof globalThis & { useRuntimeConfig?: unknown }).useRuntimeConfig =
            () => ({
                public: { ssrAuthEnabled: true },
            });
        (globalThis as typeof globalThis & { useNuxtApp?: unknown }).useNuxtApp =
            () => ({ $syncEngine: { stop: vi.fn() } });
    });

    it('clears workspace DBs when Clerk listener reports sign-out', async () => {
        clerkClient.session = null;
        await import('or3-provider-clerk/src/runtime/plugins/session-logout-bridge.client');
        expect(typeof clerkListener).toBe('function');
        await clerkListener?.();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(logoutCleanup).toHaveBeenCalledTimes(1);
    });

    it('does not clear workspace DBs when Clerk still has an active session', async () => {
        clerkClient.session = { id: 'sess-1' };
        await import('or3-provider-clerk/src/runtime/plugins/session-logout-bridge.client');
        expect(typeof clerkListener).toBe('function');
        await clerkListener?.();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(logoutCleanup).toHaveBeenCalledTimes(0);
    });
});
