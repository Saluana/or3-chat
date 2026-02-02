/**
 * Composable for GPT tokenization.
 * Attempts to use a dedicated Web Worker on the client and dynamically imports
 * the encoder as a fallback (SSR-safe).
 */

import { onMounted, ref } from 'vue';

type EncodeFn = (text: string) => number[];

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

// Module-level worker state so all composable instances share the same worker
let workerInstance: Worker | null = null;
let workerPromise: Promise<Worker | null> | null = null;
let nextMessageId = 1;
const pendingRequests = new Map<number, PendingRequest>();

// Cached encoder used for fallback when worker is unavailable
let fallbackEncoder: EncodeFn | null = null;

const loadFallbackEncoder = async (): Promise<EncodeFn> => {
    if (!fallbackEncoder) {
        const { encode } = await import('gpt-tokenizer');
        fallbackEncoder = encode;
    }
    return fallbackEncoder;
};

const disposeWorker = () => {
    if (workerInstance) {
        workerInstance.terminate();
    }
    workerInstance = null;
    workerPromise = null;
};

const handleWorkerError = (error: Event | Error) => {
    console.error('[useTokenizer] Worker error:', error);

    for (const [id, pending] of pendingRequests.entries()) {
        pending.reject(new Error('Tokenizer worker failed'));
        pendingRequests.delete(id);
    }

    disposeWorker();
};

const setupWorker = (worker: Worker) => {
    worker.onmessage = (event: MessageEvent) => {
        const { id, type, count, counts, error } = event.data as {
            id: number;
            type: 'result' | 'batch-result' | 'error';
            count?: number;
            counts?: Record<string, number>;
            error?: string;
        };

        const pending = pendingRequests.get(id);
        if (!pending) return;

        pendingRequests.delete(id);

        if (type === 'error') {
            pending.reject(new Error(error || 'Tokenizer worker error'));
            return;
        }

        if (type === 'result') {
            pending.resolve(count ?? 0);
            return;
        }

        // After narrowing from 'error' and 'result', type must be 'batch-result'
        pending.resolve(counts ?? {});
    };

    worker.onerror = handleWorkerError;
    worker.addEventListener('messageerror', handleWorkerError);
};

const ensureWorker = async (): Promise<Worker | null> => {
    if (!import.meta.client) return null;
    if (workerInstance) return workerInstance;
    
    // Use atomic promise initialization to prevent race conditions
    if (!workerPromise) {
        workerPromise = (async () => {
            try {
                const worker = new Worker(
                    new URL('../../workers/tokenizer.worker.ts', import.meta.url),
                    { type: 'module' }
                );
                setupWorker(worker);
                workerInstance = worker;
                return workerInstance;
            } catch (error) {
                console.warn('[useTokenizer] Failed to initialize worker:', error);
                workerInstance = null;
                workerPromise = null;
                return null;
            }
        })();
    }

    return workerPromise;
};

const fallbackCountSingle = async (text: string) => {
    if (!text) return 0;
    const encode = await loadFallbackEncoder();
    return encode(text).length;
};

const fallbackCountBatch = async (
    items: Array<{ key: string; text: string }>
) => {
    if (!items.length) return {} as Record<string, number>;
    const encode = await loadFallbackEncoder();
    const counts: Record<string, number> = {};

    for (const { key, text } of items) {
        counts[key] = text ? encode(text).length : 0;
    }

    return counts;
};

const runWorkerRequest = async <T>(
    payload: Record<string, unknown>,
    fallback: () => Promise<T>
): Promise<T> => {
    if (!process.client) return fallback();

    const worker = await ensureWorker();
    if (!worker) return fallback();

    const id = nextMessageId++;

    return new Promise<T>((resolve, reject) => {
        pendingRequests.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
        });

        try {
            worker.postMessage({ id, ...payload });
        } catch (error) {
            pendingRequests.delete(id);
            reject(error as Error);
        }
    }).catch(async (error) => {
        console.warn(
            '[useTokenizer] Worker request failed, falling back:',
            error
        );
        return fallback();
    });
};

/**
 * `useTokenizer`
 *
 * Purpose:
 * Counts tokens using a shared worker with a fallback encoder.
 *
 * Behavior:
 * Uses a Web Worker on the client when available and falls back to
 * `gpt-tokenizer` via dynamic import when worker setup fails.
 *
 * Constraints:
 * - Worker is client-only and skipped during SSR
 * - Token counts are approximate to the underlying tokenizer
 *
 * Non-Goals:
 * - Does not cache token results by input
 * - Does not expose tokenization details beyond counts
 *
 * @example
 * ```ts
 * const { countTokens } = useTokenizer();
 * const tokens = await countTokens('Hello world');
 * ```
 */
export function useTokenizer() {
    const isReady = ref(!process.client);

    onMounted(async () => {
        await ensureWorker();
        isReady.value = true;
    });

    const countTokens = async (text: string): Promise<number> => {
        if (!text) return 0;
        return runWorkerRequest<number>({ type: 'encode', text }, () =>
            fallbackCountSingle(text)
        );
    };

    const countTokensBatch = async (
        items: Array<{ key: string; text: string }>
    ): Promise<Record<string, number>> => {
        if (!items.length) return {};
        return runWorkerRequest<Record<string, number>>(
            {
                type: 'batch',
                texts: items.map((item) => item.text),
                keys: items.map((item) => item.key),
            },
            () => fallbackCountBatch(items)
        );
    };

    return {
        countTokens,
        countTokensBatch,
        isReady,
    };
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        disposeWorker();
        pendingRequests.clear();
    });
}
