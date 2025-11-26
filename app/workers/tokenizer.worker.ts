/// <reference lib="webworker" />

export {};

/**
 * Web Worker for GPT tokenization
 * Offloads heavy tokenization to a background thread
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

type EncodeFn = (text: string) => number[];

let encoder: EncodeFn | null = null;

const ensureEncoder = async (): Promise<EncodeFn> => {
    if (!encoder) {
        const { encode } = await import('gpt-tokenizer');
        encoder = encode;
    }
    return encoder;
};

interface EncodeRequest {
    id: number;
    type: 'encode';
    text: string;
}

interface BatchRequest {
    id: number;
    type: 'batch';
    texts: string[];
    keys?: string[];
}

type TokenizerRequest = EncodeRequest | BatchRequest;

type TokenizerResponse =
    | { id: number; type: 'result'; count: number }
    | { id: number; type: 'batch-result'; counts: Record<string, number> }
    | { id: number; type: 'error'; error: string };

const postMessage = (message: TokenizerResponse) => {
    ctx.postMessage(message);
};

ctx.addEventListener('message', (event: MessageEvent<TokenizerRequest>) => {
    void handleMessage(event);
});

async function handleMessage(event: MessageEvent<TokenizerRequest>) {
    const { id, type } = event.data;

    try {
        const encode = await ensureEncoder();

        if (type === 'encode') {
            const count = event.data.text ? encode(event.data.text).length : 0;
            postMessage({ id, type: 'result', count });
            return;
        }

        const { texts, keys } = event.data;
        const counts: Record<string, number> = {};

        for (let index = 0; index < texts.length; index++) {
            const key = keys?.[index] ?? String(index);
            const text = texts[index] ?? '';
            counts[key] = text ? encode(text).length : 0;
        }

        postMessage({ id, type: 'batch-result', counts });
    } catch (error) {
        postMessage({
            id,
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
