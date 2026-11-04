/**
 * Host model client for plugin-attributed AI calls: OpenRouter by default, and
 * the direct OpenAI router for `@openai/` models.
 *
 * Reuses the host's existing router configuration (base URL and instance key)
 * so plugins never receive a credential, and keeps a bounded, cancellable
 * request with a hard output ceiling. Each model's request and key go only to
 * its own router.
 *
 * The deadline and the caller's cancellation are combined into the signal that
 * fetch (and the body read) actually use, the response is read through a byte
 * ceiling instead of being buffered, and usage must be present and usable: an
 * unreconcilable call fails closed rather than being recorded as free.
 */

import { readBoundedBody, combineWithDeadline } from '../connections/bounded-body';
import { createAiRuntime } from '~~/shared/ai/runtime';
import { createOpenRouterCompletionAdapter } from '~~/shared/openrouter/adapter';
import { createOpenAiCompletionAdapter } from '~~/shared/openai/adapter';
import { isOpenAiModel, openAiApiUrl } from '~~/shared/openai/models';
import { isUsablePluginModelPrice } from '~~/shared/plugins/ai/model-catalog';
import type {
    ModelPrice,
    ModelPriceTable,
} from '~~/shared/plugins/ai/plugin-usage';
import type {
    PluginAiCompletionRequest,
    PluginAiCompletionResult,
    PluginAiProvider,
} from './plugin-invocation';

export interface OpenRouterPluginProviderOptions {
    /** OpenRouter's host key; absent when no allowed model needs it. */
    readonly apiKey: string | undefined;
    readonly baseUrl: string;
    /** The OpenAI router's host key and base URL, for `@openai/` models. */
    readonly openAi?: { readonly apiKey: string | undefined; readonly baseUrl?: unknown };
    readonly fetchImpl?: typeof fetch;
    /**
     * Trusted per-model prices. A model without a usable price is refused, so a
     * paid call can never be accounted as free.
     */
    readonly prices: ModelPriceTable;
    /** Response ceiling for one completion (bytes). */
    readonly maxResponseBytes?: number;
}

export const DEFAULT_AI_MAX_RESPONSE_BYTES = 1024 * 1024;

export function resolveModelPrice(
    prices: ModelPriceTable,
    model: string
): ModelPrice | null {
    const price = prices[model];
    // One canonical usable-price predicate, shared with the catalog and the
    // governor: all-zero prices would be accounted as free and are refused.
    return isUsablePluginModelPrice(price) ? price : null;
}

function nonNegativeInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return Math.trunc(value);
}

export function createOpenRouterPluginProvider(
    options: OpenRouterPluginProviderOptions
): PluginAiProvider {
    const fetchImpl = options.fetchImpl ?? fetch;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_AI_MAX_RESPONSE_BYTES;

    return {
        async complete(
            request: PluginAiCompletionRequest,
            context
        ): Promise<PluginAiCompletionResult> {
            const openAi = isOpenAiModel(request.model);
            const apiKey = openAi ? options.openAi?.apiKey : options.apiKey;
            if (!apiKey) {
                throw new Error('No host model provider credential is configured');
            }
            const price = resolveModelPrice(options.prices, request.model);
            if (!price) {
                throw Object.assign(
                    new Error(
                        `No trusted price is configured for model ${request.model}; refusing to spend`
                    ),
                    { rpcCode: 'policy-denied' }
                );
            }

            const deadline = combineWithDeadline({
                ...(context.signal === undefined ? {} : { signal: context.signal }),
                timeoutMs: context.timeoutMs,
            });

            try {
                const runtime = createAiRuntime(openAi ? createOpenAiCompletionAdapter() : createOpenRouterCompletionAdapter(), async prepared => {
                    const response = await fetchImpl(
                        openAi
                            ? openAiApiUrl(options.openAi?.baseUrl, 'chat/completions')
                            : `${options.baseUrl.replace(/\/$/, '')}/chat/completions`,
                        {
                            method: 'POST',
                            redirect: 'error',
                            headers: {
                                authorization: `Bearer ${apiKey}`,
                                'content-type': 'application/json',
                            },
                            signal: deadline.signal,
                            body: JSON.stringify(prepared),
                        }
                    );
                    if (!response.ok) {
                        try { await response.body?.cancel(); } catch { /* Nothing to release. */ }
                        throw new Error(`Model provider returned ${response.status}`);
                    }
                    const bounded = await readBoundedBody(response, { maxBytes: maxResponseBytes });
                    if (!bounded.ok) throw new Error(bounded.message);
                    return new Response(bounded.text);
                });
                let result;
                try { result = await runtime.complete({ model: { routerId: openAi ? 'openai' : 'openrouter', modelId: request.model },
                    messages: [{ role: 'user', content: request.prompt }], maxOutputTokens: request.maxOutputTokens }); }
                catch (error) {
                    if (error instanceof SyntaxError) throw new Error('Model provider returned an unreadable response');
                    throw error;
                }
                const text = typeof result.content === 'string' ? result.content : '';
                const usage = result.usage && typeof result.usage === 'object'
                    ? result.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } : undefined;
                const promptTokens = nonNegativeInteger(usage?.prompt_tokens);
                const completionTokens = nonNegativeInteger(usage?.completion_tokens);
                if (promptTokens === null || completionTokens === null) {
                    // Without usable usage the spend cannot be reconciled.
                    throw Object.assign(
                        new Error('Model provider did not report usable token usage; the call cannot be accounted'),
                        { rpcCode: 'internal' }
                    );
                }

                const spendUsd =
                    (promptTokens / 1_000_000) * price.promptPerMillion +
                    (completionTokens / 1_000_000) * price.completionPerMillion;

                return {
                    text,
                    model: request.model,
                    promptTokens,
                    completionTokens,
                    spendUsd,
                };
            } catch (error) {
                if (deadline.timedOut()) {
                    throw new Error('Model provider call exceeded its deadline');
                }
                throw error;
            } finally {
                deadline.dispose();
            }
        },
    };
}
