import {
    createError,
    getHeader,
    readBody,
    type H3Event,
} from 'h3';

export const CONNECT_PUBLIC_BODY_LIMIT_BYTES = 8 * 1024;

/**
 * Storage presign and commit requests are small control messages: identifiers,
 * a MIME type, a filename and a few numbers. File bytes use a separate upload.
 */
export const STORAGE_CONTROL_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Model requests carry the whole conversation, including inline attachments
 * (base64 grows a 20 MiB file to about 27 MiB), so they need a far larger
 * ceiling than control messages. This bounds buffering only; it is not a
 * context or token limit, which are enforced after parsing by context
 * admission.
 */
export const MODEL_REQUEST_BODY_LIMIT_BYTES = 128 * 1024 * 1024;

/** True for the error `readLimitedJsonBody` throws when a body exceeds its limit. */
export function isPayloadTooLargeError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { statusCode?: unknown }).statusCode === 413
    );
}

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

    // Events created by h3's web adapter carry the body as a web stream while
    // their Node request is only a shim that cannot be iterated, so a web
    // stream takes precedence. A real Node request never has one.
    const webEvent = (
        event as unknown as {
            web?: { request?: { body?: ReadableStream<Uint8Array> | null } };
            request?: { body?: ReadableStream<Uint8Array> | null };
        }
    );
    const webStream = webEvent.web?.request?.body ?? webEvent.request?.body;
    const nodeRequest = (
        event as unknown as {
            node?: {
                req?: AsyncIterable<Uint8Array | Buffer | string>;
            };
        }
    ).node?.req;
    if (
        !webStream?.getReader &&
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
    if (webStream?.getReader) {
        const reader = webStream.getReader();
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
    const serialized = JSON.stringify(value) as string | undefined;
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
