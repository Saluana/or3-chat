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
import { OpenRouterStreamError } from '~~/shared/openrouter/errors';
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

type ORMessagePart = { type: string; [key: string]: unknown };

// Permissive message type that accepts both strict ORMessage from openrouter-build
// and tool messages. Content is optional for tool role messages.
type ORMessage = {
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
    modalities: string[];
    stream: true;
    reasoning?: OpenRouterReasoningConfig;
    cache_control?: OpenRouterCacheControl;
    tools?: ToolDefinition[];
    tool_choice?: ToolChoice;
    _background?: true;
    _threadId?: string;
    _messageId?: string;
    _toolRuntime?: Record<string, string>;
    _streamedFieldMode?: StreamedFieldMode;
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
export async function* openRouterStream(params: {
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    threadId?: string;
    messageId?: string;
    tools?: ToolDefinition[];
    toolChoice?: ToolChoice;
    signal?: AbortSignal;
    reasoning?: OpenRouterReasoningConfig;
    /** How the selected provider emits streamed tool name/argument fields. */
    streamedFieldMode?: StreamedFieldMode;
    /** Primarily configurable for deterministic tests and constrained runtimes. */
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
}): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, orMessages, modalities, tools, signal } = params;
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

    const body: OpenRouterRequestBody = {
        model,
        messages: orMessages,
        modalities,
        stream: true,
    };

    if (params.threadId) {
        body._threadId = params.threadId;
    }
    if (params.messageId) {
        body._messageId = params.messageId;
    }

    if (params.reasoning) {
        body.reasoning = params.reasoning;
    }
    const cacheControl = getAnthropicPromptCacheControl(model);
    if (cacheControl) {
        body.cache_control = cacheControl;
    }

    if (tools) {
        body.tools = tools.map(stripUiMetadata);
        body.tool_choice = params.toolChoice ?? 'auto';
    }

    // Req 3, 5, 6: Try server route first (/api/openrouter/stream) if available.
    // Only 404/405 and genuine network failures are treated as "route unavailable";
    // other proxy errors (5xx, 401, 403, etc.) propagate so the caller can retry or
    // surface them instead of silently poisoning the availability cache.
    if (forceServerRoute || isServerRouteAvailable()) {
        let serverResp: Response | undefined;
        let networkError: Error | undefined;

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (hasApiKey) {
                headers['x-or3-openrouter-key'] = apiKey as string;
            }
            serverResp = await fetchWithResponseDeadline('/api/openrouter/stream', {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            }, { signal, timeoutMs: params.responseTimeoutMs });
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
                for await (const evt of parseOpenRouterSSE(guardedBody, {
                    streamedFieldMode: params.streamedFieldMode,
                })) {
                    yield evt;
                }
                return; // Success; don't fall back
            }

            if (serverResp.status === 404 || serverResp.status === 405) {
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
                const retryable =
                    serverResp.status === 429 || serverResp.status >= 500;
                throw new OpenRouterStreamError(
                    `OpenRouter proxy error ${serverResp.status}: ${errorText.slice(
                        0,
                        300
                    )}`,
                    { status: serverResp.status, retryable }
                );
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
    const fallbackBody = { ...body };
    delete fallbackBody._background;
    delete fallbackBody._threadId;
    delete fallbackBody._messageId;

    let resp: Response;
    try {
        resp = await fetchWithResponseDeadline(openRouterChatUrl, {
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
            body: JSON.stringify(fallbackBody),
        }, { signal, timeoutMs: params.responseTimeoutMs });
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
        let respText = '<no-body>';
        try {
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

        const retryable = resp.status === 429 || resp.status >= 500;
        const retryAfter = resp.headers.get('retry-after');
        const retryAfterMs = retryAfter
            ? parseRetryAfterSeconds(retryAfter) * 1000
            : undefined;
        throw new OpenRouterStreamError(
            `OpenRouter request failed ${resp.status} ${resp.statusText}`,
            { status: resp.status, retryable, retryAfterMs }
        );
    }

    // Req 6: Use shared parser on fallback (direct) path to ensure identical behavior
    const guardedBody = withIdleWatchdog(resp.body, {
        signal,
        timeoutMs: params.idleTimeoutMs,
    });
    for await (const evt of parseOpenRouterSSE(guardedBody, {
        streamedFieldMode: params.streamedFieldMode,
    })) {
        yield evt;
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

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const stream = openRouterStream(streamParams);
            const iterator = stream[Symbol.asyncIterator]();
            const first = await iterator.next();
            if (first.done) {
                return;
            }
            yield first.value;
            // First event succeeded; drain the rest without retry to avoid duplicates.
            while (true) {
                const next = await iterator.next();
                if (next.done) return;
                yield next.value;
            }
        } catch (e) {
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
            if (!error.retryable || attempt >= maxRetries) {
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
    startedAt: number;
    completedAt?: number;
    error?: string;
    content?: string;
    content_delta?: string;
    content_length?: number;
    tool_calls?: Array<{
        id?: string;
        name: string;
        status: 'loading' | 'complete' | 'error' | 'pending' | 'skipped';
        args?: string;
        result?: string;
        error?: string;
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

async function readErrorMessage(
    response: Response,
    fallback: string
): Promise<string> {
    const data = (await response.json().catch(() => null)) as unknown;
    if (data && typeof data === 'object' && 'error' in data) {
        const error = (data as { error?: unknown }).error;
        if (typeof error === 'string') return error;
    }
    return fallback;
}

/**
 * `isBackgroundStreamingEnabled`
 *
 * Purpose:
 * Returns true when background streaming is available for this client.
 */
export function isBackgroundStreamingEnabled(): boolean {
    if (!isServerRouteAvailable()) return false;

    const runtimeConfig = useRuntimeConfig() as {
        public?: { backgroundStreaming?: { enabled?: boolean } };
    };
    const configEnabled = runtimeConfig.public?.backgroundStreaming?.enabled;
    if (configEnabled === false) return false;
    // Explicit config should win over stale local cache.
    if (configEnabled === true) return true;
    
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
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    threadId: string;
    messageId: string;
    reasoning?: OpenRouterReasoningConfig;
    tools?: ToolDefinition[];
    toolChoice?: ToolChoice;
    toolRuntime?: Record<string, string>;
    streamedFieldMode?: StreamedFieldMode;
    signal?: AbortSignal;
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
}): Promise<BackgroundStreamResult> {
    const body: OpenRouterRequestBody & {
        _background: true;
        _threadId: string;
        _messageId: string;
    } = {
        model: params.model,
        messages: params.orMessages,
        modalities: params.modalities,
        stream: true,
        _background: true,
        _threadId: params.threadId,
        _messageId: params.messageId,
    };

    if (params.reasoning) {
        body.reasoning = params.reasoning;
    }
    const cacheControl = getAnthropicPromptCacheControl(params.model);
    if (cacheControl) {
        body.cache_control = cacheControl;
    }

    if (params.tools) {
        body.tools = params.tools.map(stripUiMetadata);
        body.tool_choice = params.toolChoice ?? 'auto';
    }
    if (params.toolRuntime) {
        body._toolRuntime = params.toolRuntime;
    }
    if (params.streamedFieldMode) {
        body._streamedFieldMode = params.streamedFieldMode;
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (params.apiKey) {
        headers['x-or3-openrouter-key'] = params.apiKey;
    }

    const resp = await fetchWithResponseDeadline('/api/openrouter/stream', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(body),
    }, {
        signal: params.signal,
        timeoutMs: params.responseTimeoutMs ?? DEFAULT_BACKGROUND_START_TIMEOUT_MS,
    });

    if (!resp.ok) {
        if (resp.status === 404 || resp.status === 405) {
            setServerRouteAvailable(false);
            setBackgroundStreamingAvailable(false);
        }
        const message = await readErrorMessage(
            resp,
            `Background stream failed: ${resp.status}`
        );
        throw new Error(message);
    }

    const result = await readResponseJsonWithIdleDeadline<BackgroundStreamResult>(resp, {
        signal: params.signal,
        timeoutMs: params.idleTimeoutMs,
    });
    
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
    signal?: AbortSignal
): Promise<BackgroundJobStatus> {
    const url =
        typeof offset === 'number' && Number.isFinite(offset) && offset >= 0
            ? `/api/jobs/${jobId}/status?offset=${Math.floor(offset)}`
            : `/api/jobs/${jobId}/status`;
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

    const status = await readResponseJsonWithIdleDeadline<BackgroundJobStatus>(resp, { signal });
    return status;
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
    });

    if (!resp.ok) {
        return false;
    }

    const result = await resp.json() as { aborted: boolean };
    return result.aborted;
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
    const url =
        offset !== null
            ? `/api/jobs/${params.jobId}/stream?offset=${offset}`
            : `/api/jobs/${params.jobId}/stream`;

    const es = new EventSource(url);

    es.onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data) as BackgroundJobStreamEvent;
            params.onStatus(parsed.status);
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
