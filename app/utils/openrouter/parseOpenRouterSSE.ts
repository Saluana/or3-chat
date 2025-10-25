/**
 * Isomorphic OpenRouter SSE parser.
 * Used by both server route and client fallback to normalize upstream SSE into ORStreamEvent.
 * 
 * Note: ORStreamEvent type is also defined in app/utils/chat/types.ts.
 * They are kept in sync manually; both are the source of truth for their respective modules.
 * This avoids complex path resolution issues across shared/server/client boundaries.
 */

export type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; tool_call: { id: string; type: 'function'; function: { name: string; arguments: string } } }
    | { type: 'done' };

/**
 * Parse upstream OpenRouter SSE stream and yield normalized ORStreamEvent.
 * Handles reasoning, text, images, and tool calls across streaming chunks.
 */
export async function* parseOpenRouterSSE(
    stream: ReadableStream<Uint8Array>
): AsyncGenerator<ORStreamEvent, void, unknown> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emittedImages = new Set<string>();

    // Track tool calls being streamed across chunks
    const toolCallMap = new Map<string, any>();

    function emitImageCandidate(
        url: string | undefined | null,
        indexRef: { v: number },
        final = false
    ): ORStreamEvent | null {
        if (!url) return null;
        if (emittedImages.has(url)) return null;
        emittedImages.add(url);
        const idx = indexRef.v++;
        return { type: 'image', url, final, index: idx };
    }

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const raw of lines) {
                const line = raw.trim();
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data) continue;
                if (data === '[DONE]') {
                    yield { type: 'done' };
                    continue;
                }
                try {
                    const parsed = JSON.parse(data);
                    const choices = parsed.choices || [];
                    for (const choice of choices) {
                        const delta = choice.delta || {};

                        // Handle model reasoning
                        let reasoningYielded = false;

                        if (choice?.delta?.reasoning_details) {
                            if (
                                choice?.delta?.reasoning_details[0]?.type ===
                                'reasoning.text'
                            ) {
                                if (choice?.delta?.reasoning_details[0]?.text) {
                                    yield {
                                        type: 'reasoning',
                                        text: choice.delta.reasoning_details[0].text,
                                    };
                                    reasoningYielded = true;
                                }
                            } else if (
                                choice?.delta?.reasoning_details[0]?.type ===
                                'reasoning.summary'
                            ) {
                                yield {
                                    type: 'reasoning',
                                    text: choice.delta.reasoning_details[0].summary,
                                };
                                reasoningYielded = true;
                            }
                        }

                        // Only yield delta.reasoning if we haven't already yielded from reasoning_details
                        if (
                            !reasoningYielded &&
                            typeof delta.reasoning === 'string' &&
                            delta.reasoning
                        ) {
                            yield {
                                type: 'reasoning',
                                text: delta.reasoning,
                            };
                        }

                        // Text variants
                        if (Array.isArray(delta.content)) {
                            for (const part of delta.content) {
                                if (part?.type === 'text' && part.text) {
                                    yield { type: 'text', text: part.text };
                                }
                            }
                        }
                        if (typeof delta.text === 'string' && delta.text) {
                            yield { type: 'text', text: delta.text };
                        }
                        if (typeof delta.content === 'string' && delta.content) {
                            yield { type: 'text', text: delta.content };
                        }

                        // Accumulate tool calls across streaming chunks
                        if (Array.isArray(delta.tool_calls)) {
                            for (const toolCallDelta of delta.tool_calls) {
                                const index = toolCallDelta.index ?? 0;
                                const mapKey = `idx_${index}`;
                                const id = toolCallDelta.id;

                                // Initialize or retrieve existing tool call
                                if (!toolCallMap.has(mapKey)) {
                                    toolCallMap.set(mapKey, {
                                        id: undefined,
                                        type: 'function',
                                        function: {
                                            name: '',
                                            arguments: '',
                                        },
                                        _yielded: false,
                                    });
                                }

                                const accumulated = toolCallMap.get(mapKey)!;

                                // Set id if it wasn't set before and is now available
                                if (id && !accumulated.id) {
                                    accumulated.id = id;
                                }

                                // Accumulate function name
                                if (toolCallDelta.function?.name) {
                                    accumulated.function.name += toolCallDelta.function.name;
                                }

                                // Accumulate function arguments (streamed incrementally)
                                if (toolCallDelta.function?.arguments) {
                                    accumulated.function.arguments +=
                                        toolCallDelta.function.arguments;
                                }
                            }
                        }

                        // Yield tool calls as soon as we receive finish_reason
                        if (
                            choice.finish_reason === 'tool_calls' &&
                            toolCallMap.size > 0
                        ) {
                            for (const toolCall of toolCallMap.values()) {
                                // Only yield if we have id, name, and arguments, and haven't yielded yet
                                if (
                                    toolCall.id &&
                                    toolCall.function.name &&
                                    toolCall.function.arguments &&
                                    !toolCall._yielded
                                ) {
                                    yield {
                                        type: 'tool_call',
                                        tool_call: {
                                            id: toolCall.id,
                                            type: 'function',
                                            function: {
                                                name: toolCall.function.name,
                                                arguments: toolCall.function.arguments,
                                            },
                                        },
                                    };
                                    toolCall._yielded = true;
                                }
                            }
                        }

                        // Streaming images (legacy / OpenAI style delta.images array)
                        if (Array.isArray(delta.images)) {
                            let ixRef = { v: 0 };
                            for (const img of delta.images) {
                                const url = img?.image_url?.url || img?.url;
                                const evt = emitImageCandidate(url, ixRef, false);
                                if (evt) yield evt;
                            }
                        }

                        // Provider-specific: images may appear inside delta.content array parts
                        if (Array.isArray(delta.content)) {
                            let ixRef = { v: 0 };
                            for (const part of delta.content) {
                                if (part && typeof part === 'object') {
                                    const url =
                                        part.image_url?.url ||
                                        part.url ||
                                        (part.type === 'image' && part.url) ||
                                        (part.type === 'image_url' &&
                                            (typeof part.image_url === 'string'
                                                ? part.image_url
                                                : part.image_url?.url)) ||
                                        (part.type === 'media' && part.media?.url) ||
                                        (part.type === 'image' &&
                                            part.inline_data?.url);
                                    const evt = emitImageCandidate(url, ixRef, false);
                                    if (evt) yield evt;
                                }
                            }
                        }

                        // Final message images
                        const finalImages = choice.message?.images;
                        if (Array.isArray(finalImages)) {
                            let fIxRef = { v: 0 };
                            for (const img of finalImages) {
                                const url = img?.image_url?.url || img?.url;
                                const evt = emitImageCandidate(url, fIxRef, true);
                                if (evt) yield evt;
                            }
                        }

                        // Or inside message.content array (Gemini/OpenAI final message style)
                        const finalContent = choice.message?.content;
                        if (Array.isArray(finalContent)) {
                            let fIxRef2 = { v: 0 };
                            for (const part of finalContent) {
                                if (part && typeof part === 'object') {
                                    const url =
                                        part.image_url?.url ||
                                        part.url ||
                                        (part.type === 'image' && part.url) ||
                                        (part.type === 'image_url' &&
                                            (typeof part.image_url === 'string'
                                                ? part.image_url
                                                : part.image_url?.url)) ||
                                        (part.type === 'media' && part.media?.url) ||
                                        (part.type === 'image' &&
                                            part.inline_data?.url);
                                    const evt = emitImageCandidate(url, fIxRef2, true);
                                    if (evt) yield evt;
                                }
                            }
                        }
                    }
                } catch {
                    // ignore invalid json segments
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    yield { type: 'done' };
}

/**
 * Helper: Convert an ORStreamEvent into SSE line format.
 */
export function eventToSSE(evt: ORStreamEvent): string {
    return `data: ${JSON.stringify(evt)}\n\n`;
}
