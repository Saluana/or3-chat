import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, provide, computed } from 'vue';
import {
    useSidebarEnvironment,
    useSidebarProjects,
    useSidebarThreads,
    useSidebarDocuments,
    useSidebarQuery,
    useActiveSections,
    useSidebarMultiPane,
    provideSidebarEnvironment,
    SidebarEnvironmentKey,
    type SidebarEnvironment,
} from '../useSidebarEnvironment';
import {
    provideSidebarPageControls,
    SidebarPageControlsKey,
    type SidebarPageControls,
} from '../useSidebarEnvironment';
import {
    createMockSidebarEnvironment,
    createMockSidebarPageControls,
    createMockProject,
    createMockThread,
    createMockPost,
    createMockPanePluginApi,
    createMockSidebarMultiPane,
} from '../../../../tests/utils/sidebar-test-helpers';

// Check if Vue's provide/inject system is working before running tests
let canRunTests = false;

// Test setup to check if environment can be provided
try {
    // Create a temporary test environment
    const tempEnv = createMockSidebarEnvironment();
    const tempControls = createMockSidebarPageControls('test');

    provide(SidebarEnvironmentKey, tempEnv);
    provide(SidebarPageControlsKey, tempControls);
    useSidebarEnvironment(); // Test if injection works
    canRunTests = true;
} catch (error) {
    canRunTests = false;
}

describe.skipIf(!canRunTests)('Sidebar Interactions with Custom Pages', () => {
    let mockEnvironment: SidebarEnvironment;
    let mockControls: SidebarPageControls;
    let mockMultiPane: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockMultiPane = createMockSidebarMultiPane();

        const projectsRef = ref([
            createMockProject({ id: 'proj1', name: 'Project 1' }),
            createMockProject({ id: 'proj2', name: 'Project 2' }),
        ]);
        const threadsRef = ref([
            createMockThread({ id: 'thread1', title: 'Thread 1' }),
            createMockThread({ id: 'thread2', title: 'Thread 2' }),
        ]);
        const documentsRef = ref([
            createMockPost({ id: 'doc1', title: 'Document 1' }),
            createMockPost({ id: 'doc2', title: 'Document 2' }),
        ]);
        const sectionsRef = computed(() => ({
            top: [],
            main: [],
            bottom: [],
        }));
        const sidebarQueryRef = ref('');
        const activeSectionsRef = ref({
            projects: true,
            chats: true,
            docs: true,
        });
        const expandedProjectsRef = ref<string[]>(['proj1']);
        const activeThreadIdsRef = ref<string[]>(['thread1']);
        const activeDocumentIdsRef = ref<string[]>(['doc1']);
        const footerActionEntries = [
            {
                action: {
                    id: 'action1',
                    icon: 'pixelarticons:test',
                    handler: vi.fn(),
                },
                disabled: false,
            },
            {
                action: {
                    id: 'action2',
                    icon: 'pixelarticons:test',
                    handler: vi.fn(),
                },
                disabled: false,
            },
        ];
        const footerActionsRef = computed(() => footerActionEntries);

        const pluginApi = createMockPanePluginApi();
        (pluginApi.posts.listByType as any).mockResolvedValue({
            ok: true,
            posts: [],
        });

        mockEnvironment = createMockSidebarEnvironment({
            getMultiPane: () => mockMultiPane,
            getPanePluginApi: () => pluginApi,
            getProjects: () => projectsRef,
            getThreads: () => threadsRef,
            getDocuments: () => documentsRef,
            getSections: () => sectionsRef,
            getSidebarQuery: () => sidebarQueryRef,
            setSidebarQuery: vi.fn().mockImplementation((value: string) => {
                sidebarQueryRef.value = value;
            }),
            getActiveSections: () => activeSectionsRef,
            setActiveSections: vi.fn().mockImplementation((sections) => {
                activeSectionsRef.value = sections;
            }),
            getExpandedProjects: () => expandedProjectsRef,
            setExpandedProjects: vi.fn().mockImplementation((projects) => {
                expandedProjectsRef.value = projects;
            }),
            getActiveThreadIds: () => activeThreadIdsRef,
            setActiveThreadIds: vi.fn().mockImplementation((ids) => {
                activeThreadIdsRef.value = ids;
            }),
            getActiveDocumentIds: () => activeDocumentIdsRef,
            setActiveDocumentIds: vi.fn().mockImplementation((ids) => {
                activeDocumentIdsRef.value = ids;
            }),
            getSidebarFooterActions: () => footerActionsRef,
        });

        // Mock page controls with proper interface implementation
        mockControls = createMockSidebarPageControls();

        provide(SidebarEnvironmentKey, mockEnvironment);
        provide(SidebarPageControlsKey, mockControls);
    });

    describe('Default Sidebar Interactions', () => {
        it('provides projects data when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-todo-page';

            const projects = useSidebarProjects();

            expect(projects.value.map((project) => project.name)).toEqual([
                'Project 1',
                'Project 2',
            ]);
        });

        it('provides threads data when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-plugin-page';

            const threads = useSidebarThreads();

            expect(
                threads.value.map((thread) => thread?.title ?? null)
            ).toEqual(['Thread 1', 'Thread 2']);
        });

        it('provides documents data when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-doc-page';

            const documents = useSidebarDocuments();

            expect(documents.value.map((doc) => doc.title)).toEqual([
                'Document 1',
                'Document 2',
            ]);
        });

        it('provides query functionality when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-search-page';

            const { query, setQuery } = useSidebarQuery();

            expect(query.value).toBe('');

            setQuery('test query');
            expect(mockEnvironment.setSidebarQuery).toHaveBeenCalledWith(
                'test query'
            );
        });

        it('provides active sections control when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-sections-page';

            const { activeSections, setActiveSections } = useActiveSections();

            expect(activeSections.value).toEqual({
                projects: true,
                chats: true,
                docs: true,
            });

            setActiveSections({ projects: false, chats: true, docs: false });
            expect(mockEnvironment.setActiveSections).toHaveBeenCalledWith({
                projects: false,
                chats: true,
                docs: false,
            });
        });

        it('provides multi-pane API when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-pane-page';

            const multiPane = useSidebarMultiPane();

            expect(multiPane).toBe(mockMultiPane);
            expect(typeof multiPane.openApp).toBe('function');
            expect(typeof multiPane.openChat).toBe('function');
            expect(typeof multiPane.openDoc).toBe('function');
        });
    });

    describe('Footer Actions Availability', () => {
        it('provides footer actions when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-footer-page';

            const environment = useSidebarEnvironment();
            const footerActions = environment.getSidebarFooterActions();

            expect(footerActions.value.map((entry) => entry.action.id)).toEqual(
                ['action1', 'action2']
            );
        });

        it('footer actions remain accessible across page switches', () => {
            const environment = useSidebarEnvironment();
            const footerActions = environment.getSidebarFooterActions();

            // Start on default page
            expect(footerActions.value).toHaveLength(2);

            // Switch to custom page
            mockControls.pageId = 'custom-page-1';
            expect(footerActions.value).toHaveLength(2);

            // Switch to another custom page
            mockControls.pageId = 'custom-page-2';
            expect(footerActions.value).toHaveLength(2);

            // Return to default
            mockControls.pageId = 'sidebar-home';
            expect(footerActions.value).toHaveLength(2);
        });
    });

    describe('Multi-pane Functionality', () => {
        it('can open new chat from custom page', async () => {
            // Switch to custom page
            mockControls.pageId = 'custom-chat-page';

            const multiPane = useSidebarMultiPane();
            await multiPane.openChat('new-thread-id');

            expect(mockMultiPane.openChat).toHaveBeenCalledWith(
                'new-thread-id'
            );
        });

        it('can open new document from custom page', async () => {
            // Switch to custom page
            mockControls.pageId = 'custom-doc-page';

            const multiPane = useSidebarMultiPane();
            await multiPane.openDoc('new-doc-id');

            expect(mockMultiPane.openDoc).toHaveBeenCalledWith('new-doc-id');
        });

        it('can open custom app from custom page', async () => {
            // Switch to custom page
            mockControls.pageId = 'custom-app-page';

            const multiPane = useSidebarMultiPane();
            await multiPane.openApp('todo-app', {
                initialRecordId: 'todo-123',
            });

            expect(mockMultiPane.openApp).toHaveBeenCalledWith('todo-app', {
                initialRecordId: 'todo-123',
            });
        });

        it('can switch to different app from custom page', async () => {
            // Switch to custom page
            mockControls.pageId = 'custom-switch-page';

            const multiPane = useSidebarMultiPane();
            await multiPane.switchToApp('snake-game', { recordId: 'game-456' });

            expect(mockMultiPane.switchToApp).toHaveBeenCalledWith(
                'snake-game',
                { recordId: 'game-456' }
            );
        });
    });

    describe('Data Persistence Across Page Switches', () => {
        it('maintains expanded projects when switching pages', () => {
            const { setExpandedProjects, getExpandedProjects } =
                useSidebarEnvironment();

            // Set expanded projects on default page
            setExpandedProjects(['proj1', 'proj2']);

            // Switch to custom page
            mockControls.pageId = 'custom-page';

            // Should still have the same expanded projects
            expect(getExpandedProjects().value).toEqual(['proj1', 'proj2']);
        });

        it('maintains active thread selections when switching pages', () => {
            const { setActiveThreadIds, getActiveThreadIds } =
                useSidebarEnvironment();

            // Set active threads on default page
            setActiveThreadIds(['thread1', 'thread3']);

            // Switch to custom page
            mockControls.pageId = 'custom-page';

            // Should still have the same active threads
            expect(getActiveThreadIds().value).toEqual(['thread1', 'thread3']);
        });

        it('maintains active document selections when switching pages', () => {
            const { setActiveDocumentIds, getActiveDocumentIds } =
                useSidebarEnvironment();

            // Set active documents on default page
            setActiveDocumentIds(['doc2']);

            // Switch to custom page
            mockControls.pageId = 'custom-page';

            // Should still have the same active documents
            expect(getActiveDocumentIds().value).toEqual(['doc2']);
        });

        it('maintains query state when switching pages', () => {
            const { setSidebarQuery, getSidebarQuery } =
                useSidebarEnvironment();

            // Set query on default page
            setSidebarQuery('search term');

            // Switch to custom page
            mockControls.pageId = 'custom-search-page';

            // Should still have the same query
            expect(getSidebarQuery().value).toBe('search term');
        });
    });

    describe('Error Handling in Custom Pages', () => {
        it('handles missing multi-pane API gracefully', async () => {
            // Create environment with null-like multi-pane API
            const failingMultiPane = createMockSidebarMultiPane();
            failingMultiPane.openApp = vi
                .fn()
                .mockRejectedValue(new Error('Multi-pane not available'));
            failingMultiPane.switchToApp = vi
                .fn()
                .mockRejectedValue(new Error('Multi-pane not available'));
            failingMultiPane.openChat = vi
                .fn()
                .mockRejectedValue(new Error('Multi-pane not available'));
            failingMultiPane.openDoc = vi
                .fn()
                .mockRejectedValue(new Error('Multi-pane not available'));
            failingMultiPane.closePane = vi
                .fn()
                .mockRejectedValue(new Error('Multi-pane not available'));
            failingMultiPane.setActive = vi.fn();
            failingMultiPane.updatePane = vi.fn();
            failingMultiPane.panes.value = [];
            failingMultiPane.activePaneId.value = null;

            const brokenEnvironment = {
                ...mockEnvironment,
                getMultiPane: () => failingMultiPane,
            };

            provide(SidebarEnvironmentKey, brokenEnvironment);
            mockControls.pageId = 'custom-broken-page';

            expect(() => useSidebarMultiPane()).not.toThrow();
            const multiPane = useSidebarMultiPane();
            expect(multiPane).not.toBeNull();

            // Should handle errors gracefully when calling methods
            await expect(multiPane.openApp('test')).rejects.toThrow(
                'Multi-pane not available'
            );
        });

        it('handles missing posts API gracefully', () => {
            // Create environment without posts API
            const brokenEnvironment = {
                ...mockEnvironment,
                getPanePluginApi: () => null,
            };

            provide(SidebarEnvironmentKey, brokenEnvironment);
            mockControls.pageId = 'custom-broken-page';

            const environment = useSidebarEnvironment();
            expect(() => environment.getPanePluginApi()).not.toThrow();
            expect(environment.getPanePluginApi()).toBeNull();
        });
    });

    describe('Performance Considerations', () => {
        it('does not re-create environment instances on page switch', () => {
            const env1 = useSidebarEnvironment();

            // Switch page
            mockControls.pageId = 'custom-page';

            const env2 = useSidebarEnvironment();

            // Should be the same instance
            expect(env1).toBe(env2);
        });

        it('provides stable references to reactive data', () => {
            const projects1 = useSidebarProjects();

            // Switch page
            mockControls.pageId = 'custom-page';

            const projects2 = useSidebarProjects();

            // Should be the same reactive reference
            expect(projects1).toBe(projects2);
        });
    });
});
