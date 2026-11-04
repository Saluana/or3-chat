import type { Capability, ModelRef } from '../ai/types';
import { appendModelVariant, sanitizeModelVariant, stripModelVariantSuffix, type OpenRouterModelVariant } from './model-variants';
import type { OpenRouterModel } from './types';
import { isOpenAiModel } from '../openai/models';

const THINKING_SUFFIX = ':thinking';

/** Only legacy OpenRouter string inputs interpret this suffix as a hint. */
export function stripLegacyThinkingSuffix(modelId: string): string {
    return modelId.endsWith(THINKING_SUFFIX) ? modelId.slice(0, -THINKING_SUFFIX.length) : modelId;
}

/** Catalog identity is distinct from the request's routing/search suffix. */
export function openRouterCatalogLookupId(modelId: string): string {
    return stripModelVariantSuffix(stripLegacyThinkingSuffix(modelId));
}

/** Decode the persisted delegated selection without treating other suffixes as options. */
export function splitOpenRouterVariant(modelId: string): { model: string; variant: OpenRouterModelVariant } {
    const model = stripModelVariantSuffix(modelId);
    return { model, variant: sanitizeModelVariant(modelId.slice(model.length + 1)) };
}

export function resolveOpenRouterLegacySelection(input: {
    model: string;
    thinking?: boolean;
    online?: boolean;
    modelVariant?: OpenRouterModelVariant | null;
}): { model: ModelRef; requestModel: string; thinking: boolean } {
    const legacyModelId = stripLegacyThinkingSuffix(input.model);
    const thinking = input.thinking === true || input.model.endsWith(THINKING_SUFFIX);
    // OpenAI models have no routing or search variants; a saved preference does not apply to them.
    if (isOpenAiModel(legacyModelId)) {
        const modelId = stripModelVariantSuffix(legacyModelId);
        return { model: { routerId: 'openai', modelId }, requestModel: modelId, thinking };
    }
    const model: ModelRef = { routerId: 'openrouter', modelId: stripModelVariantSuffix(legacyModelId) };
    return {
        model,
        requestModel: appendModelVariant(legacyModelId, input.modelVariant ?? (input.online === true ? 'online' : 'off')),
        thinking,
    };
}

/** OpenRouter historically allows tools when the catalog omits the fact. */
export function openRouterToolCapability(model?: Pick<OpenRouterModel, 'supported_parameters'>): Capability {
    if (!model?.supported_parameters) return 'unknown';
    return model.supported_parameters.includes('tools') ? 'supported' : 'unsupported';
}
