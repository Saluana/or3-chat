import { describe, it, expect, vi } from 'vitest';
import { ref, computed } from 'vue';
import { createSidebarMultiPaneApi } from '../useSidebarEnvironment';

// Mock dependencies
vi.mock('~/composables/core/useMultiPane', () => ({
    useMultiPane: () => ({
        panes: ref([{ id: 'pane-1', mode: 'chat' }]),
        activePaneIndex: ref(0),
        newPaneForApp: vi.fn(),
        addPane: vi.fn(),
        closePane: vi.fn(),
        setPaneThread: vi.fn(),
    }),
}));

describe('useSidebarEnvironment', () => {
    describe('createSidebarMultiPaneApi', () => {
        it('creates trimmed API from full multi-pane API', () => {
            const mockFullApi = {
                panes: ref([{ id: 'pane-1', mode: 'chat' }]),
                activePaneIndex: ref(0),
                newPaneForApp: vi.fn(),
                addPane: vi.fn(),
                closePane: vi.fn(),
                setPaneThread: vi.fn(),
                // Other methods that should be excluded
                canAddPane: computed(() => true),
                setActive: vi.fn(),
            };

            const sidebarApi = createSidebarMultiPaneApi(mockFullApi as any);

            // Should include only the trimmed methods
            expect(sidebarApi.openApp).toBe(mockFullApi.newPaneForApp);
            expect(sidebarApi.closePane).toBe(mockFullApi.closePane);
            expect(sidebarApi.panes).toBe(mockFullApi.panes);
            expect(sidebarApi.activePaneId.value).toBe('pane-1');

            // Should have the convenience methods
            expect(typeof sidebarApi.openChat).toBe('function');
            expect(typeof sidebarApi.openDoc).toBe('function');

            // Should not include the excluded methods
            expect('canAddPane' in sidebarApi).toBe(false);
        });

        it('openChat creates new pane and sets thread', async () => {
            const mockFullApi = {
                panes: ref([]),
                activePaneIndex: ref(0),
                newPaneForApp: vi.fn(),
                addPane: vi.fn(),
                closePane: vi.fn(),
                setPaneThread: vi.fn(),
            };

            const sidebarApi = createSidebarMultiPaneApi(mockFullApi as any);

            await sidebarApi.openChat('thread-123');

            expect(mockFullApi.addPane).toHaveBeenCalled();
            expect(mockFullApi.setPaneThread).toHaveBeenCalledWith(0, 'thread-123');
        });

        it('openDoc creates new pane for document', async () => {
            const panesArray = ref([] as any[]);
            const mockFullApi = {
                panes: panesArray,
                activePaneIndex: ref(0),
                newPaneForApp: vi.fn(),
                addPane: vi.fn().mockImplementation(() => {
                    // Simulate adding a pane to the array
                    panesArray.value.push({ id: 'new-pane', mode: 'chat' });
                }),
                closePane: vi.fn(),
                setPaneThread: vi.fn(),
                updatePane: vi.fn(),
            };

            const sidebarApi = createSidebarMultiPaneApi(mockFullApi as any);

            await sidebarApi.openDoc('doc-123');

            expect(mockFullApi.addPane).toHaveBeenCalled();
            expect(mockFullApi.updatePane).toHaveBeenCalledWith(0, {
                mode: 'doc',
                documentId: 'doc-123',
                threadId: '',
                messages: [],
            });
        });

        it('openDoc handles pane limit blocking gracefully', async () => {
            const mockFullApi = {
                panes: ref([{ id: 'existing-pane', mode: 'chat' }]),
                activePaneIndex: ref(0),
                newPaneForApp: vi.fn(),
                addPane: vi.fn().mockImplementation(() => {
                    // Simulate pane limit - don't add new pane
                    return;
                }),
                closePane: vi.fn(),
                setPaneThread: vi.fn(),
                updatePane: vi.fn(),
            };

            const sidebarApi = createSidebarMultiPaneApi(mockFullApi as any);

            await sidebarApi.openDoc('doc-123');

            expect(mockFullApi.addPane).toHaveBeenCalled();
            // Should not call updatePane since pane wasn't added
            expect(mockFullApi.updatePane).not.toHaveBeenCalled();
        });

        it('activePaneId returns correct pane ID', () => {
            const mockFullApi = {
                panes: ref([{ id: 'pane-1', mode: 'chat' }, { id: 'pane-2', mode: 'doc' }]),
                activePaneIndex: ref(1),
                newPaneForApp: vi.fn(),
                addPane: vi.fn(),
                closePane: vi.fn(),
                setPaneThread: vi.fn(),
            };

            const sidebarApi = createSidebarMultiPaneApi(mockFullApi as any);

            expect(sidebarApi.activePaneId.value).toBe('pane-2');
        });

        it('activePaneId returns null when no active pane', () => {
            const mockFullApi = {
                panes: ref([]),
                activePaneIndex: ref(0),
                newPaneForApp: vi.fn(),
                addPane: vi.fn(),
                closePane: vi.fn(),
                setPaneThread: vi.fn(),
            };

            const sidebarApi = createSidebarMultiPaneApi(mockFullApi as any);

            expect(sidebarApi.activePaneId.value).toBeNull();
        });
    });
});
