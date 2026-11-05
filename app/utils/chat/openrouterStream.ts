/** OpenRouter foreground streaming, with compatibility exports for host jobs. */
import { useRuntimeConfig } from '#imports';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { captureUsagePrefix, attachRequestUsage } from '~~/shared/chat/request-usage';
import { captureContextEnvelope, ChatContextAdmissionError } from '~~/shared/chat/context-budget';
import { countTokensApprox } from './tokens';
import { normalizeError, presentError, parseRetryAfter } from '~~/shared/errors';
import type { ORStreamEvent } from '~~/shared/openrouter/parseOpenRouterSSE';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import { createOpenRouterStreamAdapter } from '~~/shared/openrouter/adapter';
import { decodeOpenAiResponseStream } from '~~/shared/openai/responses';
import { withIdleWatchdog } from '~~/shared/openrouter/deadlines';
import { isOpenAiModel } from '~~/shared/openai/models';
import { openAiKeyHeaders } from '~/core/auth/useOpenAiKey';
import { createAiRuntime } from '~~/shared/ai/runtime';
import { normalizeOpenAiUsage } from '~~/shared/ai/events';
import { OpenRouterStreamError, normalizeProviderResponseError } from '~~/shared/openrouter/errors';
import { sensitiveValueMetadata } from '~~/shared/logging/sensitive-metadata';
import { abortableDelay, fetchWithResponseDeadline, OpenRouterTimeoutError,
    readResponseTextWithIdleDeadline } from '~~/shared/openrouter/deadlines';
import { sendWithAffordableReply } from '~~/shared/openrouter/credit-retry';
import { isServerRouteAvailable, isMissingServerRoute, setServerRouteAvailable, assertDispatchOwner } from './server-route';
import { prepareOpenRouterDispatch, type OpenRouterStreamParams, type OpenRouterRequestBody } from './openrouter-request';

export { buildOpenRouterRequestBody, prepareOpenRouterRequest } from './openrouter-request';
export type { OpenRouterStreamParams } from './openrouter-request';
export type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';
export * from './background-job-transport';

export async function* openRouterStream(params: OpenRouterStreamParams): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, signal } = params;
    const hasApiKey = Boolean(apiKey);
    const runtimeConfig = useRuntimeConfig() as {
        public: {
            ssrAuthEnabled?: boolean;
            backgroundStreaming?: { enabled?: boolean };
            openRouter?: { baseUrl?: string };
        };
    };
    const openRouterChatUrl = getOpenRouterChatCompletionsUrl(
        runtimeConfig.public.openRouter?.baseUrl
    );
    const allowClientFallback = hasApiKey === true && runtimeConfig.public.ssrAuthEnabled !== true;
    const isSsrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
    const forceServerRoute = Boolean(
        isSsrAuthEnabled
    );

    const { hostBody: body, providerBody } = await prepareOpenRouterDispatch(params);
    if (params.contextPolicy) body._context = captureContextEnvelope({ ...params.contextPolicy,
        requestedCompletionTokens: params.contextPolicy.requestedCompletionTokens ?? params.maxCompletionTokens });

    if (params.threadId) {
        body._threadId = params.threadId;
    }
    if (params.messageId) {
        body._messageId = params.messageId;
    }

    // This is the actual provider request boundary. Freeze the serialized body
    // before asynchronous provenance work so later view/tool mutations cannot
    // change the sent prefix after its fingerprint was captured.
    const requestSnapshot = JSON.parse(JSON.stringify(body)) as OpenRouterRequestBody;
    const usageRequestId = createRuntimeUuid();
    let recordRequestState: ((state: 'dispatched' | 'accepted' | 'failed') => Promise<void>) | undefined;
    await assertDispatchOwner(params);
    if (params.projectContext && params.threadId && !params.messageId) {
        const { captureProjectOperation, finalizeProjectReceipt } = await import('~/utils/projects/context');
        const { resolveChatProject } = await import('~/db/project-workspace');
        const scope = captureProjectOperation(signal, params.threadId);
        if (scope.workspaceId !== params.projectContext.workspaceId || await resolveChatProject(scope.db, params.threadId) !== params.projectContext.projectId) throw new Error('Project changed while preparing the handoff.');
        scope.assertCurrent();
        params.onProjectContext?.(finalizeProjectReceipt(params.projectContext, requestSnapshot.messages), []);
    }
    if (params.projectContext && params.threadId && params.messageId) {
        const { captureProjectOperation, finalizeProjectReceipt } = await import('~/utils/projects/context');
        const { resolveChatProject } = await import('~/db/project-workspace');
        const { patchMessageInDb } = await import('~/db/messages');
        const scope = captureProjectOperation(signal, params.threadId);
        if (scope.workspaceId !== params.projectContext.workspaceId || await resolveChatProject(scope.db, params.threadId) !== params.projectContext.projectId)
            throw new Error('This chat changed workspace or project. Start a new turn.');
        let receipt = finalizeProjectReceipt(params.projectContext, requestSnapshot.messages);
        const previous = await scope.db.messages.get(params.messageId);
        const prior = (previous?.data as Record<string, unknown> | undefined)?.project_context_iterations;
        const iterations: unknown[] = Array.isArray(prior) ? prior : [];
        if (iterations.length >= 32) throw new Error('Project request iteration limit reached. Continue in a new chat.');
        const { ProjectContextIterationSchema } = await import('~~/shared/projects/workspace');
        const previousSources = new Map<string, { revision: string; state: string }>();
        const previousChats = new Map<string, string>();
        for (const iteration of iterations) {
            const parsed = ProjectContextIterationSchema.safeParse(iteration);
            if (!parsed.success) continue;
            for (const source of parsed.data.source_changes) previousSources.set(source.id, source);
            for (const chat of parsed.data.chat_changes) previousChats.set(chat.id, chat.state);
        }
        const iteration = { project_id: receipt.project_id, request_id: usageRequestId, request_state: 'prepared' as const,
            instructions: receipt.instructions_included ?? Boolean(receipt.instructions), brief: receipt.brief_included ?? Boolean(receipt.brief), memory_count: receipt.memories.length,
            source_changes: receipt.sources.filter(source => {
                const previous = previousSources.get(source.id);
                return previous ? previous.revision !== source.revision || previous.state !== source.state : source.state !== 'available';
            }).map(source => ({ id: source.id, revision: source.revision, state: source.state })),
            chat_changes: (receipt.chats ?? []).filter(chat => previousChats.get(chat.message_id) !== chat.state).map(chat => ({ id: chat.message_id, state: chat.state })) };
        const history = [...iterations, iteration];
        receipt = finalizeProjectReceipt(params.projectContext, requestSnapshot.messages,
            new TextEncoder().encode(JSON.stringify(history)).byteLength);
        const metadata = { project_context: receipt, project_context_iterations: history };
        await patchMessageInDb(scope.db, params.messageId, { data: metadata }, undefined, message => {
            scope.assertCurrent('write'); return Boolean(message && !message.deleted && message.thread_id === params.threadId);
        });
        scope.assertCurrent();
        params.onProjectContext?.(receipt, metadata.project_context_iterations);
        recordRequestState = async request_state => {
            scope.assertCurrent('write');
            if (await resolveChatProject(scope.db, params.threadId!) !== receipt.project_id)
                throw new Error('Project changed before recording dispatch.');
            const message = await scope.db.messages.get(params.messageId!);
            const current = (message?.data as Record<string, unknown> | undefined)?.project_context_iterations;
            if (!Array.isArray(current) || current.at(-1)?.request_id !== usageRequestId)
                throw new Error('The project request was replaced.');
            const savedIterations: unknown[] = current;
            const next = [...savedIterations.slice(0, -1), { ...(savedIterations.at(-1) as Record<string, unknown>), request_state }];
            await patchMessageInDb(scope.db, params.messageId!, { data: { project_context_iterations: next } }, undefined, row => {
                scope.assertCurrent('write');
                return Boolean(row && !row.deleted && row.thread_id === params.threadId
                    && JSON.stringify((row.data as Record<string, unknown>).project_context_iterations) === JSON.stringify(current));
            });
            scope.assertCurrent();
            params.onProjectContext?.(receipt, next);
        };
    }
    const providerSnapshot = JSON.parse(JSON.stringify(providerBody)) as OpenRouterRequestBody;
    const streamAdapter = isOpenAiModel(providerSnapshot.model) ? {
        id: 'openai', prepare: (request: typeof providerSnapshot) => request,
        async *decodeStream(response: Response) {
            if (!response.body) throw new Error('OpenAI response has no stream');
            yield* decodeOpenAiResponseStream(withIdleWatchdog(response.body, { signal, timeoutMs: params.idleTimeoutMs }));
        },
    } : createOpenRouterStreamAdapter<typeof providerSnapshot>({
        signal, idleTimeoutMs: params.idleTimeoutMs, streamedFieldMode: params.streamedFieldMode,
    });
    const runtime = createAiRuntime(streamAdapter, openPreparedProvider);
    const { messages: _messages, ...providerConfiguration } = providerSnapshot;
    const usagePrefix = await captureUsagePrefix({ model: providerSnapshot.model, messages: providerSnapshot.messages,
        tools: providerSnapshot.tools, modalities: providerSnapshot.modalities, configuration: providerConfiguration,
        countText: countTokensApprox }).catch(() => undefined);
    const recordFailure = async () => {
        try { await recordRequestState?.('failed'); }
        catch (error) { console.warn('[projects] Could not record failed dispatch', error); }
    };
    // Admission (ownership, workspace/project scope) refuses before any network
    // I/O. The refusal is final for this payload, so it must not be retried or
    // reported as a connection problem.
    const admitDispatch = async (assertOwnerFirst = false) => {
        try {
            if (assertOwnerFirst) await assertDispatchOwner(params);
            await recordRequestState?.('dispatched');
            await assertDispatchOwner(params);
        } catch (error) {
            if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            throw new OpenRouterStreamError(
                error instanceof Error ? error.message : String(error),
                { status: 0, retryable: false, kind: 'admission' }
            );
        }
    };
    const transportRequest = async (url: string, init: RequestInit) => {
        try {
            const response = await fetchWithResponseDeadline(url, init, { signal, timeoutMs: params.responseTimeoutMs });
            try { await recordRequestState?.(response.ok && response.body ? 'accepted' : 'failed'); }
            catch (error) {
                // A refused turn must not leave the provider stream generating unseen tokens.
                await response.body?.cancel().catch(() => undefined);
                throw error;
            }
            return response;
        } catch (error) { await recordFailure(); throw error; }
    };
    const dispatchRequest = async (url: string, init: RequestInit) => {
        await admitDispatch();
        return await transportRequest(url, init);
    };
    let providerAccepted = false;
    // A successful upstream response is the provider's receipt; reasoning
    // models may send no event until their answer starts.
    const acceptProvider = () => {
        if (!providerAccepted && !signal?.aborted) { providerAccepted = true; params.onProviderAccepted?.(); }
    };
    const measuredEvent = (event: ORStreamEvent): ORStreamEvent => {
        acceptProvider();
        if (event.type !== 'usage') return event;
        const usage = normalizeOpenAiUsage(event.usage, providerSnapshot.model);
        return { ...event, usage, requestUsage: attachRequestUsage(usagePrefix, usage,
            { requestId: usageRequestId, iteration: 1, measuredAt: Date.now() }) };
    };

    let streamCredentialSource: 'server' | 'personal' | undefined;
    let streamOpened = false;

    async function openPreparedProvider(preparedBody: typeof providerSnapshot): Promise<Response> {
        // Req 3, 5, 6: Try server route first (/api/openrouter/stream) if available.
        // Only an unmarked 404/405 proves the route is absent. A transport failure
        // can use the optional fallback while online, but cannot poison discovery.
        if (forceServerRoute || isServerRouteAvailable()) {
            let serverResp: Response | undefined;
            let networkError: Error | undefined;

            await admitDispatch(true);
            try {
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'x-or3-cloud-intent': 'mutation',
                };
                if (hasApiKey && !isSsrAuthEnabled) {
                    headers['x-or3-openrouter-key'] = apiKey as string;
                }
                Object.assign(headers, await openAiKeyHeaders(preparedBody.model));
                serverResp = await transportRequest('/api/openrouter/stream', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestSnapshot),
                });
            } catch (e) {
                if (
                    signal?.aborted ||
                    (e instanceof Error && e.name === 'AbortError')
                ) {
                    throw e;
                }
                if (e instanceof OpenRouterTimeoutError) throw e;
                networkError = e instanceof Error ? e : new Error(String(e));
            }

            if (serverResp) {
                if (serverResp.ok && serverResp.body) {
                    streamOpened = true;
                    acceptProvider();
                    streamCredentialSource = serverResp.headers.get('x-or3-credential-source') === 'server' ? 'server' : hasApiKey ? 'personal' : undefined;
                    return serverResp; // Success; don't fall back
                }

                if (isMissingServerRoute(serverResp)) {
                    if (forceServerRoute) {
                        throw new OpenRouterStreamError(
                            'OpenRouter server route unavailable in SSR mode (/api/openrouter/stream)',
                            { status: serverResp.status, retryable: false }
                        );
                    }
                    setServerRouteAvailable(false);
                } else {
                    const errorText = await readResponseTextWithIdleDeadline(serverResp, {
                        signal,
                        timeoutMs: params.idleTimeoutMs,
                    }).catch(() => '');
                    let payload: unknown;
                    try { payload = JSON.parse(errorText); } catch { payload = {}; }
                    const metadata = normalizeError({ data: payload, status: serverResp.status,
                        retryAfterMs: parseRetryAfter(serverResp.headers.get('retry-after')) });
                    throw new OpenRouterStreamError(presentError(metadata).message, {
                        ...metadata, status: serverResp.status,
                    });
                }
            } else if (networkError) {
                if (forceServerRoute || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
                    throw new OpenRouterStreamError(networkError.message, {
                        status: 0,
                        retryable: true,
                    });
                }
            }
        }

        // The OpenAI key stays with the OR3 server; there is no browser-direct OpenAI path.
        if (isOpenAiModel(preparedBody.model)) {
            throw new OpenRouterStreamError('OpenAI models need the OR3 server. Reload and try again.', {
                status: 503,
                retryable: true,
            });
        }
        if (!hasApiKey) {
            throw new OpenRouterStreamError('Missing OpenRouter API key', {
                status: 400,
                retryable: false,
            });
        }

        // Fallback: direct OpenRouter (legacy path)
        const fallbackBody = preparedBody;

        let resp: Response;
        let refusedText: string | undefined;
        try {
            ({ response: resp, errorText: refusedText } = await sendWithAffordableReply((requestBody) => dispatchRequest(openRouterChatUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer':
                        (typeof location !== 'undefined' && location.origin) ||
                        'https://or3.chat',
                    'X-Title': 'or3.chat',
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify(requestBody),
            }), fallbackBody, {
                defaultAllowance: !!params.contextPolicy
                    && (params.contextPolicy.requestedCompletionTokens ?? params.maxCompletionTokens) == null,
                signal,
            }));
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') throw error;
            if (error instanceof OpenRouterStreamError) throw error;
            throw new OpenRouterStreamError(
                error instanceof Error ? error.message : 'OpenRouter network request failed',
                { status: 0, retryable: true, kind: 'transport' }
            );
        }

        if (!resp.ok || !resp.body) {
            // Read response text for diagnostics
            let respText = refusedText ?? '<no-body>';
            if (refusedText === undefined) try {
                respText = await readResponseTextWithIdleDeadline(resp, {
                    signal,
                    timeoutMs: params.idleTimeoutMs,
                });
            } catch (readErr) {
                respText = `<error-reading-body:${
                    readErr instanceof Error ? readErr.message : 'err'
                }>`;
            }

            console.warn('[openrouterStream] OpenRouter request failed', {
                status: resp.status,
                statusText: resp.statusText,
                responseMetadata: sensitiveValueMetadata(respText),
                requestMetadata: sensitiveValueMetadata(JSON.stringify(fallbackBody)),
            });

            const metadata = normalizeProviderResponseError(respText, resp.status, { credentialSource: 'personal' });
            throw new OpenRouterStreamError(
                presentError(metadata).message,
                { ...metadata, status: resp.status, retryAfterMs: parseRetryAfter(resp.headers.get('retry-after')) }
            );
        }

        streamOpened = true;
        acceptProvider();
        streamCredentialSource = 'personal';
        return resp;
    }

    try {
        for await (const event of runtime.streamPrepared(providerSnapshot)) yield measuredEvent(event);
    } catch (error) {
        if (streamOpened) {
            await recordFailure();
            if (error instanceof OpenRouterStreamError) error.credentialSource = streamCredentialSource;
        }
        throw error;
    }
}

/**
 * `openRouterStreamWithRetry`
 *
 * Purpose:
 * Wraps `openRouterStream` with automatic retry for transient connection
 * failures. Retries only before the first streamed event is yielded; once
 * bytes start flowing, mid-stream errors propagate so the caller can preserve
 * partial state.
 *
 * Behavior:
 * - Retries 429 (with Retry-After), 5xx, and network errors up to `maxRetries`
 * - Caps per-retry wait at `maxRetryAfterMs` (default 5s)
 * - Non-retryable errors (4xx except 429, AbortError) propagate immediately
 */
export async function* openRouterStreamWithRetry(
    params: Parameters<typeof openRouterStream>[0] & {
        maxRetries?: number;
        maxRetryAfterMs?: number;
    }
): AsyncGenerator<ORStreamEvent, void, unknown> {
    const {
        maxRetries = 2,
        maxRetryAfterMs = 5000,
        ...streamParams
    } = params;
    const baseDelayMs = 500;
    let lastError: OpenRouterStreamError | undefined;
    /**
     * Once any event has been handed to the consumer, automatic replay is
     * forbidden: a retry would duplicate output. Mid-stream recovery is owned
     * by the explicit checkpoint/attempt mechanism instead.
     */
    let yieldedAnyEvent = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const stream = openRouterStream(streamParams);
            const iterator = stream[Symbol.asyncIterator]();
            try {
                const first = await iterator.next();
                if (first.done) {
                    return;
                }
                yieldedAnyEvent = true;
                yield first.value;
                // First event succeeded; drain the rest without retry to avoid duplicates.
                for (;;) {
                    const next = await iterator.next();
                    if (next.done) return;
                    yield next.value;
                }
            } finally {
                // Manual next() forwarding does not close the inner generator
                // when the outer consumer breaks or returns early.
                await iterator.return();
            }
        } catch (e) {
            // Local admission is a final decision for this exact full payload;
            // preserve its structured reason and never treat it as transport.
            if (e instanceof ChatContextAdmissionError) throw e;
            const error =
                e instanceof OpenRouterStreamError
                    ? e
                    : new OpenRouterStreamError(
                          e instanceof Error ? e.message : String(e),
                          {
                              status: 0,
                              retryable:
                                  !(e instanceof Error) ||
                                  e.name !== 'AbortError',
                          }
                      );
            lastError = error;
            if (
                yieldedAnyEvent ||
                !error.retryable ||
                attempt >= maxRetries
            ) {
                throw error;
            }
            const delayMs = Math.min(
                error.retryAfterMs ?? baseDelayMs * 2 ** attempt,
                maxRetryAfterMs
            );
            await abortableDelay(delayMs, streamParams.signal);
        }
    }

    throw (
        lastError ??
        new OpenRouterStreamError('OpenRouter stream failed', {
            status: 0,
            retryable: true,
        })
    );
}

// ============================================================
// BACKGROUND STREAMING (SSR mode only)
// ============================================================
