import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref, shallowRef } from 'vue';
import ChatSettingsPopover from '../ChatSettingsPopover.vue';
import { useModelStore } from '~/composables/chat/useModelStore';
import type { OpenRouterModel } from '~/core/auth/models-service';
import type { RegisteredTool } from '~/utils/chat/tool-registry';

const mockTools = vi.hoisted(() => ({
    tools: [] as RegisteredTool[],
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
    }),
}));

// Tool preference behavior is exercised by the real browser/persistence journey.
// These component tests own navigation and model/prompt controls only.
vi.mock('~/composables/chat/useChatToolPreferences', () => ({
    useChatToolPreferences: () => ({
        preferences: ref({ enabled: false, tools: {} }), ready: ref(true), saving: ref(false), error: ref(''),
        setEnabled: vi.fn(), setTools: vi.fn(),
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

// The Models page has its own suite; here it only needs to drive navigation.
const modelsPageStub = {
    name: 'ChatSettingsModelsPage',
    props: ['selectedModel', 'detailId', 'disabled'],
    emits: ['select', 'open-detail', 'open-catalog'],
    template: '<div class="models-page-stub" :data-detail="detailId ?? \'\'" />',
};

const inputStub = {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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
            directives: { theme: {} },
            stubs: {
                // $attrs carries the click listener, so the stub forwards it once.
                UButton: { template: '<button v-bind="$attrs"><slot/></button>' },
                UIcon: { template: '<span class="uicon-stub" />' },
                USwitch: switchStub,
                USelectMenu: menuStub,
                UInput: inputStub,
                UTooltip: { props: ['text', 'delayDuration'], template: '<slot />' },
                ChatSettingsModelsPage: modelsPageStub,
            },
        },
    });
}

describe('ChatSettingsPopover options layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTools.tools.splice(0);
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
        expect(wrapper.find('.chat-settings-tool-category').exists()).toBe(false);
        await wrapper.findAll('button').find(button => button.text().startsWith('Tools'))!.trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Tools');
        const category = wrapper.find('.chat-settings-tool-category');
        expect(category.text()).toContain('Task list tools');
        expect(category.text()).toContain('11');
        expect(wrapper.text()).not.toContain('Other tools');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(0);

        await category.trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Task list tools');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(11);
        expect(wrapper.text()).toContain('search lists');
        expect(wrapper.find('.chat-settings-body').attributes('style')).toContain('display: none');

        await wrapper.find('[aria-label="Back to tools"]').trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Tools');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(0);
        await wrapper.find('[aria-label="Back to chat settings"]').trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Chat settings');
        expect(wrapper.findAll('.chat-settings-tool-row')).toHaveLength(0);
    });

    it('renders Chat/Preferences/Library headings with dropdown rows', () => {
        const wrapper = mountPopover();
        const text = wrapper.text();
        expect(wrapper.findAll('.chat-settings-heading').map((heading) => heading.text())).toEqual(['Chat', 'Preferences', 'Library']);
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

    it('opens the Models page from the current-model row and returns after a choice', async () => {
        const wrapper = mountPopover({ containerWidth: 360 });
        const trigger = wrapper.find('[aria-label="Current model"]');
        expect(trigger.text()).toContain('Current model for this chat');

        await trigger.trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Models');
        expect(wrapper.find('.chat-settings-body').attributes('style')).toContain('display: none');
        const page = wrapper.findComponent(modelsPageStub);
        expect(page.props('selectedModel')).toBe('deepseek/deepseek-chat');

        page.vm.$emit('open-detail', 'openai/gpt-4o');
        await flushPromises();
        expect(wrapper.find('.chat-settings-title').text()).toBe('Model details');
        expect(page.props('detailId')).toBe('openai/gpt-4o');
        await wrapper.find('[aria-label="Back to models"]').trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Models');
        expect(page.props('detailId')).toBeNull();

        page.vm.$emit('select', 'openai/gpt-4o');
        await flushPromises();
        expect(wrapper.emitted('update:model')?.at(-1)).toEqual(['openai/gpt-4o']);
        expect(wrapper.find('.chat-settings-title').text()).toBe('Chat settings');
        expect(wrapper.findComponent(modelsPageStub).exists()).toBe(false);
    });

    it('opens the Models page from the library and hands off to the full catalog', async () => {
        const wrapper = mountPopover({ containerWidth: 600 });
        await wrapper.findAll('button').find(button => button.text().includes('Model catalog'))!.trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Models');
        await wrapper.find('[aria-label="Open full catalog"]').trigger('click');
        expect(wrapper.emitted('open-model-catalog')).toHaveLength(1);

        // Details have no full-catalog shortcut in the header.
        wrapper.findComponent(modelsPageStub).vm.$emit('open-detail', 'openai/gpt-4o');
        await flushPromises();
        expect(wrapper.find('[aria-label="Open full catalog"]').exists()).toBe(false);
    });

    it('hides the current-model row on wide composers', () => {
        const wrapper = mountPopover({ containerWidth: 600 });
        expect(
            wrapper.find('[aria-label="Current model"]').exists()
        ).toBe(false);
    });

    it('picks a prompt on the System prompts page and returns to settings', async () => {
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

        await prompt.trigger('click');
        expect(wrapper.find('.chat-settings-title').text()).toBe('System prompts');
        const rows = wrapper.findAll('.settings-page-row-main');
        expect(rows.map(row => row.find('.settings-page-row-title').text())).toEqual([
            'Default', 'Disabled', 'Writing coach', 'Code reviewer',
        ]);
        // Section labels carry no counts.
        expect(wrapper.findAll('.settings-page-heading').map(heading => heading.text())).toEqual([
            'Favorites', 'All prompts',
        ]);
        expect(rows[3]!.attributes('aria-current')).toBe('true');
        expect(rows[3]!.attributes('aria-pressed')).toBe('true');

        await rows[0]!.trigger('click');
        expect(mockPrompts.updateThread).not.toHaveBeenCalled();
        expect(wrapper.find('.settings-page-use').text()).toBe('Switch to default prompt');
        await wrapper.find('.settings-page-use').trigger('click');
        await flushPromises();
        expect(mockPrompts.updateThread).toHaveBeenCalledWith('chat-1', '__or3_default_prompt__');
        expect(wrapper.find('.chat-settings-title').text()).toBe('Chat settings');
        expect(prompt.text()).toContain('Default · Writing coach');
    });

    it('stages Disabled for a new chat from the System prompts page', async () => {
        const wrapper = mountPopover({ paneId: 'pane-1' });
        await flushPromises();
        await wrapper.find('[aria-label="System prompt for this chat"]').trigger('click');
        const disabled = wrapper.findAll('.settings-page-row-main')
            .find(row => row.text().includes('Disabled'))!;
        // A second tap on the highlighted row uses it.
        await disabled.trigger('click');
        await disabled.trigger('click');
        await flushPromises();
        expect(mockPrompts.setPane).toHaveBeenCalledWith('pane-1', '__or3_disabled_prompt__');
        expect(wrapper.emitted('pending-prompt-selected')?.[0]).toEqual(['__or3_disabled_prompt__']);
        expect(wrapper.find('[aria-label="System prompt for this chat"]').text()).toContain('Disabled');
    });

    it('filters prompts and hands editing, new prompts, and the full library to the modal', async () => {
        mockPrompts.items = [
            { id: 'prompt-a', title: 'Writing coach', favorite: true },
            { id: 'prompt-b', title: 'Code reviewer', favorite: false },
        ];
        const wrapper = mountPopover({ threadId: 'chat-1' });
        await flushPromises();
        await wrapper.findAll('button').find(button => button.text().includes('System prompts'))!.trigger('click');
        await wrapper.find('[aria-label="Search system prompts"]').setValue('review');
        expect(wrapper.findAll('.settings-page-row-title').map(title => title.text())).toEqual(['Code reviewer']);

        // Edit appears only on a highlighted saved prompt.
        expect(wrapper.find('[aria-label="Edit prompt"]').exists()).toBe(false);
        await wrapper.find('.settings-page-row-main').trigger('click');
        await wrapper.find('[aria-label="Edit prompt"]').trigger('click');

        await wrapper.find('[aria-label="New prompt"]').trigger('click');
        await wrapper.find('[aria-label="Open full library"]').trigger('click');
        expect(wrapper.emitted('open-system-prompts')).toEqual([['edit', 'prompt-b'], ['new'], ['home']]);
    });
});
