import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const toastAdd = vi.fn();
const refresh = vi.fn();
const sessionData = ref({ session: null as { authenticated: boolean } | null });
const runtimeConfig = { public: { ssrAuthEnabled: true } };

describe('useOpenRouterAuth', () => {
    beforeEach(() => {
        vi.resetModules();
        toastAdd.mockClear();
        refresh.mockReset().mockResolvedValue({ session: null });
        sessionData.value = { session: null };
        vi.doMock('#imports', () => ({
            useRuntimeConfig: () => runtimeConfig,
            useToast: () => ({ add: toastAdd }),
        }));
        vi.doMock('~/db', () => ({ kv: { delete: vi.fn() } }));
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
});
