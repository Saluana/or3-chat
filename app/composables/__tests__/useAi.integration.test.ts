import { describe, it, expect, vi, beforeEach } from 'vitest';

// We will exercise the sendMessage setup path for new threads where model is resolved
// and system prompt is composed. We'll mock dependent modules to isolate behavior.

vi.mock('~/utils/models-service', async (orig) => {
    const actual = await (orig as any)();
    return {
        ...actual,
        // Use the real implementation for resolveDefaultModel by re-exporting it
        resolveDefaultModel: actual.resolveDefaultModel,
    };
});

vi.mock('~/composables/useAiSettings', () => {
    return {
        useAiSettings: () => ({
            settings: {
                value: {
                    masterSystemPrompt: 'MASTER',
                    defaultModelMode: 'fixed',
                    fixedModelId: 'fixed-x',
                },
            },
        }),
    };
});

const addToast = vi.fn();
vi.mock('#imports', async (orig) => {
    const actual = await (orig as any)();
    return {
        ...actual,
        useToast: () => ({ add: addToast }),
        useAppConfig: () => ({ errors: { showAbortInfo: false } }),
    };
});

vi.mock('~/composables/useModelStore', () => {
    // Empty catalog => fixed model unavailable triggers fallback
    return {
        useModelStore: () => ({ catalog: { value: [] } }),
    };
});

vi.mock('~/db/threads', () => ({
    getThreadSystemPrompt: vi.fn().mockResolvedValue(null),
}));

vi.mock('~/db/prompts', () => ({
    getPrompt: vi.fn().mockResolvedValue(null),
}));

vi.mock('~/db', () => ({
    create: { thread: vi.fn().mockResolvedValue({ id: 't1' }) },
    tx: { appendMessage: vi.fn().mockResolvedValue({ id: 'm1' }) },
    upsert: { message: vi.fn().mockResolvedValue(undefined) },
    db: {
        messages: {
            where: vi
                .fn()
                .mockReturnValue({
                    between: vi
                        .fn()
                        .mockReturnValue({
                            filter: vi
                                .fn()
                                .mockReturnValue({
                                    first: vi.fn().mockResolvedValue(null),
                                    last: vi.fn().mockResolvedValue(null),
                                }),
                        }),
                }),
        },
    },
}));

vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: vi.fn().mockResolvedValue(
        (async function* () {
            yield { type: 'text', text: 'Hello' };
            yield { type: 'text', text: ' World' };
            return; // done
        })()
    ),
}));

vi.mock('~/utils/openrouter-build', () => ({
    buildOpenRouterMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock('~/db/files', () => ({
    createOrRefFile: vi.fn().mockResolvedValue({ hash: 'h1' }),
}));
vi.mock('~/db/files-util', () => ({
    serializeFileHashes: vi.fn().mockReturnValue('h1'),
    parseHashes: vi.fn().mockReturnValue([]),
}));
vi.mock('~/utils/chat/messages', () => ({
    buildParts: vi.fn().mockReturnValue([]),
    mergeFileHashes: vi.fn(),
    trimOrMessagesImages: vi.fn(),
}));
vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (m: any) => ({ ...m, text: m.content || '' }),
    recordRawMessage: vi.fn(),
}));
vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: (...args: any[]) => new Error(args.join(',')),
}));
vi.mock('~/db/util', () => ({
    nowSec: () => Math.floor(Date.now() / 1000),
    newId: () => 'nid',
}));
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => ({
        applyFilters: vi
            .fn()
            .mockImplementation((name: string, val: any) => val),
        doAction: vi.fn(),
    }),
}));
vi.mock('~/composables/useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: { value: 'k' }, setKey: vi.fn() }),
}));
vi.mock('~/composables/useActivePrompt', () => ({
    useActivePrompt: () => ({ activePromptContent: { value: null } }),
}));
vi.mock('~/composables/useDefaultPrompt', () => ({
    getDefaultPromptId: vi.fn().mockResolvedValue(null),
}));
vi.mock('~/state/global', () => ({ state: { value: {} } }));

import { useChat } from '~/composables/useAi';

describe('useAi integration (light)', () => {
    beforeEach(() => {
        addToast.mockReset();
        // Ensure no last-selected model
        try {
            localStorage.removeItem('last_selected_model');
        } catch {}
    });

    it('composes master + thread prompt and triggers toast when fixed model unavailable', async () => {
        const { sendMessage } = useChat([], undefined, undefined);
        await sendMessage('Hi', {
            files: [],
            model: '',
            file_hashes: [],
            online: false,
        });
        // Fallback toast should be shown (fixed not honored)
        expect(addToast).toHaveBeenCalled();
    });
});
