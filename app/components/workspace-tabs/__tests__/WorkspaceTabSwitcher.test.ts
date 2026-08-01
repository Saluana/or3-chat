import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import WorkspaceTabSwitcher from '../WorkspaceTabSwitcher.vue';

vi.mock('~/composables/useIcon', () => ({
    useIcon: (token: string) => ({ value: `icon:${token}` }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

const tabs = [
    {
        id: 'tab-doc',
        resource: { kind: 'document' as const, documentId: 'doc-1' },
        cachedTitle: 'Astilbe notes',
        createdAt: 1,
        lastActivatedAt: 2,
        ephemeral: false,
    },
    {
        id: 'tab-chat',
        resource: { kind: 'chat' as const, threadId: null },
        cachedTitle: 'New chat',
        createdAt: 2,
        lastActivatedAt: 1,
        ephemeral: true,
    },
];

function mountSwitcher(open = true) {
    return mount(WorkspaceTabSwitcher, {
        props: {
            open,
            tabs,
            activeTabId: 'tab-doc',
            canReopenClosed: true,
            'onUpdate:open': (value: boolean) => {
                void value;
            },
        },
        global: {
            stubs: {
                UIcon: { template: '<span class="icon" />' },
                UBadge: { template: '<span><slot /></span>' },
                UButton: {
                    inheritAttrs: false,
                    template: '<button v-bind="$attrs"><slot /></button>',
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                USelectMenu: {
                    props: ['modelValue', 'items'],
                    emits: ['update:modelValue'],
                    template: '<div class="sort-stub"><slot /></div>',
                },
                UModal: {
                    props: ['open'],
                    emits: ['update:open'],
                    template: `
                        <div v-if="open" data-testid="workspace-tab-switcher">
                            <slot name="header" :close="() => $emit('update:open', false)" />
                            <slot name="body" />
                            <slot name="footer" />
                        </div>
                    `,
                },
            },
        },
    });
}

describe('WorkspaceTabSwitcher', () => {
    it('activates a tab and closes the switcher', async () => {
        const wrapper = mountSwitcher();
        await wrapper.get('[role="option"][aria-selected="false"]').trigger('click');
        expect(wrapper.emitted('activate')).toEqual([['tab-chat']]);
        expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    });

    it('filters tabs by title and closes from new-tab', async () => {
        const wrapper = mountSwitcher();
        await wrapper.get('input').setValue('new');
        await nextTick();
        expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
        expect(wrapper.get('[role="option"]').text()).toContain('New chat');

        await wrapper.get('button[aria-label="Close New chat"]').trigger('click');
        expect(wrapper.emitted('close')).toEqual([['tab-chat']]);

        const buttons = wrapper.findAll('button');
        const newTab = buttons.find((button) => button.text() === 'New tab');
        expect(newTab).toBeTruthy();
        await newTab!.trigger('click');
        expect(wrapper.emitted('new-tab')).toHaveLength(1);
        expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    });
});
