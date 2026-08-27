export interface InternSseEvent<T = unknown> {
    event?: string;
    id?: string;
    retry?: number;
    data: string;
    json?: T;
    cursor?: string;
}

function parseJson<T>(data: string): T | undefined {
    if (!data) return undefined;
    try {
        return JSON.parse(data) as T;
    } catch {
        return undefined;
    }
}

export function parseInternSseBlock<T = unknown>(
    block: string
): InternSseEvent<T> {
    const data: string[] = [];
    const output: InternSseEvent<T> = { data: '' };

    for (const line of block.split(/\r\n|\r|\n/)) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const rawValue = separator < 0 ? '' : line.slice(separator + 1);
        const value = rawValue.startsWith(' ')
            ? rawValue.slice(1)
            : rawValue;
        switch (field) {
            case 'event':
                output.event = value;
                break;
            case 'id':
                if (!value.includes('\0')) output.id = value;
                break;
            case 'retry': {
                const retry = Number(value);
                if (Number.isInteger(retry) && retry >= 0) {
                    output.retry = retry;
                }
                break;
            }
            case 'data':
                data.push(value);
                break;
        }
    }

    output.data = data.join('\n');
    output.json = parseJson<T>(output.data);
    if (output.id) output.cursor = output.id;
    return output;
}

function splitSseBuffer(buffer: string): {
    blocks: string[];
    remainder: string;
} {
    const blocks: string[] = [];
    let start = 0;
    const delimiter = /\r\n\r\n|\n\n|\r\r/g;
    for (let match = delimiter.exec(buffer); match; match = delimiter.exec(buffer)) {
        blocks.push(buffer.slice(start, match.index));
        start = match.index + match[0].length;
    }
    return { blocks, remainder: buffer.slice(start) };
}

export async function* readInternSseStream<T = unknown>(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal
): AsyncIterable<InternSseEvent<T>> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const abort = () => {
        void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
        while (true) {
            if (signal?.aborted) {
                throw signal.reason ?? new DOMException('Aborted', 'AbortError');
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { blocks, remainder } = splitSseBuffer(buffer);
            buffer = remainder;
            for (const block of blocks) {
                if (block.trim() && !block.trimStart().startsWith(':')) {
                    yield parseInternSseBlock<T>(block);
                }
            }
        }
        buffer += decoder.decode();
        if (buffer.trim() && !buffer.trimStart().startsWith(':')) {
            yield parseInternSseBlock<T>(buffer);
        }
    } finally {
        signal?.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}

export function internSseEventKey(
    event: InternSseEvent<unknown>
): string | undefined {
    if (event.id) return `sse:${event.id}`;
    const payload =
        event.json && typeof event.json === 'object' && !Array.isArray(event.json)
            ? (event.json as Record<string, unknown>)
            : undefined;
    if (!payload) return undefined;
    if (
        (typeof payload.id === 'string' || typeof payload.id === 'number') &&
        String(payload.id) !== ''
    ) {
        return `payload:${String(payload.id)}`;
    }
    if (
        typeof payload.turn_id === 'string' &&
        (typeof payload.seq === 'string' || typeof payload.seq === 'number')
    ) {
        return `turn:${payload.turn_id}:${String(payload.seq)}`;
    }
    return undefined;
}

export function internSseEventCursor(
    event: InternSseEvent<unknown>
): string | undefined {
    if (event.id) return event.id;
    const payload =
        event.json && typeof event.json === 'object' && !Array.isArray(event.json)
            ? (event.json as Record<string, unknown>)
            : undefined;
    if (
        payload &&
        (typeof payload.seq === 'string' || typeof payload.seq === 'number')
    ) {
        return String(payload.seq);
    }
    return undefined;
}
