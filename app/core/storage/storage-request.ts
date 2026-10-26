/** Bound both cooperative fetches and providers that fail to settle on abort. */
export async function withStorageDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    timeoutMs = 60_000,
): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('Storage request timed out', 'TimeoutError')), timeoutMs);
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
        controller.signal.throwIfAborted();
        return await Promise.race([operation(controller.signal), aborted]);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', onAbort);
    }
}
