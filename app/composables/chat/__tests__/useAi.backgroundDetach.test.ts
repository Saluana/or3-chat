import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const startBackgroundStreamMock = vi.fn();
const ensureBackgroundJobTrackerMock = vi.fn();
const subscribeBackgroundJobMock = vi.fn();
const stopBackgroundJobTrackingMock = vi.fn();
const runForegroundStreamLoopMock = vi.fn();
const appendMessageMock = vi.fn();
const upsertMessageMock = vi.fn();
const hookOnMock = vi.fn();
const hookDoActionMock = vi.fn(async () => {});
const hookApplyFiltersMock = vi.fn(async (_name: string, value: unknown) => value);
const messagesByThreadMock = vi.fn(async () => []);
const backgroundJobTrackers = new Map<string, any>();
const messageStore = new Map<string, any>();
const enabledToolDefsRef = { value: [] as any[] };
const runtimeConfigRef = {
    value: {
        public: {
            ssrAuthEnabled: true,
            backgroundStreaming: {
                enabled: true,
                startMode: 'background' as 'foreground' | 'background',
            },
            openRouter: {
                allowUserOverride: true,
                hasInstanceKey: false,
                requireUserKey: false,
            },
            limits: { enabled: false },
        },
    },
};

let resolveBackgroundStart: ((value: { jobId: string }) => void) | null = null;
let latestTracker: any = null;

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfigRef.value,
    useToast: () => ({ add: vi.fn() }),
    useAppConfig: () => ({}),
    useUserApiKey: () => ({ apiKey: ref('test-key'), setKey: vi.fn() }),
    useActivePrompt: () => ({ activePromptContent: ref(null) }),
    getDefaultPromptId: vi.fn(async () => null),
    useHooks: () => ({
        on: hookOnMock,
        off: vi.fn(),
        doAction: hookDoActionMock,
        applyFilters: hookApplyFiltersMock,
        _diagnostics: { errors: {} as Record<string, number> },
    }),
}));

vi.mock('~/db/util', () => ({
    nowSec: () => 1,
    newId: () => 'id-test',
    getWriteTxTableNames: () => ['messages'],
}));

vi.mock('~/db', () => ({
    create: {
        thread: vi.fn(async () => ({ id: 'thread-1' })),
    },
    tx: {
        appendMessage: appendMessageMock,
    },
    upsert: {
        message: upsertMessageMock,
    },
}));

vi.mock('~/db/client', () => ({
    getDb: () => ({
        messages: {
            get: async (id: string) => messageStore.get(id),
            delete: vi.fn(async (id: string) => {
                messageStore.delete(id);
            }),
        },
        transaction: async (
            _mode: string,
            _tables: string[],
            fn: () => Promise<unknown>
        ) => await fn(),
    }),
}));

vi.mock('~/db/files-util', () => ({
    serializeFileHashes: (hashes: string[]) => JSON.stringify(hashes),
}));

vi.mock('~/utils/chat/useAi-internal/files', () => ({
    normalizeFileUrl: async (file: unknown) => file,
}));

vi.mock('~/utils/files/attachments', () => ({
    parseHashes: () => [],
    mergeAssistantFileHashes: (_prev: string[], next: string[]) => next || [],
}));

vi.mock('~/db/messages', () => ({
    messagesByThread: messagesByThreadMock,
}));

vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (message: any) => ({
        ...message,
        text: typeof message.content === 'string' ? message.content : '',
        pending: Boolean(message.pending),
    }),
    recordRawMessage: vi.fn(),
}));

vi.mock('~/utils/chat/messages', () => ({
    buildParts: (text: string) => [{ type: 'text', text }],
    deriveMessageContent: ({
        content,
        data,
    }: {
        content?: string | { type: string; text: string }[];
        data?: Record<string, unknown> | null;
    }) =>
        typeof content === 'string'
            ? content
            : typeof data?.content === 'string'
              ? data.content
              : '',
}));

vi.mock('~/utils/chat/openrouterStream', () => ({
    startBackgroundStream: startBackgroundStreamMock,
    abortBackgroundJob: vi.fn(),
    isBackgroundStreamingEnabled: () => true,
}));

vi.mock('~/utils/chat/tool-registry', () => ({
    useToolRegistry: () => ({
        getEnabledDefinitions: () => enabledToolDefsRef.value,
    }),
}));

vi.mock('~/utils/chat/files', () => ({
    inferMimeFromUrl: () => 'image/png',
}));

vi.mock('~/composables/chat/useStreamAccumulator', () => ({
    createStreamAccumulator: () => {
        const state = {
            text: '',
            reasoningText: '',
            finalized: false,
            version: 0,
        };
        return {
            state,
            reset: () => {
                state.text = '';
                state.reasoningText = '';
                state.finalized = false;
            },
            append: (chunk: string, opts?: { kind?: string }) => {
                if (opts?.kind === 'reasoning') state.reasoningText += chunk;
                else state.text += chunk;
                state.version += 1;
            },
            finalize: () => {
                state.finalized = true;
            },
        };
    },
}));

vi.mock('~/core/auth/useOpenrouter', () => ({
    useOpenRouterAuth: () => ({
        startLogin: vi.fn(),
    }),
}));

vi.mock('~/composables/chat/useAiSettings', () => ({
    useAiSettings: () => ({
        settings: ref({
            masterSystemPrompt: '',
            defaultModelMode: 'lastSelected',
            fixedModelId: null,
        }),
    }),
}));

vi.mock('~/composables/chat/useModelStore', () => ({
    useModelStore: () => ({
        catalog: ref([{ id: 'test-model' }]),
    }),
}));

vi.mock('~/core/auth/models-service', () => ({
    resolveDefaultModel: () => ({
        id: 'test-model',
        reason: 'recommended',
    }),
}));

vi.mock('~/state/global', () => ({
    state: { value: { openrouterKey: null } },
}));

vi.mock('~/plugins/workflow-slash-commands.client', () => ({
    consumeWorkflowHandlingFlag: () => false,
}));

vi.mock('~/core/notifications/notification-user', () => ({
    resolveNotificationUserId: () => 'user-1',
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({
        data: ref({
            session: {
                authenticated: true,
                workspace: { id: 'ws-1' },
            },
        }),
    }),
}));

vi.mock('~/utils/chat/history', () => ({
    ensureThreadHistoryLoaded: vi.fn(async () => undefined),
}));

vi.mock('~/utils/chat/useAi-internal', () => ({
    backgroundJobTrackers,
    primeBackgroundJobUpdate: vi.fn(),
    stopBackgroundJobTracking: stopBackgroundJobTrackingMock,
    ensureBackgroundJobTracker: ensureBackgroundJobTrackerMock,
    subscribeBackgroundJob: subscribeBackgroundJobMock,
    runForegroundStreamLoop: runForegroundStreamLoopMock,
    resolveSystemPromptText: vi.fn(async () => ''),
    buildSystemPromptMessage: vi.fn(async () => null),
    buildOpenRouterMessagesForSend: vi.fn(async () => [
        { role: 'user', content: 'hello' },
    ]),
    retryMessageImpl: vi.fn(),
    continueMessageImpl: vi.fn(),
}));

async function waitForCall(mock: { mock: { calls: unknown[][] } }): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (mock.mock.calls.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('Timed out waiting for mock to be called');
}

describe('useChat background detach race', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        backgroundJobTrackers.clear();
        messageStore.clear();
        resolveBackgroundStart = null;
        latestTracker = null;
        enabledToolDefsRef.value = [];
        runtimeConfigRef.value = {
            public: {
                ssrAuthEnabled: true,
                backgroundStreaming: {
                    enabled: true,
                    startMode: 'background',
                },
                openRouter: {
                    allowUserOverride: true,
                    hasInstanceKey: false,
                    requireUserKey: false,
                },
                limits: { enabled: false },
            },
        };

        hookOnMock.mockImplementation(() => vi.fn());
        hookDoActionMock.mockResolvedValue(undefined);
        hookApplyFiltersMock.mockImplementation(
            async (_name: string, value: unknown) => value
        );
        runForegroundStreamLoopMock.mockResolvedValue(undefined);

        appendMessageMock.mockImplementation(async (payload: any) => {
            const id = payload.role === 'user' ? 'user-msg-1' : 'assistant-msg-1';
            const row = {
                id,
                role: payload.role,
                thread_id: payload.thread_id,
                data: payload.data ?? {},
                pending: payload.pending ?? false,
                stream_id: payload.stream_id ?? null,
                file_hashes: payload.file_hashes ?? null,
                content: typeof payload.data?.content === 'string' ? payload.data.content : '',
                created_at: 1,
                updated_at: 1,
                clock: 1,
                index: payload.role === 'user' ? 0 : 1,
            };
            messageStore.set(id, row);
            return row;
        });

        upsertMessageMock.mockImplementation(async (row: any) => {
            if (row?.id) {
                const prev = messageStore.get(row.id) || {};
                messageStore.set(row.id, { ...prev, ...row });
            }
        });

        startBackgroundStreamMock.mockImplementation(
            () =>
                new Promise<{ jobId: string }>((resolve) => {
                    resolveBackgroundStart = resolve;
                })
        );

        ensureBackgroundJobTrackerMock.mockImplementation((params: any) => {
            latestTracker = {
                jobId: params.jobId,
                userId: params.userId,
                threadId: params.threadId,
                messageId: params.messageId,
                status: 'streaming',
                lastWorkflowVersion: -1,
                lastContent: params.initialContent || '',
                lastPersistedLength: (params.initialContent || '').length,
                lastPersistAt: 0,
                polling: false,
                streaming: false,
                active: true,
                subscribers: new Set(),
                completion: Promise.resolve({
                    id: params.jobId,
                    status: 'complete',
                    threadId: params.threadId,
                    messageId: params.messageId,
                    model: 'test-model',
                    chunksReceived: 1,
                    startedAt: Date.now(),
                    completedAt: Date.now(),
                    content: 'done',
                }),
                resolveCompletion: () => {},
            };
            backgroundJobTrackers.set(params.jobId, latestTracker);
            return latestTracker;
        });

        subscribeBackgroundJobMock.mockImplementation(
            (tracker: any, subscriber: any) => {
                tracker.subscribers.add(subscriber);
                return () => {
                    tracker.subscribers.delete(subscriber);
                };
            }
        );

        messagesByThreadMock.mockResolvedValue([]);
    });

    it('does not register a late UI subscriber after clear() detaches the chat', async () => {
        vi.resetModules();
        vi.unmock('~/composables/chat/useAi');
        const { useChat } = await import('~/composables/chat/useAi');

        const chat = useChat([], 'thread-1');

        const sendPromise = chat.sendMessage('hello', {
            files: [],
            model: 'test-model',
            file_hashes: [],
            online: false,
            context_hashes: [],
        } as any);

        await waitForCall(startBackgroundStreamMock);
        chat.clear();

        if (!resolveBackgroundStart) {
            throw new Error('Background start resolver was not initialized');
        }
        resolveBackgroundStart({ jobId: 'job-race-1' });
        await sendPromise;

        expect(ensureBackgroundJobTrackerMock).toHaveBeenCalledTimes(1);
        expect(subscribeBackgroundJobMock).not.toHaveBeenCalled();
        expect(latestTracker?.subscribers.size ?? -1).toBe(0);
    });

    it('registers a UI subscriber when chat remains attached', async () => {
        vi.resetModules();
        vi.unmock('~/composables/chat/useAi');
        const { useChat } = await import('~/composables/chat/useAi');

        const chat = useChat([], 'thread-1');

        const sendPromise = chat.sendMessage('hello', {
            files: [],
            model: 'test-model',
            file_hashes: [],
            online: false,
            context_hashes: [],
        } as any);

        await waitForCall(startBackgroundStreamMock);
        if (!resolveBackgroundStart) {
            throw new Error('Background start resolver was not initialized');
        }
        resolveBackgroundStart({ jobId: 'job-normal-1' });
        await sendPromise;

        expect(ensureBackgroundJobTrackerMock).toHaveBeenCalledTimes(1);
        expect(subscribeBackgroundJobMock).toHaveBeenCalledTimes(1);
        expect(latestTracker?.subscribers.size ?? 0).toBe(1);
    });

    it('allows background streaming when tools are enabled and passes tool runtime hints', async () => {
        enabledToolDefsRef.value = [
            {
                type: 'function',
                function: {
                    name: 'server_tool',
                    description: 'server tool',
                    parameters: { type: 'object', properties: {} },
                },
                runtime: 'server',
            },
            {
                type: 'function',
                function: {
                    name: 'client_tool',
                    description: 'client tool',
                    parameters: { type: 'object', properties: {} },
                },
                runtime: 'client',
            },
        ];

        vi.resetModules();
        vi.unmock('~/composables/chat/useAi');
        const { useChat } = await import('~/composables/chat/useAi');

        const chat = useChat([], 'thread-1');
        const sendPromise = chat.sendMessage('hello with tools', {
            files: [],
            model: 'test-model',
            file_hashes: [],
            online: false,
            context_hashes: [],
        } as any);

        await waitForCall(startBackgroundStreamMock);
        if (!resolveBackgroundStart) {
            throw new Error('Background start resolver was not initialized');
        }
        resolveBackgroundStart({ jobId: 'job-tools-1' });
        await sendPromise;

        const lastCall =
            startBackgroundStreamMock.mock.calls[
                startBackgroundStreamMock.mock.calls.length - 1
            ]?.[0];
        expect(lastCall?.tools).toBeDefined();
        expect(Array.isArray(lastCall?.tools)).toBe(true);
        expect(lastCall?.tools).toHaveLength(2);
        expect(lastCall?.toolRuntime).toEqual({
            server_tool: 'server',
            client_tool: 'client',
        });
    });

    it('defaults to foreground streaming when background start mode is not set to background', async () => {
        runtimeConfigRef.value.public.backgroundStreaming = {
            enabled: true,
            startMode: 'foreground',
        };

        vi.resetModules();
        vi.unmock('~/composables/chat/useAi');
        const { useChat } = await import('~/composables/chat/useAi');

        const chat = useChat([], 'thread-1');
        await chat.sendMessage('foreground please', {
            files: [],
            model: 'test-model',
            file_hashes: [],
            online: false,
            context_hashes: [],
        } as any);

        expect(startBackgroundStreamMock).not.toHaveBeenCalled();
        expect(runForegroundStreamLoopMock).toHaveBeenCalledTimes(1);
    });
});
