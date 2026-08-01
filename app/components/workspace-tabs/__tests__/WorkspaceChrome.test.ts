import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkspaceChrome from '../WorkspaceChrome.vue';

const props = {
    tabs: [
        {
            id: 'tab-a',
            resource: { kind: 'chat' as const, threadId: null },
            cachedTitle: 'New chat',
            createdAt: 1,
            lastActivatedAt: 1,
            ephemeral: true,
        },
    ],
    activeTabId: 'tab-a',
    visibleTabIds: new Set(['tab-a']),
};

describe('WorkspaceChrome', () => {
    it('uses a compact two-row mobile chrome and keeps split actions out of it', () => {
        const wrapper = mount(WorkspaceChrome, {
            props: { ...props, mobile: true },
            global: {
                stubs: {
                    UIcon: { template: '<span />' },
                },
            },
            slots: {
                sidebar: '<button data-test="sidebar" />',
                brand: '<span data-test="brand">OR3</span>',
                actions: '<button data-test="action" />',
            },
        });

        expect(wrapper.get('[data-testid="workspace-chrome"]').classes()).toContain(
            'workspace-chrome--mobile'
        );
        expect(wrapper.find('[data-test="sidebar"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="brand"]').exists()).toBe(true);
        expect(wrapper.findAll('[data-test="action"]')).toHaveLength(1);
    });

    it('renders desktop actions beside, not inside, the scrollable tab strip', () => {
        const wrapper = mount(WorkspaceChrome, {
            props: { ...props, mobile: false },
            global: { stubs: { UIcon: { template: '<span />' } } },
            slots: { actions: '<button data-test="action" />' },
        });
        expect(wrapper.find('.workspace-tab-bar [data-test="action"]').exists()).toBe(false);
        expect(wrapper.find('.workspace-chrome-actions [data-test="action"]').exists()).toBe(
            true
        );
    });
});
