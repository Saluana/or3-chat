import {
    computed,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
    type Ref,
} from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { useAiSettings } from './useAiSettings';
import { useModelStore } from './useModelStore';
import {
    getDefaultReasoningEffort,
    getSupportedReasoningEfforts,
    modelSupportsReasoning,
    type OpenRouterReasoningEffort,
} from '~~/shared/openrouter/reasoning';
import type { OpenRouterModel } from '~~/shared/openrouter/types';

const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const LAST_MODEL_KEY = 'last_selected_model';

function stripThinkingSuffix(modelId: string): string {
    return modelId.endsWith(':thinking')
        ? modelId.slice(0, -':thinking'.length)
        : modelId;
}

export function useChatModelSelection(options: {
    threadId: () => string | undefined;
    onChange: (modelId: string) => void;
}): {
    selectedModel: Ref<string>;
    webSearchEnabled: Ref<boolean>;
    thinkingEnabled: Ref<boolean>;
    reasoningEffort: Ref<string | undefined>;
    modelReasoningEfforts: Readonly<Ref<OpenRouterReasoningEffort[]>>;
    modelSupportsThinking: Readonly<Ref<boolean>>;
} {
    const {
        favoriteModels,
        getFavoriteModels,
        catalog,
        fetchModels,
    } = useModelStore();
    const { settings } = useAiSettings();
    const selectedModel = ref(DEFAULT_MODEL);
    const webSearchEnabled = ref(false);
    const thinkingEnabled = ref(false);
    const reasoningEffort = ref<string>();
    const persistedModel = useLocalStorage(LAST_MODEL_KEY, DEFAULT_MODEL);
    const suppressNextPersist = ref(false);

    const selectedModelMeta = computed<OpenRouterModel | undefined>(() => {
        const modelId = stripThinkingSuffix(selectedModel.value);
        const matchesSelectedModel = (model: OpenRouterModel) =>
            model.id === modelId || model.canonical_slug === modelId;
        return (
            catalog.value.find(matchesSelectedModel) ??
            favoriteModels.value.find(matchesSelectedModel)
        );
    });
    const modelReasoningEfforts = computed(() =>
        getSupportedReasoningEfforts(selectedModelMeta.value)
    );
    const modelSupportsThinking = computed(() =>
        modelSupportsReasoning(selectedModelMeta.value)
    );

    function applyNewChatDefault(): void {
        if (options.threadId()) return;
        const modelId =
            settings.value.defaultModelMode === 'fixed'
                ? settings.value.fixedModelId
                : null;
        if (!modelId) return;
        suppressNextPersist.value = true;
        selectedModel.value = modelId;
    }

    onMounted(async () => {
        const catalogHydration = fetchModels().catch(() => undefined);
        await getFavoriteModels();
        if (!process.client) return;
        if (persistedModel.value) {
            selectedModel.value = persistedModel.value;
        }
        applyNewChatDefault();
        window.addEventListener('or3:model-selected', onCatalogModelSelected);
        await catalogHydration;
    });
    onBeforeUnmount(() => {
        if (process.client) {
            window.removeEventListener(
                'or3:model-selected',
                onCatalogModelSelected
            );
        }
    });

    function onCatalogModelSelected(event: Event): void {
        const modelId = (
            event as CustomEvent<{ modelId?: string }>
        ).detail.modelId;
        if (modelId && modelId !== selectedModel.value) {
            selectedModel.value = modelId;
        }
    }

    watch(options.threadId, applyNewChatDefault);
    watch(modelSupportsThinking, (supported) => {
        if (!supported) thinkingEnabled.value = false;
    });
    watch(
        [selectedModelMeta, modelReasoningEfforts],
        ([model, efforts]) => {
            if (!modelSupportsReasoning(model)) {
                reasoningEffort.value = undefined;
                return;
            }
            if (
                reasoningEffort.value &&
                efforts.includes(
                    reasoningEffort.value as OpenRouterReasoningEffort
                )
            ) {
                return;
            }
            reasoningEffort.value = getDefaultReasoningEffort(model);
        },
        { immediate: true }
    );
    watch(selectedModel, (modelId) => {
        options.onChange(modelId);
        if (!process.client) return;
        if (suppressNextPersist.value) {
            suppressNextPersist.value = false;
            return;
        }
        persistedModel.value = modelId;
    });

    return {
        selectedModel,
        webSearchEnabled,
        thinkingEnabled,
        reasoningEffort,
        modelReasoningEfforts,
        modelSupportsThinking,
    };
}
