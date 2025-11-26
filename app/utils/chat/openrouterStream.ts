import type { ToolDefinition } from './types';
import {
    parseOpenRouterSSE,
    type ORStreamEvent,
} from '../../../shared/openrouter/parseOpenRouterSSE';

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
    apiKey: string;
    model: string;
    orMessages: ORMessage[];
    modalities: string[];
    tools?: ToolDefinition[];
    signal?: AbortSignal;
    reasoning?: unknown;
}): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, orMessages, modalities, tools, signal } = params;

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
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`, // Req 1, 3: Send API key in header; server uses only if env key missing
                },
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

            // Server route not OK; mark as unavailable and fall through
            setServerRouteAvailable(false);
        } catch {
            // Server route unavailable (404, network error, etc.); mark as unavailable and fall back
            setServerRouteAvailable(false);
        }
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
            `OpenRouter request failed ${resp.status} ${resp.statusText}: ${
                respText.slice(0, 300)
            }`
        );
    }

    // Req 6: Use shared parser on fallback (direct) path to ensure identical behavior
    for await (const evt of parseOpenRouterSSE(resp.body)) {
        yield evt;
    }
}
