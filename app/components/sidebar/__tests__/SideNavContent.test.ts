import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import SideNavContent from '../SideNavContent.vue';
import {
    createMockSidebarEnvironment,
    mockSidebarComposables,
    setupSidebarTestEnvironment,
} from '../../../../tests/utils/sidebar-test-helpers';

// Setup test environment
setupSidebarTestEnvironment();
mockSidebarComposables();

// Mock the environment (used by mocked composables)
createMockSidebarEnvironment();

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

        it.skip('renders suspense fallback during loading', () => {
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
                            template: '<div>Home Page</div>',
                            async setup() {
                                // Simulate async loading
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 100)
                                );
                            },
                        },
                    },
                },
            });

            // Should show loading fallback initially
            expect(wrapper.text()).toContain('Loading page...');
        });
    });
});
