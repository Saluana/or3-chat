import { createRuntimeUuid } from '~~/shared/runtime-id';
import { captureUsagePrefix, attachRequestUsage, estimateMeasuredChatRequest } from '~~/shared/chat/request-usage';
import { readRequestUsage, type RequestUsage } from '~~/shared/chat/compaction';
import { countTokensApprox } from './tokens';
import { admitProviderRequest, captureContextEnvelope, ChatContextAdmissionError, type ContextRequestPolicy, type ContextRequestEnvelope } from '~~/shared/chat/context-budget';
import { normalizeError, presentError, parseRetryAfter } from '~~/shared/errors';
/**
 * @module app/utils/chat/openrouterStream
 *
 * Purpose:
 * Implements OpenRouter streaming and SSR background streaming utilities.
 *
 * Behavior:
 * - Tries server route streaming first when available
 * - Falls back to direct OpenRouter streaming when allowed
 * - Supports SSR background streaming jobs with polling and SSE helpers
 *
 * Constraints:
 * - Server routes are required when SSR auth is enabled and no client key is available
 * - Client fallback requires an API key
 */

import { useRuntimeConfig } from '#imports';
import type { ToolDefinition, ToolChoice } from './types';
import type { WorkflowMessageData } from './workflow-types';
import {
    parseOpenRouterSSE,
    type ORStreamEvent,
    type StreamedFieldMode,
} from '~~/shared/openrouter/parseOpenRouterSSE';
import { getOpenRouterChatCompletionsUrl } from '~~/shared/openrouter/url';
import { PROJECT_MEMORY_HEADING } from '~~/shared/projects/workspace';
import { OpenRouterStreamError, normalizeProviderResponseError } from '~~/shared/openrouter/errors';
import {
    getAnthropicPromptCacheControl,
    type OpenRouterCacheControl,
} from '~~/shared/openrouter/request';
import type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';
import { sensitiveValueMetadata } from '~~/shared/logging/sensitive-metadata';
import {
    abortableDelay,
    DEFAULT_BACKGROUND_START_TIMEOUT_MS,
    fetchWithResponseDeadline,
    OpenRouterTimeoutError,
    readResponseJsonWithIdleDeadline,
    readResponseTextWithIdleDeadline,
    withIdleWatchdog,
} from '~~/shared/openrouter/deadlines';
import { sendWithAffordableReply } from '~~/shared/openrouter/credit-retry';
import { getDeviceId } from '~/core/sync/hlc';
import type { ORContentPart, ORMessage as BuiltMessage } from '~/core/auth/openrouter-build';

function parseRetryAfterSeconds(value: string): number {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
    // Retry-After may also be an HTTP-date string; for our budget we treat
    // unparseable values as a small default.
    return 1;
}

export type BackgroundPollFailureKind =
    | 'transport'
    | 'rate_limit'
    | 'server'
    | 'not_found'
    | 'auth'
    | 'protocol';

export class BackgroundJobPollError extends Error {
    constructor(
        message: string,
        readonly kind: BackgroundPollFailureKind,
        readonly retryable: boolean,
        readonly statusCode?: number,
        readonly retryAfterMs?: number
    ) {
        super(message);
        this.name = 'BackgroundJobPollError';
    }
}

// NOTE: The OpenRouter SDK supports streaming, but this module uses raw fetch
// so we can keep one shared SSE parser for both direct and proxied/server routes.

type ORMessagePart = ORContentPart | { type: string; [key: string]: unknown };

// Permissive message type that accepts both strict ORMessage from openrouter-build
// and tool messages. Content is optional for tool role messages.
type ORMessage = BuiltMessage | {
    role: string;
    content?: string | ORMessagePart[];
    name?: string;
    tool_call_id?: string;
    [key: string]: unknown;
};

export type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';

interface ServerRouteCacheEntry {
    available: boolean;
    timestamp: number;
}

type OpenRouterRequestBody = {
    model: string;
    messages: ORMessage[];
    modalities?: string[];
    stream: true;
    max_tokens?: number;
    reasoning?: OpenRouterReasoningConfig;
    cache_control?: OpenRouterCacheControl;
    tools?: ToolDefinition[];
    tool_choice?: ToolChoice;
    _background?: true;
    _threadId?: string;
    _messageId?: string;
    _toolRuntime?: Record<string, string>;
    _clientDeviceId?: string;
    _streamedFieldMode?: StreamedFieldMode;
    _context?: ContextRequestEnvelope;
};

// Cache key for detecting static build (no server routes)
const SERVER_ROUTE_AVAILABLE_CACHE_KEY = 'or3:server-route-available';
const SERVER_ROUTE_AVAILABLE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if server routes are available (not a static build).
 * Uses localStorage to cache the result to avoid repeated 404 attempts.
 * Includes a TTL so transient failures are periodically retried.
 */
function isServerRouteAvailable(): boolean {
    if (typeof localStorage === 'undefined') return false;

    const cached = localStorage.getItem(SERVER_ROUTE_AVAILABLE_CACHE_KEY);
    if (cached === null) {
        // First time; assume available
        return true;
    }

    try {
        const parsed: unknown = JSON.parse(cached);
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'available' in parsed &&
            'timestamp' in parsed &&
            typeof (parsed as ServerRouteCacheEntry).available === 'boolean' &&
            typeof (parsed as ServerRouteCacheEntry).timestamp === 'number'
        ) {
            const { available, timestamp } = parsed as ServerRouteCacheEntry;
            const now = Date.now();
            const isExpired = now - timestamp > SERVER_ROUTE_AVAILABLE_TTL_MS;

            if (isExpired) {
                // TTL expired; retry the server route
                return true;
            }

            return available;
        }
        // Invalid shape; assume available
        return true;
    } catch {
        // Invalid cache; assume available
        return true;
    }
}

/**
 * A 404/405 only means the stream route is absent when the route did not
 * answer itself. The route marks every response (including relayed provider
 * errors such as "No endpoints found that support image input").
 */
function isMissingServerRoute(response: Response): boolean {
    return (response.status === 404 || response.status === 405)
        && response.headers.get('x-or3-stream-route') !== '1';
}

/**
 * Mark server routes as available or unavailable with TTL.
 */
function setServerRouteAvailable(available: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
        SERVER_ROUTE_AVAILABLE_CACHE_KEY,
        JSON.stringify({
            available,
            timestamp: Date.now(),
        })
    );
}

function stripUiMetadata(tool: ToolDefinition): ToolDefinition {
    const { ui: _ui, runtime: _runtime, ...rest } = tool as ToolDefinition & {
        ui?: Record<string, unknown>;
        runtime?: string;
    };
    return {
        ...rest,
        function: {
            ...tool.function,
            parameters: { ...tool.function.parameters },
        },
    };
}

/**
 * `openRouterStream`
 *
 * Purpose:
 * Streams OpenRouter responses as SSE events.
 */
async function assertDispatchOwner(params: {
    expectedProjectId?: string | null;
    threadId?: string;
    signal?: AbortSignal;
}) {
    if (params.expectedProjectId === undefined || !params.threadId) return;
    const { captureProjectOperation } = await import('~/utils/projects/context');
    const { resolveChatProject } = await import('~/db/project-workspace');
    const scope = captureProjectOperation(params.signal, params.threadId);
    if (await resolveChatProject(scope.db, params.threadId) !== params.expectedProjectId)
        throw new Error('This chat changed projects before dispatch. Start a new turn.');
    scope.assertCurrent();
}

export type OpenRouterStreamParams = {
    expectedProjectId?: string | null;
    onProjectContext?: (receipt: import('~~/shared/projects/workspace').ProjectContextReceipt, iterations: unknown[]) => void;
    projectContext?: import('~/utils/projects/types').ProjectContextSnapshot | null;
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities?: string[];
    threadId?: string;
    messageId?: string;
    tools?: ToolDefinition[];
    maxCompletionTokens?: number;
    toolChoice?: ToolChoice;
    signal?: AbortSignal;
    reasoning?: OpenRouterReasoningConfig;
    /** How the selected provider emits streamed tool name/argument fields. */
    streamedFieldMode?: StreamedFieldMode;
    /** Primarily configurable for deterministic tests and constrained runtimes. */
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
    contextPolicy?: ContextRequestPolicy;
    /** First valid provider event, after initial admission/error handling. */
    onProviderAccepted?: () => void;
};

/** Single provider-body constructor used by admission and dispatch. */
export function buildOpenRouterRequestBody(params: OpenRouterStreamParams): OpenRouterRequestBody {
    const body: OpenRouterRequestBody = { model: params.model, messages: params.orMessages, stream: true };
    if (params.modalities?.length) body.modalities = params.modalities;
    if (params.maxCompletionTokens !== undefined) body.max_tokens = params.maxCompletionTokens;
    if (params.reasoning) body.reasoning = params.reasoning;
    const cacheControl = getAnthropicPromptCacheControl(params.model);
    if (cacheControl) body.cache_control = cacheControl;
    if (params.tools) {
        body.tools = params.tools.map(stripUiMetadata);
        body.tool_choice = params.toolChoice ?? 'auto';
    }
    return JSON.parse(JSON.stringify(body)) as OpenRouterRequestBody;
}

/** Validate the detached, complete provider body; preserve every selected message. */
export async function prepareOpenRouterRequest(params: OpenRouterStreamParams): Promise<OpenRouterRequestBody> {
    const body = buildOpenRouterRequestBody(params);
    if (params.projectContext) {
        const { assertProjectContextIncluded } = await import('~/utils/projects/context');
        assertProjectContextIncluded(params.projectContext, body.messages);
    }
    if (!params.contextPolicy) {
        if (body.max_tokens !== undefined && (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0))
            throw new Error('Reply maximum must be a positive integer.');
        return body;
    }
    const policy = params.contextPolicy;
    const admit = () => admitProviderRequest(body, { ...policy,
        requestedCompletionTokens: policy.requestedCompletionTokens ?? params.maxCompletionTokens },
        countTokensApprox, params.signal, async (request) => {
            const { messages, ...configuration } = request;
            return estimateMeasuredChatRequest({ model: params.model, messages, tools: request.tools,
                modalities: request.modalities, configuration, usage: params.contextPolicy?.measuredUsage,
                countText: countTokensApprox });
        });
    while (true) {
        try { return await admit(); }
        catch (error) {
            if (!(error instanceof ChatContextAdmissionError) || error.code !== 'context_full' || !params.projectContext) throw error;
            const optional = [...(params.projectContext.receipt.chats ?? []).map(chat => chat.message_id),
                ...params.projectContext.receipt.sources.filter(source => !params.projectContext!.requiredSourceIds.includes(source.id)).map(source => source.id)];
            const index = body.messages.findLastIndex(message => {
                const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
                    ? message.content.map(part => 'text' in part ? part.text : '').filter(Boolean).join(' ') : '';
                return message.role === 'user' && params.projectContext!.messages.some(context => (typeof context.content === 'string' ? context.content === text
                    : Array.isArray(context.content) && context.content.some(part => part.type === 'text' && part.text === text)
                        && context.content.every(part => part.type !== 'image' || JSON.stringify(message.content).includes(String(part.image))))
                    && (text.startsWith(`${params.projectContext!.marker}\n${PROJECT_MEMORY_HEADING}`)
                        || optional.some(id => text.startsWith(`${params.projectContext!.marker} Source ${id}:`) || text.startsWith(`${params.projectContext!.marker} Source ${id} `)
                        || text.startsWith(`${params.projectContext!.marker} Previous chat `) && text.includes(`summary ${id}:`))));
            });
            if (index < 0) throw error;
            body.messages.splice(index, 1);
        }
    }
}

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
    const allowClientFallback = hasApiKey === true;
    const isSsrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
    const forceServerRoute = Boolean(
        isSsrAuthEnabled && !allowClientFallback
    );

    const body = await prepareOpenRouterRequest(params);
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
    const { messages: _messages, _threadId: _thread, _messageId: _message, _background: _background, _context: _context, ...providerConfiguration } = requestSnapshot;
    const usagePrefix = await captureUsagePrefix({ model, messages: requestSnapshot.messages,
        tools: requestSnapshot.tools, modalities: requestSnapshot.modalities, configuration: providerConfiguration,
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
    const measuredEvent = (event: ORStreamEvent): ORStreamEvent => {
        if (!providerAccepted && !signal?.aborted) { providerAccepted = true; params.onProviderAccepted?.(); }
        return event.type === 'usage' ? { ...event, requestUsage: attachRequestUsage(usagePrefix, event.usage,
            { requestId: usageRequestId, iteration: 1, measuredAt: Date.now() }) } : event;
    };

    // Req 3, 5, 6: Try server route first (/api/openrouter/stream) if available.
    // Only 404/405 and genuine network failures are treated as "route unavailable";
    // other proxy errors (5xx, 401, 403, etc.) propagate so the caller can retry or
    // surface them instead of silently poisoning the availability cache.
    if (forceServerRoute || isServerRouteAvailable()) {
        let serverResp: Response | undefined;
        let networkError: Error | undefined;

        await admitDispatch(true);
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-or3-cloud-intent': 'mutation',
            };
            if (hasApiKey) {
                headers['x-or3-openrouter-key'] = apiKey as string;
            }
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
                // Server route available; use shared parser on response
                const guardedBody = withIdleWatchdog(serverResp.body, {
                    signal,
                    timeoutMs: params.idleTimeoutMs,
                });
                try {
                for await (const evt of parseOpenRouterSSE(guardedBody, {
                    streamedFieldMode: params.streamedFieldMode,
                })) {
                    yield measuredEvent(evt);
                }
                } catch (error) {
                    await recordFailure();
                    if (error instanceof OpenRouterStreamError) error.credentialSource = serverResp.headers.get('x-or3-credential-source') === 'server' ? 'server' : hasApiKey ? 'personal' : undefined;
                    throw error;
                }
                return; // Success; don't fall back
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
            if (forceServerRoute) {
                throw new OpenRouterStreamError(networkError.message, {
                    status: 0,
                    retryable: true,
                });
            }
            setServerRouteAvailable(false);
        }
    }

    if (!hasApiKey) {
        throw new OpenRouterStreamError('Missing OpenRouter API key', {
            status: 400,
            retryable: false,
        });
    }

    // Fallback: direct OpenRouter (legacy path)
    const fallbackBody = { ...requestSnapshot };
    delete fallbackBody._background;
    delete fallbackBody._threadId;
    delete fallbackBody._messageId;
    delete fallbackBody._context;

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

    // Req 6: Use shared parser on fallback (direct) path to ensure identical behavior
    const guardedBody = withIdleWatchdog(resp.body, {
        signal,
        timeoutMs: params.idleTimeoutMs,
    });
    try {
    for await (const evt of parseOpenRouterSSE(guardedBody, {
        streamedFieldMode: params.streamedFieldMode,
    })) {
        yield measuredEvent(evt);
    }
    } catch (error) {
        await recordFailure();
        if (error instanceof OpenRouterStreamError) error.credentialSource = 'personal';
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

/**
 * Cache key for background streaming availability
 */
const BACKGROUND_STREAMING_CACHE_KEY = 'or3:background-streaming-available';

/**
 * Session-scoped override set when the server explicitly rejects background
 * execution. It beats explicit client config so a mismatched deployment does
 * not cause repeated admissions on every send.
 */
let backgroundStreamingCapabilityDisabled = false;

/**
 * `BackgroundJobStatus`
 *
 * Purpose:
 * Represents background streaming job status from the server.
 */
export interface BackgroundJobStatus {
    id: string;
    status: 'streaming' | 'complete' | 'error' | 'aborted';
    threadId: string;
    messageId: string;
    model: string;
    chunksReceived: number;
    /** Durable execution attempt; increments after a worker takeover. */
    attempt?: number;
    /** Last measured provider request; prompt occupancy is never accumulated. */
    usage?: RequestUsage;
    startedAt: number;
    completedAt?: number;
    error?: string;
    content?: string;
    content_delta?: string;
    content_length?: number;
    /** Full reasoning snapshot when the server provides one. */
    reasoning_text?: string;
    reasoning_delta?: string;
    reasoning_length?: number;
    reasoning_reset?: boolean;
    /** Full content replaces a pre-recovery partial response. */
    content_reset?: boolean;
    /**
     * Client-side only. The server job may still be healthy; tracking was
     * interrupted by a connection/protocol/auth problem. Callers must not
     * treat this as an authoritative generation failure.
     */
    trackingInterrupted?: boolean;
    /**
     * Client-side only reason for `trackingInterrupted`. `missing` means the
     * job was confirmed gone and the row was durably projected as interrupted;
     * `auth` and `protocol` leave the row pending for reattachment retry.
     */
    trackingInterruptedKind?: 'missing' | 'auth' | 'protocol';
    tool_calls?: Array<{
        id?: string;
        name: string;
        status: 'loading' | 'complete' | 'error' | 'pending' | 'skipped';
        args?: string;
        result?: string;
        error?: string;
        runtime?: 'client' | 'server' | 'hybrid';
        /** Length of the assistant text when this call's results arrived. */
        text_offset?: number;
    }>;
    workflow_state?: WorkflowMessageData;
}

/**
 * `BackgroundStreamResult`
 *
 * Purpose:
 * Return type for starting a background streaming job.
 */
export interface BackgroundStreamResult {
    jobId: string;
    status: 'streaming';
    /** Present for canonical chat admission; workflow jobs use another contract. */
    historyVersion?: 1;
}

/**
 * `BackgroundJobStreamEvent`
 *
 * Purpose:
 * SSE payload shape for background job updates.
 */
export type BackgroundJobStreamEvent = {
    event: 'snapshot' | 'delta' | 'status';
    status: BackgroundJobStatus;
};

function normalizeBackgroundJobUsage(status: BackgroundJobStatus): BackgroundJobStatus {
    const { usage: candidate, ...rest } = status;
    const usage = readRequestUsage(candidate);
    return { ...rest, ...(usage ? { usage } : {}) };
}

type BackgroundAdmissionError = Error & {
    backgroundAdmissionRetryable?: boolean;
    backgroundCapabilityDisabled?: boolean;
};

function makeBackgroundAdmissionError(
    message: string,
    options: { retryable: boolean; capabilityDisabled?: boolean }
): BackgroundAdmissionError {
    const error = new Error(message) as BackgroundAdmissionError;
    error.name = 'BackgroundAdmissionError';
    error.backgroundAdmissionRetryable = options.retryable;
    error.backgroundCapabilityDisabled = options.capabilityDisabled === true;
    return error;
}

async function readErrorPayload(
    response: Response
): Promise<{ error?: string; code?: string }> {
    const data = (await response.json().catch(() => null)) as unknown;
    if (data && typeof data === 'object') {
        const error = (data as { error?: unknown }).error;
        const code = (data as { code?: unknown }).code;
        return {
            error: typeof error === 'string' ? error : undefined,
            code: typeof code === 'string' ? code : undefined,
        };
    }
    return {};
}

async function readErrorMessage(
    response: Response,
    fallback: string
): Promise<string> {
    const payload = await readErrorPayload(response);
    return payload.error ?? fallback;
}

/**
 * `isBackgroundStreamingEnabled`
 *
 * Purpose:
 * Returns true when background streaming is available for this client.
 */
export function isBackgroundStreamingEnabled(
    configuredEnabled?: boolean
): boolean {
    if (backgroundStreamingCapabilityDisabled) return false;
    const configEnabled =
        configuredEnabled ??
        (
            useRuntimeConfig() as {
                public?: { backgroundStreaming?: { enabled?: boolean } };
            }
        ).public?.backgroundStreaming?.enabled;
    // Explicit config wins over stale local caches. A stale "server route
    // unavailable" entry must not veto a Cloud instance that explicitly
    // enables background streaming.
    if (configEnabled === false) return false;
    if (configEnabled === true) return true;

    if (!isServerRouteAvailable()) return false;

    // Check cached result
    if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem(BACKGROUND_STREAMING_CACHE_KEY);
        if (cached === 'true') return true;
        if (cached === 'false') return false;
    }

    // Default: assume not available until first successful background request
    return false;
}

/**
 * Mark background streaming as available
 */
function setBackgroundStreamingAvailable(available: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BACKGROUND_STREAMING_CACHE_KEY, String(available));
}

/**
 * `startBackgroundStream`
 *
 * Purpose:
 * Starts a background streaming job and returns its job ID.
 */
export async function startBackgroundStream(params: {
    expectedProjectId?: string | null;
    projectContext?: import('~/utils/projects/types').ProjectContextSnapshot | null;
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    threadId: string;
    messageId: string;
    /** Stable admission identity; generated once per user-initiated send. */
    admissionId?: string;
    history: import('~~/shared/chat/background-history').ChatGenerationAdmissionEnvelope;
    reasoning?: OpenRouterReasoningConfig;
    tools?: ToolDefinition[];
    toolChoice?: ToolChoice;
    toolRuntime?: Record<string, string>;
    contextPolicy?: ContextRequestPolicy;
    streamedFieldMode?: StreamedFieldMode;
    signal?: AbortSignal;
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
}): Promise<BackgroundStreamResult> {
    const body: OpenRouterRequestBody & {
        _background: true;
        _threadId: string;
        _messageId: string;
        _backgroundAdmissionId: string;
        _history: import('~~/shared/chat/background-history').ChatGenerationAdmissionEnvelope;
    } = {
        ...await prepareOpenRouterRequest(params),
        _background: true,
        _threadId: params.threadId,
        _messageId: params.messageId,
        // One admission ID per user-initiated send. Transport retries reuse
        // this body, while an explicit retry creates a fresh admission.
        _backgroundAdmissionId:
            params.admissionId && params.admissionId.length > 0
                ? params.admissionId
                : createRuntimeUuid(),
        _history: params.history,
        _clientDeviceId: getDeviceId(),
    };

    if (params.contextPolicy) body._context = captureContextEnvelope({ ...params.contextPolicy,
        requestedCompletionTokens: params.contextPolicy.requestedCompletionTokens });
    if (params.toolRuntime) {
        body._toolRuntime = params.toolRuntime;
    }
    if (params.streamedFieldMode) {
        body._streamedFieldMode = params.streamedFieldMode;
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-or3-cloud-intent': 'mutation',
    };
    if (params.apiKey) {
        headers['x-or3-openrouter-key'] = params.apiKey;
    }

    const serializedBody = JSON.stringify(body);
    let result: BackgroundStreamResult | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await assertDispatchOwner(params);
        try {
            const resp = await fetchWithResponseDeadline('/api/openrouter/stream', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: serializedBody,
            }, {
                signal: params.signal,
                timeoutMs:
                    params.responseTimeoutMs ??
                    DEFAULT_BACKGROUND_START_TIMEOUT_MS,
            });

            if (!resp.ok) {
                const payload = await readErrorPayload(resp);
                const message =
                    payload.error ?? `Background stream failed: ${resp.status}`;
                if (
                    payload.code === 'background_streaming_disabled' ||
                    payload.code === 'background_history_unsupported' ||
                    payload.code === 'background_client_tool_unsupported'
                ) {
                    // Server explicitly rejected durable execution. Refresh the
                    // capability cache; do not retry and do not fall through to
                    // a different execution mode.
                    backgroundStreamingCapabilityDisabled = true;
                    setBackgroundStreamingAvailable(false);
                    setServerRouteAvailable(true);
                    throw makeBackgroundAdmissionError(message, {
                        retryable: false,
                        capabilityDisabled: true,
                    });
                }
                if (isMissingServerRoute(resp)) {
                    setServerRouteAvailable(false);
                    setBackgroundStreamingAvailable(false);
                }
                const metadata = normalizeError({ data: payload, status: resp.status,
                    retryAfterMs: parseRetryAfter(resp.headers.get('retry-after')) });
                const retryable = metadata.retryable === true;
                const error = makeBackgroundAdmissionError(presentError(metadata).message, { retryable });
                Object.assign(error, metadata);
                if (!retryable || attempt === 2) throw error;
                lastError = error;
            } else {
                // Strict admission contract: `_background: true` must return a
                // JSON `{ jobId, status: 'streaming' }` body. An unexpected SSE
                // or malformed body means a mismatched deployment; reject it
                // instead of silently launching another execution mode.
                const contentType = resp.headers.get('content-type') ?? '';
                if (!contentType.includes('application/json')) {
                    throw makeBackgroundAdmissionError(
                        'Background admission returned a non-JSON response',
                        { retryable: false }
                    );
                }
                let decoded: unknown;
                try {
                    decoded = await readResponseJsonWithIdleDeadline<unknown>(
                        resp,
                        {
                            signal: params.signal,
                            timeoutMs: params.idleTimeoutMs,
                        }
                    );
                } catch (decodeError) {
                    if (params.signal?.aborted) throw decodeError;
                    throw makeBackgroundAdmissionError(
                        decodeError instanceof Error
                            ? decodeError.message
                            : 'Malformed background admission response',
                        { retryable: false }
                    );
                }
                const candidate =
                    decoded && typeof decoded === 'object'
                        ? (decoded as { jobId?: unknown; status?: unknown; historyVersion?: unknown })
                        : null;
                if (
                    !candidate ||
                    typeof candidate.jobId !== 'string' ||
                    candidate.jobId.length === 0 ||
                    candidate.status !== 'streaming' ||
                    candidate.historyVersion !== 1
                ) {
                    throw makeBackgroundAdmissionError(
                        'Malformed background admission response',
                        { retryable: false }
                    );
                }
                result = {
                    jobId: candidate.jobId,
                    status: 'streaming',
                    historyVersion: 1,
                };
                break;
            }
        } catch (error) {
            if (
                params.signal?.aborted ||
                (error instanceof Error && error.name === 'AbortError') ||
                (error instanceof Error &&
                    (error as BackgroundAdmissionError)
                        .backgroundAdmissionRetryable === false) ||
                attempt === 2
            ) {
                throw error;
            }
            lastError = error;
        }
        await abortableDelay(150 * 2 ** attempt, params.signal);
    }
    if (!result) {
        throw lastError instanceof Error
            ? lastError
            : new Error('Background stream admission failed');
    }
    
    // Mark background streaming as available since it worked
    setBackgroundStreamingAvailable(true);
    
    return result;
}

/**
 * `pollJobStatus`
 *
 * Purpose:
 * Polls the status of a background streaming job.
 */
export async function pollJobStatus(
    jobId: string,
    offset?: number,
    signal?: AbortSignal,
    attempt?: number
): Promise<BackgroundJobStatus> {
    const query = new URLSearchParams();
    if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
        query.set('offset', String(Math.floor(offset)));
    }
    if (
        typeof attempt === 'number' &&
        Number.isFinite(attempt) &&
        attempt >= 0
    ) {
        query.set('attempt', String(Math.floor(attempt)));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const url = `/api/jobs/${jobId}/status${suffix}`;
    let resp: Response;
    try {
        resp = await fetchWithResponseDeadline(url, {}, { signal });
    } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw error;
        }
        throw new BackgroundJobPollError(
            error instanceof Error ? error.message : 'Job status transport failed',
            'transport',
            true
        );
    }

    if (!resp.ok) {
        const message = await readErrorMessage(
            resp,
            `Job status failed: ${resp.status}`
        );
        const retryAfter = resp.headers.get('retry-after');
        const retryAfterMs = retryAfter
            ? Math.min(30_000, Math.max(0, parseRetryAfterSeconds(retryAfter) * 1_000))
            : undefined;
        const kind: BackgroundPollFailureKind =
            resp.status === 429
                ? 'rate_limit'
                : resp.status >= 500
                    ? 'server'
                    : resp.status === 404
                        ? 'not_found'
                        : resp.status === 401 || resp.status === 403
                            ? 'auth'
                            : 'protocol';
        throw new BackgroundJobPollError(
            message,
            kind,
            kind !== 'protocol',
            resp.status,
            retryAfterMs
        );
    }

    let decoded: unknown;
    try {
        decoded = await readResponseJsonWithIdleDeadline<unknown>(resp, {
            signal,
        });
    } catch (error) {
        if (
            signal?.aborted ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            throw error;
        }
        // Body timeouts and malformed payloads are transport/provider problems,
        // not authoritative job states. Classify them so callers retry instead
        // of fabricating a terminal generation failure.
        if (error instanceof OpenRouterTimeoutError) {
            throw new BackgroundJobPollError(error.message, 'transport', true);
        }
        throw new BackgroundJobPollError(
            error instanceof Error
                ? error.message
                : 'Job status response decode failed',
            'protocol',
            false
        );
    }
    if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof (decoded as { status?: unknown }).status !== 'string'
    ) {
        throw new BackgroundJobPollError(
            'Malformed job status response',
            'protocol',
            false
        );
    }
    return normalizeBackgroundJobUsage(decoded as BackgroundJobStatus);
}

/**
 * `abortBackgroundJob`
 *
 * Purpose:
 * Requests abortion of a background streaming job.
 */
export async function abortBackgroundJob(jobId: string): Promise<boolean> {
    const resp = await fetch(`/api/jobs/${jobId}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
        body: '{}',
    });

    if (!resp.ok) {
        return false;
    }

    const result = await resp.json() as { aborted: boolean };
    return result.aborted;
}

export type BackgroundClientToolClaim = {
    claimToken: string;
    call: {
        id: string;
        name: string;
        arguments: string;
        definition: ToolDefinition;
    };
    context: { workspaceId: string; threadId: string; messageId: string };
};

export async function claimBackgroundClientTool(
    jobId: string,
    callId: string
): Promise<BackgroundClientToolClaim | null> {
    const response = await fetch(`/api/jobs/${jobId}/client-tool/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-OR3-Tool-Intent': 'claim',
        },
        body: JSON.stringify({ callId, deviceId: getDeviceId() }),
    });
    if (response.status === 409) return null;
    if (!response.ok) throw new Error(`Client tool claim failed: ${response.status}`);
    return (await response.json()) as BackgroundClientToolClaim;
}

export async function isBackgroundClientToolBridgeAvailable(): Promise<boolean> {
    try {
        const response = await fetchWithResponseDeadline(
            '/api/jobs/client-tool/capability',
            { credentials: 'include', cache: 'no-store' },
            { timeoutMs: 3_000 }
        );
        if (!response.ok) return false;
        const body = (await response.json()) as { available?: unknown };
        return body.available === true;
    } catch {
        return false;
    }
}

export async function submitBackgroundClientToolResult(params: {
    jobId: string;
    callId: string;
    claimToken: string;
    result?: string;
    error?: string;
}): Promise<void> {
    const response = await fetch(`/api/jobs/${params.jobId}/client-tool/result`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-OR3-Tool-Intent': 'result',
        },
        body: JSON.stringify({
            callId: params.callId,
            claimToken: params.claimToken,
            result: params.result,
            error: params.error,
        }),
    });
    if (!response.ok) {
        throw new Error(`Client tool result failed: ${response.status}`);
    }
}

/**
 * `abortBackgroundAdmission`
 *
 * Purpose:
 * Cancels a background admission before its job ID is known, using the stable
 * admission ID. The server either aborts the committed job or records a
 * cancellation marker consumed when the admission commits.
 */
export async function abortBackgroundAdmission(
    admissionId: string,
    workspaceId: string | undefined
): Promise<{ aborted: boolean; pending: boolean; jobId?: string }> {
    let resp: Response;
    try {
        resp = await fetch('/api/jobs/admission-abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            credentials: 'include',
            body: JSON.stringify({ admissionId, workspaceId }),
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw new BackgroundJobPollError(
            error instanceof Error
                ? error.message
                : 'Admission cancellation transport failed',
            'transport',
            true
        );
    }
    if (!resp.ok) {
        throw new BackgroundJobPollError(
            `Admission cancellation failed: ${resp.status}`,
            resp.status === 401 || resp.status === 403 ? 'auth' : 'transport',
            resp.status >= 500 || resp.status === 429
        );
    }
    const result = (await resp.json().catch(() => null)) as {
        aborted?: boolean;
        pending?: boolean;
        jobId?: string;
    } | null;
    if (!result || typeof result !== 'object') {
        throw new BackgroundJobPollError(
            'Malformed admission cancellation response',
            'protocol',
            false
        );
    }
    return {
        aborted: result.aborted === true,
        pending: result.pending === true,
        jobId: typeof result.jobId === 'string' ? result.jobId : undefined,
    };
}

/**
 * `waitForJobCompletion`
 *
 * Purpose:
 * Polls a job until it completes or errors.
 */
export async function waitForJobCompletion(
    jobId: string,
    onProgress?: (status: BackgroundJobStatus) => void,
    pollIntervalMs = 1000,
    maxWaitMs = 5 * 60 * 1000
): Promise<BackgroundJobStatus> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const status = await pollJobStatus(jobId);
        
        if (onProgress) {
            onProgress(status);
        }

        if (status.status !== 'streaming') {
            return status;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Job timed out waiting for completion');
}

/**
 * `subscribeBackgroundJobStream`
 *
 * Purpose:
 * Subscribes to background job updates via SSE.
 */
export function subscribeBackgroundJobStream(params: {
    jobId: string;
    offset?: number;
    attempt?: number;
    onStatus: (status: BackgroundJobStatus) => void;
    onError?: (error: Error) => void;
}): () => void {
    if (typeof EventSource === 'undefined') {
        throw new Error('EventSource unavailable');
    }
    const offset =
        typeof params.offset === 'number' && Number.isFinite(params.offset)
            ? Math.max(0, Math.floor(params.offset))
            : null;
    const query = new URLSearchParams();
    if (offset !== null) query.set('offset', String(offset));
    if (
        typeof params.attempt === 'number' &&
        Number.isFinite(params.attempt) &&
        params.attempt >= 0
    ) {
        query.set('attempt', String(Math.floor(params.attempt)));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const url = `/api/jobs/${params.jobId}/stream${suffix}`;

    const es = new EventSource(url);

    es.onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data) as BackgroundJobStreamEvent;
            params.onStatus(normalizeBackgroundJobUsage(parsed.status));
        } catch (err) {
            if (params.onError) {
                params.onError(
                    err instanceof Error ? err : new Error('Invalid SSE payload')
                );
            }
        }
    };

    es.onerror = () => {
        if (params.onError) {
            params.onError(new Error('Background SSE connection failed'));
        }
    };

    return () => {
        try {
            es.close();
        } catch {
            /* intentionally empty */
        }
    };
}
