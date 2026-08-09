import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from 'node:crypto';

function deriveKey(secret: string): Buffer {
    if (!secret.trim()) {
        throw new Error(
            'A server auth secret is required for durable background jobs'
        );
    }
    return createHash('sha256').update(secret, 'utf8').digest();
}

/** Encrypt a user-owned OpenRouter key before durable provider persistence. */
export function encryptBackgroundCredential(
    apiKey: string,
    secret: string
): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
    const ciphertext = Buffer.concat([
        cipher.update(apiKey, 'utf8'),
        cipher.final(),
    ]);
    return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

/** Decrypt a persisted credential only inside a claimed server worker. */
export function decryptBackgroundCredential(
    envelope: string,
    secret: string
): string {
    try {
        const [version, iv, tag, ciphertext] = envelope.split('.');
        if (version !== 'v1' || !iv || !tag || !ciphertext) {
            throw new Error('invalid envelope');
        }
        const decipher = createDecipheriv(
            'aes-256-gcm',
            deriveKey(secret),
            Buffer.from(iv, 'base64url')
        );
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(ciphertext, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    } catch {
        throw new Error('Failed to decrypt background job credential');
    }
}
