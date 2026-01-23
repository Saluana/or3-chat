import { useRuntimeConfig } from '#imports';
import type { ToolDefinition } from './types';
import {
    parseOpenRouterSSE,
    type ORStreamEvent,
} from '~~/shared/openrouter/parseOpenRouterSSE';

// Note: Streaming requires direct body access which the SDK doesn't expose.
// Per design document, we keep raw fetch for streaming but use SDK for non-streaming calls.
// The SDK's chat.send() method buffers the entire response, which breaks streaming.

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

interface ServerRouteCacheEntry {
    available: boolean;
    timestamp: number;
}

type OpenRouterRequestBody = {
    model: string;
    messages: ORMessage[];
    modalities: string[];
    stream: true;
    reasoning?: unknown;
    tools?: ToolDefinition[];
    tool_choice?: 'auto';
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
    const { ui: _ui, ...rest } = tool as ToolDefinition & {
        ui?: Record<string, unknown>;
    };
    return {
        ...rest,
        function: {
            ...tool.function,
            parameters: { ...tool.function.parameters },
        },
    };
}

export async function* openRouterStream(params: {
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    tools?: ToolDefinition[];
    signal?: AbortSignal;
    reasoning?: unknown;
}): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, orMessages, modalities, tools, signal } = params;
    const hasApiKey = Boolean(apiKey);

    const body: OpenRouterRequestBody = {
        model,
        messages: orMessages,
        modalities,
        stream: true,
    };

    if (params.reasoning) {
        body.reasoning = params.reasoning;
    }

    if (tools) {
        body.tools = tools.map(stripUiMetadata);
        body.tool_choice = 'auto';
    }

    // Req 3, 5, 6: Try server route first (/api/openrouter/stream) if available
    // Skip if we've already determined it's not available (static build or server down)
    if (isServerRouteAvailable()) {
        try {
            const serverResp = await fetch('/api/openrouter/stream', {
                method: 'POST',
                headers: hasApiKey
                    ? {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${apiKey}`, // Req 1, 3: Send API key in header; server uses only if env key missing
                      }
                    : { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });

            if (serverResp.ok && serverResp.body) {
                // Server route available; use shared parser on response
                for await (const evt of parseOpenRouterSSE(serverResp.body)) {
                    yield evt;
                }
                return; // Success; don't fall back
            }

            if (serverResp.status === 404 || serverResp.status === 405) {
                // Server route not OK; mark as unavailable and fall through
                setServerRouteAvailable(false);
            } else {
                const errorText = await serverResp.text().catch(() => '');
                throw new Error(
                    `OpenRouter proxy error ${serverResp.status}: ${errorText.slice(
                        0,
                        300
                    )}`
                );
            }
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith('OpenRouter proxy error')
            ) {
                throw error;
            }
            // Server route unavailable (404, network error, etc.); mark as unavailable and fall back
            setServerRouteAvailable(false);
        }
    }

    if (!hasApiKey) {
        throw new Error('Missing OpenRouter API key');
    }

    // Fallback: direct OpenRouter (legacy path)
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        body: JSON.stringify(body),
        signal,
    });

    if (!resp.ok || !resp.body) {
        // Read response text for diagnostics
        let respText = '<no-body>';
        try {
            respText = await resp.text();
        } catch (readErr) {
            respText = `<error-reading-body:${
                readErr instanceof Error ? readErr.message : 'err'
            }>`;
        }

        // Produce a truncated preview of the outgoing body to help debug (truncate long strings)
        let bodyPreview = '<preview-failed>';
        try {
            bodyPreview = JSON.stringify(
                body,
                (_key: string, value: unknown): unknown => {
                    if (typeof value === 'string' && value.length > 300) {
                        return `${value.slice(0, 300)}...(${value.length})`;
                    }
                    return value;
                },
                2
            );
        } catch (stringifyErr) {
            bodyPreview = `<stringify-error:${
                stringifyErr instanceof Error ? stringifyErr.message : 'err'
            }>`;
        }

        console.warn('[openrouterStream] OpenRouter request failed', {
            status: resp.status,
            statusText: resp.statusText,
            responseSnippet: respText.slice(0, 2000),
            bodyPreview,
        });

        throw new Error(
            `OpenRouter request failed ${resp.status} ${
                resp.statusText
            }: ${respText.slice(0, 300)}`
        );
    }

    // Req 6: Use shared parser on fallback (direct) path to ensure identical behavior
    for await (const evt of parseOpenRouterSSE(resp.body)) {
        yield evt;
    }
}

// ============================================================
// BACKGROUND STREAMING (SSR mode only)
// ============================================================

/**
 * Cache key for background streaming availability
 */
const BACKGROUND_STREAMING_CACHE_KEY = 'or3:background-streaming-available';

/**
 * Background job status from server
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
}

/**
 * Result from starting a background stream
 */
export interface BackgroundStreamResult {
    jobId: string;
    status: 'streaming';
}

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
 * Check if background streaming is available (server must support it)
 */
export function isBackgroundStreamingEnabled(): boolean {
    if (!isServerRouteAvailable()) return false;

    const runtimeConfig = useRuntimeConfig() as {
        public?: { backgroundStreaming?: { enabled?: boolean } };
    };
    const configEnabled = runtimeConfig.public?.backgroundStreaming?.enabled;
    if (configEnabled === false) return false;
    
    // Check cached result
    if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem(BACKGROUND_STREAMING_CACHE_KEY);
        if (cached === 'true') return true;
        if (cached === 'false') return false;
    }

    if (configEnabled === true) return true;

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
 * Start a background streaming job.
 * Returns immediately with a job ID; streaming continues on server.
 */
export async function startBackgroundStream(params: {
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    threadId: string;
    messageId: string;
    reasoning?: unknown;
    tools?: ToolDefinition[];
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

    if (params.tools) {
        body.tools = params.tools.map(stripUiMetadata);
        body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`;
    }

    const resp = await fetch('/api/openrouter/stream', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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

    const result = await resp.json() as BackgroundStreamResult;
    
    // Mark background streaming as available since it worked
    setBackgroundStreamingAvailable(true);
    
    return result;
}

/**
 * Poll the status of a background job
 */
export async function pollJobStatus(jobId: string): Promise<BackgroundJobStatus> {
    const resp = await fetch(`/api/jobs/${jobId}/status`);

    if (!resp.ok) {
        const message = await readErrorMessage(
            resp,
            `Job status failed: ${resp.status}`
        );
        throw new Error(message);
    }

    return await resp.json() as BackgroundJobStatus;
}

/**
 * Abort a background streaming job
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
 * Poll a job until it completes or errors
 * @param jobId - The job ID to poll
 * @param onProgress - Optional callback for progress updates
 * @param pollIntervalMs - Polling interval in ms (default 1000)
 * @param maxWaitMs - Maximum wait time in ms (default 5 minutes)
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
