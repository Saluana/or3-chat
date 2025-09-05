import { describe, it, expect, vi, beforeEach } from 'vitest';
// Engine provided by #app alias stub; import useNuxtApp to access same instance
import { useNuxtApp } from '#app';
const hookEngine = useNuxtApp().$hooks;

vi.mock('#imports', () => ({ useToast: () => ({ add: () => {} }) }));

vi.mock('../../utils/chat/openrouterStream', () => ({
    openRouterStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'text', text: 'Hello ' };
        yield { type: 'text', text: 'World' };
    }),
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
vi.mock('../../utils/chat/messages', () => ({
    buildParts: (text: string) => [{ type: 'text', text }],
    getTextFromContent: (c: any) =>
        typeof c === 'string'
            ? c
            : Array.isArray(c)
            ? c.find((p: any) => p.type === 'text')?.text || ''
            : '',
    mergeFileHashes: (a: string[], b: string[]) => [
        ...new Set([...(a || []), ...(b || [])]),
    ],
    trimOrMessagesImages: () => {},
}));
vi.mock('../../utils/chat/history', () => ({
    ensureThreadHistoryLoaded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/chat/files', () => ({
    dataUrlToBlob: () => null,
    inferMimeFromUrl: () => 'image/png',
}));
vi.mock('../../utils/openrouter-build', () => ({
    buildOpenRouterMessages: async (msgs: any) => msgs,
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
        },
    },
    create: { thread: vi.fn().mockResolvedValue({ id: 'thread-1' }) },
    tx: {
        appendMessage: vi
            .fn()
            .mockResolvedValue({
                id: 'm-' + Math.random().toString(36).slice(2, 6),
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
vi.mock('../useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: { value: 'test-key' }, setKey: () => {} }),
}));
vi.mock('../useActivePrompt', () => ({
    useActivePrompt: () => ({ activePromptContent: { value: null } }),
}));
vi.mock('../useDefaultPrompt', () => ({
    getDefaultPromptId: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../state/global', () => ({
    state: { value: { openrouterKey: null } },
}));

import { useChat } from '../useAi';

describe('Hook order snapshot (pre-accumulator integration)', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
    });

    it('captures sendMessage hook invocation order', async () => {
        const calls: string[] = [];
        const record =
            (name: string) =>
            (..._args: any[]) => {
                calls.push(name);
            };
        hookEngine.addFilter(
            'ui.chat.message:filter:outgoing',
            (v: string) => v
        );
        hookEngine.addFilter(
            'ai.chat.model:filter:select',
            (v: string) => v + ''
        );
        hookEngine.addFilter('ai.chat.messages:filter:input', (v: any) => v);
        hookEngine.addFilter(
            'ui.chat.message:filter:incoming',
            (v: string) => v
        );
        hookEngine.addAction(
            'ai.chat.send:action:before',
            record('ai.chat.send:action:before')
        );
        hookEngine.addAction(
            'ai.chat.stream:action:reasoning',
            record('ai.chat.stream:action:reasoning')
        );
        hookEngine.addAction(
            'ai.chat.stream:action:delta',
            record('ai.chat.stream:action:delta')
        );
        hookEngine.addAction(
            'ai.chat.send:action:after',
            record('ai.chat.send:action:after')
        );
        hookEngine.addAction(
            'ai.chat.error:action',
            record('ai.chat.error:action')
        );

        const { sendMessage } = useChat([]);
        await sendMessage('Hello world');
        expect(calls[0]).toBe('ai.chat.send:action:before');
        expect(calls[calls.length - 1]).toBe('ai.chat.send:action:after');
        expect(calls).toMatchSnapshot();
    });
});
