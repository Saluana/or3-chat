/**
 * Isomorphic OpenRouter SSE parser shared by foreground and background paths.
 * Framing follows the EventSource processing model; payload interpretation is
 * intentionally OpenRouter/OpenAI-specific.
 */
import {
    MAX_SSE_EVENT_BYTES,
    MAX_TOOL_ARGUMENT_BYTES,
    utf8Bytes,
} from '../chat/tool-limits';
import {
    OpenRouterProtocolError,
    OpenRouterProviderError,
    OpenRouterStreamError,
} from './errors';

export type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | {
          type: 'tool_call';
          tool_call: {
              id: string;
              type: 'function';
              function: { name: string; arguments: string };
          };
      }
    | { type: 'done' };

/**
 * Standard OpenAI-compatible providers send deltas. A small number of adapters
 * send the whole field on every update; they must opt into cumulative snapshots
 * explicitly so repeated standard deltas are never mistaken for replays.
 */
export type StreamedFieldMode = 'delta' | 'cumulative-snapshot';

export interface ParseOpenRouterSSEOptions {
    streamedFieldMode?: StreamedFieldMode;
}

interface ImageUrlObject { url?: string }
interface ContentPart {
    type?: string;
    text?: string;
    url?: string;
    image_url?: string | ImageUrlObject;
    media?: { url?: string };
    inline_data?: { url?: string };
}
interface ImagePart { url?: string; image_url?: ImageUrlObject }
interface ToolCallDelta {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
}
interface ReasoningDetail { type?: string; text?: string; summary?: string }
interface Delta {
    reasoning?: string;
    reasoning_details?: ReasoningDetail[];
    content?: string | ContentPart[];
    text?: string;
    tool_calls?: ToolCallDelta[];
    images?: ImagePart[];
}
interface Message { images?: ImagePart[]; content?: string | ContentPart[] }
interface ProviderErrorEnvelope {
    message?: string;
    code?: string | number;
    status?: number;
    metadata?: { raw?: string };
}
interface Choice {
    delta?: Delta;
    message?: Message;
    finish_reason?: string | null;
    error?: ProviderErrorEnvelope | string;
}
interface ParsedChunk {
    choices?: Choice[];
    error?: ProviderErrorEnvelope | string;
}
interface AccumulatedToolCall {
    id: string | undefined;
    type: 'function';
    function: { name: string; arguments: string };
    yielded: boolean;
    argumentsExceeded: boolean;
}

const ERROR_FINISH_REASONS = new Set([
    'error',
    'failed',
    'cancelled',
    'content_filter',
]);

function mergeStreamedField(
    previous: string,
    next: string,
    mode: StreamedFieldMode
): string {
    if (!next) return previous;
    return mode === 'cumulative-snapshot' ? next : previous + next;
}

function providerErrorMessage(error: ProviderErrorEnvelope | string): string {
    if (typeof error === 'string') return error || 'Provider stream failed';
    return error.message || error.metadata?.raw || 'Provider stream failed';
}

function throwProviderError(
    error: ProviderErrorEnvelope | string,
    finishReason?: string
): never {
    const envelope = typeof error === 'string' ? undefined : error;
    throw new OpenRouterProviderError(providerErrorMessage(error), {
        status: envelope?.status,
        providerCode: envelope?.code,
        finishReason,
        retryable:
            envelope?.status === 429 ||
            (typeof envelope?.status === 'number' && envelope.status >= 500),
    });
}

/** Parse an upstream OpenRouter SSE byte stream into normalized events. */
export async function* parseOpenRouterSSE(
    stream: ReadableStream<Uint8Array>,
    options: ParseOpenRouterSSEOptions = {}
): AsyncGenerator<ORStreamEvent, void, unknown> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const streamedFieldMode = options.streamedFieldMode ?? 'delta';
    const emittedImages = new Set<string>();
    const textStreamedByChoice = new Map<number, boolean>();
    const toolCallMap = new Map<string, AccumulatedToolCall>();
    let buffer = '';
    let dataLines: string[] = [];
    let sourceDone = false;

    const extractImageUrl = (part: ContentPart): string | null => {
        if (typeof part !== 'object') return null;
        const imageUrl = part.image_url;
        const imageUrlString =
            typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;
        return (
            imageUrlString ||
            part.url ||
            (part.type === 'media' ? part.media?.url : undefined) ||
            (part.type === 'image' ? part.inline_data?.url : undefined) ||
            null
        );
    };

    const imageEvent = (
        url: string | undefined | null,
        index: number,
        final: boolean
    ): ORStreamEvent | null => {
        if (!url || emittedImages.has(url)) return null;
        emittedImages.add(url);
        return { type: 'image', url, final, index };
    };

    const parsePayload = (data: string): ORStreamEvent[] | 'done' => {
        if (data.trim() === '[DONE]') return 'done';
        if (data.length === 0) return [];

        let parsed: ParsedChunk;
        try {
            parsed = JSON.parse(data) as ParsedChunk;
        } catch {
            throw new OpenRouterProtocolError('Malformed JSON in OpenRouter SSE event');
        }

        if (parsed.error) throwProviderError(parsed.error);

        const events: ORStreamEvent[] = [];
        const choices = parsed.choices ?? [];
        for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
            const choice = choices[choiceIndex];
            if (!choice) continue;
            if (choice.error) throwProviderError(choice.error);
            const finishReason = choice.finish_reason ?? undefined;
            if (finishReason && ERROR_FINISH_REASONS.has(finishReason)) {
                throwProviderError(
                    `Provider ended the stream with finish reason: ${finishReason}`,
                    finishReason
                );
            }

            const delta = choice.delta ?? {};
            let reasoningYielded = false;
            if (Array.isArray(delta.reasoning_details)) {
                for (const detail of delta.reasoning_details) {
                    const text =
                        detail.type === 'reasoning.text'
                            ? detail.text
                            : detail.type === 'reasoning.summary'
                              ? detail.summary
                              : undefined;
                    if (text) {
                        events.push({ type: 'reasoning', text });
                        reasoningYielded = true;
                    }
                }
            }
            if (!reasoningYielded && delta.reasoning) {
                events.push({ type: 'reasoning', text: delta.reasoning });
            }

            const stageText = (text: string) => {
                textStreamedByChoice.set(choiceIndex, true);
                events.push({ type: 'text', text });
            };
            if (Array.isArray(delta.content)) {
                for (const part of delta.content) {
                    if (part.type === 'text' && part.text) stageText(part.text);
                }
            } else if (delta.text) {
                stageText(delta.text);
            } else if (typeof delta.content === 'string' && delta.content) {
                stageText(delta.content);
            }

            if (Array.isArray(delta.tool_calls)) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index ?? 0;
                    const mapKey = `idx_${choiceIndex}_${index}`;
                    let accumulated = toolCallMap.get(mapKey);
                    if (!accumulated) {
                        accumulated = {
                            id: undefined,
                            type: 'function',
                            function: { name: '', arguments: '' },
                            yielded: false,
                            argumentsExceeded: false,
                        };
                        toolCallMap.set(mapKey, accumulated);
                    }
                    if (toolCallDelta.id && !accumulated.id) {
                        accumulated.id = toolCallDelta.id;
                    }
                    const fn = toolCallDelta.function;
                    if (fn?.name) {
                        accumulated.function.name = mergeStreamedField(
                            accumulated.function.name,
                            fn.name,
                            streamedFieldMode
                        );
                    }
                    if (typeof fn?.arguments === 'string' && !accumulated.argumentsExceeded) {
                        const merged = mergeStreamedField(
                            accumulated.function.arguments,
                            fn.arguments,
                            streamedFieldMode
                        );
                        if (utf8Bytes(merged) > MAX_TOOL_ARGUMENT_BYTES) {
                            accumulated.function.arguments = JSON.stringify({
                                _or3_error: `Tool arguments exceed ${MAX_TOOL_ARGUMENT_BYTES} UTF-8 bytes`,
                            });
                            accumulated.argumentsExceeded = true;
                        } else {
                            accumulated.function.arguments = merged;
                        }
                    }
                }
            }

            if (finishReason && toolCallMap.size > 0) {
                for (const [mapKey, toolCall] of toolCallMap) {
                    if (toolCall.yielded || !toolCall.function.name) continue;
                    const index = Number(mapKey.split('_').pop() ?? '0');
                    events.push({
                        type: 'tool_call',
                        tool_call: {
                            id:
                                toolCall.id ||
                                `or3_tool_call_${index}_${crypto.randomUUID().slice(0, 8)}`,
                            type: 'function',
                            function: { ...toolCall.function },
                        },
                    });
                    toolCall.yielded = true;
                }
            }

            if (Array.isArray(delta.images)) {
                delta.images.forEach((img, index) => {
                    const event = imageEvent(img.image_url?.url || img.url, index, false);
                    if (event) events.push(event);
                });
            }
            if (Array.isArray(delta.content)) {
                delta.content.forEach((part, index) => {
                    const event = imageEvent(extractImageUrl(part), index, false);
                    if (event) events.push(event);
                });
            }
            if (Array.isArray(choice.message?.images)) {
                choice.message.images.forEach((img, index) => {
                    const event = imageEvent(img.image_url?.url || img.url, index, true);
                    if (event) events.push(event);
                });
            }

            const finalContent = choice.message?.content;
            if (Array.isArray(finalContent)) {
                finalContent.forEach((part, index) => {
                    if (
                        part.type === 'text' &&
                        part.text &&
                        !textStreamedByChoice.get(choiceIndex)
                    ) {
                        stageText(part.text);
                    }
                    const event = imageEvent(extractImageUrl(part), index, true);
                    if (event) events.push(event);
                });
            } else if (
                typeof finalContent === 'string' &&
                finalContent.length > 0 &&
                !textStreamedByChoice.get(choiceIndex)
            ) {
                stageText(finalContent);
            }
        }
        return events;
    };

    const acceptLine = (line: string): string | null => {
        if (line.length === 0) {
            if (dataLines.length === 0) return null;
            const data = dataLines.join('\n');
            dataLines = [];
            return data;
        }
        if (line.startsWith(':')) return null;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') {
            dataLines.push(value);
            if (utf8Bytes(dataLines.join('\n')) > MAX_SSE_EVENT_BYTES) {
                throw new OpenRouterProtocolError(
                    `SSE event exceeds ${MAX_SSE_EVENT_BYTES} UTF-8 bytes`
                );
            }
        }
        return null;
    };

    const pullLine = (atEof: boolean): string | null => {
        for (let index = 0; index < buffer.length; index += 1) {
            const char = buffer[index];
            if (char !== '\n' && char !== '\r') continue;
            if (char === '\r' && index === buffer.length - 1 && !atEof) return null;
            const line = buffer.slice(0, index);
            const width = char === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
            buffer = buffer.slice(index + width);
            return line;
        }
        if (atEof && buffer.length > 0) {
            const line = buffer;
            buffer = '';
            return line;
        }
        return null;
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            sourceDone = done;
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (utf8Bytes(buffer) > MAX_SSE_EVENT_BYTES) {
                throw new OpenRouterProtocolError(
                    `SSE line exceeds ${MAX_SSE_EVENT_BYTES} UTF-8 bytes`
                );
            }

            for (;;) {
                const line = pullLine(done);
                if (line === null) break;
                const payload = acceptLine(line);
                if (payload === null) continue;
                const result = parsePayload(payload);
                if (result === 'done') {
                    yield { type: 'done' };
                    return;
                }
                for (const event of result) yield event;
            }

            if (done) {
                if (dataLines.length > 0) {
                    const result = parsePayload(dataLines.join('\n'));
                    dataLines = [];
                    if (result === 'done') {
                        yield { type: 'done' };
                        return;
                    }
                    for (const event of result) yield event;
                }
                yield { type: 'done' };
                return;
            }
        }
    } catch (error) {
        if (
            error instanceof OpenRouterStreamError ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            throw error;
        }
        throw new OpenRouterStreamError(
            error instanceof Error ? error.message : 'OpenRouter stream transport failed',
            { status: 0, retryable: true, kind: 'transport' }
        );
    } finally {
        if (!sourceDone) {
            await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
    }
}

export function eventToSSE(evt: ORStreamEvent): string {
    return `data: ${JSON.stringify(evt)}\n\n`;
}
