import { watch, effectScope } from 'vue';
import { defineNuxtPlugin } from '#app';
import {
    modelRegistry,
    registerDefaultModels,
    type OpenRouterModel as WorkflowModel,
} from '@or3/workflow-core';
import { useModelStore } from '~/composables/chat/useModelStore';
import type { OpenRouterModel } from '~/core/auth/models-service';

function toWorkflowModel(model: OpenRouterModel): WorkflowModel {
    const inputModalities = model.architecture?.input_modalities || [];
    const outputModalities = model.architecture?.output_modalities || [];
    return {
        id: model.id,
        canonicalSlug: model.canonical_slug ?? model.id,
        huggingFaceId: model.hugging_face_id ?? '',
        name: model.name,
        created: model.created ?? Date.now(),
        description: model.description,
        contextLength:
            model.top_provider?.context_length ??
            model.context_length ??
            undefined,
        architecture: {
            modality: `${inputModalities.join('+') || 'text'}->${
                outputModalities.join('+') || 'text'
            }`,
            inputModalities,
            outputModalities,
            tokenizer: model.architecture?.tokenizer ?? undefined,
            instructType: model.architecture?.instruct_type ?? null,
        },
        pricing: {
            prompt: model.pricing?.prompt ?? '0',
            completion: model.pricing?.completion ?? '0',
            request: model.pricing?.request,
            image: model.pricing?.image,
            webSearch: model.pricing?.web_search,
            internalReasoning: model.pricing?.internal_reasoning,
            inputCacheRead: model.pricing?.input_cache_read,
            inputCacheWrite: model.pricing?.input_cache_write,
        },
        topProvider: {
            isModerated: model.top_provider?.is_moderated ?? false,
            contextLength:
                model.top_provider?.context_length ?? model.context_length,
            maxCompletionTokens: model.top_provider?.max_completion_tokens,
        },
        perRequestLimits: model.per_request_limits ?? null,
        supportedParameters: model.supported_parameters ?? [],
        defaultParameters: null,
    };
}

export default defineNuxtPlugin((nuxtApp) => {
    if (!import.meta.client) return;

    const { favoriteModels, getFavoriteModels } = useModelStore();
    const scope = effectScope();

    const syncFavorites = (list: OpenRouterModel[]) => {
        modelRegistry.clear();
        if (Array.isArray(list) && list.length > 0) {
            modelRegistry.registerMany(list.map(toWorkflowModel));
        } else {
            // Fallback to defaults so inspector/model dropdowns still work
            registerDefaultModels();
        }
    };

    nuxtApp.hook('app:mounted', async () => {
        const initial = await getFavoriteModels();
        syncFavorites(initial);

        scope.run(() => {
            watch(
                favoriteModels,
                (list) => {
                    syncFavorites(list);
                },
                { deep: true }
            );
        });
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => scope.stop());
    }
});
