import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';
import { stripModelVariantSuffix } from '~~/shared/openrouter/model-variants';
import { admitProviderRequest, ChatContextAdmissionError, type ContextRequestPolicy,
    type CountableChatMessage } from '~~/shared/chat/context-budget';
import { countTokensApprox } from '~/utils/chat/tokens';
import { estimateMeasuredChatRequest } from '~~/shared/chat/request-usage';

/** New native requests carry only user choices. Legacy payloads retain their existing boundary. */
export async function resolveServerContextPolicy(body: Record<string, unknown>, apiKey: string,
    serverURL?: string, signal?: AbortSignal): Promise<ContextRequestPolicy | undefined> {
    if (!('_context' in body)) return undefined;
    const envelope = body._context && typeof body._context === 'object' && !Array.isArray(body._context)
        ? body._context as Record<string, unknown> : null;
    if (!envelope || envelope.version !== 1 || typeof body.model !== 'string' || !Array.isArray(body.messages)) {
        throw new ChatContextAdmissionError({ ok: false, code: 'model_metadata_unavailable' });
    }
    const selectedModel = body.model;
    const userMaximum = envelope.user_max_context_tokens === null ? null
        : typeof envelope.user_max_context_tokens === 'number' ? envelope.user_max_context_tokens : NaN;
    const requestedCompletion = envelope.requested_completion_tokens === null ? null
        : typeof envelope.requested_completion_tokens === 'number' ? envelope.requested_completion_tokens : NaN;
    let catalog;
    try { catalog = await fetchOpenRouterCatalog(createOpenRouterClient({ apiKey, serverURL }), signal); }
    catch (error) {
        if (signal?.aborted) throw error;
        throw new ChatContextAdmissionError({ ok: false, code: 'model_metadata_unavailable' });
    }
    const withoutThinking = selectedModel.endsWith(':thinking') ? selectedModel.slice(0, -':thinking'.length) : selectedModel;
    const lookupId = stripModelVariantSuffix(withoutThinking);
    const model = catalog.find((candidate) => candidate.id === lookupId)
        ?? catalog.find((candidate) => candidate.canonical_slug === lookupId);
    if (!model) throw new ChatContextAdmissionError({ ok: false, code: 'model_metadata_unavailable' });
    return Object.freeze({ model: Object.freeze({ context_length: model.context_length,
        top_provider: model.top_provider ? Object.freeze({ context_length: model.top_provider.context_length,
            max_completion_tokens: model.top_provider.max_completion_tokens }) : undefined }), source: 'openrouter-live', userMaxContextTokens: userMaximum,
        requestedCompletionTokens: requestedCompletion });
}

export async function admitServerProviderBody(body: Record<string, unknown>, policy: ContextRequestPolicy | undefined,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!policy) return body;
    return admitProviderRequest(body as Record<string, unknown> & { messages: CountableChatMessage[];
        tools?: unknown[]; max_tokens?: number }, policy, countTokensApprox, signal, async (request) => {
            const { messages, ...configuration } = request;
            return estimateMeasuredChatRequest({ model: typeof request.model === 'string' ? request.model : '',
                messages, tools: request.tools, modalities: Array.isArray(request.modalities) ? request.modalities as string[] : undefined,
                configuration, usage: policy.measuredUsage, countText: countTokensApprox });
        });
}

export function contextAdmissionResponse(error: ChatContextAdmissionError) {
    return { code: error.code, error: error.message, retryable: false };
}

/** OR3 routing fields are not provider configuration or billable request input. */
export function withoutOr3RequestMetadata(body: Record<string, unknown>): Record<string, unknown> {
    const providerBody = { ...body };
    for (const key of ['_background', '_threadId', '_messageId', '_backgroundAdmissionId', '_backgroundMode',
        '_toolRuntime', '_clientDeviceId', '_streamedFieldMode', '_history', '_context']) delete providerBody[key];
    return providerBody;
}
