/** Compress large same-origin requests only when the server supports it. */
export async function prepareJsonBody(value: unknown, enabled: boolean, signal?: AbortSignal): Promise<{
    body: string | Blob;
    compressed: boolean;
}> {
    const json = JSON.stringify(value);
    signal?.throwIfAborted();
    if (!enabled || json.length < 32 * 1024 || typeof CompressionStream === 'undefined') {
        return { body: json, compressed: false };
    }
    try {
        const input = new Blob([json], { type: 'application/json' });
        const compressed = await new Response(input.stream().pipeThrough(new CompressionStream('gzip'), signal ? { signal } : undefined)).blob();
        signal?.throwIfAborted();
        return compressed.size < input.size ? { body: compressed, compressed: true } : { body: json, compressed: false };
    } catch {
        signal?.throwIfAborted();
        return { body: json, compressed: false };
    }
}
