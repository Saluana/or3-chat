import type { ORStreamEvent, ToolChoice, ToolDefinition } from './types';

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

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emittedImages = new Set<string>();
    // Removed rawPackets accumulation to avoid unbounded memory growth on long streams.
    // If debugging of raw packets is needed, consider adding a bounded ring buffer
    // or an opt-in flag that logs selectively.

    // Track tool calls being streamed across chunks
    // Maps tool call id -> accumulated tool call data
    const toolCallMap = new Map<string, any>();

    function emitImageCandidate(
        url: string | undefined | null,
        indexRef: { v: number },
        final = false
    ) {
        if (!url) return;
        if (emittedImages.has(url)) return;
        emittedImages.add(url);
        const idx = indexRef.v++;
        // Yield image event
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => {
            /* placeholder for async transforms if needed */
        })();
        imageQueue.push({ type: 'image', url, final, index: idx });
    }

    // Queue to preserve ordering between text and image parts inside a single chunk
    const imageQueue: ORStreamEvent[] = [];

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

                    // Handle model reasoning (from reasoning field or reasoning_details)
                    // Some models (DeepSeek-R1) provide the same content in both delta.reasoning
                    // and delta.reasoning_details, so we prioritize reasoning_details to avoid duplicates
                    let reasoningYielded = false;

                    if (choice?.delta?.reasoning_details) {
                        if (
                            choice?.delta?.reasoning_details[0]?.type ===
                            'reasoning.text'
                        ) {
                            if (choice?.delta?.reasoning_details[0]?.text) {
                                yield {
                                    type: 'reasoning',
                                    text: choice.delta.reasoning_details[0]
                                        .text,
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
                        if (import.meta.dev) {
                            console.log(
                                '[openrouterStream] Received tool_calls delta:',
                                delta.tool_calls
                            );
                        }

                        for (const toolCallDelta of delta.tool_calls) {
                            const index = toolCallDelta.index ?? 0;

                            // Use index as the primary key since id may be undefined in subsequent chunks
                            const mapKey = `idx_${index}`;
                            const id = toolCallDelta.id;

                            // Initialize or retrieve existing tool call
                            if (!toolCallMap.has(mapKey)) {
                                if (import.meta.dev) {
                                    console.log(
                                        `[openrouterStream] Initializing new tool call at index ${index}, id: ${id}`
                                    );
                                }
                                toolCallMap.set(mapKey, {
                                    id: id || null, // May be set later
                                    type: toolCallDelta.type || 'function',
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
                                if (import.meta.dev) {
                                    console.log(
                                        `[openrouterStream] Setting id for index ${index}: ${id}`
                                    );
                                }
                                accumulated.id = id;
                            }

                            // Accumulate function name
                            if (toolCallDelta.function?.name) {
                                if (import.meta.dev) {
                                    console.log(
                                        `[openrouterStream] Setting function name at index ${index}: ${toolCallDelta.function.name}`
                                    );
                                }
                                accumulated.function.name =
                                    toolCallDelta.function.name;
                            }

                            // Accumulate function arguments (streamed incrementally)
                            if (toolCallDelta.function?.arguments) {
                                if (import.meta.dev) {
                                    console.log(
                                        `[openrouterStream] Appending arguments chunk (${toolCallDelta.function.arguments.length} chars) at index ${index}`
                                    );
                                }
                                accumulated.function.arguments +=
                                    toolCallDelta.function.arguments;
                            }

                            if (import.meta.dev) {
                                console.log(
                                    `[openrouterStream] Tool call state at index ${index}:`,
                                    {
                                        id: accumulated.id,
                                        name: accumulated.function.name,
                                        argsLength:
                                            accumulated.function.arguments
                                                .length,
                                        argsPreview:
                                            accumulated.function.arguments.slice(
                                                0,
                                                100
                                            ),
                                    }
                                );
                            }
                        }
                    }

                    // Log finish_reason for debugging
                    if (choice.finish_reason && import.meta.dev) {
                        console.log(
                            `[openrouterStream] finish_reason: ${choice.finish_reason}`,
                            {
                                toolCallMapSize: toolCallMap.size,
                                toolCallKeys: Array.from(toolCallMap.keys()),
                                toolCalls: Array.from(toolCallMap.values()).map(
                                    (tc) => ({
                                        id: tc.id,
                                        name: tc.function.name,
                                        argsLength:
                                            tc.function.arguments.length,
                                    })
                                ),
                            }
                        );
                    }

                    // Yield tool calls as soon as we receive finish_reason (streaming complete)
                    if (
                        choice.finish_reason === 'tool_calls' &&
                        toolCallMap.size > 0
                    ) {
                        if (import.meta.dev) {
                            console.log(
                                '[openrouterStream] finish_reason is "tool_calls", yielding accumulated tool calls...'
                            );
                        }

                        for (const toolCall of toolCallMap.values()) {
                            // Only yield if we have id, name, and arguments, and haven't yielded yet
                            if (
                                toolCall.id &&
                                toolCall.function.name &&
                                toolCall.function.arguments &&
                                !toolCall._yielded
                            ) {
                                const { _yielded, ...cleanToolCall } = toolCall;

                                if (import.meta.dev) {
                                    console.log(
                                        '[openrouterStream] Yielding tool_call:',
                                        {
                                            id: cleanToolCall.id,
                                            name: cleanToolCall.function.name,
                                            argsLength:
                                                cleanToolCall.function.arguments
                                                    .length,
                                            args: cleanToolCall.function
                                                .arguments,
                                        }
                                    );
                                }

                                yield {
                                    type: 'tool_call',
                                    tool_call: cleanToolCall,
                                };
                                toolCall._yielded = true;
                            } else if (import.meta.dev) {
                                console.warn(
                                    '[openrouterStream] Skipping incomplete tool call:',
                                    {
                                        id: toolCall.id,
                                        hasId: !!toolCall.id,
                                        hasName: !!toolCall.function.name,
                                        hasArgs: !!toolCall.function.arguments,
                                        alreadyYielded: toolCall._yielded,
                                    }
                                );
                            }
                        }
                    }

                    // Streaming images (legacy / OpenAI style delta.images array)
                    if (Array.isArray(delta.images)) {
                        let ixRef = { v: 0 };
                        for (const img of delta.images) {
                            const url = img?.image_url?.url || img?.url;
                            emitImageCandidate(url, ixRef, false);
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }

                    // Provider-specific: images may appear inside delta.content array parts with type 'image', 'image_url', 'media', or have inline_data
                    if (Array.isArray(delta.content)) {
                        let ixRef = { v: 0 };
                        for (const part of delta.content) {
                            if (part && typeof part === 'object') {
                                if (
                                    part.type === 'image' &&
                                    (part.url || part.image)
                                ) {
                                    emitImageCandidate(
                                        part.url || part.image,
                                        ixRef,
                                        false
                                    );
                                } else if (
                                    part.type === 'image_url' &&
                                    part.image_url?.url
                                ) {
                                    emitImageCandidate(
                                        part.image_url.url,
                                        ixRef,
                                        false
                                    );
                                } else if (
                                    part.type === 'media' &&
                                    part.media?.url
                                ) {
                                    emitImageCandidate(
                                        part.media.url,
                                        ixRef,
                                        false
                                    );
                                } else if (part.inline_data?.data) {
                                    // Gemini style inline base64 data
                                    const mime =
                                        part.inline_data.mimeType ||
                                        'image/png';
                                    const dataUrl = `data:${mime};base64,${part.inline_data.data}`;
                                    emitImageCandidate(dataUrl, ixRef, false);
                                }
                            }
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }

                    // Final message images
                    // Final images may be in message.images array
                    const finalImages = choice.message?.images;
                    if (Array.isArray(finalImages)) {
                        let fIxRef = { v: 0 };
                        for (const img of finalImages) {
                            const url = img?.image_url?.url || img?.url;
                            emitImageCandidate(url, fIxRef, true);
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }

                    // Or inside message.content array (Gemini/OpenAI final message style)
                    const finalContent = choice.message?.content;
                    if (Array.isArray(finalContent)) {
                        let fIxRef2 = { v: 0 };
                        for (const part of finalContent) {
                            if (
                                part?.type === 'image' &&
                                (part.url || part.image)
                            ) {
                                emitImageCandidate(
                                    part.url || part.image,
                                    fIxRef2,
                                    true
                                );
                            } else if (
                                part?.type === 'image_url' &&
                                part.image_url?.url
                            ) {
                                emitImageCandidate(
                                    part.image_url.url,
                                    fIxRef2,
                                    true
                                );
                            } else if (part?.inline_data?.data) {
                                const mime =
                                    part.inline_data.mimeType || 'image/png';
                                const dataUrl = `data:${mime};base64,${part.inline_data.data}`;
                                emitImageCandidate(dataUrl, fIxRef2, true);
                            }
                        }
                        while (imageQueue.length) yield imageQueue.shift()!;
                    }
                }
            } catch {
                // ignore invalid json segments
            }
        }
    }

    // Removed verbose final packet dump to prevent large memory retention.

    yield { type: 'done' };
}
