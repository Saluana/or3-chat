/**
 * @module server/utils/plugins/acquisition/release-verify
 *
 * Purpose:
 * Verify the detached Ed25519 signature on a release metadata document against
 * the host's configured trust root, using the exact canonical bytes the
 * marketplace signs.
 *
 * Behavior:
 * - The signature is checked over `encodeReleaseMetadata(document without
 *   signature)`, so a single changed field invalidates it.
 * - An unknown key id, missing key material or malformed base64 verifies as
 *   `false`: this function never throws for bad input, and callers treat `false`
 *   as a refusal.
 *
 * Constraints:
 * - Public material only. The host never holds a release private key.
 *
 * Non-Goals:
 * - Trust-root provisioning and rotation (operator configuration).
 */

import { encodeReleaseMetadata, type ReleaseMetadataDocument } from '~~/shared/plugins/acquisition/release-metadata';

export interface TrustedReleaseKey {
    readonly keyId: string;
    readonly publicJwk: { readonly kty: string; readonly crv: string; readonly x: string };
}

function fromBase64(value: string): Uint8Array | null {
    try {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    } catch {
        return null;
    }
}

/** The signed bytes: the canonical document with the signature removed. */
export function releaseMetadataSigningPayload(document: ReleaseMetadataDocument): Uint8Array {
    const { signature: _signature, ...unsigned } = document;
    return encodeReleaseMetadata(unsigned);
}

export async function verifyReleaseMetadataSignature(input: {
    readonly document: ReleaseMetadataDocument;
    readonly trustRoot: readonly TrustedReleaseKey[];
}): Promise<boolean> {
    const signature = input.document.signature;
    if (!signature || signature.algorithm !== 'ed25519') return false;

    const key = input.trustRoot.find((candidate) => candidate.keyId === signature.keyId);
    if (!key) return false;
    if (key.publicJwk.kty !== 'OKP' || key.publicJwk.crv !== 'Ed25519') return false;

    const bytes = fromBase64(signature.value);
    if (!bytes) return false;

    try {
        const publicKey = await crypto.subtle.importKey(
            'jwk',
            key.publicJwk as JsonWebKey,
            { name: 'Ed25519' },
            true,
            ['verify']
        );
        return await crypto.subtle.verify(
            { name: 'Ed25519' },
            publicKey,
            bytes as unknown as BufferSource,
            releaseMetadataSigningPayload(input.document) as unknown as BufferSource
        );
    } catch {
        return false;
    }
}

/**
 * Mint a signature with an explicit key. Test and tooling helper only: the host
 * runtime never signs release metadata.
 */
export async function signReleaseMetadataForTest(input: {
    readonly document: ReleaseMetadataDocument;
    readonly keyId: string;
    readonly privateKeyBase64: string;
}): Promise<ReleaseMetadataDocument> {
    const raw = fromBase64(input.privateKeyBase64);
    if (!raw) throw new Error('Invalid private key encoding');
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        raw as unknown as ArrayBuffer,
        { name: 'Ed25519' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        privateKey,
        releaseMetadataSigningPayload(input.document) as unknown as BufferSource
    );
    let binary = '';
    for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
    return {
        ...input.document,
        signature: { keyId: input.keyId, algorithm: 'ed25519', value: btoa(binary) },
    };
}
