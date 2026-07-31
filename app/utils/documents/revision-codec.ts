import type { TipTapDocument } from '~/types/database';

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

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
    return [...new Uint8Array(digest)]
        .map((part) => part.toString(16).padStart(2, '0'))
        .join('');
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot decompress this revision.');
    }
    const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
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
    encoded: Pick<EncodedDocumentRevision, 'encoding' | 'hash'> & { chunks: string[] }
): Promise<DocumentRevisionSnapshot> {
    const payload = base64UrlToBytes(encoded.chunks.join(''));
    const raw = encoded.encoding === 'gzip-base64url'
        ? await gunzip(payload)
        : payload;
    if (await sha256(raw) !== encoded.hash) {
        throw new Error('Revision checksum does not match its manifest.');
    }
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Revision snapshot is invalid.');
    }
    const snapshot = parsed as Partial<DocumentRevisionSnapshot>;
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
