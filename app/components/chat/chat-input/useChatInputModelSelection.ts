import { computed, onMounted, ref, watch, type Ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';

interface AiSettingsValue {
    defaultModelMode?: string;
    fixedModelId?: string | null;
}

interface UseChatInputModelSelectionOptions {
    selectedModel: Ref<string>;
    threadId: Ref<string | undefined>;
    aiSettings: Ref<AiSettingsValue | null | undefined>;
    getFavoriteModels: () => Promise<unknown>;
}

const LAST_MODEL_KEY = 'last_selected_model';

export function useChatInputModelSelection(
    options: UseChatInputModelSelectionOptions
): void {
    const persistedModel = useLocalStorage<string>(
        LAST_MODEL_KEY,
        'openai/gpt-oss-120b'
    );
    const suppressPersist = ref(false);

    const fixedDefaultModel = computed(() => {
        const value = options.aiSettings.value;
        return value?.defaultModelMode === 'fixed' ? value.fixedModelId : null;
    });

    onMounted(async () => {
        await options.getFavoriteModels();
        if (!process.client) return;

        if (persistedModel.value) {
            options.selectedModel.value = persistedModel.value;
        }

        if (!options.threadId.value && fixedDefaultModel.value) {
            suppressPersist.value = true;
            options.selectedModel.value = fixedDefaultModel.value;
        }
    });

    watch(options.threadId, (threadId) => {
        if (threadId) return;
        const fixed = fixedDefaultModel.value;
        if (!fixed) return;
        suppressPersist.value = true;
        options.selectedModel.value = fixed;
    });

    watch(options.selectedModel, (newModel) => {
        if (!process.client) return;
        if (suppressPersist.value) {
            suppressPersist.value = false;
            return;
        }
        persistedModel.value = newModel;
    });
}
