import type { TipTapDocument } from '~/types/database';
import { sha256Hex as sha256 } from '~~/shared/runtime-crypto';

export const REVISION_CHUNK_MAX_CHARS = 48 * 1024;
export const REVISION_SYNC_PAYLOAD_MAX_BYTES = 56 * 1024;

export type DocumentRevisionEncoding = 'gzip-base64url' | 'identity-base64url';

export interface DocumentRevisionSnapshot {
    title: string;
    content: TipTapDocument;
}

export interface EncodedDocumentRevision {
    encoding: DocumentRevisionEncoding;
    hash: string;
    originalBytes: number;
    encodedBytes: number;
    chunks: string[];
}

export type DecodableDocumentRevision = Pick<EncodedDocumentRevision, 'encoding' | 'hash' | 'chunks'>
    & Partial<Pick<EncodedDocumentRevision, 'originalBytes'>>;

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    const stride = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += stride) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
    }
    return btoa(binary)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
        + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot decompress this revision.');
    }
    const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) {
                await reader.cancel().catch(() => {});
                throw new Error('Revision snapshot exceeds its allowed size in bytes.');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const raw = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
    return raw;
}

export async function encodeDocumentRevision(
    snapshot: DocumentRevisionSnapshot,
    options: { disableCompression?: boolean } = {}
): Promise<EncodedDocumentRevision> {
    const raw = new TextEncoder().encode(JSON.stringify(snapshot));
    const compressed = options.disableCompression ? null : await gzip(raw);
    const payload = compressed && compressed.byteLength < raw.byteLength
        ? compressed
        : raw;
    const encoding: DocumentRevisionEncoding = payload === compressed
        ? 'gzip-base64url'
        : 'identity-base64url';
    const encoded = bytesToBase64Url(payload);
    const chunks: string[] = [];
    for (let offset = 0; offset < encoded.length; offset += REVISION_CHUNK_MAX_CHARS) {
        chunks.push(encoded.slice(offset, offset + REVISION_CHUNK_MAX_CHARS));
    }

    return {
        encoding,
        hash: await sha256(raw),
        originalBytes: raw.byteLength,
        encodedBytes: new TextEncoder().encode(encoded).byteLength,
        chunks: chunks.length ? chunks : [''],
    };
}

export async function decodeDocumentRevision(
    encoded: DecodableDocumentRevision
): Promise<DocumentRevisionSnapshot> {
    // Stored manifests declare their original size. Enforce that bound while
    // streaming, without introducing a new ceiling for valid large history.
    const maxBytes = encoded.originalBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new Error('Revision snapshot declares an invalid size in bytes.');
    }
    if (encoded.chunks.length > 4096 || encoded.chunks.some(chunk => chunk.length > REVISION_CHUNK_MAX_CHARS)) {
        throw new Error('Encoded revision exceeds its chunk size in bytes.');
    }
    const payload = base64UrlToBytes(encoded.chunks.join(''));
    const raw = encoded.encoding === 'gzip-base64url'
        ? await gunzip(payload, maxBytes)
        : payload;
    if (raw.byteLength > maxBytes || (encoded.originalBytes !== undefined && raw.byteLength !== encoded.originalBytes)) {
        throw new Error('Revision snapshot size does not match its declared bytes.');
    }
    if (await sha256(raw) !== encoded.hash) {
        throw new Error('Revision checksum does not match its manifest.');
    }
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Revision snapshot is invalid.');
    }
    const snapshot = parsed as { title?: unknown; content?: { type?: unknown } };
    if (
        typeof snapshot.title !== 'string'
        || !snapshot.content
        || snapshot.content.type !== 'doc'
    ) {
        throw new Error('Revision snapshot is invalid.');
    }
    return snapshot as DocumentRevisionSnapshot;
}

export function assertRevisionSyncPayloadSize(payload: unknown): void {
    const size = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (size > REVISION_SYNC_PAYLOAD_MAX_BYTES) {
        throw new Error(`Revision sync payload is ${size} bytes; maximum is ${REVISION_SYNC_PAYLOAD_MAX_BYTES}.`);
    }
}
