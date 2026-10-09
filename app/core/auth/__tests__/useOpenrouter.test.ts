import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ref } from 'vue';

const toastAdd = vi.fn();
const refresh = vi.fn();
const sessionData = ref({ session: null as { authenticated: boolean } | null });
const runtimeConfig = { public: { ssrAuthEnabled: true } };

describe('useOpenRouterAuth', () => {
    const kvDelete = vi.fn();

    beforeEach(() => {
        runtimeConfig.public.ssrAuthEnabled = true;
        sessionStorage.clear();
        localStorage.clear();
        vi.resetModules();
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

    it('clears canonical reactive state before waiting for persisted-key deletion', async () => {
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
