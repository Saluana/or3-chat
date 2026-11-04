import type { AiAdapter } from '../ai/runtime';
import type { AiEvent } from '../ai/events';
import type { AiCompletion, AiCompletionRequest } from '../ai/types';
import { parseOpenRouterSSE, type StreamedFieldMode } from './parseOpenRouterSSE';
import { withIdleWatchdog } from './deadlines';
import { prepareOpenRouterWebSearch } from './request';

/** Host metadata stays in the envelope used by the authorized server route. */
export function encodeOpenRouterRequest<T extends { model?: unknown; tools?: unknown }>(body: T): T {
    return prepareOpenRouterWebSearch(body);
}

/** Decode a byte stream once; the host remains responsible for its lifetime. */
export function decodeOpenRouterStream(stream: ReadableStream<Uint8Array>, streamedFieldMode?: StreamedFieldMode) {
    return parseOpenRouterSSE(stream, { streamedFieldMode });
}

export function createOpenRouterStreamAdapter<T extends { model?: unknown; tools?: unknown }>(options: {
    signal?: AbortSignal;
    idleTimeoutMs?: number;
    streamedFieldMode?: StreamedFieldMode;
} = {}): AiAdapter<T, T, AiEvent> {
    return {
        id: 'openrouter',
        prepare: encodeOpenRouterRequest,
        async *decodeStream(response) {
            if (!response.body) throw new Error('OpenRouter response has no stream');
            const guardedBody = withIdleWatchdog(response.body, {
                signal: options.signal,
                timeoutMs: options.idleTimeoutMs,
            });
            yield* decodeOpenRouterStream(guardedBody, options.streamedFieldMode);
        },
    };
}

type OpenRouterCompletionBody = {
    model: string;
    messages: AiCompletionRequest['messages'];
    max_tokens?: number;
    stream?: false;
    reasoning?: { effort: 'none' };
};

/** Encode text completions and decode their result without imposing a caller's validation policy. */
export function createOpenRouterCompletionAdapter(options: { explicitStreamFalse?: boolean } = {}):
    AiAdapter<AiCompletionRequest, OpenRouterCompletionBody, never, AiCompletion> {
    return {
        id: 'openrouter',
        prepare(request) {
            if (request.model.routerId !== 'openrouter') throw new Error('Model belongs to a different router');
            const model = request.model.modelId;
            const reasoning = request.reasoning?.kind === 'disabled' ? { effort: 'none' as const } : undefined;
            // Preserve each existing operation's wire shape, including its omitted stream field.
            return options.explicitStreamFalse
                ? { model, stream: false, max_tokens: request.maxOutputTokens,
                    ...(reasoning ? { reasoning } : {}), messages: request.messages }
                : { model, messages: request.messages, max_tokens: request.maxOutputTokens,
                    ...(reasoning ? { reasoning } : {}) };
        },
        decodeCompletion: decodeChatCompletion,
    };
}

/** The Chat Completions result shape both routers return. */
export async function decodeChatCompletion(response: Response): Promise<AiCompletion> {
    const payload = await response.json() as {
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
        usage?: unknown;
    };
    const choice = payload?.choices?.[0];
    return { content: choice?.message?.content, finishReason: choice?.finish_reason, usage: payload?.usage };
}
