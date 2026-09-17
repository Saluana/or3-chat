/**
 * Bounded response reading.
 *
 * A provider response body must never be buffered before its size is checked:
 * a large or endless response would exhaust memory before the ceiling could be
 * applied. These helpers read the stream chunk by chunk, count the bytes, cancel
 * the body as soon as the limit is crossed, and only then hand a bounded string
 * to the caller.
 *
 * `Content-Length` is used as an early hint, never as the enforcement mechanism.
 */

export type BoundedBodyResult =
    | { readonly ok: true; readonly text: string; readonly bytes: number }
    | {
          readonly ok: false;
          readonly code: 'response-too-large' | 'response-unreadable';
          readonly message: string;
          readonly bytes: number;
      };

export interface BoundedBodyLimits {
    readonly maxBytes: number;
    /** Hard ceiling on chunks read, so a chunk flood cannot loop forever. */
    readonly maxChunks?: number;
}

export const DEFAULT_MAX_CHUNKS = 20_000;

function utf8Bytes(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}

/**
 * Read at most `maxBytes` UTF-8 bytes from a fetch response.
 * Cancels the response body when the ceiling is crossed.
 */
export async function readBoundedBody(
    response: Response,
    limits: BoundedBodyLimits
): Promise<BoundedBodyResult> {
    // Early rejection hint only: a wrong or absent length never decides the limit.
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
        try {
            await response.body?.cancel();
        } catch {
            // The body may already be unusable; the limit decision stands.
        }
        return {
            ok: false,
            code: 'response-too-large',
            message: `Provider response exceeds ${limits.maxBytes} bytes`,
            bytes: declared,
        };
    }

    const body = response.body;
    if (!body) {
        try {
            const text = await response.text();
            const bytes = utf8Bytes(text);
            if (bytes > limits.maxBytes) {
                return {
                    ok: false,
                    code: 'response-too-large',
                    message: `Provider response exceeds ${limits.maxBytes} bytes`,
                    bytes,
                };
            }
            return { ok: true, text, bytes };
        } catch {
            return {
                ok: false,
                code: 'response-unreadable',
                message: 'Provider response body could not be read',
                bytes: 0,
            };
        }
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const maxChunks = limits.maxChunks ?? DEFAULT_MAX_CHUNKS;
    let bytes = 0;
    let chunks = 0;
    let text = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks += 1;
            if (chunks > maxChunks) {
                await reader.cancel('chunk-limit');
                return {
                    ok: false,
                    code: 'response-too-large',
                    message: `Provider response exceeded ${maxChunks} chunks`,
                    bytes,
                };
            }
            // A read that is not done always yields a chunk (WHATWG streams).
            bytes += value.byteLength;
            if (bytes > limits.maxBytes) {
                // Stop consuming immediately: the ceiling is the enforcement.
                await reader.cancel('response-too-large');
                return {
                    ok: false,
                    code: 'response-too-large',
                    message: `Provider response exceeds ${limits.maxBytes} bytes`,
                    bytes,
                };
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return { ok: true, text, bytes };
    } catch {
        return {
            ok: false,
            code: 'response-unreadable',
            message: 'Provider response body could not be read',
            bytes,
        };
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Already released or cancelled.
        }
    }
}

/**
 * Run a callback with a signal that aborts when either the caller cancels or the
 * deadline elapses, and report which of the two happened.
 *
 * `request.signal ?? controller.signal` (the previous pattern) silently dropped
 * the deadline whenever a caller supplied its own signal.
 */
export interface DeadlineSignal {
    readonly signal: AbortSignal;
    /** True when the deadline fired rather than the caller cancelling. */
    timedOut(): boolean;
    /** Always call this once the request (including its body) is finished. */
    dispose(): void;
}

export function combineWithDeadline(input: {
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
}): DeadlineSignal {
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => {
        controller.abort(input.signal?.reason ?? 'cancelled');
    };
    if (input.signal?.aborted) {
        controller.abort(input.signal.reason ?? 'cancelled');
    } else if (input.signal) {
        input.signal.addEventListener('abort', onParentAbort, { once: true });
    }
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort('deadline-exceeded');
    }, Math.max(1, input.timeoutMs));

    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        dispose: () => {
            clearTimeout(timer);
            input.signal?.removeEventListener('abort', onParentAbort);
        },
    };
}
