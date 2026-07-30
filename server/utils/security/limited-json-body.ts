import {
    createError,
    getHeader,
    readBody,
    type H3Event,
} from 'h3';

export const CONNECT_PUBLIC_BODY_LIMIT_BYTES = 8 * 1024;

/**
 * Reads a small anonymous JSON request without allowing the framework's
 * general-purpose parser to buffer an unbounded body first.
 */
export async function readLimitedJsonBody<T>(
    event: H3Event,
    maxBytes = CONNECT_PUBLIC_BODY_LIMIT_BYTES
): Promise<T> {
    const declared = getHeader(event, 'content-length');
    if (declared) {
        const length = Number(declared);
        if (
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > maxBytes
        ) {
            throw payloadTooLarge();
        }
    }

    const nodeRequest = (
        event as H3Event & {
            node?: {
                req?: AsyncIterable<Uint8Array | Buffer | string>;
            };
        }
    ).node?.req;
    if (
        nodeRequest &&
        typeof nodeRequest[Symbol.asyncIterator] === 'function'
    ) {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of nodeRequest) {
            const bytes = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
            length += bytes.byteLength;
            if (length > maxBytes) throw payloadTooLarge();
            chunks.push(bytes);
        }
        return parseJSON<T>(Buffer.concat(chunks, length).toString('utf8'));
    }

    // Web-runtime requests expose a bounded ReadableStream instead.
    const webBody = (
        event as H3Event & {
            request?: { body?: ReadableStream<Uint8Array> | null };
        }
    ).request?.body;
    if (webBody?.getReader) {
        const reader = webBody.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > maxBytes) {
                    await reader.cancel();
                    throw payloadTooLarge();
                }
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return parseJSON<T>(new TextDecoder().decode(bytes));
    }

    // Unit adapters without a transport stream still get the declared-size
    // check above. Production Node and edge requests use one of the bounded
    // streaming branches.
    const value = await readBody<T>(event);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The request body must be valid JSON.',
        });
    }
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
        throw payloadTooLarge();
    }
    return value;
}

function parseJSON<T>(text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        throw createError({
            statusCode: 400,
            statusMessage: 'The request body must be valid JSON.',
        });
    }
}

function payloadTooLarge() {
    return createError({
        statusCode: 413,
        statusMessage: 'The request body is too large.',
    });
}
