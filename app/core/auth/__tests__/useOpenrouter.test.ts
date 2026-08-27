import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const toastAdd = vi.fn();
const refresh = vi.fn();
const sessionData = ref({ session: null as { authenticated: boolean } | null });
const runtimeConfig = { public: { ssrAuthEnabled: true } };

describe('useOpenRouterAuth', () => {
    const kvDelete = vi.fn();

    beforeEach(() => {
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
        expect(kvDelete).toHaveBeenCalledWith('openrouter_api_key');
    });
});
