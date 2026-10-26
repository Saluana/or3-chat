/** Bound allocation and keep cancellation/deadline active through the body. */
export async function fetchBoundedBlob(url: string, options: { maxBytes: number; timeoutMs: number; signal?: AbortSignal }): Promise<Blob> {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    const timer = setTimeout(() => controller.abort(new DOMException('Media download timed out.', 'TimeoutError')), options.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelReader = () => { void reader?.cancel(controller.signal.reason).catch(() => {}); };
    controller.signal.addEventListener('abort', cancelReader, { once: true });
    try {
        controller.signal.throwIfAborted();
        const response = await fetch(url, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (!response.ok) throw new Error(`Media download failed (${response.status}).`);
        if (Number(response.headers.get('content-length')) > options.maxBytes) {
            void response.body?.cancel().catch(() => {});
            throw new Error('Media exceeds the download size limit.');
        }
        reader = response.body?.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        while (reader) {
            const { done, value } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > options.maxBytes) {
                cancelReader();
                throw new Error('Media exceeds the download size limit.');
            }
            // Copy only accepted chunks; never retain oversized backing buffers.
            chunks.push(new Uint8Array(value));
        }
        return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', cancelReader);
        reader?.releaseLock();
    }
}
