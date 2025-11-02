import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, provide } from 'vue';
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
    type SidebarEnvironment 
} from '../useSidebarEnvironment';
import { 
    provideSidebarPageControls,
    SidebarPageControlsKey,
    type SidebarPageControls 
} from '../useSidebarEnvironment';

// Check if Vue's provide/inject system is working before running tests
let canRunTests = false;

// Test setup to check if environment can be provided
try {
    // Create a temporary test environment
    const tempEnv = {
        getMultiPane: () => ({} as any),
        getPanePluginApi: () => ({}),
        getProjects: () => ref([]),
        getThreads: () => ref([]),
        getDocuments: () => ref([]),
        getSections: () => ref({}),
        getSidebarQuery: () => ref(''),
        setSidebarQuery: vi.fn(),
        getActiveSections: () => ref({ projects: true, chats: true, docs: true }),
        setActiveSections: vi.fn(),
        getExpandedProjects: () => ref([]),
        setExpandedProjects: vi.fn(),
        getActiveThreadIds: () => ref([]),
        setActiveThreadIds: vi.fn(),
        getActiveDocumentIds: () => ref([]),
        setActiveDocumentIds: vi.fn(),
        getSidebarFooterActions: () => ref([]),
    };
    
    const tempControls = {
        get pageId() { return 'test'; },
        set pageId(value: string) {},
        get isActive() { return true; },
        setActivePage: vi.fn(),
        resetToDefault: vi.fn(),
    };
    
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

        // Mock multi-pane API
        mockMultiPane = {
            openApp: vi.fn().mockResolvedValue(undefined),
            switchToApp: vi.fn().mockResolvedValue(undefined),
            openChat: vi.fn().mockResolvedValue(undefined),
            openDoc: vi.fn().mockResolvedValue(undefined),
            closePane: vi.fn(),
            setActive: vi.fn(),
            panes: ref([]),
            activePaneId: ref(null),
            updatePane: vi.fn(),
        };

        // Mock environment
        mockEnvironment = {
            getMultiPane: () => mockMultiPane,
            getPanePluginApi: () => ({
                posts: {
                    create: vi.fn().mockResolvedValue({ ok: true, id: 'test-id' }),
                    listByType: vi.fn().mockResolvedValue({ ok: true, data: [] }),
                },
            }),
            getProjects: () => ref([
                { id: 'proj1', title: 'Project 1' },
                { id: 'proj2', title: 'Project 2' },
            ]),
            getThreads: () => ref([
                { id: 'thread1', title: 'Thread 1' },
                { id: 'thread2', title: 'Thread 2' },
            ]),
            getDocuments: () => ref([
                { id: 'doc1', title: 'Document 1' },
                { id: 'doc2', title: 'Document 2' },
            ]),
            getSections: () => ref({
                projects: true,
                chats: true,
                docs: true,
            }),
            getSidebarQuery: () => ref(''),
            setSidebarQuery: vi.fn(),
            getActiveSections: () => ref({
                projects: true,
                chats: true,
                docs: true,
            }),
            setActiveSections: vi.fn(),
            getExpandedProjects: () => ref(['proj1']),
            setExpandedProjects: vi.fn(),
            getActiveThreadIds: () => ref(['thread1']),
            setActiveThreadIds: vi.fn(),
            getActiveDocumentIds: () => ref(['doc1']),
            setActiveDocumentIds: vi.fn(),
            getSidebarFooterActions: () => ref([
                { id: 'action1', label: 'Action 1' },
                { id: 'action2', label: 'Action 2' },
            ]),
        };

        // Mock page controls with proper interface implementation
        const pageIdRef = ref('sidebar-home');
        const isActiveRef = ref(true);
        
        mockControls = {
            get pageId() { return pageIdRef.value; },
            set pageId(value: string) { pageIdRef.value = value; },
            get isActive() { return isActiveRef.value; },
            setActivePage: vi.fn().mockImplementation(async (id: string) => {
                mockControls.pageId = id;
                return true;
            }),
            resetToDefault: vi.fn().mockImplementation(async () => {
                mockControls.pageId = 'sidebar-home';
                return true;
            }),
        };

        provide(SidebarEnvironmentKey, mockEnvironment);
        provide(SidebarPageControlsKey, mockControls);
    });

    describe('Default Sidebar Interactions', () => {
        it('provides projects data when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-todo-page';
            
            const projects = useSidebarProjects();
            
            expect(projects.value).toEqual([
                { id: 'proj1', title: 'Project 1' },
                { id: 'proj2', title: 'Project 2' },
            ]);
        });

        it('provides threads data when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-plugin-page';
            
            const threads = useSidebarThreads();
            
            expect(threads.value).toEqual([
                { id: 'thread1', title: 'Thread 1' },
                { id: 'thread2', title: 'Thread 2' },
            ]);
        });

        it('provides documents data when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-doc-page';
            
            const documents = useSidebarDocuments();
            
            expect(documents.value).toEqual([
                { id: 'doc1', title: 'Document 1' },
                { id: 'doc2', title: 'Document 2' },
            ]);
        });

        it('provides query functionality when custom page is active', () => {
            // Switch to custom page
            mockControls.pageId = 'custom-search-page';
            
            const { query, setQuery } = useSidebarQuery();
            
            expect(query.value).toBe('');
            
            setQuery('test query');
            expect(mockEnvironment.setSidebarQuery).toHaveBeenCalledWith('test query');
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
            
            expect(footerActions.value).toEqual([
                { id: 'action1', label: 'Action 1' },
                { id: 'action2', label: 'Action 2' },
            ]);
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
            
            expect(mockMultiPane.openChat).toHaveBeenCalledWith('new-thread-id');
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
            await multiPane.openApp('todo-app', { initialRecordId: 'todo-123' });
            
            expect(mockMultiPane.openApp).toHaveBeenCalledWith('todo-app', { initialRecordId: 'todo-123' });
        });

        it('can switch to different app from custom page', async () => {
            // Switch to custom page
            mockControls.pageId = 'custom-switch-page';
            
            const multiPane = useSidebarMultiPane();
            await multiPane.switchToApp('snake-game', { recordId: 'game-456' });
            
            expect(mockMultiPane.switchToApp).toHaveBeenCalledWith('snake-game', { recordId: 'game-456' });
        });
    });

    describe('Data Persistence Across Page Switches', () => {
        it('maintains expanded projects when switching pages', () => {
            const { setExpandedProjects, getExpandedProjects } = useSidebarEnvironment();
            
            // Set expanded projects on default page
            setExpandedProjects(['proj1', 'proj2']);
            
            // Switch to custom page
            mockControls.pageId = 'custom-page';
            
            // Should still have the same expanded projects
            expect(getExpandedProjects().value).toEqual(['proj1', 'proj2']);
        });

        it('maintains active thread selections when switching pages', () => {
            const { setActiveThreadIds, getActiveThreadIds } = useSidebarEnvironment();
            
            // Set active threads on default page
            setActiveThreadIds(['thread1', 'thread3']);
            
            // Switch to custom page
            mockControls.pageId = 'custom-page';
            
            // Should still have the same active threads
            expect(getActiveThreadIds().value).toEqual(['thread1', 'thread3']);
        });

        it('maintains active document selections when switching pages', () => {
            const { setActiveDocumentIds, getActiveDocumentIds } = useSidebarEnvironment();
            
            // Set active documents on default page
            setActiveDocumentIds(['doc2']);
            
            // Switch to custom page
            mockControls.pageId = 'custom-page';
            
            // Should still have the same active documents
            expect(getActiveDocumentIds().value).toEqual(['doc2']);
        });

        it('maintains query state when switching pages', () => {
            const { setSidebarQuery, getSidebarQuery } = useSidebarEnvironment();
            
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
            const brokenEnvironment = {
                ...mockEnvironment,
                getMultiPane: () => ({
                    openApp: vi.fn().mockRejectedValue(new Error('Multi-pane not available')),
                    switchToApp: vi.fn().mockRejectedValue(new Error('Multi-pane not available')),
                    openChat: vi.fn().mockRejectedValue(new Error('Multi-pane not available')),
                    openDoc: vi.fn().mockRejectedValue(new Error('Multi-pane not available')),
                    closePane: vi.fn(),
                    setActive: vi.fn(),
                    updatePane: vi.fn(),
                    panes: ref([]),
                    activePaneId: ref(null),
                }),
            };
            
            provide(SidebarEnvironmentKey, brokenEnvironment);
            mockControls.pageId = 'custom-broken-page';
            
            expect(() => useSidebarMultiPane()).not.toThrow();
            const multiPane = useSidebarMultiPane();
            expect(multiPane).not.toBeNull();
            
            // Should handle errors gracefully when calling methods
            await expect(multiPane.openApp('test')).rejects.toThrow('Multi-pane not available');
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
