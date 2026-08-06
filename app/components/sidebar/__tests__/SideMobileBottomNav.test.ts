import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import SideMobileBottomNav from '../SideMobileBottomNav.vue';
import {
    DEFAULT_WORKSPACE_PROFILE_INVENTORY,
    resolveWorkspaceProfile,
    setResolvedWorkspaceProfile,
    STANDARD_OR3_PROFILE,
} from '~/core/workspace-profiles';
import { setGlobalSidebarLayoutApi } from '~/utils/sidebarLayoutApi';

// Mock the sidebar composables
const defaultMockPages: Array<{
    id: string;
    label: string;
    icon: string;
    order: number;
    component: ReturnType<typeof vi.fn>;
}> = [
    {
        id: 'test-page-1',
        label: 'Test Page 1',
        icon: 'pixelarticons:test',
        order: 100,
        component: vi.fn(),
    },
    {
        id: 'test-page-2',
        label: 'Test Page 2',
        icon: 'pixelarticons:test2',
        order: 50,
        component: vi.fn(),
    },
];
const mockListSidebarPages = ref(defaultMockPages.map((page) => ({ ...page })));

const mockActivePageId = ref('sidebar-home');
const mockSetActivePage = vi.fn().mockResolvedValue(true);
const mockToastAdd = vi.fn();
const mockNavigateTo = vi.fn();
const mockCloseSidebarIfMobile = vi.fn();

const testConfig = {
    public: {
        ssrAuthEnabled: false,
        features: {},
        or3: {
            site: {},
            limits: {},
            ui: {},
            legal: {},
        },
    },
};

vi.mock('~/composables/sidebar/useSidebarPages', () => ({
    useSidebarPages: () => ({
        listSidebarPages: mockListSidebarPages,
    }),
}));

vi.mock('~/composables/sidebar/useActiveSidebarPage', () => ({
    useActiveSidebarPage: () => ({
        activePageId: mockActivePageId,
        setActivePage: mockSetActivePage,
    }),
}));

vi.mock('#imports', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#imports')>();
    return {
        ...actual,
        useNuxtApp: () => ({
            $iconRegistry: {
                resolve: (token: string) => token,
            },
            $theme: {
                activeTheme: ref('light'),
                getResolver: () => ({ resolve: () => ({ props: {} }) }),
                setActiveTheme: vi.fn(),
            },
        }),
        useRuntimeConfig: () => testConfig,
        useToast: () => ({
            add: mockToastAdd,
        }),
        navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
    };
});

function useMobileProjectionProfile() {
    setResolvedWorkspaceProfile(
        resolveWorkspaceProfile(
            {
                schemaVersion: 1,
                id: 'mobile-projection',
                label: 'Mobile projection',
                navigation: {
                    order: ['sidebar-home', 'test-page-1', 'test-page-2'],
                },
                mobile: {
                    bottomNavigation: ['sidebar-home', 'test-page-1'],
                    defaultPageId: 'sidebar-home',
                },
            },
            {
                ...DEFAULT_WORKSPACE_PROFILE_INVENTORY,
                navigation: [
                    { id: 'sidebar-home' },
                    { id: 'test-page-1' },
                    { id: 'test-page-2' },
                ],
            },
            { maxDesktopPanes: 3, mobilePolicy: 'single-pane' }
        )
    );
}

function mountComponent() {
    return mount(SideMobileBottomNav, {
        global: {
            stubs: {
                Teleport: true,
                UIcon: { template: '<span><slot /></span>' },
                UButton: {
                    template:
                        '<button @click="$emit(\'click\')"><slot /></button>',
                    emits: ['click'],
                },
                UPopover: {
                    template:
                        '<div class="u-popover-stub"><slot /><slot name="content" /></div>',
                },
                SidebarAuthButton: {
                    template: '<div class="auth-button-stub" />',
                },
                NuxtLink: { template: '<a><slot /></a>' },
            },
        },
    });
}

async function openMoreSheet(
    wrapper: ReturnType<typeof mountComponent>
) {
    await wrapper.find('#mobile-nav-more').trigger('click');
}

describe('SideMobileBottomNav', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockListSidebarPages.value = defaultMockPages.map((page) => ({
            ...page,
        }));
        mockActivePageId.value = 'sidebar-home';
        mockSetActivePage.mockResolvedValue(true);
        testConfig.public.ssrAuthEnabled = false;
        setGlobalSidebarLayoutApi({
            close: vi.fn(),
            open: vi.fn(),
            toggleCollapse: vi.fn(),
            expand: vi.fn(),
            isMobile: () => true,
            closeSidebarIfMobile: mockCloseSidebarIfMobile,
        });
        setResolvedWorkspaceProfile(
            resolveWorkspaceProfile(
                STANDARD_OR3_PROFILE,
                DEFAULT_WORKSPACE_PROFILE_INVENTORY,
                { maxDesktopPanes: 3, mobilePolicy: 'single-pane' }
            )
        );
    });

    it('renders the core navigation items', () => {
        const wrapper = mountComponent();

        expect(wrapper.find('#mobile-bottom-nav').exists()).toBe(true);
        expect(wrapper.find('#mobile-nav-home').exists()).toBe(true);
        expect(wrapper.find('#mobile-nav-search').exists()).toBe(true);
        expect(wrapper.find('#mobile-nav-create').exists()).toBe(true);
        expect(wrapper.find('#mobile-nav-more').exists()).toBe(true);
    });

    it('emits focus-search when search is tapped', async () => {
        const wrapper = mountComponent();

        await wrapper.find('#mobile-nav-search').trigger('click');
        expect(wrapper.emitted('focus-search')).toBeTruthy();
    });

    it('renders create menu actions and emits new-chat', async () => {
        const wrapper = mountComponent();

        const createChat = wrapper.find('#mobile-nav-create-chat');
        expect(createChat.exists()).toBe(true);
        expect(wrapper.find('#mobile-nav-create-project').exists()).toBe(true);
        // Documents enabled by default fallback config
        expect(wrapper.find('#mobile-nav-create-document').exists()).toBe(
            true
        );

        await createChat.trigger('click');
        expect(wrapper.emitted('new-chat')).toBeTruthy();
    });

    it('emits new-document and new-project from the create menu', async () => {
        const wrapper = mountComponent();

        await wrapper.find('#mobile-nav-create-document').trigger('click');
        expect(wrapper.emitted('new-document')).toBeTruthy();

        await wrapper.find('#mobile-nav-create-project').trigger('click');
        expect(wrapper.emitted('new-project')).toBeTruthy();
    });

    it('navigates home and activates the home page', async () => {
        mockActivePageId.value = 'test-page-1';
        const wrapper = mountComponent();

        await wrapper.find('#mobile-nav-home').trigger('click');

        expect(mockNavigateTo).toHaveBeenCalledWith('/');
        expect(mockSetActivePage).toHaveBeenCalledWith('sidebar-home');
    });

    it('keeps overflow profile pages in More, not the tab bar', async () => {
        useMobileProjectionProfile();

        const wrapper = mountComponent();
        expect(
            wrapper.find('#mobile-bottom-nav > #mobile-nav-page-test-page-1')
                .exists()
        ).toBe(false);

        await openMoreSheet(wrapper);

        expect(wrapper.find('#mobile-nav-page-test-page-1').exists()).toBe(
            true
        );
        expect(wrapper.find('#mobile-nav-page-test-page-2').exists()).toBe(
            false
        );
        expect(
            wrapper
                .find('.mobile-nav-more-panel #mobile-nav-page-test-page-1')
                .exists()
        ).toBe(true);
    });

    it('activates a profile page from More', async () => {
        useMobileProjectionProfile();
        const wrapper = mountComponent();

        await openMoreSheet(wrapper);
        await wrapper.find('#mobile-nav-page-test-page-1').trigger('click');
        expect(mockSetActivePage).toHaveBeenCalledWith('test-page-1');
    });

    it('shows a toast when page activation is vetoed', async () => {
        mockSetActivePage.mockResolvedValue(false);
        useMobileProjectionProfile();
        const wrapper = mountComponent();

        await openMoreSheet(wrapper);
        await wrapper.find('#mobile-nav-page-test-page-1').trigger('click');

        expect(mockToastAdd).toHaveBeenCalledWith({
            title: 'Cannot switch page',
            description: 'Unable to activate "Test Page 1"',
            color: 'neutral',
        });
    });

    it('puts Dashboard in the tab bar and keeps the drawer open on tap', async () => {
        const wrapper = mountComponent();

        const dashboard = wrapper.find('#mobile-nav-dashboard');
        expect(dashboard.exists()).toBe(true);
        expect(
            wrapper.find('.mobile-nav-more-panel #mobile-nav-dashboard').exists()
        ).toBe(false);

        await dashboard.trigger('click');

        expect(wrapper.emitted('toggle-dashboard')).toBeTruthy();
        expect(mockCloseSidebarIfMobile).not.toHaveBeenCalled();
    });

    it('shows Local mode badge when SSR auth is disabled', async () => {
        const wrapper = mountComponent();
        await openMoreSheet(wrapper);
        expect(wrapper.find('.more-system-mode').text()).toContain('Local mode');
    });

    it('shows Cloud mode badge when SSR auth is enabled', async () => {
        testConfig.public.ssrAuthEnabled = true;
        const wrapper = mountComponent();
        await openMoreSheet(wrapper);
        expect(wrapper.find('.more-system-mode').text()).toContain('Cloud mode');
        expect(wrapper.find('.more-status-badge').text()).toBe('Active');
        expect(wrapper.find('.more-system-admin').exists()).toBe(true);
    });

    it('navigates to admin when Admin is tapped', async () => {
        testConfig.public.ssrAuthEnabled = true;
        const wrapper = mountComponent();
        await openMoreSheet(wrapper);

        await wrapper.find('.more-system-admin').trigger('click');

        expect(mockNavigateTo).toHaveBeenCalledWith('/admin');
        expect(wrapper.find('#mobile-nav-more-sheet').exists()).toBe(false);
    });

    it('hides the info button in SSR auth mode', async () => {
        testConfig.public.ssrAuthEnabled = true;
        const wrapper = mountComponent();
        await openMoreSheet(wrapper);
        expect(wrapper.find('#mobile-nav-info').exists()).toBe(false);
    });

    it('opens More as a bottom sheet with workspace cards', async () => {
        useMobileProjectionProfile();
        const wrapper = mountComponent();

        await openMoreSheet(wrapper);

        expect(wrapper.find('#mobile-nav-more-sheet').exists()).toBe(true);
        expect(wrapper.find('.more-sheet-panel').exists()).toBe(true);
        expect(wrapper.find('.more-tile-desc').exists()).toBe(true);
        expect(wrapper.find('.more-section-label').text()).toContain(
            'Workspace'
        );
    });

    it('hides the home button when the profile omits it', async () => {
        setResolvedWorkspaceProfile(
            resolveWorkspaceProfile(
                {
                    schemaVersion: 1,
                    id: 'no-home',
                    label: 'No home',
                    navigation: { order: ['test-page-1'] },
                    mobile: {
                        bottomNavigation: ['test-page-1'],
                        defaultPageId: 'test-page-1',
                    },
                },
                {
                    ...DEFAULT_WORKSPACE_PROFILE_INVENTORY,
                    navigation: [{ id: 'test-page-1' }],
                },
                { maxDesktopPanes: 3, mobilePolicy: 'single-pane' }
            )
        );

        const wrapper = mountComponent();
        expect(wrapper.find('#mobile-nav-home').exists()).toBe(false);

        await openMoreSheet(wrapper);
        expect(wrapper.find('#mobile-nav-page-test-page-1').exists()).toBe(
            true
        );
    });
});
