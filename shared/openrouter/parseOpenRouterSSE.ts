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
    | {
          type: 'tool_call';
          tool_call: {
              id: string;
              type: 'function';
              function: { name: string; arguments: string };
          };
      }
    | { type: 'done' };

// Internal types for OpenRouter SSE parsing
interface ImageUrlObject {
    url?: string;
}

interface ContentPart {
    type?: string;
    text?: string;
    url?: string;
    image_url?: string | ImageUrlObject;
    media?: { url?: string };
    inline_data?: { url?: string };
}

interface ImagePart {
    url?: string;
    image_url?: ImageUrlObject;
}

interface ToolCallDelta {
    index?: number;
    id?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
}

interface ReasoningDetail {
    type?: string;
    text?: string;
    summary?: string;
}

interface Delta {
    reasoning?: string;
    reasoning_details?: ReasoningDetail[];
    content?: string | ContentPart[];
    text?: string;
    tool_calls?: ToolCallDelta[];
    images?: ImagePart[];
}

interface Message {
    images?: ImagePart[];
    content?: ContentPart[];
}

interface Choice {
    delta?: Delta;
    message?: Message;
    finish_reason?: string;
}

interface ParsedChunk {
    choices?: Choice[];
}

interface AccumulatedToolCall {
    id: string | undefined;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
    _yielded: boolean;
}

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
    const toolCallMap = new Map<string, AccumulatedToolCall>();

    /**
     * Extract image URL from various provider-specific part formats.
     * Handles OpenAI, Gemini, and other provider variations.
     */
    function extractImageUrl(part: ContentPart): string | null {
        if (typeof part !== 'object') return null;

        const imageUrl = part.image_url;
        const imageUrlStr =
            typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;

        return (
            imageUrlStr ||
            part.url ||
            (part.type === 'image' && part.url) ||
            (part.type === 'image_url' && imageUrlStr) ||
            (part.type === 'media' && part.media?.url) ||
            (part.type === 'image' && part.inline_data?.url) ||
            null
        );
    }

    function emitImageCandidate(
        url: string | undefined | null,
        indexRef: { v: number },
        final = false
    ): ORStreamEvent | null {
        if (url == null) return null;
        if (emittedImages.has(url)) return null;
        emittedImages.add(url);
        const idx = indexRef.v++;
        return { type: 'image', url, final, index: idx };
    }

    try {
        for (;;) {
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
                    const parsed = JSON.parse(data) as ParsedChunk;
                    const choices: Choice[] = parsed.choices || [];
                    for (const choice of choices) {
                        const delta: Delta = choice.delta || {};

                        // Handle model reasoning
                        let reasoningYielded = false;

                        const reasoningDetails =
                            choice.delta?.reasoning_details;
                        const firstReasoningDetail = reasoningDetails?.[0];
                        if (firstReasoningDetail) {
                            if (
                                firstReasoningDetail.type === 'reasoning.text'
                            ) {
                                if (firstReasoningDetail.text) {
                                    yield {
                                        type: 'reasoning',
                                        text: firstReasoningDetail.text,
                                    };
                                    reasoningYielded = true;
                                }
                            } else if (
                                firstReasoningDetail.type ===
                                'reasoning.summary'
                            ) {
                                const summary = firstReasoningDetail.summary;
                                if (summary) {
                                    yield {
                                        type: 'reasoning',
                                        text: summary,
                                    };
                                    reasoningYielded = true;
                                }
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
                                if (part.type === 'text' && part.text) {
                                    yield { type: 'text', text: part.text };
                                }
                            }
                        }
                        if (typeof delta.text === 'string' && delta.text) {
                            yield { type: 'text', text: delta.text };
                        }
                        if (
                            typeof delta.content === 'string' &&
                            delta.content
                        ) {
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
                                    accumulated.function.name +=
                                        toolCallDelta.function.name;
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
                                                arguments:
                                                    toolCall.function.arguments,
                                            },
                                        },
                                    };
                                    toolCall._yielded = true;
                                }
                            }
                        }

                        // Streaming images (legacy / OpenAI style delta.images array)
                        if (Array.isArray(delta.images)) {
                            const ixRef = { v: 0 };
                            for (const img of delta.images) {
                                const url = img.image_url?.url || img.url;
                                const evt = emitImageCandidate(
                                    url,
                                    ixRef,
                                    false
                                );
                                if (evt) yield evt;
                            }
                        }

                        // Provider-specific: images may appear inside delta.content array parts
                        if (Array.isArray(delta.content)) {
                            const ixRef = { v: 0 };
                            for (const part of delta.content) {
                                const url = extractImageUrl(part);
                                const evt = emitImageCandidate(
                                    url,
                                    ixRef,
                                    false
                                );
                                if (evt) yield evt;
                            }
                        }

                        // Final message images
                        const finalImages = choice.message?.images;
                        if (Array.isArray(finalImages)) {
                            const fIxRef = { v: 0 };
                            for (const img of finalImages) {
                                const url = img.image_url?.url || img.url;
                                const evt = emitImageCandidate(
                                    url,
                                    fIxRef,
                                    true
                                );
                                if (evt) yield evt;
                            }
                        }

                        // Or inside message.content array (Gemini/OpenAI final message style)
                        const finalContent = choice.message?.content;
                        if (Array.isArray(finalContent)) {
                            const fIxRef2 = { v: 0 };
                            for (const part of finalContent) {
                                const url = extractImageUrl(part);
                                const evt = emitImageCandidate(
                                    url,
                                    fIxRef2,
                                    true
                                );
                                if (evt) yield evt;
                            }
                        }
                    }
                } catch (parseError) {
                    // Log parse errors in dev for debugging
                    if (import.meta.dev) {
                        console.warn(
                            '[parseOpenRouterSSE] Failed to parse SSE chunk:',
                            { line, parseError }
                        );
                    }
                    // Skip malformed chunk
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
