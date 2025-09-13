import { describe, it, expect, vi } from 'vitest';
// Collect toast calls via mocked useToast
const addedToasts: any[] = [];

// Basic mocks reused from other chat tests (minimal subset)
vi.mock('#imports', () => ({
    useToast: () => ({
        add: (t: any) => {
            addedToasts.push(t);
        },
    }),
}));
vi.mock('../../state/global', () => ({
    state: { value: { openrouterKey: null } },
}));
vi.mock('../useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: { value: 'k' }, setKey: () => {} }),
}));
vi.mock('../useActivePrompt', () => ({
    useActivePrompt: () => ({ activePromptContent: { value: null } }),
}));
vi.mock('../useDefaultPrompt', () => ({
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
const __userMessages: any[] = [];
vi.mock('../../db', () => ({
    db: {
        messages: {
            get: vi.fn(
                async (id: string) =>
                    __userMessages.find((m) => m.id === id) || null
            ),
            where: () => ({
                between: () => ({
                    filter: () => ({ last: () => null, first: () => null }),
                }),
            }),
            delete: vi.fn(async (id: string) => {
                const i = __userMessages.findIndex((m) => m.id === id);
                if (i >= 0) __userMessages.splice(i, 1);
            }),
        },
        transaction: async (_mode: string, _table: any, fn: any) => {
            await fn();
        },
    },
    create: { thread: vi.fn().mockResolvedValue({ id: 'thread-rt1' }) },
    tx: {
        appendMessage: vi
            .fn()
            .mockImplementation(async ({ role, data }: any) => {
                const id =
                    (role === 'user' ? 'u-' : 'a-') +
                    Math.random().toString(36).slice(2, 6);
                if (role === 'user') {
                    __userMessages.push({
                        id,
                        role: 'user',
                        thread_id: 'thread-rt1',
                        data,
                        index: __userMessages.length,
                    });
                }
                return { id };
            }),
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

// Force stream to throw after minimal delay (simulate transport failure)
vi.doMock('../../utils/chat/openrouterStream', () => ({
    openRouterStream: vi.fn().mockImplementation(async function* () {
        // produce a small initial delta so assistant placeholder exists
        yield { type: 'text', text: 'hi' };
        throw new Error('network boom');
    }),
}));

async function tick(ms = 0) {
    return new Promise((r) => setTimeout(r, ms));
}

describe('chat retry integration', () => {
    it('adds retry closure on stream failure and invoking it replays user message', async () => {
        const { useChat } = await import('../useAi');
        const chat = useChat([]);
        await chat.sendMessage('hello');
        await tick(20); // allow failure path + reportError toast push
        const toast = addedToasts.find((t) => t.title === 'ERR_STREAM_FAILURE');
        expect(toast).toBeTruthy();
        const retryAction = toast?.actions?.find((a: any) =>
            /retry/i.test(a.label)
        );
        expect(retryAction).toBeTruthy();
        const usersBefore = chat.messages.value.filter(
            (m) => m.role === 'user'
        );
        const userCountBefore = usersBefore.length;
        const originalUserId = usersBefore[usersBefore.length - 1]?.id;
        // Invoke retry
        await retryAction.onClick();
        await tick(30);
        const usersAfter = chat.messages.value.filter((m) => m.role === 'user');
        const userCountAfter = usersAfter.length;
        // Retry replaces prior user message (delete + re-add) so count is stable but id changes
        expect(userCountAfter).toBeGreaterThanOrEqual(userCountBefore); // usually equal
        const latestId = usersAfter[usersAfter.length - 1]?.id;
        if (originalUserId && latestId) {
            expect(latestId).not.toBe(originalUserId);
        }
    });
});
