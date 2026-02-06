import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClientAuthStatusResolver } from '~/composables/auth/useClientAuthStatus.client';

const logoutCleanup = vi.fn(async () => undefined);

vi.mock('~/utils/logout-cleanup', () => ({
    logoutCleanup,
}));

const sessionState = { value: { session: null as null | { authenticated: boolean; workspace?: { id?: string } } } };

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({
        data: sessionState,
        refresh: vi.fn(async () => sessionState.value),
    }),
}));

vi.mock('~/db/client', () => ({
    setActiveWorkspaceDb: vi.fn(),
}));

vi.mock('~/core/sync/cursor-manager', () => ({
    cleanupCursorManager: vi.fn(),
}));

vi.mock('~/core/sync/hook-bridge', () => ({
    cleanupHookBridge: vi.fn(),
}));

vi.mock('~/core/sync/subscription-manager', () => ({
    cleanupSubscriptionManager: vi.fn(),
}));

vi.mock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue');
    return {
        ...actual,
        watch: vi.fn(),
    };
});

describe('workspace logout cleanup plugin', () => {
    beforeEach(() => {
        vi.resetModules();
        logoutCleanup.mockClear();
        sessionState.value.session = null;
        (globalThis as typeof globalThis & {
            defineNuxtPlugin?: (plugin: () => unknown) => unknown;
            useRuntimeConfig?: () => { public: { ssrAuthEnabled: boolean } };
            useNuxtApp?: () => { provide: (key: string, value: unknown) => void };
        }).defineNuxtPlugin = (plugin) => plugin();
        (globalThis as typeof globalThis & {
            useRuntimeConfig?: () => { public: { ssrAuthEnabled: boolean } };
        }).useRuntimeConfig = () => ({
            public: { ssrAuthEnabled: true },
        });
        (globalThis as typeof globalThis & {
            useNuxtApp?: () => { provide: (key: string, value: unknown) => void };
        }).useNuxtApp = () => ({
            provide: vi.fn(),
        });
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated: undefined,
        }));
    });

    it('clears workspace DBs when session is unauthenticated on load', async () => {
        await import('~/plugins/00-workspace-db.client');
        expect(logoutCleanup).toHaveBeenCalledTimes(1);
    });

    it('does not clear workspace DBs when Clerk still has an active session', async () => {
        registerClientAuthStatusResolver(() => ({
            ready: true,
            authenticated: true,
        }));
        await import('~/plugins/00-workspace-db.client');
        expect(logoutCleanup).toHaveBeenCalledTimes(0);
    });
});
