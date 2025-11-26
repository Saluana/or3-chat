// shared/openrouter/types.ts
// Type mapping between SDK types and internal OR3 types

import type { Model as SDKModel } from '@openrouter/sdk/models';
import type { OpenRouterModel } from '~/core/auth/models-service';

/**
 * Convert SDK Model type to our internal OpenRouterModel type.
 * Handles field name differences between SDK (camelCase) and our interface (snake_case).
 *
 * The SDK returns models in camelCase format, but our internal OpenRouterModel interface
 * uses snake_case to match the OpenRouter REST API directly.
 */
export function sdkModelToLocal(model: SDKModel): OpenRouterModel {
    return {
        id: model.id,
        name: model.name,
        description: model.description,
        created: model.created,
        architecture: {
            input_modalities: model.architecture.inputModalities,
            output_modalities: model.architecture.outputModalities,
            tokenizer: model.architecture.tokenizer ?? undefined,
            instruct_type: model.architecture.instructType ?? undefined,
        },
        top_provider: {
            is_moderated: model.topProvider.isModerated,
            context_length: model.topProvider.contextLength ?? undefined,
            max_completion_tokens:
                model.topProvider.maxCompletionTokens ?? undefined,
        },
        pricing: {
            prompt: String(model.pricing.prompt ?? ''),
            completion: String(model.pricing.completion ?? ''),
            image: model.pricing.image
                ? String(model.pricing.image)
                : undefined,
            request: model.pricing.request
                ? String(model.pricing.request)
                : undefined,
            web_search: model.pricing.webSearch
                ? String(model.pricing.webSearch)
                : undefined,
            internal_reasoning: model.pricing.internalReasoning
                ? String(model.pricing.internalReasoning)
                : undefined,
            input_cache_read: model.pricing.inputCacheRead
                ? String(model.pricing.inputCacheRead)
                : undefined,
            input_cache_write: model.pricing.inputCacheWrite
                ? String(model.pricing.inputCacheWrite)
                : undefined,
        },
        canonical_slug: model.canonicalSlug,
        context_length: model.contextLength ?? undefined,
        hugging_face_id: model.huggingFaceId ?? undefined,
        per_request_limits: model.perRequestLimits ?? undefined,
        supported_parameters: model.supportedParameters.map((p) =>
            typeof p === 'string' ? p : String(p)
        ),
    };
}
