import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import WorkspaceNewTabControl from '../WorkspaceNewTabControl.vue';

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => ({ value: 'i-lucide-plus' }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

const stubs = {
    UTooltip: { template: '<div><slot /></div>' },
    UIcon: { template: '<span />' },
};

function mountControl(
    props: Record<string, unknown> = {}
): VueWrapper<InstanceType<typeof WorkspaceNewTabControl>> {
    return mount(WorkspaceNewTabControl, {
        props,
        attachTo: document.body,
        global: { stubs },
    });
}

function menuItems(): HTMLButtonElement[] {
    return Array.from(
        document.body.querySelectorAll<HTMLButtonElement>(
            '.workspace-new-tab-menu [role="menuitem"]'
        )
    );
}

describe('WorkspaceNewTabControl', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('emits new-tab on primary click', async () => {
        const wrapper = mountControl();
        await wrapper.get('.workspace-tab-new').trigger('click');
        expect(wrapper.emitted('new-tab')).toHaveLength(1);
        wrapper.unmount();
    });

    it('opens a create menu on right-click with available kinds', async () => {
        const wrapper = mountControl({
            canCreateDocument: true,
            canCreateWorkflow: true,
            canCreateAgent: true,
        });
        await wrapper.get('.workspace-tab-new').trigger('contextmenu', {
            clientX: 40,
            clientY: 20,
        });
        const items = menuItems();
        expect(items.map((item) => item.textContent?.trim())).toEqual([
            'New chat',
            'New document',
            'New workflow',
            'New agent session',
        ]);
        const menu = document.body.querySelector(
            '.workspace-new-tab-menu'
        ) as HTMLElement | null;
        expect(menu?.style.left).toBe('40px');
        expect(menu?.style.top).toBe('20px');

        items[2]!.click();
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('create')).toEqual([['workflow']]);
        expect(
            document.body.querySelector('.workspace-new-tab-menu')
        ).toBeNull();
        wrapper.unmount();
    });

    it('hides unavailable create kinds', async () => {
        const wrapper = mountControl({
            canCreateDocument: true,
            canCreateWorkflow: false,
            canCreateAgent: false,
        });
        await wrapper.get('.workspace-tab-new').trigger('contextmenu');
        expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
            'New chat',
            'New document',
        ]);
        wrapper.unmount();
    });

    it('opens the create menu from the keyboard and restores trigger focus on Escape', async () => {
        const wrapper = mountControl({ canCreateDocument: true });
        const trigger = wrapper.get('.workspace-tab-new');
        await trigger.trigger('keydown', { key: 'ArrowDown' });
        await wrapper.vm.$nextTick();

        expect(document.activeElement).toBe(menuItems()[0]);
        expect(trigger.attributes('aria-expanded')).toBe('true');

        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        await wrapper.vm.$nextTick();

        expect(menuItems()).toHaveLength(0);
        expect(document.activeElement).toBe(trigger.element);
        wrapper.unmount();
    });

    it('closes the create menu before opening a new chat from the trigger', async () => {
        const wrapper = mountControl({ canCreateDocument: true });
        const trigger = wrapper.get('.workspace-tab-new');
        await trigger.trigger('contextmenu', { clientX: 40, clientY: 20 });
        expect(menuItems()).toHaveLength(2);

        await trigger.trigger('click');

        expect(wrapper.emitted('new-tab')).toHaveLength(1);
        expect(menuItems()).toHaveLength(0);
        wrapper.unmount();
    });
});
