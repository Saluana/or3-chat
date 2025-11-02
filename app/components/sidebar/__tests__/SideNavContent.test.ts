import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import SideNavContent from '../SideNavContent.vue';
import { 
    provideSidebarEnvironment,
    type SidebarEnvironment 
} from '~/composables/sidebar/useSidebarEnvironment';

// Mock the environment
const mockEnvironment: SidebarEnvironment = {
    getMultiPane: () => ({
        openApp: () => Promise.resolve(),
        openChat: () => Promise.resolve(),
        openDoc: () => Promise.resolve(),
        closePane: () => {},
        panes: ref([]),
        activePaneId: ref(null),
    }),
    getPanePluginApi: () => null,
    getProjects: () => ref([]),
    getThreads: () => ref([]),
    getDocuments: () => ref([]),
    getSections: () => ref({ top: [], main: [], bottom: [] }),
    getSidebarQuery: () => ref(''),
    setSidebarQuery: () => {},
    getActiveSections: () => ref({ projects: true, chats: true, docs: true }),
    setActiveSections: () => {},
    getExpandedProjects: () => ref([]),
    setExpandedProjects: () => {},
    getActiveThreadIds: () => ref([]),
    setActiveThreadIds: () => {},
    getActiveDocumentIds: () => ref([]),
    setActiveDocumentIds: () => {},
    getSidebarFooterActions: () => ref([]),
};

// Minimal stubs for child components & composables used inside (focus is resize logic wiring)
vi.mock('~/components/sidebar/SidebarVirtualList.vue', () => ({
    default: {
        name: 'SidebarVirtualList',
        props: [
            'height',
            'projects',
            'threads',
            'documents',
            'displayDocuments',
            'expandedProjects',
            'activeSections',
            'activeThread',
            'activeDocument',
            'activeThreads',
            'activeDocuments',
        ],
        template: '<div class="virtual-list" />',
    },
}));
vi.mock('~/components/sidebar/SideNavHeader.vue', () => ({
    default: {
        name: 'SideNavHeader',
        props: ['sidebarQuery', 'activeSections', 'projects'],
        template: '<header class="side-nav-header" />',
    },
}));
vi.mock('dexie', () => ({
    liveQuery: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
}));
vi.mock('~/db', () => ({
    db: {
        threads: {
            orderBy: () => ({
                reverse: () => ({
                    filter: () => ({ toArray: async () => [] }),
                }),
            }),
        },
        projects: {
            orderBy: () => ({
                reverse: () => ({
                    filter: () => ({ toArray: async () => [] }),
                }),
            }),
        },
        posts: {
            where: () => ({
                equals: () => ({ and: () => ({ toArray: async () => [] }) }),
            }),
        },
    },
    upsert: {},
    del: {},
    create: {},
}));
vi.mock('~/db/documents', () => ({ updateDocument: vi.fn() }));
vi.mock('~/composables/documents/useDocumentsStore', () => ({
    loadDocument: vi.fn(),
}));
vi.mock('~/composables/sidebar/useSidebarSearch', () => ({
    useSidebarSearch: () => ({
        query: ref(''),
        threadResults: ref([]),
        projectResults: ref([]),
        documentResults: ref([]),
    }),
}));
vi.mock('~/composables/sidebar/useActiveSidebarPage', () => ({
    useActiveSidebarPage: () => ({
        activePageId: ref('sidebar-home'),
        activePageDef: ref({ id: 'sidebar-home', usesDefaultHeader: true }),
        setActivePage: () => Promise.resolve(true),
        resetToDefault: () => Promise.resolve(true),
    }),
}));

describe('SideNavContent', () => {
    it('mounts and provides a numeric listHeight', async () => {
        const wrapper = mount(SideNavContent, {
            props: {
                activeThread: undefined,
                items: [],
                projects: [],
                expandedProjects: [],
                docs: [],
                listHeight: 400,
                activeSections: { projects: true, chats: true, docs: true },
                displayThreads: [],
                displayProjects: [],
                displayDocuments: [],
                sidebarQuery: '',
                activeDocumentIds: [],
                activeThreadIds: [],
                sidebarFooterActions: [],
                resolvedSidebarSections: { top: [], main: [], bottom: [] },
            },
            global: {
                plugins: [
                    {
                        install(app: any) {
                            provideSidebarEnvironment(mockEnvironment);
                        },
                    },
                ],
                stubs: {
                    UIcon: true,
                    UButton: true,
                    UTooltip: true,
                },
            },
        });
        // Allow nextTick chain used in onMounted
        await wrapper.vm.$nextTick();
        expect(typeof (wrapper.vm as any).listHeight).toBe('number');
        // Simulate container size change by directly calling recompute if exposed
        // (Not strictly necessary; mount success without TS/runtime errors is primary assertion.)
    });

    describe('Dynamic page rendering', () => {
        it('renders default page component with proper props', async () => {
            const wrapper = mount(SideNavContent, {
                props: {
                    activeThread: undefined,
                    items: [],
                    projects: [],
                    expandedProjects: [],
                    docs: [],
                    listHeight: 400,
                    activeSections: { projects: true, chats: true, docs: true },
                    displayThreads: [],
                    displayProjects: [],
                    displayDocuments: [],
                    sidebarQuery: '',
                    activeDocumentIds: [],
                    activeThreadIds: [],
                    sidebarFooterActions: [],
                    resolvedSidebarSections: { top: [], main: [], bottom: [] },
                },
                global: {
                    plugins: [
                        {
                            install(app: any) {
                                provideSidebarEnvironment(mockEnvironment);
                            },
                        },
                    ],
                    stubs: {
                        UIcon: true,
                        UButton: true,
                        UTooltip: true,
                        SidebarHomePage: { template: '<div data-testid="sidebar-home-page">Home Page Content</div>' },
                    },
                },
            });

            await wrapper.vm.$nextTick();

            // Should render the home page component
            expect(wrapper.find('[data-testid="sidebar-home-page"]').exists()).toBe(true);
            expect(wrapper.text()).toContain('Home Page Content');
        });

        it('shows header for pages that use default header', async () => {
            const wrapper = mount(SideNavContent, {
                props: {
                    activeThread: undefined,
                    items: [],
                    projects: [],
                    expandedProjects: [],
                    docs: [],
                    listHeight: 400,
                    activeSections: { projects: true, chats: true, docs: true },
                    displayThreads: [],
                    displayProjects: [],
                    displayDocuments: [],
                    sidebarQuery: '',
                    activeDocumentIds: [],
                    activeThreadIds: [],
                    sidebarFooterActions: [],
                    resolvedSidebarSections: { top: [], main: [], bottom: [] },
                },
                global: {
                    plugins: [
                        {
                            install(app: any) {
                                provideSidebarEnvironment(mockEnvironment);
                            },
                        },
                    ],
                    stubs: {
                        UIcon: true,
                        UButton: true,
                        UTooltip: true,
                        SideNavHeader: { template: '<div data-testid="side-nav-header">Header</div>' },
                        SidebarHomePage: { template: '<div>Home Page</div>' },
                    },
                },
            });

            await wrapper.vm.$nextTick();

            // Should show header for default page
            expect(wrapper.find('[data-testid="side-nav-header"]').exists()).toBe(true);
        });

        it('renders suspense fallback during loading', async () => {
            const wrapper = mount(SideNavContent, {
                props: {
                    activeThread: undefined,
                    items: [],
                    projects: [],
                    expandedProjects: [],
                    docs: [],
                    listHeight: 400,
                    activeSections: { projects: true, chats: true, docs: true },
                    displayThreads: [],
                    displayProjects: [],
                    displayDocuments: [],
                    sidebarQuery: '',
                    activeDocumentIds: [],
                    activeThreadIds: [],
                    sidebarFooterActions: [],
                    resolvedSidebarSections: { top: [], main: [], bottom: [] },
                },
                global: {
                    plugins: [
                        {
                            install(app: any) {
                                provideSidebarEnvironment(mockEnvironment);
                            },
                        },
                    ],
                    stubs: {
                        UIcon: true,
                        UButton: true,
                        UTooltip: true,
                        SidebarHomePage: { 
                            template: '<div>Home Page</div>',
                            async setup() {
                                // Simulate async loading
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        },
                    },
                },
            });

            // Should show loading fallback initially
            expect(wrapper.text()).toContain('Loading page...');
        });
    });
});
