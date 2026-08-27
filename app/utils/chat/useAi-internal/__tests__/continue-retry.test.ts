import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import type { ChatMessage } from '~/utils/chat/types';

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
    compareMessageOrder: (a: { index?: number; order_key?: string; id: string }, b: { index?: number; order_key?: string; id: string }) =>
        (a.index ?? 0) - (b.index ?? 0) ||
        (a.order_key ?? '').localeCompare(b.order_key ?? '') ||
        a.id.localeCompare(b.id),
}));

vi.mock('~/db/files-util', () => ({
    parseFileHashes: (...args: unknown[]) => parseFileHashesSpy(...args),
}));

vi.mock('~/utils/chat/messages', async (importOriginal) => ({
    ...(await importOriginal<typeof import('~/utils/chat/messages')>()),
    shouldKeepAssistantMessage: () => true,
    getChatModalities: (modelId: string) =>
        /dall-e|stable-diffusion|midjourney|imagen/i.test(modelId)
            ? ['image', 'text']
            : ['text'],
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
    openRouterStreamWithRetry: async function* (...args: unknown[]) {
        yield* openRouterStreamSpy(...args);
    },
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

vi.mock('../messageBuild', () => ({
    buildOpenRouterMessagesForSend: vi.fn(async () => [
        { role: 'user', content: 'continue' },
    ]),
    enforceOpenRouterMessageTokenBudget: vi.fn(async (messages) => messages),
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

    it('continue marks stream interruption on the target message when stream throws', async () => {
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

        makeAssistantPersisterSpy.mockReturnValue(vi.fn(async () => null));
        openRouterStreamSpy.mockReturnValue(
            (async function* () {
                throw new Error('stream exploded');
            })()
        );

        const tailAssistant = ref<{
            id: string;
            role: string;
            text: string;
            pending: boolean;
            error: string | null;
            reasoning_text: string | null;
        } | null>(null);

        await continueMessageImpl(
            {
                loading: ref(false),
                aborted: ref(false),
                abortController: ref(null),
                threadIdRef: ref('t1'),
                tailAssistant: tailAssistant as any,
                rawMessages: ref([
                    {
                        id: 'a1',
                        role: 'assistant',
                        content: 'Hello',
                        error: null,
                    },
                ]) as any,
                messages: ref([
                    {
                        id: 'a1',
                        role: 'assistant',
                        text: 'Hello',
                        pending: false,
                        error: null,
                        reasoning_text: null,
                    },
                ]) as any,
                streamId: ref<string | undefined>(undefined),
                streamAcc: {
                    reset: vi.fn(),
                    append: vi.fn(),
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

        expect(updateMessageRecordSpy).toHaveBeenCalledWith(
            expect.anything(),
            'a1',
            {
            error: 'stream_interrupted',
            }
        );
        expect(reportErrorSpy).toHaveBeenCalled();
        expect(tailAssistant.value?.pending).toBe(false);
    });

    it('continue cleans up UI and persistence when setup fails before streaming', async () => {
        const target = {
            id: 'a-setup',
            thread_id: 't1',
            role: 'assistant',
            index: 2,
            content: 'Partial answer',
            data: { content: 'Partial answer' },
            file_hashes: null,
            stream_id: null,
            error: null,
            pending: false,
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
        makeAssistantPersisterSpy.mockImplementationOnce(() => {
            throw new Error('persister setup failed');
        });

        const loading = ref(false);
        const abortController = ref<AbortController | null>(null);
        const tailAssistant = ref<{
            id: string;
            role: string;
            text: string;
            pending: boolean;
            error: string | null;
            reasoning_text: string | null;
        } | null>(null);
        const messages = ref([
            {
                id: 'a-setup',
                role: 'assistant',
                text: 'Partial answer',
                pending: false,
                error: null,
                reasoning_text: null,
            },
        ]);
        const rawMessages = ref([
            {
                id: 'a-setup',
                role: 'assistant',
                content: 'Partial answer',
                error: null,
            },
        ]);

        await continueMessageImpl(
            {
                loading,
                aborted: ref(false),
                abortController,
                threadIdRef: ref('t1'),
                tailAssistant: tailAssistant as any,
                rawMessages: rawMessages as any,
                messages: messages as any,
                streamId: ref<string | undefined>(undefined),
                streamAcc: {
                    reset: vi.fn(),
                    append: vi.fn(),
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
            'a-setup'
        );

        expect(loading.value).toBe(false);
        expect(abortController.value).toBeNull();
        expect(tailAssistant.value).toMatchObject({
            text: 'Partial answer',
            pending: false,
            error: 'stream_interrupted',
        });
        expect(rawMessages.value[0]).toMatchObject({
            content: 'Partial answer',
            error: 'stream_interrupted',
        });
        expect(updateMessageRecordSpy).toHaveBeenCalledWith(
            expect.anything(),
            'a-setup',
            expect.objectContaining({
                pending: false,
                error: 'stream_interrupted',
                data: expect.objectContaining({
                    generation_state: 'interrupted',
                }),
            }),
            target
        );
        expect(reportErrorSpy).toHaveBeenCalled();
    });

    it('retry preserves the source branch and resends with the prior turn boundary', async () => {
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
        const sendMessageSpy = vi.fn(async () => ({ status: 'accepted' as const, requestId: 'retry-1' }));
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

        expect(dbState.transaction).not.toHaveBeenCalled();
        expect(dbState.messagesDelete).not.toHaveBeenCalled();
        expect(sendMessageSpy).toHaveBeenCalledWith('retry this', {
            model: 'override-model',
            file_hashes: ['h1'],
            files: [],
            online: false,
            historyOverride: [],
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

    it('retry handles missing trailing assistant and still resends user message', async () => {
        const userMsg = {
            id: 'u2',
            role: 'user',
            thread_id: 't1',
            index: 3,
            content: 'retry solo',
            data: { content: 'retry solo' },
            file_hashes: null,
            deleted: false,
        };

        dbState.messagesGet.mockResolvedValue(userMsg);
        const assistantChain = {
            between: vi.fn().mockReturnThis(),
            filter: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(undefined),
        };
        dbState.where.mockReturnValue(assistantChain);
        dbState.transaction.mockImplementation(
            async (_mode: string, _tables: string[], cb: () => Promise<void>) => {
                await cb();
            }
        );
        messagesByThreadSpy.mockResolvedValue([userMsg]);
        parseFileHashesSpy.mockReturnValue([]);
        const sendMessageSpy = vi.fn(async () => ({ status: 'accepted' as const, requestId: 'retry-2' }));
        const hooksSpy = { doAction: vi.fn(async () => {}) };

        await retryMessageImpl(
            {
                loading: ref(false),
                threadIdRef: ref('t1'),
                tailAssistant: ref(null),
                rawMessages: ref([
                    { id: 'u2', role: 'user', content: 'retry solo' },
                ]) as any,
                messages: ref([
                    { id: 'u2', role: 'user', text: 'retry solo' },
                ]) as any,
                hooks: hooksSpy,
                sendMessage: sendMessageSpy,
                defaultModelId: 'default-model',
                suppressNextTailFlush: vi.fn(),
            },
            'u2'
        );

        expect(dbState.transaction).not.toHaveBeenCalled();
        expect(dbState.messagesDelete).not.toHaveBeenCalled();
        expect(sendMessageSpy).toHaveBeenCalledWith('retry solo', {
            model: 'default-model',
            file_hashes: [],
            files: [],
            online: false,
            historyOverride: [],
        });
    });

    it('retry extracts text from ContentPart[] user messages', async () => {
        const userMsg = {
            id: 'u3',
            role: 'user',
            thread_id: 't1',
            index: 5,
            content: [{ type: 'text', text: 'image prompt' }],
            data: null,
            file_hashes: null,
            deleted: false,
        };

        dbState.messagesGet.mockResolvedValue(userMsg);
        const assistantChain = {
            between: vi.fn().mockReturnThis(),
            filter: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(undefined),
        };
        dbState.where.mockReturnValue(assistantChain);
        dbState.transaction.mockImplementation(
            async (_mode: string, _tables: string[], cb: () => Promise<void>) => {
                await cb();
            }
        );
        messagesByThreadSpy.mockResolvedValue([userMsg]);
        parseFileHashesSpy.mockReturnValue([]);
        const sendMessageSpy = vi.fn(async () => ({ status: 'accepted' as const, requestId: 'retry-3' }));
        const hooksSpy = { doAction: vi.fn(async () => {}) };

        await retryMessageImpl(
            {
                loading: ref(false),
                threadIdRef: ref('t1'),
                tailAssistant: ref(null),
                rawMessages: ref([
                    { id: 'u3', role: 'user', content: [{ type: 'text', text: 'image prompt' }] },
                ]) as any,
                messages: ref([
                    { id: 'u3', role: 'user', text: 'image prompt' },
                ]) as any,
                hooks: hooksSpy,
                sendMessage: sendMessageSpy,
                defaultModelId: 'default-model',
                suppressNextTailFlush: vi.fn(),
            },
            'u3'
        );

        expect(sendMessageSpy).toHaveBeenCalledWith('image prompt', {
            model: 'default-model',
            file_hashes: [],
            files: [],
            online: false,
            historyOverride: [],
        });
    });

    it('keeps earlier tool rows and excludes the selected and future turns', async () => {
        const rows = [
            { id: 'u0', role: 'user', thread_id: 't1', index: 1, data: { content: 'first' }, deleted: false },
            { id: 'a0', role: 'assistant', thread_id: 't1', index: 2, data: { content: 'calling', tool_calls: [{ id: 'c1' }] }, deleted: false },
            { id: 'tool0', role: 'tool', thread_id: 't1', index: 3, data: { content: 'result', tool_call_id: 'c1', tool_name: 'lookup' }, deleted: false },
            { id: 'u1', role: 'user', thread_id: 't1', index: 4, data: { content: 'retry me' }, deleted: false },
            { id: 'a1', role: 'assistant', thread_id: 't1', index: 5, data: { content: 'old' }, deleted: false },
            { id: 'u2', role: 'user', thread_id: 't1', index: 6, data: { content: 'future' }, deleted: false },
        ];
        dbState.messagesGet.mockResolvedValue(rows[4]);
        messagesByThreadSpy.mockResolvedValue(rows);
        parseFileHashesSpy.mockReturnValue([]);
        const sendMessageSpy = vi.fn(async () => ({ status: 'rejected' as const, requestId: 'retry-4', reason: 'filtered' as const }));

        const result = await retryMessageImpl(
            {
                loading: ref(false), threadIdRef: ref('t1'), tailAssistant: ref(null),
                rawMessages: ref([]), messages: ref([]),
                hooks: { doAction: vi.fn(async () => {}) },
                sendMessage: sendMessageSpy, defaultModelId: 'model',
                suppressNextTailFlush: vi.fn(),
            },
            'a1'
        );

        expect(result).toMatchObject({ status: 'rejected', reason: 'filtered' });
        const sendCall = sendMessageSpy.mock.calls[0] as unknown as [
            string,
            { historyOverride?: ChatMessage[] },
        ];
        const history = sendCall[1].historyOverride;
        expect(history?.map((message: ChatMessage) => message.id)).toEqual(['u0', 'a0', 'tool0']);
        expect(history?.[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1', name: 'lookup' });
        expect(dbState.messagesDelete).not.toHaveBeenCalled();
    });
});
