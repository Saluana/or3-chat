import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkspaceNewTabControl from '../WorkspaceNewTabControl.vue';

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => ({ value: 'i-lucide-plus' }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

describe('WorkspaceNewTabControl', () => {
    it('emits new-tab on primary click', async () => {
        const wrapper = mount(WorkspaceNewTabControl, {
            global: {
                stubs: {
                    UTooltip: { template: '<div><slot /></div>' },
                    UIcon: { template: '<span />' },
                },
            },
        });
        await wrapper.get('.workspace-tab-new').trigger('click');
        expect(wrapper.emitted('new-tab')).toHaveLength(1);
    });

    it('opens a create menu on right-click with available kinds', async () => {
        const wrapper = mount(WorkspaceNewTabControl, {
            props: {
                canCreateDocument: true,
                canCreateWorkflow: true,
                canCreateAgent: true,
            },
            global: {
                stubs: {
                    UTooltip: { template: '<div><slot /></div>' },
                    UIcon: { template: '<span />' },
                },
            },
        });
        await wrapper.get('.workspace-tab-new').trigger('contextmenu', {
            clientX: 40,
            clientY: 20,
        });
        const items = wrapper.findAll('[role="menuitem"]');
        expect(items.map((item) => item.text())).toEqual([
            'New chat',
            'New document',
            'New workflow',
            'New agent session',
        ]);

        await items[2]!.trigger('click');
        expect(wrapper.emitted('create')).toEqual([['workflow']]);
        expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    });

    it('hides unavailable create kinds', async () => {
        const wrapper = mount(WorkspaceNewTabControl, {
            props: {
                canCreateDocument: true,
                canCreateWorkflow: false,
                canCreateAgent: false,
            },
            global: {
                stubs: {
                    UTooltip: { template: '<div><slot /></div>' },
                    UIcon: { template: '<span />' },
                },
            },
        });
        await wrapper.get('.workspace-tab-new').trigger('contextmenu');
        expect(
            wrapper.findAll('[role="menuitem"]').map((item) => item.text())
        ).toEqual(['New chat', 'New document']);
    });
});
