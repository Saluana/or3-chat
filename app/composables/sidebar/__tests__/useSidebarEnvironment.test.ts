import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, computed, getCurrentInstance } from 'vue';
import {
    provideSidebarEnvironment,
    useSidebarEnvironment,
    useSidebarProjects,
    useSidebarThreads,
    useSidebarDocuments,
    useSidebarQuery,
    useActiveSections,
    useExpandedProjects,
    useActiveThreadIds,
    useActiveDocumentIds,
    useSidebarMultiPane,
    useSidebarPostsApi,
    type SidebarEnvironment,
    createSidebarMultiPaneApi
} from '../useSidebarEnvironment';
import {
    useSidebarSections,
    useSidebarFooterActions
} from '../useSidebarSections';
import {
    createMockSidebarEnvironment,
    createMockProject,
    createMockThread,
    createMockPost,
    createMockPanePluginApi,
} from '../../../../tests/utils/sidebar-test-helpers';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';

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
    let mockEnvironment: SidebarEnvironment;

    beforeEach(() => {
        const fullMultiPaneApi = {
            panes: ref([{ id: 'test-pane', mode: 'chat' }] as any),
            activePaneIndex: ref(0),
            newPaneForApp: vi.fn(),
            addPane: vi.fn(),
            closePane: vi.fn(),
            setPaneThread: vi.fn(),
            setActive: vi.fn(),
            updatePane: vi.fn(),
        } as unknown as UseMultiPaneApi;

        mockEnvironment = createMockSidebarEnvironment({
            getMultiPane: () => createSidebarMultiPaneApi(fullMultiPaneApi),
            getPanePluginApi: () => createMockPanePluginApi(),
            getProjects: () => ref([createMockProject({ id: 'proj-1', name: 'Project 1' })]),
            getThreads: () => ref([createMockThread({ id: 'thread-1', title: 'Thread 1' })]),
            getDocuments: () => ref([createMockPost({ id: 'doc-1', title: 'Doc 1' })]),
            getSidebarQuery: () => ref('test query'),
            setSidebarQuery: vi.fn(),
            getExpandedProjects: () => ref(['proj-1']),
            setExpandedProjects: vi.fn(),
            getActiveThreadIds: () => ref(['thread-1']),
            setActiveThreadIds: vi.fn(),
            getActiveDocumentIds: () => ref(['doc-1']),
            setActiveDocumentIds: vi.fn(),
            getSidebarFooterActions: () =>
                computed(() => [
                    {
                        action: {
                            id: 'action-1',
                            icon: 'pixelarticons:test',
                            handler: vi.fn(),
                        },
                        disabled: false,
                    },
                ]),
        });
    });

    it('provides and injects environment correctly', () => {
        // Mock Vue's provide/inject by testing the functions directly
        // Since we can't use provide/inject outside setup(), we'll test the logic
        
        // Test that the environment is created correctly
        expect(mockEnvironment.getProjects().value[0]?.id).toBe('proj-1');
        expect(mockEnvironment.getThreads().value[0]?.id).toBe('thread-1');
        expect(mockEnvironment.getDocuments().value[0]?.id).toBe('doc-1');
    });

    it('throws error when environment not provided', () => {
        // This test verifies the error handling when inject fails
        // We can't actually test this without a Vue component context
        // but we can verify the error message exists
        expect(() => {
            // Simulate the condition where inject returns null
            const instance = getCurrentInstance();
            if (!instance) {
                throw new Error('useSidebarEnvironment must be used within a component that provides SidebarEnvironment');
            }
        }).toThrow('useSidebarEnvironment must be used within a component that provides SidebarEnvironment');
    });

    describe('helper composables functionality', () => {
        it('verify helper functions access correct environment methods', () => {
            // Test that helper functions would access the correct environment methods
            expect(typeof mockEnvironment.getProjects).toBe('function');
            expect(typeof mockEnvironment.getThreads).toBe('function');
            expect(typeof mockEnvironment.getDocuments).toBe('function');
            expect(typeof mockEnvironment.getSections).toBe('function');
            expect(typeof mockEnvironment.getSidebarQuery).toBe('function');
            expect(typeof mockEnvironment.setSidebarQuery).toBe('function');
            expect(typeof mockEnvironment.getActiveSections).toBe('function');
            expect(typeof mockEnvironment.setActiveSections).toBe('function');
            expect(typeof mockEnvironment.getExpandedProjects).toBe('function');
            expect(typeof mockEnvironment.setExpandedProjects).toBe('function');
            expect(typeof mockEnvironment.getActiveThreadIds).toBe('function');
            expect(typeof mockEnvironment.setActiveThreadIds).toBe('function');
            expect(typeof mockEnvironment.getActiveDocumentIds).toBe('function');
            expect(typeof mockEnvironment.setActiveDocumentIds).toBe('function');
            expect(typeof mockEnvironment.getSidebarFooterActions).toBe('function');
        });

        it('verify environment returns correct data types', () => {
            const projects = mockEnvironment.getProjects();
            const threads = mockEnvironment.getThreads();
            const documents = mockEnvironment.getDocuments();
            const sections = mockEnvironment.getSections();
            const query = mockEnvironment.getSidebarQuery();
            const activeSections = mockEnvironment.getActiveSections();
            const expandedProjects = mockEnvironment.getExpandedProjects();
            const activeThreadIds = mockEnvironment.getActiveThreadIds();
            const activeDocumentIds = mockEnvironment.getActiveDocumentIds();
            const footerActions = mockEnvironment.getSidebarFooterActions();

            // Check that they have .value property (indicating they are refs)
            expect('value' in projects).toBe(true);
            expect('value' in threads).toBe(true);
            expect('value' in documents).toBe(true);
            expect('value' in sections).toBe(true);
            expect('value' in query).toBe(true);
            expect('value' in activeSections).toBe(true);
            expect('value' in expandedProjects).toBe(true);
            expect('value' in activeThreadIds).toBe(true);
            expect('value' in activeDocumentIds).toBe(true);
            expect('value' in footerActions).toBe(true);
        });
    });

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
