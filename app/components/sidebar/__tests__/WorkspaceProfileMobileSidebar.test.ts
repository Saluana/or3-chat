import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResizableSidebarLayout from '../../ResizableSidebarLayout.vue';
import SideNavContent from '../SideNavContent.vue';
import SidebarHomePage from '../SidebarHomePage.vue';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import { __resetActiveSidebarPageForTests } from '~/composables/sidebar/useActiveSidebarPage';
import {
    DEFAULT_WORKSPACE_PROFILE_INVENTORY,
    resolveWorkspaceProfile,
    setResolvedWorkspaceProfile,
    STANDARD_OR3_PROFILE,
} from '~/core/workspace-profiles';
import { isMobile } from '~/state/global';

vi.mock('@vueuse/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vueuse/core')>();
    return {
        ...actual,
        useEventListener: vi.fn(),
        useMediaQuery: () => ref(false),
        useResizeObserver: vi.fn(),
    };
});

vi.mock('~/composables/sidebar/usePaginatedSidebarItems', () => ({
    usePaginatedSidebarItems: () => ({
        items: ref([]),
        loading: ref(false),
        reset: vi.fn(),
    }),
}));

vi.mock('~/composables/useOr3Config', () => ({
    useOr3Config: () => ({
        features: {
            documents: { enabled: true },
        },
    }),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: vi.fn().mockResolvedValue(undefined),
    }),
}));

const limits = {
    maxDesktopPanes: 3,
    mobilePolicy: 'single-pane' as const,
};

const inventory = {
    ...DEFAULT_WORKSPACE_PROFILE_INVENTORY,
    navigation: [
        { id: 'sidebar-home', label: 'Home' },
        { id: 'sidebar-chats', label: 'Chats' },
        { id: 'sidebar-docs', label: 'Documents' },
    ],
};

const sideNavProps = {
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
};

function registerPages(): Array<() => void> {
    const { registerSidebarPage } = useSidebarPages();
    return [
        registerSidebarPage({
            id: 'sidebar-home',
            label: 'Home',
            icon: 'pixelarticons:home',
            order: 10,
            component: SidebarHomePage,
            usesDefaultHeader: true,
        }),
        registerSidebarPage({
            id: 'sidebar-chats',
            label: 'Chats',
            icon: 'pixelarticons:message',
            order: 20,
            component: defineComponent({
                name: 'sidebar-chats',
                template: '<div data-testid="mobile-chats-page" />',
            }),
        }),
        registerSidebarPage({
            id: 'sidebar-docs',
            label: 'Documents',
            icon: 'pixelarticons:note',
            order: 30,
            component: defineComponent({
                name: 'sidebar-docs',
                template: '<div data-testid="mobile-docs-page" />',
            }),
        }),
    ];
}

function mountRealExpandedSidebar() {
    return mount(ResizableSidebarLayout, {
        slots: {
            'sidebar-expanded': () => h(SideNavContent, sideNavProps),
            'sidebar-collapsed': () =>
                h('div', { 'data-testid': 'collapsed-sidebar' }),
        },
        global: {
            stubs: {
                ResizeHandle: true,
                SidebarHeader: {
                    template: '<header><slot /></header>',
                },
                SideNavHeader: true,
            },
        },
    });
}

describe('workspace profile mobile expanded sidebar', () => {
    let unregisterPages: Array<() => void> = [];

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        (
            globalThis as typeof globalThis & {
                __or3SidebarPagesRegistry?: Map<string, unknown>;
            }
        ).__or3SidebarPagesRegistry = new Map();
        (
            process as typeof process & {
                client?: boolean;
            }
        ).client = true;
        localStorage.clear();
        __resetActiveSidebarPageForTests();
        unregisterPages = registerPages();
    });

    afterEach(() => {
        for (const unregister of unregisterPages.reverse()) unregister();
        isMobile.value = false;
        setResolvedWorkspaceProfile(
            resolveWorkspaceProfile(
                STANDARD_OR3_PROFILE,
                DEFAULT_WORKSPACE_PROFILE_INVENTORY,
                limits
            )
        );
        vi.unstubAllGlobals();
    });

    it('keeps the initially closed mobile drawer off-canvas', () => {
        const wrapper = mountRealExpandedSidebar();

        expect(wrapper.get('[data-testid="sidebar"]').classes()).toContain(
            'max-md:-translate-x-full'
        );
        wrapper.unmount();
    });

    it('renders the profile mobile default through the real expanded slot', async () => {
        isMobile.value = true;
        setResolvedWorkspaceProfile(
            resolveWorkspaceProfile(
                {
                    schemaVersion: 1,
                    id: 'mobile-documents',
                    label: 'Mobile documents',
                    navigation: {
                        defaultPageId: 'sidebar-home',
                        order: [
                            'sidebar-home',
                            'sidebar-chats',
                            'sidebar-docs',
                        ],
                    },
                    mobile: {
                        bottomNavigation: ['sidebar-docs'],
                        defaultPageId: 'sidebar-docs',
                    },
                },
                inventory,
                limits
            )
        );

        const wrapper = mountRealExpandedSidebar();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('[data-testid="mobile-docs-page"]').exists()).toBe(
            true
        );
        expect(
            wrapper.find('[data-testid="mobile-chats-page"]').exists()
        ).toBe(false);
        wrapper.unmount();
    });

    it('uses mobile bottom navigation inside SidebarHomePage', async () => {
        isMobile.value = true;
        setResolvedWorkspaceProfile(
            resolveWorkspaceProfile(
                {
                    schemaVersion: 1,
                    id: 'mobile-home-links',
                    label: 'Mobile home links',
                    navigation: {
                        defaultPageId: 'sidebar-home',
                        order: [
                            'sidebar-home',
                            'sidebar-chats',
                            'sidebar-docs',
                        ],
                    },
                    mobile: {
                        bottomNavigation: [
                            'sidebar-home',
                            'sidebar-docs',
                        ],
                        defaultPageId: 'sidebar-home',
                    },
                },
                inventory,
                limits
            )
        );

        const wrapper = mountRealExpandedSidebar();
        await flushPromises();

        expect(wrapper.find('button[aria-label="Documents"]').exists()).toBe(
            true
        );
        expect(wrapper.find('button[aria-label="Chats"]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('continues to render desktop navigation in the expanded slot', async () => {
        isMobile.value = false;
        setResolvedWorkspaceProfile(
            resolveWorkspaceProfile(
                {
                    schemaVersion: 1,
                    id: 'desktop-home-links',
                    label: 'Desktop home links',
                    navigation: {
                        defaultPageId: 'sidebar-home',
                        order: [
                            'sidebar-home',
                            'sidebar-chats',
                            'sidebar-docs',
                        ],
                    },
                    mobile: {
                        bottomNavigation: [
                            'sidebar-home',
                            'sidebar-docs',
                        ],
                        defaultPageId: 'sidebar-home',
                    },
                },
                inventory,
                limits
            )
        );

        const wrapper = mountRealExpandedSidebar();
        await flushPromises();

        expect(wrapper.find('button[aria-label="Documents"]').exists()).toBe(
            true
        );
        expect(wrapper.find('button[aria-label="Chats"]').exists()).toBe(true);
        wrapper.unmount();
    });
});
