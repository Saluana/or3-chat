import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkspaceTabBar from '../WorkspaceTabBar.vue';

const tabs = [
    {
        id: 'tab-chat',
        resource: { kind: 'chat' as const, threadId: 'chat-1' },
        cachedTitle: 'First chat',
        createdAt: 1,
        lastActivatedAt: 1,
        ephemeral: false,
    },
    {
        id: 'tab-doc',
        resource: { kind: 'document' as const, documentId: 'doc-1' },
        cachedTitle: 'Release notes',
        createdAt: 2,
        lastActivatedAt: 2,
        ephemeral: false,
    },
];

function mountBar() {
    return mount(WorkspaceTabBar, {
        props: {
            tabs,
            activeTabId: 'tab-chat',
            visibleTabIds: new Set(['tab-chat']),
        },
        global: {
            stubs: {
                UIcon: { template: '<span />' },
            },
        },
    });
}

describe('WorkspaceTabBar', () => {
    it('uses a roving tablist and activates adjacent tabs from the keyboard', async () => {
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoView,
        });
        const wrapper = mountBar();
        const tabButtons = wrapper.findAll('[role="tab"]');
        expect(tabButtons[0]?.attributes('tabindex')).toBe('0');
        expect(tabButtons[1]?.attributes('tabindex')).toBe('-1');

        await wrapper.get('[role="tablist"]').trigger('keydown', {
            key: 'ArrowRight',
        });
        expect(wrapper.emitted('activate')).toEqual([
            ['tab-doc', 'keyboard'],
        ]);
    });

    it('keeps the new-tab action outside the horizontally scrolling tablist', () => {
        const wrapper = mountBar();
        expect(wrapper.find('[role="tablist"] .workspace-tab-new').exists()).toBe(false);
        expect(wrapper.get('.workspace-tab-new').attributes('aria-label')).toBe('New tab');
    });

    it('provides accessible close and split actions without closing a tab on normal click', async () => {
        const wrapper = mountBar();
        await wrapper.get('.workspace-tab-close').trigger('click');
        expect(wrapper.emitted('close')).toEqual([['tab-chat']]);

        await wrapper
            .findAll('[role="tab"]')[1]!
            .trigger('contextmenu', { clientX: 20, clientY: 30 });
        await wrapper.get('[role="menuitem"]').trigger('click');
        expect(wrapper.emitted('close')).toEqual([
            ['tab-chat'],
            ['tab-doc'],
        ]);
    });

    it('dismisses the context menu when the user clicks outside it', async () => {
        const wrapper = mountBar();
        await wrapper
            .findAll('[role="tab"]')[0]!
            .trigger('contextmenu', { clientX: 20, clientY: 30 });
        expect(wrapper.find('[role="menu"]').exists()).toBe(true);

        window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        await wrapper.vm.$nextTick();

        expect(wrapper.find('[role="menu"]').exists()).toBe(false);
        wrapper.unmount();
    });

    it('reorders after a real pointer drag without activating the source tab', async () => {
        const wrapper = mountBar();
        const wrappers = wrapper.findAll('.workspace-tab-wrap');
        vi.spyOn(wrappers[1]!.element, 'getBoundingClientRect').mockReturnValue(
            {
                left: 100,
                width: 100,
                right: 200,
                top: 0,
                bottom: 32,
                height: 32,
                x: 100,
                y: 0,
                toJSON: () => ({}),
            }
        );

        await wrappers[0]!.trigger('pointerdown', {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 10,
        });
        await wrappers[0]!.trigger('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 250,
        });
        await wrappers[0]!.trigger('pointerup', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 250,
        });

        expect(wrapper.emitted('reorder')).toEqual([['tab-chat', 1]]);
        expect(wrapper.emitted('activate')).toBeUndefined();
    });
});
