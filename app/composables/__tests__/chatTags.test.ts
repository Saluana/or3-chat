import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Errors from '~/utils/errors';
import { useChat } from '../useAi';
import { state } from '~/state/global';

// Mock hooks to avoid Dexie / heavy deps impacting test
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_: string, v: any) => v,
        doAction: async () => {},
    }),
}));

// Mock DB layer pieces used in sendMessage path
vi.mock('~/db', () => ({
    tx: {
        appendMessage: async (m: any) => ({
            id: 'm_' + Math.random().toString(36).slice(2),
            file_hashes: m.file_hashes,
        }),
    },
    create: {
        thread: async () => ({
            id: 't_' + Math.random().toString(36).slice(2),
        }),
    },
    db: { messages: { get: async () => null } },
}));

vi.mock('~/db/util', () => ({
    nowSec: () => Math.floor(Date.now() / 1000),
    newId: () => Math.random().toString(36).slice(2),
}));
vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: async function* () {
        yield { type: 'final', text: 'ok' };
    },
}));
vi.mock('~/utils/chat/messages', () => ({
    buildParts: (t: string) => [{ type: 'text', text: t }],
    mergeFileHashes: (a: any) => a,
    trimOrMessagesImages: (x: any) => x,
}));
vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (m: any) => ({ ...m, pending: false }),
    recordRawMessage: () => {},
}));
vi.mock('~/utils/chat/files', () => ({
    inferMimeFromUrl: () => 'image/png',
    dataUrlToBlob: async () => new Blob(),
}));
vi.mock('~/db/threads', () => ({ getThreadSystemPrompt: async () => null }));
vi.mock('~/db/prompts', () => ({ getPrompt: async () => null }));
vi.mock('#imports', () => ({
    useAppConfig: () => ({ errors: { showAbortInfo: false } }),
    useToast: () => ({ add: () => {} }),
}));

describe('chat context tags', () => {
    beforeEach(() => {
        state.value.openrouterKey = 'test-key';
    });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    it('attaches tags for simulated stream failure', async () => {
        // Spy after ensuring original loaded
        const spy = vi.spyOn(Errors, 'reportError');
        const chat = useChat();
        state.value.openrouterKey = 'k';
        await chat.sendMessage('hello');
        const simulated = new Error('fail');
        Errors.reportError(simulated, {
            code: 'ERR_STREAM_FAILURE',
            tags: {
                domain: 'chat',
                threadId: chat.threadId.value || '',
                streamId: chat.streamId.value || '',
                modelId: '',
                stage: 'stream',
            },
        });
        const entry = spy.mock.calls.find(
            (c) =>
                c[1]?.code === 'ERR_STREAM_FAILURE' ||
                c[1]?.tags?.stage === 'stream'
        );
        expect(entry).toBeTruthy();
        const optsArg: any = entry?.[1];
        expect(optsArg && optsArg.tags && optsArg.tags.domain).toBe('chat');
        expect(optsArg && optsArg.tags && optsArg.tags.stage).toBe('stream');
    });
});
