import type { AiAdapter } from '../ai/runtime';
import type { AiEvent } from '../ai/events';
import type { AiCompletion, AiCompletionRequest } from '../ai/types';
import { parseOpenRouterSSE, type StreamedFieldMode } from '../openrouter/parseOpenRouterSSE';
import { withIdleWatchdog } from '../openrouter/deadlines';
import { createOpenRouterCompletionAdapter, decodeChatCompletion } from '../openrouter/adapter';
import { openAiApiModel, openAiReasoningEfforts } from './models';

// Chat Completions accepts no OpenRouter routing, plugin, usage or search options.
const REQUEST_KEYS = ['stream', 'tool_choice', 'parallel_tool_calls', 'temperature', 'top_p', 'stop', 'seed',
    'response_format', 'frequency_penalty', 'presence_penalty', 'logit_bias', 'user'];
const MESSAGE_KEYS = ['role', 'content', 'name', 'tool_calls', 'tool_call_id'];

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** The nearest effort the model accepts, rounding up; OpenAI refuses any effort outside a family's list. */
function reasoningEffort(model: string, reasoning: { effort?: unknown; enabled?: unknown } | undefined): string | undefined {
    const efforts = openAiReasoningEfforts(model);
    const requested = reasoning?.enabled === false ? 'none' : reasoning?.effort;
    const rank = EFFORT_ORDER.indexOf(String(requested));
    if (!efforts || rank < 0) return undefined;
    return efforts.find(effort => EFFORT_ORDER.indexOf(effort) >= rank) ?? efforts.at(-1);
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

/** Wire projection of OR3's OpenRouter-shaped chat request for OpenAI Chat Completions. */
export function encodeOpenAiRequest(body: Record<string, unknown>): Record<string, unknown> {
    const messages = Array.isArray(body.messages) ? body.messages as Record<string, unknown>[] : [];
    const request: Record<string, unknown> = {
        model: openAiApiModel(String(body.model)),
        messages: messages.map((message) => {
            const projected = pick(message, MESSAGE_KEYS);
            // Prompt-cache markers are an OpenRouter/Anthropic extension.
            if (Array.isArray(projected.content)) projected.content = (projected.content as Record<string, unknown>[])
                .map(({ cache_control: _cache, ...part }) => part);
            return projected;
        }),
        ...pick(body, REQUEST_KEYS),
    };
    const tools = Array.isArray(body.tools) ? body.tools.filter(tool => (tool as { type?: unknown })?.type === 'function') : [];
    if (tools.length) request.tools = tools;
    else delete request.tool_choice;
    const limit = body.max_completion_tokens ?? body.max_tokens;
    if (typeof limit === 'number') request.max_completion_tokens = limit;
    const effort = reasoningEffort(request.model as string, body.reasoning as { effort?: unknown; enabled?: unknown } | undefined);
    if (effort) request.reasoning_effort = effort;
    if (request.stream === true) request.stream_options = { include_usage: true };
    return request;
}

/** Text completions on Chat Completions, with the OpenRouter completion adapter's request and result contract. */
export function createOpenAiCompletionAdapter(): AiAdapter<AiCompletionRequest, Record<string, unknown>, never, AiCompletion> {
    const shared = createOpenRouterCompletionAdapter({ explicitStreamFalse: true });
    return {
        id: 'openai',
        async prepare(request) {
            if (request.model.routerId !== 'openai') throw new Error('Model belongs to a different router');
            return encodeOpenAiRequest(await shared.prepare({ ...request, model: { routerId: 'openrouter', modelId: request.model.modelId } }));
        },
        decodeCompletion: decodeChatCompletion,
    };
}

/** OpenAI's chunk format is the subset OR3's SSE decoder already reads. */
export function createOpenAiStreamAdapter(options: {
    signal?: AbortSignal;
    idleTimeoutMs?: number;
    streamedFieldMode?: StreamedFieldMode;
} = {}): AiAdapter<Record<string, unknown>, Record<string, unknown>, AiEvent> {
    return {
        id: 'openai',
        prepare: encodeOpenAiRequest,
        async *decodeStream(response) {
            if (!response.body) throw new Error('OpenAI response has no stream');
            yield* parseOpenRouterSSE(withIdleWatchdog(response.body, { signal: options.signal, timeoutMs: options.idleTimeoutMs }),
                { streamedFieldMode: options.streamedFieldMode });
        },
    };
}
