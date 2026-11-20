import { $fetch } from 'ofetch';
import { effectScope, ref, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#imports', async (importOriginal) => ({
    ...await importOriginal<typeof import('#imports')>(),
    useRuntimeConfig: () => useRuntimeConfig(),
}));

vi.mock('ofetch', () => ({ $fetch: vi.fn() }));

const logoutCleanup = vi.fn(async () => undefined);
const clearPersistedUserApiKey = vi.fn(async () => undefined);
let scope: EffectScope;

vi.mock('~/core/auth/useUserApiKey', () => ({ clearPersistedUserApiKey }));
const confirmClientSignedOut = vi.fn<
    typeof import('~/composables/auth/confirmClientSignedOut').confirmClientSignedOut
>(async () => false);

vi.mock('~/utils/logout-cleanup', async (importOriginal) => ({
    ...await importOriginal<typeof import('~/utils/logout-cleanup')>(),
    logoutCleanup,
}));

vi.mock('~/composables/auth/confirmClientSignedOut', async (importOriginal) => ({
    ...await importOriginal<typeof import('~/composables/auth/confirmClientSignedOut')>(),
    confirmClientSignedOut,
}));

const sessionState = ref({
    session: null as null | {
        authenticated: boolean;
        workspace?: { id?: string };
        user?: { id: string };
    },
});
const refreshSession = vi.fn(async () => sessionState.value);

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({
        data: sessionState,
        refresh: refreshSession,
    }),
}));

vi.mock('~/db/client', () => ({
    setActiveWorkspaceDb: vi.fn(),
}));

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({
        activeWorkspaceId: { value: null },
    }),
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
        watch: (...args: Parameters<typeof actual.watch>) => scope.run(() => actual.watch(...args)),
    };
});

describe('workspace logout cleanup plugin', () => {
    afterEach(() => { scope.stop(); vi.unstubAllGlobals(); });

    beforeEach(() => {
        scope = effectScope();
        vi.resetModules();
        clearPersistedUserApiKey.mockClear();
        logoutCleanup.mockClear();
        confirmClientSignedOut.mockReset().mockResolvedValue(false);
        sessionState.value.session = null;
        refreshSession.mockReset().mockResolvedValue(sessionState.value);
        (
            globalThis as typeof globalThis & {
                defineNuxtPlugin?: (plugin: () => unknown) => unknown;
                useRuntimeConfig?: () => {
                    public: { ssrAuthEnabled: boolean };
                };
                useNuxtApp?: () => {
                    provide: (key: string, value: unknown) => void;
                };
            }
        ).defineNuxtPlugin = (plugin) => plugin();
        (
            globalThis as typeof globalThis & {
                useRuntimeConfig?: () => {
                    public: { ssrAuthEnabled: boolean };
                };
            }
        ).useRuntimeConfig = () => ({
            public: { ssrAuthEnabled: true },
        });
        (
            globalThis as typeof globalThis & {
                useNuxtApp?: () => {
                    provide: (key: string, value: unknown) => void;
                };
            }
        ).useNuxtApp = () => ({
            provide: vi.fn(),
        });
    });

    it('does not clear workspace DBs when sign-out is not confirmed', async () => {
        confirmClientSignedOut.mockResolvedValue(false);
        await import('~/plugins/00-workspace-db.client');
        await vi.waitFor(() => {
            expect(confirmClientSignedOut).toHaveBeenCalled();
        });
        expect(logoutCleanup).toHaveBeenCalledTimes(0);
    });

    it.each(['renewed', 'rate-limited'])('preserves local data when a fresh Basic Auth check is %s', async (scenario) => {
        const config = () => ({ public: { ssrAuthEnabled: true, authProvider: 'basic-auth' } });
        vi.stubGlobal('useRuntimeConfig', config);
        const legacyStatus = vi.fn(async () => ({ ready: true, authenticated: false }));
        const { registerClientAuthStatusResolver } = await import('~/composables/auth/useClientAuthStatus.client');
        registerClientAuthStatusResolver(legacyStatus);
        const { confirmClientSignedOut: confirm } = await vi.importActual<
            typeof import('~/composables/auth/confirmClientSignedOut')
        >('~/composables/auth/confirmClientSignedOut');
        confirmClientSignedOut.mockImplementation((options?: Parameters<typeof confirm>[0]) =>
            confirm({ ...options, confirmMs: 0 })
        );
        const fetch = vi.mocked($fetch);
        fetch.mockReset();
        if (scenario === 'renewed') {
            fetch.mockResolvedValueOnce({ session: { authenticated: true } });
        } else {
            fetch.mockResolvedValueOnce({ session: null })
                .mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429 }));
        }

        try {
            const { default: initialization } = await import('~/plugins/00-workspace-db.client');
            await initialization;
            expect(logoutCleanup).not.toHaveBeenCalled();
            expect(fetch).toHaveBeenCalledTimes(scenario === 'renewed' ? 1 : 2);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('keeps startup recoverable without logout cleanup when the session check fails', async () => {
        refreshSession.mockRejectedValue(new Error('Session API unavailable'));
        confirmClientSignedOut.mockResolvedValue(true);

        const { default: initialization } = await import('~/plugins/00-workspace-db.client');

        await expect(initialization).resolves.toBeUndefined();
        expect(confirmClientSignedOut).not.toHaveBeenCalled();
        expect(logoutCleanup).not.toHaveBeenCalled();
    });

    it('clears workspace DBs when session is unauthenticated and sign-out is confirmed', async () => {
        confirmClientSignedOut.mockResolvedValue(true);
        await import('~/plugins/00-workspace-db.client');
        await vi.waitFor(() => {
            expect(logoutCleanup).toHaveBeenCalledTimes(1);
        });
        expect(logoutCleanup).toHaveBeenCalledWith(expect.anything(), {
            preservePluginSecrets: true,
        });
    });

    it('keeps PKCE markers while OpenRouter is returning to the callback page', async () => {
        window.history.replaceState({}, '', '/openrouter-callback');
        confirmClientSignedOut.mockResolvedValue(true);

        await import('~/plugins/00-workspace-db.client');

        await vi.waitFor(() => {
            expect(logoutCleanup).toHaveBeenCalledWith(expect.anything(), {
                preservePluginSecrets: true,
                preserveOpenRouterPkce: true,
            });
        });
        window.history.replaceState({}, '', '/');
    });

    it('invalidates device plugin credentials and the former API key on an account switch', async () => {
        sessionState.value = { session: { authenticated: true, user: { id: 'former' } } };
        const { default: initialization } = await import('~/plugins/00-workspace-db.client');
        await initialization;
        const key = 'or3.plugin.example.secret.credential';
        localStorage.setItem(key, 'former account credential');
        try {
            sessionState.value = { session: { authenticated: true, user: { id: 'new-owner' } } };
            expect(localStorage.getItem(key)).toBeNull();
            expect(clearPersistedUserApiKey).toHaveBeenCalledOnce();
            expect(logoutCleanup).not.toHaveBeenCalled();
        } finally {
            localStorage.removeItem(key);
        }
    });

    it('does not clear workspace DBs when session is authenticated', async () => {
        sessionState.value.session = { authenticated: true };
        confirmClientSignedOut.mockResolvedValue(true);
        await import('~/plugins/00-workspace-db.client');
        await Promise.resolve();
        expect(confirmClientSignedOut).not.toHaveBeenCalled();
        expect(logoutCleanup).toHaveBeenCalledTimes(0);
    });
});
