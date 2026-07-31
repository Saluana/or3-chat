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

function mountModelSelection() {
    let selection!: ReturnType<typeof useChatModelSelection>;
    const wrapper = mount(
        defineComponent({
            setup() {
                selection = useChatModelSelection({
                    threadId: () => undefined,
                    onChange: vi.fn(),
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

    it('hydrates the model catalog so capability metadata is available', async () => {
        mountModelSelection();
        await flushPromises();

        expect(modelStore.fetchModels).toHaveBeenCalledOnce();
        expect(modelStore.getFavoriteModels).toHaveBeenCalledOnce();
    });

    it('recognizes reasoning models without an explicit effort list', async () => {
        modelStore.favoriteModels!.value = [
            model({
                id: 'openai/gpt-oss-120b',
                reasoning: {
                    supports_max_tokens: true,
                },
            }),
        ];

        const { selection } = mountModelSelection();
        await nextTick();

        expect(selection.modelSupportsThinking.value).toBe(true);
        expect(selection.modelReasoningEfforts.value).toEqual([]);
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
