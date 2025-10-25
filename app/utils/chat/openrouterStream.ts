import type { ORStreamEvent, ToolDefinition } from './types';
import { parseOpenRouterSSE } from '../../../shared/openrouter/parseOpenRouterSSE';

// Cache key for detecting static build (no server routes)
const SERVER_ROUTE_AVAILABLE_CACHE_KEY = 'or3:server-route-available';

/**
 * Check if server routes are available (not a static build).
 * Uses localStorage to cache the result to avoid repeated 404 attempts.
 */
function isServerRouteAvailable(): boolean {
    if (typeof localStorage === 'undefined') return false;

    const cached = localStorage.getItem(SERVER_ROUTE_AVAILABLE_CACHE_KEY);
    if (cached !== null) {
        return cached === 'true';
    }

    // First time; assume available, will be set to false if it fails
    return true;
}

/**
 * Mark server routes as available or unavailable.
 */
function setServerRouteAvailable(available: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SERVER_ROUTE_AVAILABLE_CACHE_KEY, String(available));
}

function stripUiMetadata(tool: ToolDefinition): ToolDefinition {
    const { ui: _ignored, ...rest } = tool as ToolDefinition & {
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
    orMessages: any[];
    modalities: string[];
    tools?: ToolDefinition[];
    signal?: AbortSignal;
    reasoning?: any;
}): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, orMessages, modalities, tools, signal } = params;

    const body = {
        model,
        messages: orMessages,
        modalities,
        stream: true,
    } as any;

    if (params.reasoning) {
        body['reasoning'] = params.reasoning;
    }

    if (tools) {
        body['tools'] = tools.map(stripUiMetadata);
        body['tool_choice'] = 'auto';
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
        } catch (e: any) {
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
        } catch (e) {
            respText = `<error-reading-body:${(e as any)?.message || 'err'}>`;
        }

        // Produce a truncated preview of the outgoing body to help debug (truncate long strings)
        let bodyPreview = '<preview-failed>';
        try {
            bodyPreview = JSON.stringify(
                body,
                (_key, value) => {
                    if (typeof value === 'string') {
                        if (value.length > 300)
                            return value.slice(0, 300) + `...(${value.length})`;
                    }
                    return value;
                },
                2
            );
        } catch (e) {
            bodyPreview = `<stringify-error:${(e as any)?.message || 'err'}>`;
        }

        console.warn('[openrouterStream] OpenRouter request failed', {
            status: resp.status,
            statusText: resp.statusText,
            responseSnippet: respText?.slice
                ? respText.slice(0, 2000)
                : String(respText),
            bodyPreview,
        });

        throw new Error(
            `OpenRouter request failed ${resp.status} ${resp.statusText}: ${
                respText?.slice ? respText.slice(0, 300) : String(respText)
            }`
        );
    }

    // Req 6: Use shared parser on fallback (direct) path to ensure identical behavior
    for await (const evt of parseOpenRouterSSE(resp.body)) {
        yield evt;
    }
}
