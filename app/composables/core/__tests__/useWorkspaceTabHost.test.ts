import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useWorkspaceTabHost } from '../useWorkspaceTabHost';

const activation = {
    paneId: 'pane-a',
    generation: 1,
    signal: new AbortController().signal,
    isCurrent: () => true,
};

describe('useWorkspaceTabHost', () => {
    it('maps stable pane IDs to existing chat, document, and app pane APIs', async () => {
        const updatePane = vi.fn();
        const setPaneThread = vi.fn(async () => undefined);
        const setPaneApp = vi.fn(async () => undefined);
        const api = {
            panes: ref([{ id: 'pane-a' }]),
            activePaneId: ref('pane-a'),
            getPaneIndexById: (id: string) => (id === 'pane-a' ? 0 : -1),
            setActive: vi.fn(),
            addPane: vi.fn(() => 'pane-b'),
            closePane: vi.fn(async () => undefined),
            updatePane,
            setPaneThread,
            setPaneApp,
        };
        const host = useWorkspaceTabHost(api as never);

        await host.bindResourceToPane(
            'pane-a',
            { kind: 'chat', threadId: 'chat-a' },
            activation
        );
        expect(setPaneThread).toHaveBeenCalledWith(0, 'chat-a');

        await host.bindResourceToPane(
            'pane-a',
            { kind: 'document', documentId: 'doc-a' },
            activation
        );
        expect(updatePane).toHaveBeenCalledWith(
            0,
            expect.objectContaining({ mode: 'doc', documentId: 'doc-a' })
        );

        await host.bindResourceToPane(
            'pane-a',
            { kind: 'app', appId: 'kanban', recordId: 'record-a' },
            activation
        );
        expect(setPaneApp).toHaveBeenCalledWith(0, 'kanban', {
            recordId: 'record-a',
        });
    });

    it('looks up the current pane index after a pane to its left closes', async () => {
        const panes = ref([{ id: 'pane-a' }, { id: 'pane-b' }]);
        const updatePane = vi.fn();
        const setPaneThread = vi.fn(async () => undefined);
        const api = {
            panes,
            activePaneId: ref('pane-b'),
            getPaneIndexById: (id: string) =>
                panes.value.findIndex((pane) => pane.id === id),
            setActive: vi.fn(),
            addPane: vi.fn(),
            closePane: vi.fn(),
            updatePane,
            setPaneThread,
            setPaneApp: vi.fn(),
        };
        const host = useWorkspaceTabHost(api as never);

        panes.value.shift();
        await host.bindResourceToPane(
            'pane-b',
            { kind: 'chat', threadId: 'chat-b' },
            { ...activation, paneId: 'pane-b' }
        );

        expect(setPaneThread).toHaveBeenCalledWith(0, 'chat-b');
    });

    it('publishes the target chat while replacing a document', async () => {
        const pane = {
            id: 'pane-a',
            mode: 'doc',
            documentId: 'doc-a',
            threadId: '',
            messages: [],
        };
        const panes = ref([pane]);
        const updatePane = vi.fn((_: number, updates: Record<string, unknown>) => {
            Object.assign(pane, updates);
        });
        const setPaneThread = vi.fn(async () => {
            expect(pane.mode).toBe('chat');
            expect((pane as { pendingThreadId?: string }).pendingThreadId).toBe(
                'chat-a'
            );
            pane.threadId = 'chat-a';
        });
        const api = {
            panes,
            activePaneId: ref('pane-a'),
            getPaneIndexById: () => 0,
            setActive: vi.fn(),
            addPane: vi.fn(),
            closePane: vi.fn(),
            updatePane,
            setPaneThread,
            setPaneApp: vi.fn(),
        };
        const host = useWorkspaceTabHost(api as never);

        await host.bindResourceToPane(
            'pane-a',
            { kind: 'chat', threadId: 'chat-a' },
            activation
        );

        expect(updatePane).toHaveBeenCalledWith(0, {
            mode: 'chat',
            documentId: undefined,
            pendingThreadId: 'chat-a',
            messages: [],
        });
        expect(pane.threadId).toBe('chat-a');
        expect((pane as { pendingThreadId?: string }).pendingThreadId).toBeUndefined();
    });
});
