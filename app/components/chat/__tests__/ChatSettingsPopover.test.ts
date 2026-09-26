import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref, shallowRef } from 'vue';
import ChatSettingsPopover from '../ChatSettingsPopover.vue';
import { useModelStore } from '~/composables/chat/useModelStore';
import type { OpenRouterModel } from '~/core/auth/models-service';
import type { RegisteredTool } from '~/utils/chat/tool-registry';

const mockTools = vi.hoisted(() => ({
    tools: [] as RegisteredTool[],
    setEnabled: vi.fn(),
}));
const mockPrompts = vi.hoisted(() => ({
    items: [] as Array<{ id: string; title: string; favorite: boolean }>,
    threadSelection: null as string | null,
    paneSelection: null as string | null,
    updateThread: vi.fn(),
    setPane: vi.fn(),
}));

vi.mock('~/db/prompts', () => ({
    listPrompts: vi.fn(async () => mockPrompts.items),
}));

vi.mock('~/db/threads', async (importOriginal) => ({
    ...(await importOriginal<typeof import('~/db/threads')>()),
    getThreadSystemPrompt: vi.fn(async () => mockPrompts.threadSelection),
    updateThreadSystemPrompt: (...args: unknown[]) =>
        mockPrompts.updateThread(...args),
}));

vi.mock('~/composables/core/usePanePrompt', () => ({
    getPanePendingPrompt: () => mockPrompts.paneSelection,
    setPanePendingPrompt: (...args: unknown[]) => mockPrompts.setPane(...args),
}));

vi.mock('~/composables/chat/useDefaultPrompt', () => ({
    useDefaultPrompt: () => ({ defaultPromptId: ref('prompt-a') }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({}),
}));

vi.mock('~/utils/chat/tools-public', () => ({
    useToolRegistry: () => ({
        listTools: shallowRef(mockTools.tools),
        setEnabled: mockTools.setEnabled,
    }),
}));

const menuStub = {
    props: ['modelValue', 'items', 'disabled'],
    template: `
        <div class="menu-stub" v-bind="$attrs">
            <slot name="default" :open="false" />
            <div v-for="(item, index) in (items ?? [])" :key="index" class="menu-item">
                <slot name="item-leading" :item="item" :index="index" />
                <span class="menu-label">{{ item.label }}</span>
            </div>
            <slot name="empty" />
        </div>
    `,
};

const switchStub = {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: `
        <button type="button" role="switch" :aria-checked="modelValue"
            :disabled="disabled" v-bind="$attrs"
            @click="$emit('update:modelValue', !modelValue)" />
    `,
};

function popoverItems(wrapper: ReturnType<typeof mountPopover>) {
    return wrapper.findAllComponents(menuStub).map((menu) => ({
        label: menu.props('modelValue') as string,
        items: (menu.props('items') ?? []) as Array<{
            value: string;
            label: string;
            description?: string;
        }>,
    }));
}

function mountPopover(props: Record<string, unknown> = {}) {
    return mount(ChatSettingsPopover, {
        props: {
            thinkingSupported: true,
            reasoningEfforts: ['low', 'medium', 'high'],
            model: 'deepseek/deepseek-chat',
            modelVariant: 'off',
            thinkingEnabled: false,
            reasoningEffort: undefined,
            ...props,
        },
        global: {
            stubs: {
                UButton: {
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot/></button>',
                },
                UIcon: { template: '<span class="uicon-stub" />' },
                USwitch: switchStub,
                USelectMenu: menuStub,
            },
        },
    });
}

describe('ChatSettingsPopover options layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTools.tools.splice(0);
        mockTools.setEnabled.mockImplementation((name: string, enabled: boolean) => {
            const tool = mockTools.tools.find(
                (tool) => tool.definition.function.name === name
            );
            if (tool) tool.enabled.value = enabled;
        });
        mockPrompts.items = [];
        mockPrompts.threadSelection = null;
        mockPrompts.paneSelection = null;
    });

    it('opens task tools in a dedicated view and returns to settings', async () => {
        for (let index = 0; index < 11; index++) {
            mockTools.tools.push({
                definition: {
                    type: 'function',
                    function: {
                        name: `or3sal_tasks_tool_${index}`,
                        description: 'Manage task lists',
                        parameters: { type: 'object' },
                    },
                    ui: {
                        category: 'OR3 Tasks',
                        label: index === 0 ? 'search lists' : `task tool ${index}`,
                    },
                },
                enabled: ref(false),
            } as RegisteredTool);
        }

        const wrapper = mountPopover();
        const popover = wrapper.find('.chat-settings-popover').element as HTMLElement;
        const animate = vi.fn(() => ({ cancel: vi.fn() } as unknown as Animation));
        vi.spyOn(popover, 'getBoundingClientRect').mockImplementation(
            () => ({
                height:
                    wrapper.find('.chat-settings-title').text() === 'Chat settings'
                        ? 400
                        : 700,
            }) as DOMRect
        );
        Object.defineProperty(popover, 'animate', { configurable: true, value: animate });
        const category = wrapper.find('.chat-settings-tool-category');
        expect(category.text()).toContain('Task list tools');
        expect(category.text()).toContain('11');
        expect(wrapper.text()).not.toContain('Other tools');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(0);

        await category.trigger('click');
        expect(animate).toHaveBeenNthCalledWith(
            1,
            [{ height: '400px' }, { height: '700px' }],
            { duration: 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
        );
        expect(wrapper.find('.chat-settings-title').text()).toBe('Task list tools');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(11);
        expect(wrapper.text()).toContain('search lists');
        expect(wrapper.find('.chat-settings-body').attributes('style')).toContain('display: none');

        await wrapper.find('[aria-label="Back to chat settings"]').trigger('click');
        expect(animate).toHaveBeenNthCalledWith(
            2,
            [{ height: '700px' }, { height: '400px' }],
            { duration: 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
        );
        expect(wrapper.find('.chat-settings-title').text()).toBe('Chat settings');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(0);
    });

    it('toggles only the active category and reflects partial selection', async () => {
        for (const name of ['search', 'create', 'delete']) {
            mockTools.tools.push({
                definition: {
                    type: 'function',
                    function: {
                        name,
                        description: name,
                        parameters: { type: 'object' },
                    },
                    ui: { category: 'OR3 Tasks', label: name },
                },
                enabled: ref(false),
            } as RegisteredTool);
        }
        mockTools.tools.push({
            definition: {
                type: 'function',
                function: {
                    name: 'other',
                    description: 'Other tool',
                    parameters: { type: 'object' },
                },
                ui: { category: 'Other' },
            },
            enabled: ref(false),
        } as RegisteredTool);

        const wrapper = mountPopover();
        await wrapper.find('.chat-settings-tool-category').trigger('click');
        const allSwitch = wrapper.find('#chat-tools-all');
        expect(allSwitch.attributes('aria-checked')).toBe('false');
        expect(wrapper.find('#chat-tools-enabled-count').text()).toBe('0 of 3 enabled');

        await allSwitch.trigger('click');
        expect(mockTools.setEnabled.mock.calls).toEqual([
            ['search', true], ['create', true], ['delete', true],
        ]);
        expect(allSwitch.attributes('aria-checked')).toBe('true');
        expect(wrapper.find('#chat-tools-enabled-count').text()).toBe('3 of 3 enabled');

        await wrapper.find('#chat-tool-search').trigger('click');
        expect(allSwitch.attributes('aria-checked')).toBe('false');
        expect(wrapper.find('#chat-tools-enabled-count').text()).toBe('2 of 3 enabled');

        mockTools.setEnabled.mockClear();
        await allSwitch.trigger('click');
        expect(mockTools.setEnabled.mock.calls).toEqual([['search', true]]);

        mockTools.setEnabled.mockClear();
        await allSwitch.trigger('click');
        expect(mockTools.setEnabled.mock.calls).toEqual([
            ['search', false], ['create', false], ['delete', false],
        ]);
        expect(allSwitch.attributes('aria-checked')).toBe('false');
    });

    it('renders Options/More headings with dropdown rows', () => {
        const wrapper = mountPopover();
        const text = wrapper.text();
        expect(text).toContain('Options');
        expect(text).toContain('More');
        expect(text).toContain('Model variant');
        expect(text).toContain('Thinking');
        // Rows show their current value and act as dropdown triggers.
        expect(wrapper.find('[aria-label="Model variant"]').exists()).toBe(
            true
        );
        expect(wrapper.find('[aria-label="Thinking level"]').exists()).toBe(
            true
        );
        const labels = popoverItems(wrapper).map((menu) => menu.label);
        expect(labels).toContain('off');
    });

    it('lists thinking levels ascending with descriptions', () => {
        const wrapper = mountPopover();
        const thinking = wrapper
            .findAllComponents(menuStub)
            .find((menu) => menu.props('items')?.[0]?.value === 'disabled');
        const items = thinking!.props('items') as Array<{
            label: string;
            description: string;
        }>;
        expect(items.map((item) => item.label)).toEqual([
            'Disabled',
            'Low',
            'Medium',
            'High',
        ]);
        for (const item of items) {
            expect(item.description.length).toBeGreaterThan(0);
        }
    });

    it('reflects the active thinking level', () => {
        const wrapper = mountPopover({
            thinkingEnabled: true,
            reasoningEffort: 'high',
        });
        expect(wrapper.find('[aria-label="Thinking level"]').text()).toContain(
            'High'
        );
    });

    it('hides the thinking row when the model does not support it', () => {
        const wrapper = mountPopover({ thinkingSupported: false });
        expect(wrapper.text()).not.toContain('Thinking');
        expect(wrapper.find('[aria-label="Thinking level"]').exists()).toBe(
            false
        );
    });

    it('offers favorites as the current-model dropdown', () => {
        const { favoriteModels } = useModelStore();
        favoriteModels.value = [
            {
                id: 'deepseek/deepseek-chat',
                name: 'deepseek/deepseek-chat',
            } as OpenRouterModel,
        ];
        try {
            const narrow = mountPopover({ containerWidth: 360 });
            const trigger = narrow.find('[aria-label="Current model"]');
            expect(trigger.exists()).toBe(true);
            expect(trigger.text()).toContain('deepseek/deepseek-chat');
            expect(trigger.text()).toContain('Current model for this chat');

            const modelMenu = narrow
                .findAllComponents(menuStub)
                .find((menu) =>
                    (menu.props('items') ?? []).some(
                        (item: { slug?: string }) => item.slug
                    )
                );
            expect(modelMenu).toBeTruthy();
            const items = modelMenu!.props('items') as Array<{
                value: string;
                slug: string;
            }>;
            expect(items).toHaveLength(1);
            // `~`-prefixed canonical slugs still resolve a provider logo.
            expect(items[0]!.slug).toBe('deepseek');
        } finally {
            favoriteModels.value = [];
        }
    });

    it('hides the current-model row on wide composers', () => {
        const wrapper = mountPopover({ containerWidth: 600 });
        expect(
            wrapper.find('[aria-label="Current model"]').exists()
        ).toBe(false);
    });

    it('shows the current prompt below the model and offers Default and Disabled', async () => {
        mockPrompts.items = [
            { id: 'prompt-a', title: 'Writing coach', favorite: true },
            { id: 'prompt-b', title: 'Code reviewer', favorite: false },
        ];
        mockPrompts.threadSelection = 'prompt-b';
        const wrapper = mountPopover({ containerWidth: 360, threadId: 'chat-1' });
        await flushPromises();
        const model = wrapper.find('[aria-label="Current model"]');
        const prompt = wrapper.find('[aria-label="System prompt for this chat"]');
        expect(prompt.text()).toContain('Code reviewer');
        expect(model.element.compareDocumentPosition(prompt.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const menu = wrapper.findAllComponents(menuStub).find(
            (item) => item.attributes('aria-label') === 'System prompt for this chat'
        )!;
        expect(menu.props('items').map((item: { label: string }) => item.label)).toEqual([
            'Default', 'Disabled', 'Writing coach', 'Code reviewer',
        ]);
        menu.vm.$emit('update:modelValue', '__or3_default_prompt__');
        await flushPromises();
        expect(mockPrompts.updateThread).toHaveBeenCalledWith('chat-1', '__or3_default_prompt__');
        expect(prompt.text()).toContain('Default · Writing coach');
    });

    it('stages Disabled for a new chat', async () => {
        const wrapper = mountPopover({ paneId: 'pane-1' });
        await flushPromises();
        const menu = wrapper.findAllComponents(menuStub).find(
            (item) => item.attributes('aria-label') === 'System prompt for this chat'
        )!;
        menu.vm.$emit('update:modelValue', '__or3_disabled_prompt__');
        await flushPromises();
        expect(mockPrompts.setPane).toHaveBeenCalledWith('pane-1', '__or3_disabled_prompt__');
        expect(wrapper.emitted('pending-prompt-selected')?.[0]).toEqual(['__or3_disabled_prompt__']);
        expect(menu.text()).toContain('Disabled');
    });
});
