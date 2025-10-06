import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createHookEngine } from '../../utils/hooks';

// Primary hook engine mock for useHooks()
const hookEngine = createHookEngine();
vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => hookEngine as any,
}));

// ---- Mocks ----
vi.mock('~/composables/useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: ref('test-key'), setKey: vi.fn() }),
}));
vi.mock('~/composables/chat/useActivePrompt', () => ({
    useActivePrompt: () => ({ activePromptContent: ref(null) }),
}));
vi.mock('~/composables/chat/useDefaultPrompt', () => ({
    getDefaultPromptId: vi.fn().mockResolvedValue(null),
}));
vi.mock('~/composables/chat/useAiSettings', () => ({
    useAiSettings: () => ({
        settings: { value: { defaultModelMode: 'lastSelected' } },
    }),
}));
vi.mock('~/composables/chat/useModelStore', () => ({
    useModelStore: () => ({ catalog: { value: [] } }),
}));
vi.mock('~/db/threads', () => ({
    getThreadSystemPrompt: vi.fn().mockResolvedValue(null),
}));
vi.mock('~/db/prompts', () => ({ getPrompt: vi.fn().mockResolvedValue(null) }));
vi.mock('~/state/global', () => ({ state: ref({ openrouterKey: '' }) }));
vi.mock('~/composables/useStreamAccumulator', () => ({
    createStreamAccumulator: () => {
        const state = ref({ finalized: false });
        return {
            state,
            reset: () => {},
            append: () => {},
            finalize: () => {
                state.value.finalized = true;
            },
        };
    },
}));

// DB layer minimal mocks
let msgCounter = 0;
vi.mock('~/db', () => ({
    create: { thread: vi.fn().mockResolvedValue({ id: 'thread-new' }) },
    db: {
        messages: {
            get: vi.fn(),
            where: () => ({
                between: () => ({
                    filter: () => ({ first: () => null, last: () => null }),
                }),
            }),
        },
    },
    tx: {
        appendMessage: vi.fn(async (m: any) => ({
            ...m,
            id: 'm' + ++msgCounter,
            file_hashes: m.file_hashes || null,
        })),
    },
    upsert: { message: vi.fn(async () => {}) },
}));

vi.mock('~/utils/chat/history', () => ({
    ensureThreadHistoryLoaded: vi.fn().mockResolvedValue(undefined),
}));

// Stream mock (assistant will emit two text chunks then end)
vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: () => ({
        async *[Symbol.asyncIterator]() {
            yield { type: 'text', text: 'Hello' };
            yield { type: 'text', text: ' World' };
        },
    }),
}));

// File / attachments helpers used indirectly
vi.mock('~/utils/files/attachments', () => ({
    parseHashes: () => [],
    mergeAssistantFileHashes: (_a: any, _b: any) => _b || [],
}));
vi.mock('~/db/files', () => ({ createOrRefFile: vi.fn() }));
vi.mock('~/db/files-util', () => ({
    serializeFileHashes: (arr: string[]) => arr.join(','),
}));
vi.mock('~/utils/chat/messages', () => ({
    buildParts: (t: string) => [{ type: 'text', text: t }],
    mergeFileHashes: (a: any) => a,
    trimOrMessagesImages: () => {},
}));
vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (m: any) => ({
        id: m.id,
        role: m.role,
        text: m.content?.[0]?.text || '',
        content: m.content,
        reasoning_text: m.reasoning_text || null,
    }),
    recordRawMessage: () => {},
}));
vi.mock('~/utils/openrouter-build', () => ({
    buildOpenRouterMessages: (msgs: any) => msgs,
}));
vi.mock('#imports', () => ({ useToast: () => ({ add: vi.fn() }) }));

// Document store state mock (configurable per test via mutable map)
const docState: Record<string, any> = {};
vi.mock('../documents/useDocumentsStore', () => ({
    releaseDocument: vi.fn(),
    useDocumentState: (id: string) => docState[id],
}));

// ---- Imports under test ----
import { useMultiPane } from '~/composables/useMultiPane';
import { usePaneDocuments } from '~/composables/documents/usePaneDocuments';
import { useChat } from '~/composables/chat/useAi';

// Helper to await microtasks
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('extended pane hooks coverage', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
        msgCounter = 0;
        for (const k of Object.keys(docState)) delete docState[k];
    });

    it('thread changed provides message count & veto works', async () => {
        const { setPaneThread, panes } = useMultiPane({
            loadMessagesFor: async () =>
                [
                    { role: 'user', content: 'a' },
                    { role: 'assistant', content: 'b' },
                ] as any,
        });
        let changedPayload: any = null;
        hookEngine.addAction('ui.pane.thread:action:changed', (payload) => {
            changedPayload = {
                _old: payload.oldThreadId,
                _new: payload.newThreadId,
                count: payload.messageCount,
                paneIndex: payload.paneIndex,
            };
        });
        // Veto first
        hookEngine.addFilter('ui.pane.thread:filter:select', (req: string) =>
            req === 'veto' ? false : req
        );
        await setPaneThread(0, 'veto');
        expect(changedPayload).toBeNull();
        await setPaneThread(0, 'thread-ABC');
        expect(changedPayload).toEqual({
            _old: '',
            _new: 'thread-ABC',
            count: 2,
            paneIndex: 0,
        });
        expect(panes.value[0]!.messages.length).toBe(2);
    });

    it('document saved fires when switching from pending doc', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'doc',
                threadId: '',
                documentId: 'doc-old',
                messages: [],
                validating: false,
            } as any,
        ]);
        const activePaneIndex = ref(0);
        docState['doc-old'] = {
            id: 'doc-old',
            pendingTitle: 'T',
            pendingContent: 'Body',
        }; // simulate pending changes
        const createNewDoc = vi.fn().mockResolvedValue({ id: 'doc-new' });
        const flushDocument = vi.fn().mockResolvedValue(undefined);
        const { newDocumentInActive } = usePaneDocuments({
            panes,
            activePaneIndex,
            createNewDoc,
            flushDocument,
        });
        let saved: any = null;
        let changed: any = null;
        hookEngine.addAction('ui.pane.doc:action:saved', (payload) => {
            saved = payload.newDocumentId;
        });
        hookEngine.addAction('ui.pane.doc:action:changed', (payload) => {
            changed = {
                oldId: payload.oldDocumentId,
                newId: payload.newDocumentId,
                paneIndex: payload.paneIndex,
            };
        });
        await newDocumentInActive({ title: 'New' });
        expect(saved).toBe('doc-old');
        expect(changed).toEqual({
            oldId: 'doc-old',
            newId: 'doc-new',
            paneIndex: 0,
        });
    });

    it('document filter transform & veto respected', async () => {
        const panes = ref([
            {
                id: 'p1',
                mode: 'chat',
                threadId: '',
                documentId: undefined,
                messages: [],
                validating: false,
            } as any,
        ]);
        const activePaneIndex = ref(0);
        const createNewDoc = vi.fn().mockResolvedValue({ id: 'doc-B' });
        const flushDocument = vi.fn();
        const { newDocumentInActive, selectDocumentInActive } =
            usePaneDocuments({
                panes,
                activePaneIndex,
                createNewDoc,
                flushDocument,
            });
        hookEngine.addFilter('ui.pane.doc:filter:select', (req: string) =>
            req === 'doc-B' ? 'doc-B-TRANS' : req
        );
        await newDocumentInActive();
        // after new doc created, filter should have transformed id
        expect(panes.value[0]!.documentId).toBe('doc-B-TRANS');
        let changedCount = 0;
        hookEngine.addAction('ui.pane.doc:action:changed', () => {
            changedCount++;
        });
        hookEngine.addFilter('ui.pane.doc:filter:select', (req: string) =>
            req === 'doc-C' ? false : req
        );
        await selectDocumentInActive('doc-C'); // veto
        expect(changedCount).toBe(0);
    });

    it.skip('message sent & received hooks fire with lengths', async () => {
        const { panes } = useMultiPane({ initialThreadId: 't1' });

        // Ensure first pane is set to chat mode with the thread
        panes.value[0]!.mode = 'chat';
        panes.value[0]!.threadId = 't1';

        // Expose multi-pane API globally so useChat can locate pane for hook dispatch
        (globalThis as any).__or3MultiPaneApi = {
            panes,
            activePaneIndex: ref(0),
        };

        let sent: any = null;
        let received: any = null;
        hookEngine.addAction('ui.pane.msg:action:sent', (payload) => {
            sent = payload.message;
        });
        hookEngine.addAction('ui.pane.msg:action:received', (payload) => {
            received = payload.message;
        });
        const chat = useChat([], 't1');
        await chat.sendMessage('Hello AI');
        await flush();
        expect(sent).toBeTruthy();
        expect(received).toBeTruthy();
        expect(sent.length).toBe(8); // 'Hello AI'.length
        expect(received.length).toBeGreaterThan(0); // from mock stream text accumulation

        delete (globalThis as any).__or3MultiPaneApi;
    });
});
