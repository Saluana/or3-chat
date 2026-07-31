import { vi } from 'vitest';

export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

/** A deterministic I/O barrier for workspace switches, crashes, and timeouts. */
export function controlledIo<T>() {
    const gate = deferred<T>();
    return {
        request: vi.fn(() => gate.promise),
        succeed: gate.resolve,
        fail: gate.reject,
    };
}

/** A mutable wall clock suitable for lease expiry and persisted retry tests. */
export function installFaultClock(startAt: number) {
    let now = startAt;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    return {
        now: () => now,
        set: (value: number) => { now = value; },
        advance: (durationMs: number) => { now += durationMs; },
        restore: () => spy.mockRestore(),
    };
}

/** Response whose declared metadata may intentionally disagree with streamed bytes. */
export function faultingDownloadResponse(params: {
    chunks: Array<string | Uint8Array>;
    declaredLength?: number;
    declaredMime?: string;
}): Response {
    const encoder = new TextEncoder();
    const chunks = params.chunks.map((chunk) =>
        typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    );
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    }), {
        headers: {
            ...(params.declaredLength === undefined ? {} : { 'content-length': String(params.declaredLength) }),
            ...(params.declaredMime === undefined ? {} : { 'content-type': params.declaredMime }),
        },
    });
}

/** Run competing claims together so tests cannot accidentally serialize workers. */
export function raceWorkers<T extends ReadonlyArray<() => Promise<unknown>>>(
    ...claims: T
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
    return Promise.all(claims.map((claim) => claim())) as Promise<{
        [K in keyof T]: Awaited<ReturnType<T[K]>>;
    }>;
}

export async function flushTransferScheduling(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
}
