import type { ORStreamEvent } from './types';

export async function* openRouterStream(params: {
    apiKey: string;
    model: string;
    orMessages: any[];
    modalities: string[];
    signal?: AbortSignal;
}): AsyncGenerator<ORStreamEvent, void, unknown> {
    const { apiKey, model, orMessages, modalities, signal } = params;

    const body = {
        model,
        messages: orMessages,
        modalities,
        stream: true,
    } as any;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
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

                    // Handle model reasoning
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
                            }
                        } else if (
                            choice?.delta?.reasoning_details[0]?.type ===
                            'reasoning.summary'
                        ) {
                            yield {
                                type: 'reasoning',
                                text: choice.delta.reasoning_details[0].summary,
                            };
                        }
                    }

                    // Text variants
                    if (Array.isArray(delta.content)) {
                        for (const part of delta.content) {
                            if (part?.type === 'text' && part.text) {
                                yield { type: 'text', text: part.text };
                            }
                        }
                    }
                    if (typeof delta.text === 'string') {
                        yield { type: 'text', text: delta.text };
                    }
                    if (typeof delta.content === 'string') {
                        yield { type: 'text', text: delta.content };
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

                    // Or inside message.content array (Gemini style)
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
