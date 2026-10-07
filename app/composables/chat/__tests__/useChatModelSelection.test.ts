import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import { useChatModelSelection } from '../useChatModelSelection';

const modelStore = vi.hoisted(() => ({
    catalog: undefined as ReturnType<typeof ref<OpenRouterModel[]>> | undefined,
    favoriteModels: undefined as
        | ReturnType<typeof ref<OpenRouterModel[]>>
        | undefined,
    fetchModels: vi.fn(),
    getFavoriteModels: vi.fn(),
}));

vi.mock('../useModelStore', () => ({
    useModelStore: () => ({
        catalog: modelStore.catalog,
        favoriteModels: modelStore.favoriteModels,
        fetchModels: modelStore.fetchModels,
        getFavoriteModels: modelStore.getFavoriteModels,
    }),
}));

vi.mock('../useAiSettings', () => ({
    useAiSettings: () => ({
        settings: ref({
            defaultModelMode: 'last-used',
            fixedModelId: null,
        }),
    }),
}));

vi.mock('@vueuse/core', () => ({
    useLocalStorage: (_key: string, defaultValue: string) => ref(defaultValue),
}));

function model(
    overrides: Partial<OpenRouterModel> & Pick<OpenRouterModel, 'id'>
): OpenRouterModel {
    return {
        name: overrides.id,
        ...overrides,
    };
}

function mountModelSelection(onChange = vi.fn()) {
    let selection!: ReturnType<typeof useChatModelSelection>;
    const wrapper = mount(
        defineComponent({
            setup() {
                selection = useChatModelSelection({
                    threadId: () => undefined,
                    onChange,
                });
                return () => h('div');
            },
        })
    );
    return { selection, wrapper };
}

describe('useChatModelSelection', () => {
    beforeEach(() => {
        modelStore.catalog = ref([]);
        modelStore.favoriteModels = ref([]);
        modelStore.fetchModels.mockReset().mockResolvedValue([]);
        modelStore.getFavoriteModels.mockReset().mockResolvedValue([]);
    });

    it('propagates the effective route and variant-only changes without synthetic thinking suffixes', async () => {
        const onChange = vi.fn();
        const { selection, wrapper } = mountModelSelection(onChange);
        await flushPromises();
        selection.selectedModel.value = 'provider/model:thinking';
        selection.modelVariant.value = 'nitro';
        await nextTick();
        expect(onChange).toHaveBeenLastCalledWith('provider/model:nitro');
        selection.modelVariant.value = 'floor';
        await nextTick();
        expect(onChange).toHaveBeenLastCalledWith('provider/model:floor');
        expect(selection.selectedModel.value).toBe('provider/model:thinking');
        wrapper.unmount();
    });

    it('hydrates the model catalog so capability metadata is available', async () => {
        mountModelSelection();
        await flushPromises();

        expect(modelStore.fetchModels).toHaveBeenCalledOnce();
        expect(modelStore.getFavoriteModels).toHaveBeenCalledOnce();
    });

    it('does not register the model event listener after unmount', async () => {
        let release!: () => void;
        modelStore.getFavoriteModels.mockReturnValue(
            new Promise((resolve) => {
                release = () => resolve([]);
            })
        );
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const { wrapper } = mountModelSelection();

        wrapper.unmount();
        release();
        await flushPromises();

        expect(addEventListener).not.toHaveBeenCalledWith(
            'or3:model-selected',
            expect.any(Function)
        );
    });

    it('recognizes reasoning models without an explicit effort list', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: '~openai/gpt-luna-latest',
                reasoning: {
                    supports_max_tokens: true,
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.modelSupportsThinking.value).toBe(true);
        expect(selection.modelReasoningEfforts.value).toEqual([]);
        expect(selection.thinkingEnabled.value).toBe(true);
    });

    it('defaults to medium reasoning even when the model advertises a different default', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: '~openai/gpt-luna-latest',
                reasoning: {
                    default_effort: 'low',
                    supported_efforts: ['low', 'medium', 'high'],
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.thinkingEnabled.value).toBe(true);
        expect(selection.reasoningEffort.value).toBe('medium');
    });

    it('keeps the default enabled across a model without reasoning support', async () => {
        modelStore.favoriteModels!.value = [
            model({ id: '~openai/gpt-luna-latest' }),
            model({
                id: 'provider/reasoning-model',
                supported_parameters: ['reasoning'],
            }),
        ];

        const { selection } = mountModelSelection();
        selection.selectedModel.value = 'provider/reasoning-model';
        await nextTick();

        expect(selection.thinkingEnabled.value).toBe(true);
        expect(selection.reasoningEffort.value).toBe('medium');
    });

    it('chooses the middle supported level when medium is unavailable', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: '~openai/gpt-luna-latest',
                reasoning: {
                    default_effort: 'low',
                    supported_efforts: ['xhigh', 'low', 'high'],
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.reasoningEffort.value).toBe('high');
    });

    // Live: GPT-6 Luna sent medium; GLM (no medium) showed high, and DeepSeek,
    // Qwen and Claude then inherited high although nobody chose it.
    it('returns to the chosen effort after a model that cannot use it', async () => {
        modelStore.favoriteModels!.value = [
            model({ id: 'provider/standard', reasoning: { supported_efforts: ['low', 'medium', 'high'] } }),
            model({ id: 'provider/no-medium', reasoning: { supported_efforts: ['low', 'high', 'xhigh'] } }),
            model({ id: 'provider/wide', reasoning: { supported_efforts: ['low', 'medium', 'high', 'xhigh'] } }),
        ];
        const { selection } = mountModelSelection();
        const select = async (id: string) => { selection.selectedModel.value = id; await nextTick(); await nextTick(); };
        await select('provider/standard');
        expect(selection.reasoningEffort.value).toBe('medium');
        await select('provider/no-medium');
        expect(selection.reasoningEffort.value).toBe('high');
        await select('provider/wide');
        expect(selection.reasoningEffort.value).toBe('medium');

        selection.reasoningEffort.value = 'xhigh';
        await nextTick();
        await select('provider/standard');
        expect(selection.reasoningEffort.value).toBe('medium');
        await select('provider/wide');
        expect(selection.reasoningEffort.value).toBe('xhigh');
    });

    it('matches capability metadata by canonical model slug', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: 'provider/model-versioned',
                canonical_slug: 'provider/model',
                supported_parameters: ['include_reasoning'],
            }),
        ];

        const { selection } = mountModelSelection();
        selection.selectedModel.value = 'provider/model';
        await nextTick();

        expect(selection.modelSupportsThinking.value).toBe(true);
        expect(selection.modelReasoningEfforts.value).toEqual([
            'low',
            'medium',
            'high',
        ]);
    });
});
