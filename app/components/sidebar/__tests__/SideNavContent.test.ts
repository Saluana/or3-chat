import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import SideNavContent from '../SideNavContent.vue';
import { setupSidebarTestEnvironment } from '../../../../tests/utils/sidebar-test-helpers';

vi.mock('~/composables/sidebar/useSidebarSearch', async () => {
    const { ref } = await import('vue');
    return {
        useSidebarSearch: () => ({
            query: ref(''),
            threadResults: ref([]),
            projectResults: ref([]),
            documentResults: ref([]),
        }),
    };
});

vi.mock('~/composables/sidebar/useActiveSidebarPage', async () => {
    const { ref, shallowRef } = await import('vue');
    return {
        useActiveSidebarPage: () => ({
            activePageId: ref('sidebar-home'),
            activePageDef: shallowRef({
                id: 'sidebar-home',
                usesDefaultHeader: true,
                component: {
                    name: 'SidebarHomePage',
                    template:
                        '<div data-testid="sidebar-home-page">Home Page Content</div>',
                },
            }),
            setActivePage: vi.fn().mockResolvedValue(true),
            resetToDefault: vi.fn().mockResolvedValue(true),
        }),
    };
});

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
                equals: () => ({
                    and: () => ({ toArray: async () => [] }),
                }),
            }),
        },
    },
    upsert: vi.fn(),
    del: vi.fn(),
    create: vi.fn(),
}));

vi.mock('dexie', async (importOriginal) => ({
    ...(await importOriginal<typeof import('dexie')>()),
    liveQuery: () => ({
        subscribe: () => ({ unsubscribe() {} }),
    }),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        on: vi.fn().mockReturnValue(() => {}),
        off: vi.fn(),
        addAction: vi.fn(),
        removeAction: vi.fn(),
        doAction: vi.fn(),
        applyFilters: vi.fn((_, value) => Promise.resolve(value)),
    }),
}));

// Setup test environment
setupSidebarTestEnvironment();

// Minimal stubs for child components (focus is resize logic wiring)
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
                stubs: {
                    ClientOnly: { template: '<div><slot /></div>' },
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
                    stubs: {
                        ClientOnly: { template: '<div><slot /></div>' },
                        UIcon: true,
                        UButton: true,
                        UTooltip: true,
                        SidebarHomePage: {
                            template:
                                '<div data-testid="sidebar-home-page">Home Page Content</div>',
                        },
                    },
                },
            });

            await wrapper.vm.$nextTick();

            // Should render the home page component
            expect(
                wrapper.find('[data-testid="sidebar-home-page"]').exists()
            ).toBe(true);
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
                    stubs: {
                        ClientOnly: { template: '<div><slot /></div>' },
                        UIcon: true,
                        UButton: true,
                        UTooltip: true,
                        SideNavHeader: {
                            template:
                                '<div data-testid="side-nav-header">Header</div>',
                        },
                        SidebarHomePage: { template: '<div>Home Page</div>' },
                    },
                },
            });

            await wrapper.vm.$nextTick();

            // Should show header for default page
            expect(
                wrapper.find('[data-testid="side-nav-header"]').exists()
            ).toBe(true);
        });

    });
});
