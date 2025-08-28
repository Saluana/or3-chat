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
        throw new Error(
            `OpenRouter request failed ${resp.status} ${resp.statusText}`
        );
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emittedImages = new Set<string>();

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

                    // Streaming images
                    if (Array.isArray(delta.images)) {
                        let ix = 0;
                        for (const img of delta.images) {
                            const url = img?.image_url?.url || img?.url;
                            if (url && !emittedImages.has(url)) {
                                emittedImages.add(url);
                                yield { type: 'image', url, index: ix++ };
                            }
                        }
                    }

                    // Final message images
                    const finalImages = choice.message?.images;
                    if (Array.isArray(finalImages)) {
                        let fIx = 0;
                        for (const img of finalImages) {
                            const url = img?.image_url?.url || img?.url;
                            if (url && !emittedImages.has(url)) {
                                emittedImages.add(url);
                                yield {
                                    type: 'image',
                                    url,
                                    final: true,
                                    index: fIx++,
                                };
                            }
                        }
                    }
                }
            } catch {
                // ignore invalid json segments
            }
        }
    }

    yield { type: 'done' };
}
