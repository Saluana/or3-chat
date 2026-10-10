import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearWorkspaceDbsOnLogout = vi.fn(async () => undefined);
vi.mock('~/utils/workspace-db-logout', () => ({
    clearWorkspaceDbsOnLogout,
}));

const kvDelete = vi.fn(async () => undefined);
vi.mock('~/db', () => ({
    kv: { delete: kvDelete },
}));

const state = { value: { openrouterKey: 'key' } };
vi.mock('~/state/global', () => ({
    state,
}));

const localStorageMock = (() => {
    let store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
        get length() { return store.size; },
        key: (index: number) => [...store.keys()][index] ?? null,
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store = new Map();
        },
    };
})();

const sessionStorageMock = (() => {
    let store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store = new Map();
        },
    };
})();

Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageMock,
    configurable: true,
});

describe('logoutCleanup', () => {
    beforeEach(() => {
        clearWorkspaceDbsOnLogout.mockClear();
        kvDelete.mockClear();
        state.value.openrouterKey = 'key';
        localStorageMock.clear();
        sessionStorageMock.clear();
    });

    it('clears sync, workspace DBs, and auth-scoped KV', async () => {
        const stop = vi.fn(async () => undefined);
        localStorage.setItem('openrouter_api_key', 'sk-test');
        localStorage.setItem('openrouter_state', 'state');
        localStorage.setItem('or3.tools.enabled', '{"test":true}');
        localStorage.setItem(
            'or3.plugin.fixture.secret.vault',
            'encrypted-vault',
        );
        localStorage.setItem('or3.plugin.other.secret.vault', 'other');
        localStorage.setItem('or3.plugin.secret.old', 'legacy');
        localStorage.setItem('last_selected_model', 'openai/test');
        sessionStorage.setItem('openrouter_state', 'state');
        const { logoutCleanup } = await import('~/utils/logout-cleanup');
        await logoutCleanup({ $syncEngine: { stop } } as unknown as Parameters<
            typeof logoutCleanup
        >[0]);

        expect(stop).toHaveBeenCalledTimes(1);
        expect(clearWorkspaceDbsOnLogout).toHaveBeenCalledTimes(1);
        expect(kvDelete).toHaveBeenCalledWith('openrouter_api_key', expect.anything(), { isValid: expect.any(Function) });
        expect(kvDelete).toHaveBeenCalledWith('workspace.manager.cache', expect.anything(), { isValid: expect.any(Function) });
        expect(state.value.openrouterKey).toBeNull();
        expect(localStorage.getItem('openrouter_api_key')).toBeNull();
        expect(localStorage.getItem('openrouter_state')).toBeNull();
        expect(localStorage.getItem('or3.tools.enabled')).toBeNull();
        expect(
            localStorage.getItem('or3.plugin.fixture.secret.vault'),
        ).toBeNull();
        expect(localStorage.getItem('or3.plugin.other.secret.vault')).toBeNull();
        expect(localStorage.getItem('or3.plugin.secret.old')).toBeNull();
        expect(localStorage.getItem('last_selected_model')).toBeNull();
        expect(sessionStorage.getItem('openrouter_state')).toBeNull();
    });

    it('preserves device-encrypted agent credentials during startup reconciliation', async () => {
        localStorage.setItem(
            'or3.plugin.fixture.secret.vault',
            'encrypted-vault',
        );
        const { logoutCleanup } = await import('~/utils/logout-cleanup');

        await logoutCleanup(undefined, {
            preservePluginSecrets: true,
        });

        expect(localStorage.getItem('or3.plugin.fixture.secret.vault')).toBe(
            'encrypted-vault',
        );
    });

    it.each(['running', 'settled'])('scrubs %s tool journals without forgetting possible execution', async (status) => {
        const key = 'or3:bg-client-tool:opaque-job:opaque-call';
        localStorage.setItem(key, JSON.stringify({ state: status, claimDigest: 'prior-identity',
            result: 'private tool result', error: 'private detail', createdAt: Date.now() }));
        const { logoutCleanup } = await import('~/utils/logout-cleanup');
        await logoutCleanup();
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ state: 'running' });
    });

    it('preserves transient PKCE markers while an OpenRouter callback is completing', async () => {
        localStorage.setItem('openrouter_code_verifier', 'verifier');
        localStorage.setItem('openrouter_state', 'state');
        localStorage.setItem('openrouter_code_method', 'S256');
        sessionStorage.setItem('openrouter_code_verifier', 'verifier');
        sessionStorage.setItem('openrouter_state', 'state');
        sessionStorage.setItem('openrouter_code_method', 'S256');
        const { logoutCleanup } = await import('~/utils/logout-cleanup');

        await logoutCleanup(undefined, { preserveOpenRouterPkce: true });

        expect(localStorage.getItem('openrouter_code_verifier')).toBe(
            'verifier',
        );
        expect(localStorage.getItem('openrouter_state')).toBe('state');
        expect(localStorage.getItem('openrouter_code_method')).toBe('S256');
        expect(sessionStorage.getItem('openrouter_code_verifier')).toBe(
            'verifier',
        );
        expect(sessionStorage.getItem('openrouter_state')).toBe('state');
        expect(sessionStorage.getItem('openrouter_code_method')).toBe('S256');
    });
});
