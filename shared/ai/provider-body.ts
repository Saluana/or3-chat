import { encodeOpenRouterRequest } from '../openrouter/adapter';
import { isOpenAiModel } from '../openai/models';

/**
 * The provider-visible request that admission measures, selected by the model's router.
 * OpenRouter projects its search variant into a tool; OpenAI's wire options are
 * dropped by its adapter at dispatch, so its admitted body is the request itself.
 */
export function encodeProviderRequest<T extends { model?: unknown; tools?: unknown }>(body: T): T {
    return isOpenAiModel(body.model) ? body : encodeOpenRouterRequest(body);
}
