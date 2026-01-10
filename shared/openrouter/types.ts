// shared/openrouter/types.ts
// Type mapping between SDK types and internal OR3 types

import type { Model as SDKModel } from '@openrouter/sdk/models';
import { z } from 'zod';

// Define the OpenRouterModel interface here to avoid circular imports
// This is the canonical snake_case representation matching the OpenRouter REST API
export interface OpenRouterModel {
    id: string;
    name: string;
    description?: string;
    created?: number;
    architecture?: {
        input_modalities?: string[];
        output_modalities?: string[];
        tokenizer?: string;
        instruct_type?: string;
    };
    top_provider?: {
        is_moderated?: boolean;
        context_length?: number;
        max_completion_tokens?: number;
    };
    pricing?: {
        prompt?: string;
        completion?: string;
        image?: string;
        request?: string;
        web_search?: string;
        internal_reasoning?: string;
        input_cache_read?: string;
        input_cache_write?: string;
    };
    canonical_slug?: string;
    context_length?: number;
    hugging_face_id?: string;
    per_request_limits?: Record<string, unknown>;
    supported_parameters?: string[];
}

export const openRouterModelSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        created: z.number().optional(),
        architecture: z
            .object({
                input_modalities: z.array(z.string()).optional(),
                output_modalities: z.array(z.string()).optional(),
                tokenizer: z.string().optional(),
                instruct_type: z.string().optional(),
            })
            .passthrough()
            .optional(),
        top_provider: z
            .object({
                is_moderated: z.boolean().optional(),
                context_length: z.number().optional(),
                max_completion_tokens: z.number().optional(),
            })
            .passthrough()
            .optional(),
        pricing: z
            .object({
                prompt: z.string().optional(),
                completion: z.string().optional(),
                image: z.string().optional(),
                request: z.string().optional(),
                web_search: z.string().optional(),
                internal_reasoning: z.string().optional(),
                input_cache_read: z.string().optional(),
                input_cache_write: z.string().optional(),
            })
            .passthrough()
            .optional(),
        canonical_slug: z.string().optional(),
        context_length: z.number().optional(),
        hugging_face_id: z.string().optional(),
        per_request_limits: z.record(z.string(), z.unknown()).optional(),
        supported_parameters: z.array(z.string()).optional(),
    })
    .passthrough();

export const openRouterModelListSchema = z.array(openRouterModelSchema);

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
            prompt: String(model.pricing.prompt),
            completion: String(model.pricing.completion),
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
