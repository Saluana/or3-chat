import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ref } from 'vue';

const toastAdd = vi.fn();
const refresh = vi.fn();
const sessionData = ref({ session: null as { authenticated: boolean; provider?: string; user?: { id: string } } | null });
const runtimeConfig = { public: { ssrAuthEnabled: true } };

describe('useOpenRouterAuth', () => {
    const kvDelete = vi.fn();

    beforeEach(() => {
        runtimeConfig.public.ssrAuthEnabled = true;
        sessionStorage.clear();
        localStorage.clear();
        vi.resetModules();
        vi.doUnmock('~/core/auth/useUserApiKey');
        toastAdd.mockClear();
        refresh.mockReset().mockResolvedValue({ session: null });
        sessionData.value = { session: null };
        vi.doMock('#imports', () => ({
            useRuntimeConfig: () => runtimeConfig,
            useToast: () => ({ add: toastAdd }),
        }));
        kvDelete.mockReset().mockResolvedValue(undefined);
        vi.doMock('~/db', () => ({ kv: { delete: kvDelete } }));
        vi.doMock('~/composables/auth/useSessionContext', () => ({
            useSessionContext: () => ({ data: sessionData, refresh }),
        }));
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each(['native', 'http'] as const)('uses S256 PKCE in %s contexts', async (context) => {
        runtimeConfig.public.ssrAuthEnabled = false;
        const assign = vi.fn();
        vi.stubGlobal('window', { location: { origin: 'http://100.83.26.18:3000', assign } });
        if (context === 'http') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
        const { useOpenRouterAuth } = await import('~/core/auth/useOpenrouter');
        await useOpenRouterAuth().startLogin();
        const url = new URL(assign.mock.calls[0]![0] as string);
        const verifier = sessionStorage.getItem('openrouter_code_verifier')!;
        expect(verifier).toMatch(/^[a-f0-9]{128}$/);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
        expect(url.searchParams.get('state')).toBe(sessionStorage.getItem('openrouter_state'));
    });

    it('requires a workspace session before starting cloud-mode OpenRouter OAuth', async () => {
        const { useOpenRouterAuth } = await import('~/core/auth/useOpenrouter');

        await useOpenRouterAuth().startLogin();

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(toastAdd).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Sign in required' })
        );
        expect(sessionStorage.getItem('openrouter_code_verifier')).toBeNull();
    });

    it('binds Cloud OAuth initiation to the account displayed by the tab', async () => {
        sessionData.value = { session: { authenticated: true, provider: 'basic-auth', user: { id: 'account-a' } } };
        const assign = vi.fn();
        vi.stubGlobal('window', { location: { assign } });
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'https://openrouter.ai/auth' })));
        vi.stubGlobal('fetch', fetch);
        const { useOpenRouterAuth } = await import('~/core/auth/useOpenrouter');
        await useOpenRouterAuth().startLogin();
        expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-or3-account')).toBe(JSON.stringify(['basic-auth', 'account-a']));
        expect(assign).toHaveBeenCalledWith('https://openrouter.ai/auth');
    });

    it('shows an actionable connection error when Cloud OAuth cannot start', async () => {
        sessionData.value = { session: { authenticated: true, provider: 'basic-auth', user: { id: 'account-a' } } };
        const assign = vi.fn();
        vi.stubGlobal('window', { location: { assign } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
        const { useOpenRouterAuth } = await import('~/core/auth/useOpenrouter');
        const auth = useOpenRouterAuth();
        await expect(auth.startLogin()).resolves.toBeUndefined();
        expect(auth.isLoggingIn.value).toBe(false);
        expect(assign).not.toHaveBeenCalled();
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'OpenRouter connection unavailable', color: 'error' }));
    });

    it('shows a failed Cloud disconnect without emitting a connection-success event', async () => {
        vi.doMock('~/core/auth/useUserApiKey', () => ({ disconnectOpenRouterConnection: vi.fn().mockRejectedValue(new Error('Vault unavailable')) }));
        const dispatchEvent = vi.fn();
        vi.stubGlobal('window', { dispatchEvent });
        const { useOpenRouterAuth } = await import('~/core/auth/useOpenrouter');
        await expect(useOpenRouterAuth().logoutOpenRouter()).resolves.toBeUndefined();
        expect(dispatchEvent).not.toHaveBeenCalled();
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'OpenRouter disconnect failed', color: 'error' }));
    });

    it('clears static canonical state before waiting for persisted-key deletion', async () => {
        runtimeConfig.public.ssrAuthEnabled = false;
        let resolveDelete!: () => void;
        kvDelete.mockImplementation(
            () => new Promise<void>((resolve) => (resolveDelete = resolve))
        );

        const { state } = await import('~/state/global');
        state.value.openrouterKey = 'sk-or-v1-abcdefghijklmnop';
        localStorage.setItem('openrouter_api_key', 'sk-or-v1-abcdefghijklmnop');

        const { useOpenRouterAuth } = await import('~/core/auth/useOpenrouter');
        const logout = useOpenRouterAuth().logoutOpenRouter();

        expect(state.value.openrouterKey).toBeNull();
        expect(localStorage.getItem('openrouter_api_key')).toBeNull();

        resolveDelete();
        await logout;
        expect(kvDelete).toHaveBeenCalledWith('openrouter_api_key', expect.anything(), { isValid: expect.any(Function) });
    });
});
