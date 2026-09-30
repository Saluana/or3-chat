/**
 * Plugin connection secret encryption.
 *
 * AES-256-GCM with a key derived from `OR3_PLUGIN_CONNECTION_SECRET`, which is
 * supplied through the environment/secret store and never written to the
 * database. Decryption fails closed (a missing key is an error, never a
 * plaintext fallback).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'pcv1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export function requireConnectionSecretKey(secret: string | undefined): Buffer {
    if (!secret || !secret.trim()) {
        throw new Error(
            'OR3_PLUGIN_CONNECTION_SECRET is required to store plugin connection credentials'
        );
    }
    return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptConnectionSecret(
    plaintext: string,
    secret: string | undefined
): string {
    const key = requireConnectionSecretKey(secret);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
        VERSION,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

export function decryptConnectionSecret(
    payload: string,
    secret: string | undefined
): string {
    const [version, iv, tag, ciphertext] = payload.split('.');
    if (version !== VERSION || !iv || !tag || !ciphertext) {
        throw new Error('Invalid plugin connection secret payload');
    }
    const key = requireConnectionSecretKey(secret);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}
