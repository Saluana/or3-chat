import { describe, it, expect, vi } from 'vitest';

// Capture toast additions
const added: any[] = [];
vi.mock('#imports', () => ({
    useToast: () => ({
        add: (t: any) => {
            added.push(t);
        },
    }),
    useAppConfig: () => ({ errors: { showAbortInfo: false } }),
}));
vi.mock('../../state/global', () => ({
    state: { value: { openrouterKey: null } },
}));
vi.mock('../chat/useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: { value: 'k' }, setKey: () => {} }),
}));
vi.mock('../chat/useActivePrompt', () => ({
    useActivePrompt: () => ({ activePromptContent: { value: null } }),
}));
vi.mock('../chat/useDefaultPrompt', () => ({
    getDefaultPromptId: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../db/util', () => ({
    nowSec: () => Math.floor(Date.now() / 1000),
    newId: () => 'id-' + Math.random().toString(36).slice(2, 8),
}));
vi.mock('../../db/threads', () => ({
    getThreadSystemPrompt: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../db/prompts', () => ({ getPrompt: vi.fn() }));
vi.mock('../../utils/prompt-utils', () => ({
    promptJsonToString: (c: any) => String(c),
}));
vi.mock('../../utils/chat/history', () => ({
    ensureThreadHistoryLoaded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/chat/messages', () => ({
    buildParts: (text: string) => [{ type: 'text', text }],
    mergeFileHashes: (a: string[], b: string[]) => [
        ...new Set([...(a || []), ...(b || [])]),
    ],
    trimOrMessagesImages: () => {},
}));
vi.mock('../../db', () => ({
    db: {
        messages: {
            get: vi.fn(),
            where: () => ({
                between: () => ({
                    filter: () => ({ last: () => null, first: () => null }),
                }),
            }),
            delete: vi.fn(),
        },
    },
    create: { thread: vi.fn().mockResolvedValue({ id: 'thread-ab1' }) },
    tx: {
        appendMessage: vi.fn().mockImplementation(async ({ role }: any) => ({
            id:
                (role === 'user' ? 'u-' : 'a-') +
                Math.random().toString(36).slice(2, 6),
        })),
    },
    upsert: { message: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../db/files', () => ({ createOrRefFile: vi.fn() }));
vi.mock('../../db/files-util', () => ({
    serializeFileHashes: (h: string[]) => JSON.stringify(h),
    parseFileHashes: (s: string) => {
        try {
            return JSON.parse(s);
        } catch {
            return [];
        }
    },
}));
vi.mock('../../utils/openrouter-build', () => ({
    buildOpenRouterMessages: async (m: any) => m,
}));
vi.mock('../../utils/chat/files', () => ({
    dataUrlToBlob: () => null,
    inferMimeFromUrl: () => 'image/png',
}));

// Streaming generator that yields some text slowly so we can abort mid-stream
const controllers: AbortController[] = [];
vi.doMock('../../utils/chat/openrouterStream', () => ({
    openRouterStream: vi.fn().mockImplementation(async function* (opts: any) {
        // simulate a long stream; check abort signal
        for (let i = 0; i < 5; i++) {
            if (opts.signal?.aborted)
                throw new DOMException('Aborted', 'AbortError');
            yield { type: 'text', text: 'chunk' + i };
            await new Promise((r) => setTimeout(r, 5));
        }
    }),
}));

function tick(ms = 0) {
    return new Promise((r) => setTimeout(r, ms));
}

describe('chat abort behavior', () => {
    it('does not show a toast when aborting with showAbortInfo=false', async () => {
        const { useChat } = await import('../chat/useAi');
        const chat = useChat([]);
        const sendP = chat.sendMessage('hello world');
        await tick(10); // some chunks processed
        chat.abort();
        await tick(10); // allow abort handling
        // verify no toast with code ERR_STREAM_ABORTED present
        const abortToast = added.find((t) => t?.title === 'ERR_STREAM_ABORTED');
        expect(abortToast).toBeFalsy();
    });
});
