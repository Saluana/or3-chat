import { OpenRouterStreamError } from './errors';

export const DEFAULT_UPSTREAM_RESPONSE_TIMEOUT_MS = 30_000;
export const DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS = 45_000;
export const DEFAULT_BACKGROUND_START_TIMEOUT_MS = 15_000;

export type UpstreamTimeoutPhase = 'response' | 'idle';

/** Typed distinction between an upstream deadline and a caller cancellation. */
export class OpenRouterTimeoutError extends OpenRouterStreamError {
    readonly phase: UpstreamTimeoutPhase;
    readonly timeoutMs: number;

    constructor(phase: UpstreamTimeoutPhase, timeoutMs: number) {
        super(
            phase === 'response'
                ? `OpenRouter response headers timed out after ${timeoutMs}ms`
                : `OpenRouter stream was idle for ${timeoutMs}ms`,
            { status: 408, retryable: true, kind: 'transport' }
        );
        this.name = 'OpenRouterTimeoutError';
        this.phase = phase;
        this.timeoutMs = timeoutMs;
    }
}

function abortError(signal?: AbortSignal): Error {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
}

/** Fetch whose timeout covers the otherwise-unbounded wait for response headers. */
export async function fetchWithResponseDeadline(
    input: RequestInfo | URL,
    init: RequestInit = {},
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Response> {
    const callerSignal = options.signal ?? init.signal ?? undefined;
    const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_RESPONSE_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    let rejectBoundary!: (error: Error) => void;
    const boundary = new Promise<never>((_resolve, reject) => {
        rejectBoundary = reject;
    });
    const onAbort = () => {
        controller.abort(callerSignal?.reason);
        rejectBoundary(abortError(callerSignal));
    };
    const timer = setTimeout(() => {
        timedOut = true;
        const error = new OpenRouterTimeoutError('response', timeoutMs);
        controller.abort(error);
        rejectBoundary(error);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
        if (callerSignal?.aborted) onAbort();
        else callerSignal?.addEventListener('abort', onAbort, { once: true });
        return await Promise.race([
            fetch(input, { ...init, signal: controller.signal }),
            boundary,
        ]);
    } catch (error) {
        if (timedOut) {
            throw error instanceof OpenRouterTimeoutError
                ? error
                : new OpenRouterTimeoutError('response', timeoutMs);
        }
        if (callerSignal?.aborted) throw abortError(callerSignal);
        throw error;
    } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onAbort);
    }
}

/** Wrap a response body so every pending read has an idle and caller-abort bound. */
export function withIdleWatchdog(
    stream: ReadableStream<Uint8Array>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS;
    let settled = false;

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (settled) return;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let onAbort: (() => void) | undefined;
            try {
                const result = await new Promise<{
                    done: boolean;
                    value?: Uint8Array<ArrayBufferLike>;
                }>(
                    (resolve, reject) => {
                        timer = setTimeout(() => {
                            reject(new OpenRouterTimeoutError('idle', timeoutMs));
                            void reader.cancel('idle timeout');
                        }, timeoutMs);
                        if (typeof timer.unref === 'function') timer.unref();
                        onAbort = () => {
                            reject(abortError(options.signal));
                            void reader.cancel(options.signal?.reason);
                        };
                        if (options.signal?.aborted) onAbort();
                        else options.signal?.addEventListener('abort', onAbort, { once: true });
                        void reader.read().then(
                            (next) => resolve({ done: next.done, value: next.value }),
                            reject
                        );
                    }
                );
                if (result.done) {
                    settled = true;
                    controller.close();
                } else if (result.value) {
                    controller.enqueue(result.value);
                }
            } catch (error) {
                settled = true;
                controller.error(error);
            } finally {
                if (timer) clearTimeout(timer);
                if (onAbort) options.signal?.removeEventListener('abort', onAbort);
            }
        },
        async cancel(reason) {
            settled = true;
            await reader.cancel(reason).catch(() => undefined);
        },
    });
}

export async function readResponseTextWithIdleDeadline(
    response: Response,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string> {
    if (!response.body) return response.text();
    return new Response(withIdleWatchdog(response.body, options), {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
    }).text();
}

export async function readResponseJsonWithIdleDeadline<T>(
    response: Response,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
    if (!response.body) return response.json() as Promise<T>;
    return new Response(withIdleWatchdog(response.body, options), {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
    }).json() as Promise<T>;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, Math.max(0, ms));
        const onAbort = () => {
            cleanup();
            reject(abortError(signal));
        };
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
