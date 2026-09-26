/**
 * @module shared/plugins/digest
 *
 * Purpose:
 * One first-party SHA-256 helper for plugin runtime identity checks that must
 * agree between the browser client, the Nitro server and test/qualification
 * scripts.
 *
 * Behavior:
 * - Uses Web Crypto (`crypto.subtle`), available in browsers and Node 24.
 * - Accepts strings, byte arrays or an already-encoded `sha256-` digest.
 * - Returns lowercase hex (no prefix) from `sha256Hex` and a prefixed
 *   `sha256-<hex>` identity from `sha256Identity`.
 *
 * Constraints:
 * - No new dependency and no second hashing algorithm.
 * - Throws when Web Crypto is unavailable rather than silently skipping a
 *   verification step (fail closed).
 *
 * Non-Goals:
 * - Streaming hash of large files (the file-hash utility owns that path).
 */

import type { Sha256 } from './runtime-descriptor';

export type HashInput = string | ArrayBuffer | ArrayBufferView;

/** Accepts a `sha256-<hex>` string or a bare 64 character lowercase hex digest. */
export function parseSha256(value: string): Sha256 | null {
    const trimmed = value.trim();
    if (/^sha256-[a-f0-9]{64}$/.test(trimmed)) {
        return trimmed as Sha256;
    }
    if (/^[a-f0-9]{64}$/.test(trimmed)) {
        return `sha256-${trimmed}` as Sha256;
    }
    return null;
}

/**
 * Copy the input into a plain `Uint8Array<ArrayBuffer>`.
 * Web Crypto's `BufferSource` parameter does not accept a `SharedArrayBuffer`
 * backed view, so the bytes are normalised here rather than at each call site.
 */
function toBytes(input: HashInput): Uint8Array<ArrayBuffer> {
    if (typeof input === 'string') {
        return new TextEncoder().encode(input) as Uint8Array<ArrayBuffer>;
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }
    return new Uint8Array(
        input.buffer as ArrayBuffer,
        input.byteOffset,
        input.byteLength
    );
}

function hex(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0');
    }
    return out;
}

/** Lowercase SHA-256 hex of the input bytes. */
export async function sha256Hex(input: HashInput): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto SHA-256 is unavailable');
    }
    const digest = await subtle.digest('SHA-256', toBytes(input));
    return hex(new Uint8Array(digest));
}

const BASE64_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
    let out = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1];
        const third = bytes[index + 2];
        out += BASE64_ALPHABET[first >> 2];
        out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
        out += second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
        out += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f];
    }
    return out;
}

/**
 * CSP script hash for the input bytes.
 *
 * CSP requires the base64 encoding of the digest (`'sha256-<base64>'`), not the
 * hex identity used elsewhere.
 */
export async function sha256CspHash(input: HashInput): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto SHA-256 is unavailable');
    }
    const digest = await subtle.digest('SHA-256', toBytes(input));
    return `sha256-${toBase64(new Uint8Array(digest))}`;
}

/** `sha256-<hex>` identity for the input bytes. */
export async function sha256Identity(input: HashInput): Promise<Sha256> {
    return `sha256-${await sha256Hex(input)}` as Sha256;
}

/**
 * Constant-time-ish comparison of two digests for verification paths.
 * Not a secret comparison, but avoids early-exit surprises on identity checks.
 */
export function digestEquals(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return diff === 0;
}
