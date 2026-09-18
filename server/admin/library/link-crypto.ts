/**
 * Library link secret encryption.
 *
 * AES-256-GCM with a key derived from `OR3_LIBRARY_LINK_SECRET`. The additional
 * authenticated data binds every ciphertext to one local user, one instance and
 * one purpose, so a copied file cannot be replayed for another user or as a
 * different kind of secret. Decryption fails closed: a missing key is an error,
 * never a plaintext fallback.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'llv1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AAD_PREFIX = 'or3-library-link-v1';

export type LibrarySecretPurpose = 'polling-secret' | 'library-token';

export interface LibrarySecretContext {
    readonly userId: string;
    readonly instanceId: string;
    readonly purpose: LibrarySecretPurpose;
}

export function requireLibraryLinkKey(secret: string | undefined): Buffer {
    if (!secret || !secret.trim()) {
        throw new Error(
            'OR3_LIBRARY_LINK_SECRET is required to store a marketplace library credential'
        );
    }
    return createHash('sha256').update(secret, 'utf8').digest();
}

function contextAad(context: LibrarySecretContext): Buffer {
    return Buffer.from(
        `${AAD_PREFIX}\0${context.userId}\0${context.instanceId}\0${context.purpose}`,
        'utf8'
    );
}

export function encryptLibrarySecret(
    plaintext: string,
    secret: string | undefined,
    context: LibrarySecretContext
): string {
    const key = requireLibraryLinkKey(secret);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(contextAad(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
        VERSION,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

export function decryptLibrarySecret(
    payload: string,
    secret: string | undefined,
    context: LibrarySecretContext
): string {
    const [version, iv, tag, ciphertext] = payload.split('.');
    if (version !== VERSION || !iv || !tag || !ciphertext) {
        throw new Error('Invalid library link secret payload');
    }
    const key = requireLibraryLinkKey(secret);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(contextAad(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}
