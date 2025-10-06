import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Provide minimal defineNuxtPlugin global for plugin default export
(globalThis as any).defineNuxtPlugin = (fn: any) => fn;

// Hook engine mock
import { createHookEngine } from '../../utils/hooks';
const hookEngine = createHookEngine();
vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));

// DB mocks
let threadCounter = 0;
let msgCounter = 0;
vi.mock('~/db/util', () => ({ nowSec: () => 123456 }));
vi.mock('~/db', () => ({
    create: { thread: vi.fn(async () => ({ id: 't' + ++threadCounter })) },
    tx: {
        appendMessage: vi.fn(async (m: any) => ({
            id: 'm' + ++msgCounter,
            ...m,
        })),
    },
}));

// Documents store mocks (mutable map)
const docStates: Record<string, any> = {};
vi.mock('~/composables/documents/useDocumentsStore', () => ({
    setDocumentContent: vi.fn((id: string, c: any) => {
        (docStates[id] ||= {}).record = {
            ...(docStates[id]?.record || {}),
            content: c,
        };
    }),
    setDocumentTitle: vi.fn((id: string, t: string) => {
        (docStates[id] ||= {}).record = {
            ...(docStates[id]?.record || {}),
            title: t,
        };
    }),
    useDocumentState: (id: string) => docStates[id],
}));

// Defer plugin import until after mocks (dynamic to allow proper vi.mock interception)
async function initPlugin() {
    if ((globalThis as any).__or3PanePluginApi) return;
    const mod = await import('../../plugins/pane-plugin-api.client');
    // Nuxt plugin default export is a function; call with minimal nuxtApp stub
    if (typeof mod.default === 'function') await mod.default({} as any);
}

// Helper to set global multi-pane api shape used by plugin
function setPanes(panesArr: any[], active = 0) {
    (globalThis as any).__or3MultiPaneApi = {
        panes: ref(panesArr),
        activePaneIndex: ref(active),
        setPaneThread: vi.fn((i: number, id: string) => {
            panesArr[i].threadId = id;
        }),
    };
}

describe('pane plugin api', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
        (globalThis as any).__or3PanePluginApi = undefined; // force re-init
        threadCounter = 0;
        msgCounter = 0;
        for (const k of Object.keys(docStates)) delete docStates[k];
    });

    it('sends message to existing thread', async () => {
        setPanes([
            {
                id: 'p1',
                mode: 'chat',
                threadId: 'tExisting',
                messages: [],
                validating: false,
            },
        ]);
        await initPlugin();
        const api = (globalThis as any).__or3PanePluginApi;
        const res = await api.sendMessage({
            paneId: 'p1',
            text: 'Hello',
            source: 'test',
        });
        expect(res.ok).toBe(true);
        expect(res.threadId).toBe('tExisting');
    });

    it('creates thread when missing and createIfMissing provided', async () => {
        setPanes([
            {
                id: 'p1',
                mode: 'chat',
                threadId: '',
                messages: [],
                validating: false,
            },
        ]);
        await initPlugin();
        const api = (globalThis as any).__or3PanePluginApi;
        const res = await api.sendMessage({
            paneId: 'p1',
            text: 'Spin up',
            source: 'test',
            createIfMissing: true,
        });
        expect(res.ok).toBe(true);
        expect(res.threadId).toMatch(/^t\d+/);
    });

    it('rejects missing pane', async () => {
        setPanes([]);
        await initPlugin();
        const api = (globalThis as any).__or3PanePluginApi;
        const res = await api.sendMessage({
            paneId: 'none',
            text: 'x',
            source: 'test',
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe('not_found');
    });

    it('rejects non chat pane', async () => {
        setPanes([
            { id: 'p1', mode: 'doc', documentId: 'd1', validating: false },
        ]);
        await initPlugin();
        const api = (globalThis as any).__or3PanePluginApi;
        const res = await api.sendMessage({
            paneId: 'p1',
            text: 'x',
            source: 'test',
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe('pane_not_chat');
    });

    it('rejects missing source', async () => {
        setPanes([
            { id: 'p1', mode: 'chat', threadId: 't1', validating: false },
        ]);
        await (
            await import('../../plugins/pane-plugin-api.client')
        ).default({} as any);
        const api = (globalThis as any).__or3PanePluginApi;
        const res = await api.sendMessage({
            paneId: 'p1',
            text: 'x',
            source: '',
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe('missing_source');
    });

    it('document replace + title + patch', () => {
        setPanes([
            { id: 'p1', mode: 'doc', documentId: 'd1', validating: false },
        ]);
        docStates['d1'] = {
            record: { content: { type: 'doc', content: [] }, title: 'Old' },
        };
        return initPlugin().then(async () => {
            const api = (globalThis as any).__or3PanePluginApi;
            expect(
                api.updateDocumentContent({
                    paneId: 'p1',
                    content: {
                        type: 'doc',
                        content: [{ type: 'p', text: 'A' }],
                    },
                    source: 'test',
                }).ok
            ).toBe(true);
            expect(
                api.patchDocumentContent({
                    paneId: 'p1',
                    patch: { content: [{ type: 'p', text: 'B' }], meta: 1 },
                    source: 'test',
                }).ok
            ).toBe(true);
            expect(
                api.setDocumentTitle({
                    paneId: 'p1',
                    title: 'New',
                    source: 'test',
                }).ok
            ).toBe(true);
            expect(docStates['d1'].record.title).toBe('New');
        });
    });

    it('getActivePaneData returns snapshot for doc', async () => {
        setPanes(
            [{ id: 'p1', mode: 'doc', documentId: 'd1', validating: false }],
            0
        );
        docStates['d1'] = {
            record: {
                content: { type: 'doc', content: [{ type: 'p', text: 'X' }] },
            },
        };
        await initPlugin();
        const api = (globalThis as any).__or3PanePluginApi;
        const res = api.getActivePaneData();
        expect(res.ok).toBe(true);
        expect(res.documentId).toBe('d1');
        expect(res.contentSnapshot).toBeTruthy();
    });
});
