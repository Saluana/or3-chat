import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkspaceChrome from '../WorkspaceChrome.vue';

vi.mock('~/composables/useIcon', () => ({
    useIcon: (token: string) => ({ value: `icon:${token}` }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

const props = {
    tabs: [
        {
            id: 'tab-a',
            resource: { kind: 'document' as const, documentId: 'doc-1' },
            cachedTitle: 'Astilbe notes',
            createdAt: 1,
            lastActivatedAt: 1,
            ephemeral: false,
        },
        {
            id: 'tab-b',
            resource: { kind: 'chat' as const, threadId: null },
            cachedTitle: 'New chat',
            createdAt: 2,
            lastActivatedAt: 2,
            ephemeral: true,
        },
    ],
    activeTabId: 'tab-a',
    visibleTabIds: new Set(['tab-a']),
};

describe('WorkspaceChrome', () => {
    it('uses a single-row mobile chrome with a tab switcher instead of a strip', async () => {
        const wrapper = mount(WorkspaceChrome, {
            props: { ...props, mobile: true },
            global: {
                stubs: {
                    UIcon: { template: '<span />' },
                    UButton: {
                        template:
                            '<button v-bind="$attrs"><slot /></button>',
                    },
                    UTooltip: { template: '<div><slot /></div>' },
                    UModal: {
                        props: ['open'],
                        template:
                            '<div v-if="open" data-testid="workspace-tab-switcher"><slot name="body" /><slot name="footer" /></div>',
                    },
                    UInput: true,
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
        expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="brand"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="sidebar"]').exists()).toBe(true);
        expect(wrapper.get('.workspace-chrome-active-label').text()).toBe(
            'Astilbe notes'
        );
        expect(
            wrapper.find('button[aria-label="2 open tabs"]').exists()
        ).toBe(true);

        await wrapper.get('.workspace-chrome-active-title').trigger('click');
        expect(wrapper.find('[data-testid="workspace-tab-switcher"]').exists()).toBe(
            true
        );
        expect(wrapper.findAll('[data-test="action"]')).toHaveLength(1);
    });

    it('renders desktop actions beside, not inside, the scrollable tab strip', () => {
        const wrapper = mount(WorkspaceChrome, {
            props: { ...props, mobile: false },
            global: {
                stubs: {
                    UIcon: { template: '<span />' },
                    UTooltip: { template: '<div><slot /></div>' },
                    UButton: {
                        template:
                            '<button v-bind="$attrs"><slot /></button>',
                    },
                    UModal: true,
                    UInput: true,
                },
            },
            slots: { actions: '<button data-test="action" />' },
        });
        expect(wrapper.find('.workspace-tab-bar [data-test="action"]').exists()).toBe(
            false
        );
        expect(
            wrapper.find('.workspace-chrome-actions [data-test="action"]').exists()
        ).toBe(true);
        expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
    });
});
