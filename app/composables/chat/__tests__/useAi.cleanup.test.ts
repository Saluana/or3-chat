import { describe, it, expect, vi } from 'vitest';
import { effectScope, ref, nextTick } from 'vue';

let disposeSpy: ReturnType<typeof vi.fn> | null = null;

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        public: {
            ssrAuthEnabled: true,
            backgroundStreaming: { enabled: true },
            openRouter: { allowUserOverride: true, hasInstanceKey: false },
            limits: { enabled: false },
        },
    }),
    useToast: () => ({ add: vi.fn() }),
    useAppConfig: () => ({}),
    useUserApiKey: () => ({ apiKey: ref(null), setKey: vi.fn() }),
    useActivePrompt: () => ({ activePromptContent: ref(null) }),
    getDefaultPromptId: vi.fn().mockResolvedValue(null),
    useHooks: () => ({
        on: vi.fn((_name: string, _handler: unknown) => {
            disposeSpy = vi.fn();
            return disposeSpy;
        }),
        off: vi.fn(),
        doAction: vi.fn(),
        applyFilters: vi.fn(async (_name: string, value: any) => value),
    }),
}));

vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: vi.fn(),
    pollJobStatus: vi.fn(),
    startBackgroundStream: vi.fn(),
    subscribeBackgroundJobStream: vi.fn(),
    abortBackgroundJob: vi.fn(),
    isBackgroundStreamingEnabled: () => true,
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: ref({ session: null }) }),
}));

describe('useChat cleanup', () => {
    it('disposes hook listeners on scope dispose even when background streaming is active', async () => {
        vi.resetModules();
        vi.unmock('~/composables/chat/useAi');
        const { useChat } = await import('~/composables/chat/useAi');

        const scope = effectScope();
        let chat: ReturnType<typeof useChat> | undefined;
        scope.run(() => {
            chat = useChat([], 'thread-1');
        });

        expect(disposeSpy).toBeTruthy();

        if (chat) {
            chat.backgroundJobMode.value = 'background';
            chat.backgroundJobId.value = 'job-1';
        }

        scope.stop();
        await nextTick();

        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
});
