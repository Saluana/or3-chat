import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import SystemPromptsModal from '../SystemPromptsModal.vue';

const promptState = vi.hoisted(() => ({
    prompts: [
        {
            id: 'prompt-1',
            title: 'Dungeon master',
            content: {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Build an adventure' },
                        ],
                    },
                ],
            },
            tags: ['Roleplay', 'Writing'],
            favorite: false,
            created_at: 1,
            updated_at: 2,
            deleted: false,
        },
        {
            id: 'prompt-2',
            title: 'Reviewer',
            content: { type: 'doc', content: [] },
            tags: ['Coding'],
            favorite: true,
            created_at: 1,
            updated_at: 1,
            deleted: false,
        },
    ],
}));

const updatePrompt = vi.hoisted(() =>
    vi.fn(async (id: string, patch: Record<string, unknown>) => {
        const prompt = promptState.prompts.find((entry) => entry.id === id);
        if (!prompt) return undefined;
        Object.assign(prompt, patch);
        return structuredClone(prompt);
    })
);

vi.mock('~/db/prompts', () => ({
    listPrompts: vi.fn(async () => structuredClone(promptState.prompts)),
    createPrompt: vi.fn(),
    softDeletePrompt: vi.fn(),
    updatePrompt,
}));

vi.mock('~/db/threads', () => ({
    getThreadSystemPrompt: vi.fn(async () => null),
    updateThreadSystemPrompt: vi.fn(),
}));

vi.mock('~/composables/core/usePanePrompt', () => ({
    clearPanePendingPrompt: vi.fn(),
    getPanePendingPrompt: vi.fn(() => null),
    setPanePendingPrompt: vi.fn(),
}));

vi.mock('~/composables/chat/useActivePrompt', () => ({
    useActivePrompt: () => ({
        activePromptId: ref(null),
        clearActivePrompt: vi.fn(),
    }),
}));

vi.mock('~/composables/chat/useDefaultPrompt', () => ({
    useDefaultPrompt: () => ({
        defaultPromptId: ref(null),
        setDefaultPrompt: vi.fn(),
        clearDefaultPrompt: vi.fn(),
    }),
}));

vi.mock('~/composables/core/useTokenizer', () => ({
    useTokenizer: () => ({
        countTokensBatch: vi.fn(async (items: Array<{ key: string }>) =>
            Object.fromEntries(items.map((item) => [item.key, 3]))
        ),
    }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({}),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

const stubs = {
    UModal: {
        props: ['open'],
        template:
            '<div class="modal-stub"><slot name="header" /><slot name="body" /></div>',
    },
    UButton: {
        inheritAttrs: false,
        emits: ['click'],
        template:
            '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
    },
    UInput: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
            '<input :value="modelValue" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    USelectMenu: {
        template: '<select />',
    },
    UPopover: {
        template: '<div><slot /><slot name="content" /></div>',
    },
    UIcon: {
        template: '<i />',
    },
    LazyPromptsPromptEditor: {
        template: '<div class="editor-stub" />',
    },
};

describe('SystemPromptsModal', () => {
    beforeEach(() => {
        updatePrompt.mockClear();
        promptState.prompts[0]!.favorite = false;
    });

    it('renders the library with tag filters and content previews', async () => {
        const wrapper = mount(SystemPromptsModal, {
            props: { showModal: true, mode: 'home', paneId: 'pane-1' },
            global: { stubs },
        });
        await flushPromises();

        expect(wrapper.text()).toContain('Dungeon master');
        expect(wrapper.text()).toContain('Build an adventure');
        expect(wrapper.text()).toContain('Roleplay');
        expect(wrapper.text()).toContain('Favorites');
    });

    it('drills into detail and persists favorite changes', async () => {
        const wrapper = mount(SystemPromptsModal, {
            props: { showModal: true, mode: 'home', paneId: 'pane-1' },
            global: { stubs },
        });
        await flushPromises();

        await wrapper
            .get('[data-test="system-prompt-row-prompt-1"]')
            .trigger('click');
        await wrapper
            .get('button[aria-label="Add to favorites"]')
            .trigger('click');
        await flushPromises();

        expect(wrapper.get('[data-test="system-prompts-detail"]').text()).toContain(
            'Prompt preview'
        );
        expect(updatePrompt).toHaveBeenCalledWith('prompt-1', {
            favorite: true,
        });
    });
});
