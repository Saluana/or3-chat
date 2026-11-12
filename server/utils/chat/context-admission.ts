import { createHash } from 'node:crypto';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import { openRouterCatalogLookupId } from '~~/shared/openrouter/selection';
import { admitProviderRequest, ChatContextAdmissionError, type ContextRequestPolicy,
    type CountableChatMessage } from '~~/shared/chat/context-budget';
import { countTokensApprox } from '~/utils/chat/tokens';
import { estimateMeasuredChatRequest } from '~~/shared/chat/request-usage';
import { encodeProviderRequest } from '~~/shared/ai/provider-body';
import { fetchOpenAiCatalog, isOpenAiModel } from '~~/shared/openai/models';
import { useRuntimeConfig } from '#imports';

/** The send waits on this lookup; a provider that never answers must not hold it open. */
const CATALOG_DEADLINE_MS = 15_000;

/**
 * A send and its background job each need one model's capacity, but the only
 * source is the full catalog (~840 KB, 0.5–1 s on an idle connection). The
 * catalog differs per API key (account guardrails filter it), so the chosen
 * model is cached per key hash, never shared across keys. Only a found model
 * is cached: a missing one always re-reads the live catalog.
 */
const MODEL_CACHE_TTL_MS = 5 * 60_000;
const MODEL_CACHE_MAX_ENTRIES = 500;
const modelCache = new Map<string, { at: number; model: OpenRouterModel }>();

/** Test isolation: fixtures that change the catalog between cases must not see an earlier case's model. */
export function clearOpenRouterModelCache(): void {
    modelCache.clear();
}

function modelCacheKey(apiKey: string, serverURL: string | undefined, lookupId: string): string {
    return `${createHash('sha256').update(`${serverURL ?? ''}\0${apiKey}`).digest('hex')}\0${lookupId}`;
}

function findCatalogModel(catalog: readonly OpenRouterModel[], lookupId: string): OpenRouterModel | undefined {
    return catalog.find((candidate) => candidate.id === lookupId)
        ?? catalog.find((candidate) => candidate.canonical_slug === lookupId);
}

/** Normalizes as a retry-later provider failure (`ERR_PROVIDER`), never as missing model metadata. */
export class OpenRouterCatalogUnavailableError extends Error {
    readonly status = 502;
    readonly source = 'provider' as const;
    readonly retryable = false;
    constructor(cause: unknown) {
        super('The OpenRouter model catalog could not be reached.', { cause });
        this.name = 'OpenRouterCatalogUnavailableError';
    }
}

/** Use one live catalog snapshot for both model choice and context admission. */
export function contextPolicyFromCatalog(body: Record<string, unknown>, catalog: readonly OpenRouterModel[]): ContextRequestPolicy | undefined {
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
    const lookupId = openRouterCatalogLookupId(selectedModel);
    const model = findCatalogModel(catalog, lookupId);
    if (!model) throw new ChatContextAdmissionError({ ok: false, code: 'model_metadata_unavailable' });
    return Object.freeze({ model: Object.freeze({ context_length: model.context_length,
        top_provider: model.top_provider ? Object.freeze({ context_length: model.top_provider.context_length,
            max_completion_tokens: model.top_provider.max_completion_tokens }) : undefined }), source: 'openrouter-live', userMaxContextTokens: userMaximum,
        requestedCompletionTokens: requestedCompletion });
}

/** New native requests carry only user choices. Legacy payloads retain their existing boundary. */
export async function resolveServerContextPolicy(body: Record<string, unknown>, apiKey: string,
    serverURL?: string, signal?: AbortSignal): Promise<ContextRequestPolicy | undefined> {
    if (!('_context' in body)) return undefined;
    // Validate the envelope before a network request, preserving the admission boundary.
    if (!body._context || typeof body._context !== 'object' || Array.isArray(body._context) ||
        (body._context as Record<string, unknown>).version !== 1 || typeof body.model !== 'string' || !Array.isArray(body.messages))
        throw new ChatContextAdmissionError({ ok: false, code: 'model_metadata_unavailable' });
    const openRouter = !isOpenAiModel(body.model);
    const cacheKey = openRouter ? modelCacheKey(apiKey, serverURL, openRouterCatalogLookupId(body.model)) : '';
    const cached = openRouter ? modelCache.get(cacheKey) : undefined;
    if (cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) return contextPolicyFromCatalog(body, [cached.model]);
    let catalog;
    // The model's router supplies its own capacity metadata.
    try { catalog = !openRouter ? await fetchOpenAiCatalog(apiKey, useRuntimeConfig().openaiBaseUrl, signal)
        : await fetchOpenRouterCatalog(createOpenRouterClient({ apiKey, serverURL }), signal, { deadlineMs: CATALOG_DEADLINE_MS }); }
    catch (error) {
        if (signal?.aborted) throw error;
        throw new OpenRouterCatalogUnavailableError(error);
    }
    const policy = contextPolicyFromCatalog(body, catalog);
    const model = openRouter ? findCatalogModel(catalog, openRouterCatalogLookupId(body.model)) : undefined;
    if (model) {
        modelCache.delete(cacheKey);
        modelCache.set(cacheKey, { at: Date.now(), model });
        if (modelCache.size > MODEL_CACHE_MAX_ENTRIES) modelCache.delete(modelCache.keys().next().value!);
    }
    return policy;
}

export async function admitServerProviderBody(body: Record<string, unknown>, policy: ContextRequestPolicy | undefined,
    signal?: AbortSignal): Promise<{ hostBody: Record<string, unknown>; providerBody: Record<string, unknown> }> {
    // Keep the host envelope intact for authorization and persisted jobs, but
    // admit the exact provider-visible model and search-tool configuration.
    const providerBody = encodeProviderRequest({ ...body }) as Record<string, unknown> & { messages: CountableChatMessage[];
        tools?: unknown[]; max_tokens?: number };
    if (!policy) return { hostBody: body, providerBody };
    const admitted = await admitProviderRequest(providerBody as Record<string, unknown> & { messages: CountableChatMessage[];
        tools?: unknown[]; max_tokens?: number }, policy, countTokensApprox, signal, async (request) => {
            const { messages, ...configuration } = request;
            return estimateMeasuredChatRequest({ model: typeof request.model === 'string' ? request.model : '',
                messages, tools: request.tools, modalities: Array.isArray(request.modalities) ? request.modalities as string[] : undefined,
                configuration, usage: policy.measuredUsage, countText: countTokensApprox });
        });
    body.max_tokens = admitted.max_tokens;
    return { hostBody: body, providerBody: admitted };
}

export function contextAdmissionResponse(error: ChatContextAdmissionError) {
    return { code: error.code, error: error.message, retryable: false };
}

/** OR3 routing fields are not provider configuration or billable request input. */
export function withoutOr3RequestMetadata(body: Record<string, unknown>): Record<string, unknown> {
    const providerBody = { ...body };
    for (const key of ['_background', '_threadId', '_messageId', '_backgroundAdmissionId', '_backgroundMode',
        '_toolRuntime', '_clientDeviceId', '_streamedFieldMode', '_history', '_context', '_delegationDefaults', '_durableDelegation']) delete providerBody[key];
    return providerBody;
}
