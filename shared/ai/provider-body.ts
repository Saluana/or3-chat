import { encodeOpenRouterRequest } from '../openrouter/adapter';
import { isOpenAiModel } from '../openai/models';
import { encodeOpenAiRequest } from '../openai/adapter';

/**
 * The provider-visible request that admission measures, selected by the model's router.
 * Preserve the host model identity and allowance field while projecting OpenAI
 * options to the same input that will be sent upstream.
 */
export function encodeProviderRequest<T extends { model?: unknown; tools?: unknown }>(body: T): T {
    if (!isOpenAiModel(body.model)) return encodeOpenRouterRequest(body);
    const { max_completion_tokens, ...wire } = encodeOpenAiRequest(body);
    return { ...wire, model: body.model, ...(max_completion_tokens !== undefined ? { max_tokens: max_completion_tokens } : {}) } as T;
}
