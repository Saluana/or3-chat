import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import SideNavContentCollapsed from '../SideNavContentCollapsed.vue';

// Mock the sidebar composables
const mockListSidebarPages = ref([
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
]);

const mockActivePageId = ref('sidebar-home');
const mockSetActivePage = vi.fn().mockResolvedValue(true);
const mockToastAdd = vi.fn();

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

vi.mock('#imports', () => ({
    useToast: () => ({
        add: mockToastAdd,
    }),
}));

vi.mock('~/composables/sidebar/useSidebarSections', () => ({
    useSidebarFooterActions: () => ref([]),
}));

describe('SideNavContentCollapsed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockActivePageId.value = 'sidebar-home';
        mockSetActivePage.mockResolvedValue(true);
    });

    it('renders built-in controls', () => {
        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: { template: '<span><slot /></span>' },
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: { template: '<nav />' },
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Should render built-in buttons - check by their click handlers
        const buttons = wrapper.findAll('button');
        expect(buttons.length).toBeGreaterThan(5); // Should have at least the built-in controls

        // Check that new-chat button exists by looking for the tooltip text
        expect(wrapper.html()).toContain('New chat');
        expect(wrapper.html()).toContain('Search');
        expect(wrapper.html()).toContain('Create document');
        expect(wrapper.html()).toContain('Create project');
    });

    it('renders ordered page buttons', () => {
        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: true,
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: true,
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Should render page buttons with their labels
        expect(wrapper.html()).toContain('Test Page 1');
        expect(wrapper.html()).toContain('Test Page 2');
    });

    it('highlights active page', () => {
        mockActivePageId.value = 'test-page-1';

        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: true,
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: true,
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Should render the active page
        expect(wrapper.html()).toContain('Test Page 1');
    });

    it('handles page selection with canActivate success', async () => {
        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: { template: '<span><slot /></span>' },
                    UButton: {
                        template:
                            '<button @click="$emit(\'click\')"><slot /></button>',
                        emits: ['click'],
                    },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: { template: '<nav />' },
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Find the test page button by its icon attribute
        const testPageButton = wrapper.find(
            'button[icon="pixelarticons:test"]'
        );
        expect(testPageButton.exists()).toBe(true);

        await testPageButton.trigger('click');
        expect(mockSetActivePage).toHaveBeenCalledWith('test-page-1');
    });

    it('handles page selection with canActivate failure', async () => {
        mockSetActivePage.mockResolvedValue(false);

        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: { template: '<span><slot /></span>' },
                    UButton: {
                        template:
                            '<button @click="$emit(\'click\')"><slot /></button>',
                        emits: ['click'],
                    },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: { template: '<nav />' },
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        const testPageButton = wrapper.find(
            'button[icon="pixelarticons:test"]'
        );

        await testPageButton.trigger('click');

        expect(mockSetActivePage).toHaveBeenCalledWith('test-page-1');
        expect(mockToastAdd).toHaveBeenCalledWith({
            title: 'Cannot switch page',
            description: 'Unable to activate "Test Page 1"',
            color: 'neutral',
        });
    });

    it('maintains keyboard accessibility', () => {
        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: true,
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: true,
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Should render page buttons with accessibility attributes
        const testPageButton = wrapper.find(
            'button[icon="pixelarticons:test"]'
        );
        expect(testPageButton.exists()).toBe(true);
        expect(testPageButton.attributes('aria-label')).toBe('Test Page 1');
        expect(testPageButton.attributes('aria-pressed')).toBe('false');
    });

    it('filters out default page from navigation', () => {
        // Update mock to include home page
        mockListSidebarPages.value = [
            {
                id: 'sidebar-home',
                label: 'Home',
                icon: 'pixelarticons:home',
                order: 0,
                component: vi.fn(),
            },
            {
                id: 'test-page',
                label: 'Test Page',
                icon: 'pixelarticons:test',
                order: 100,
                component: vi.fn(),
            },
        ];

        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: true,
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: true,
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Should render the hardcoded Home button (once) and test page
        // The home page should be filtered from the dynamic list to avoid duplication
        const homeButtons = wrapper.findAll(
            'button[icon="pixelarticons:home"]'
        );
        expect(homeButtons.length).toBe(1); // Only the hardcoded Home button
        expect(wrapper.html()).toContain('Test Page');
    });

    it('shows hardcoded home button when home page is not in sidebar pages list', () => {
        // Reset to default mock (no home page in list)
        mockListSidebarPages.value = [
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

        const wrapper = mount(SideNavContentCollapsed, {
            global: {
                stubs: {
                    UIcon: true,
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    SideBottomNav: true,
                    ClientOnly: { template: '<div><slot /></div>' },
                },
            },
        });

        // Should render the hardcoded Home button and the test pages
        const homeButtons = wrapper.findAll(
            'button[icon="pixelarticons:home"]'
        );
        expect(homeButtons.length).toBe(1); // Only the hardcoded Home button
        expect(wrapper.html()).toContain('Test Page 1');
        expect(wrapper.html()).toContain('Test Page 2');
    });
});
