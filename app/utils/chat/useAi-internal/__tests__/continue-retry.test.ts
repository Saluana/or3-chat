import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

const reportErrorSpy = vi.fn();
const openRouterStreamSpy = vi.fn();
const updateMessageRecordSpy = vi.fn();
const makeAssistantPersisterSpy = vi.fn();
const messagesByThreadSpy = vi.fn();
const parseFileHashesSpy = vi.fn();

const dbState = vi.hoisted(() => {
    const messagesGet = vi.fn();
    const messagesDelete = vi.fn();
    const where = vi.fn();
    const transaction = vi.fn();
    const tables = [
        { name: 'messages' },
        { name: 'pending_ops' },
        { name: 'tombstones' },
    ];
    return {
        db: {
            tables,
            transaction,
            messages: {
                get: messagesGet,
                delete: messagesDelete,
                where,
            },
        },
        messagesGet,
        messagesDelete,
        where,
        transaction,
    };
});

vi.mock('~/utils/errors', () => ({
    reportError: (...args: unknown[]) => reportErrorSpy(...args),
    err: (code: string, message: string, meta: unknown) => ({
        code,
        message,
        meta,
    }),
}));

vi.mock('~/db/client', () => ({
    getDb: () => dbState.db,
}));

vi.mock('~/db/messages', () => ({
    messagesByThread: (...args: unknown[]) => messagesByThreadSpy(...args),
}));

vi.mock('~/db/files-util', () => ({
    parseFileHashes: (...args: unknown[]) => parseFileHashesSpy(...args),
}));

vi.mock('~/utils/chat/messages', () => ({
    deriveMessageContent: (m: {
        content?: string | null;
        data?: { content?: string | null } | null;
    }) => {
        if (typeof m.content === 'string') return m.content;
        if (m.data && typeof m.data.content === 'string') return m.data.content;
        return '';
    },
    trimOrMessagesImages: () => {},
}));

vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (m: { id: string; role: string; content?: unknown }) => ({
        id: m.id,
        role: m.role,
        text: typeof m.content === 'string' ? m.content : '',
        pending: false,
        error: null,
        reasoning_text: null,
    }),
}));

vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: (...args: unknown[]) => openRouterStreamSpy(...args),
}));

vi.mock('~/utils/files/attachments', () => ({
    parseHashes: () => [],
}));

vi.mock('~/db/files', () => ({
    createOrRefFile: vi.fn(),
}));

vi.mock('~/utils/chat/files', () => ({
    dataUrlToBlob: vi.fn(),
}));

vi.mock('~/utils/chat/imagePlaceholders', () => ({
    TRANSPARENT_PIXEL_GIF_DATA_URI: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
}));

vi.mock('~/utils/chat/prompt-utils', () => ({
    composeSystemPrompt: (_master: string, threadPrompt: string | null) =>
        threadPrompt || '',
}));

vi.mock('~/core/auth/openrouter-build', () => ({
    buildOpenRouterMessages: vi.fn(async () => [
        { role: 'user', content: 'continue' },
    ]),
}));

vi.mock('../persistence', () => ({
    makeAssistantPersister: (...args: unknown[]) =>
        makeAssistantPersisterSpy(...args),
    updateMessageRecord: (...args: unknown[]) => updateMessageRecordSpy(...args),
}));

vi.mock('dexie', () => ({
    default: { minKey: -Infinity, maxKey: Infinity },
}));

import { continueMessageImpl } from '../continue';
import { retryMessageImpl } from '../retry';

describe('continue/retry regressions', () => {
    beforeEach(() => {
        reportErrorSpy.mockReset();
        openRouterStreamSpy.mockReset();
        updateMessageRecordSpy.mockReset();
        makeAssistantPersisterSpy.mockReset();
        messagesByThreadSpy.mockReset();
        parseFileHashesSpy.mockReset();
        dbState.messagesGet.mockReset();
        dbState.messagesDelete.mockReset();
        dbState.where.mockReset();
        dbState.transaction.mockReset();
    });

    it('continue keeps existing assistant message in list while streaming', async () => {
        const target = {
            id: 'a1',
            thread_id: 't1',
            role: 'assistant',
            index: 2,
            content: 'Hello',
            data: { content: 'Hello' },
            file_hashes: null,
            stream_id: null,
            error: null,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 1,
        };
        dbState.messagesGet.mockResolvedValue(target);
        const whereChain = {
            between: vi.fn().mockReturnThis(),
            filter: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([target]),
        };
        dbState.where.mockReturnValue(whereChain);

        makeAssistantPersisterSpy.mockReturnValue(
            vi.fn(async () => null)
        );
        openRouterStreamSpy.mockReturnValue(
            (async function* () {
                yield { type: 'text', text: '>> world' };
            })()
        );

        const messages = ref([
            {
                id: 'a1',
                role: 'assistant',
                text: 'Hello',
                pending: false,
                error: null,
                reasoning_text: null,
            },
        ]);
        const rawMessages = ref([
            {
                id: 'a1',
                role: 'assistant',
                content: 'Hello',
                error: null,
            },
        ]);
        const tailAssistant = ref<{
            id: string;
            role: string;
            text: string;
            pending: boolean;
            error: string | null;
            reasoning_text: string | null;
            file_hashes?: string[];
            toolCalls?: unknown[] | null;
        } | null>(null);
        const streamAccAppend = vi.fn();

        await continueMessageImpl(
            {
                loading: ref(false),
                aborted: ref(false),
                abortController: ref(null),
                threadIdRef: ref('t1'),
                tailAssistant: tailAssistant as any,
                rawMessages: rawMessages as any,
                messages: messages as any,
                streamId: ref<string | undefined>(undefined),
                streamAcc: {
                    reset: vi.fn(),
                    append: streamAccAppend,
                    finalize: vi.fn(),
                    state: { finalized: false },
                },
                streamState: { finalized: false },
                hooks: {
                    applyFilters: vi.fn(async (_name, value) => value),
                },
                effectiveApiKey: ref('k'),
                hasInstanceKey: ref(false),
                defaultModelId: 'model-a',
                getSystemPromptContent: async () => null,
                useAiSettings: () => ({ settings: ref(undefined) }),
                resetStream: vi.fn(),
            },
            'a1'
        );

        expect(messages.value.some((m) => m.id === 'a1')).toBe(true);
        expect(tailAssistant.value?.text).toBe('Hello world');
        expect(streamAccAppend).toHaveBeenCalled();
        expect(reportErrorSpy).not.toHaveBeenCalled();
    });

    it('retry deletes inside sync-aware transaction and resends message', async () => {
        const userMsg = {
            id: 'u1',
            role: 'user',
            thread_id: 't1',
            index: 1,
            content: 'retry this',
            data: { content: 'retry this' },
            file_hashes: 'h1',
            deleted: false,
        };
        const assistantMsg = {
            id: 'a1',
            role: 'assistant',
            thread_id: 't1',
            index: 2,
            content: 'old answer',
            deleted: false,
        };

        dbState.messagesGet.mockResolvedValue(userMsg);
        const assistantChain = {
            between: vi.fn().mockReturnThis(),
            filter: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(assistantMsg),
        };
        dbState.where.mockReturnValue(assistantChain);
        dbState.transaction.mockImplementation(
            async (_mode: string, _tables: string[], cb: () => Promise<void>) => {
                await cb();
            }
        );

        messagesByThreadSpy.mockResolvedValue([userMsg, assistantMsg]);
        parseFileHashesSpy.mockReturnValue(['h1']);
        const sendMessageSpy = vi.fn(async () => {});
        const hooksSpy = { doAction: vi.fn(async () => {}) };

        await retryMessageImpl(
            {
                loading: ref(false),
                threadIdRef: ref('t1'),
                tailAssistant: ref(null),
                rawMessages: ref([
                    { id: 'u1', role: 'user', content: 'retry this' },
                    { id: 'a1', role: 'assistant', content: 'old answer' },
                ]) as any,
                messages: ref([
                    { id: 'u1', role: 'user', text: 'retry this' },
                    { id: 'a1', role: 'assistant', text: 'old answer' },
                ]) as any,
                hooks: hooksSpy,
                sendMessage: sendMessageSpy,
                defaultModelId: 'default-model',
                suppressNextTailFlush: vi.fn(),
            },
            'u1',
            'override-model'
        );

        const txTables = dbState.transaction.mock.calls[0]?.[1] as string[];
        expect(txTables).toEqual(
            expect.arrayContaining(['messages', 'pending_ops', 'tombstones'])
        );
        expect(dbState.messagesDelete).toHaveBeenCalledWith('u1');
        expect(dbState.messagesDelete).toHaveBeenCalledWith('a1');
        expect(sendMessageSpy).toHaveBeenCalledWith('retry this', {
            model: 'override-model',
            file_hashes: ['h1'],
            files: [],
            online: false,
        });
        expect(hooksSpy.doAction).toHaveBeenCalledWith(
            'ai.chat.retry:action:before',
            expect.objectContaining({
                threadId: 't1',
                originalUserId: 'u1',
                originalAssistantId: 'a1',
            })
        );
        expect(reportErrorSpy).not.toHaveBeenCalled();
    });
});
