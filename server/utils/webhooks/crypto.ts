import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENCRYPTION_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_IV_BYTES = 12;

function deriveEncryptionKey(encryptionKey: string): Buffer {
    if (!encryptionKey.trim()) {
        throw new Error('Webhook encryption key is required');
    }

    return createHash('sha256').update(encryptionKey, 'utf8').digest();
}

export function generateSigningSecret(): string {
    return `whs_${randomBytes(32).toString('hex')}`;
}

export function encryptSecret(secret: string, encryptionKey: string): string {
    const key = deriveEncryptionKey(encryptionKey);
    const iv = randomBytes(ENCRYPTION_IV_BYTES);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(secret, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
        ENCRYPTION_VERSION,
        iv.toString('base64url'),
        authTag.toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

export function decryptSecret(
    encryptedSecret: string,
    encryptionKey: string
): string {
    const [version, ivEncoded, authTagEncoded, ciphertextEncoded] =
        encryptedSecret.split('.');

    if (
        version !== ENCRYPTION_VERSION ||
        !ivEncoded ||
        !authTagEncoded ||
        !ciphertextEncoded
    ) {
        throw new Error('Invalid webhook secret payload');
    }

    try {
        const key = deriveEncryptionKey(encryptionKey);
        const decipher = createDecipheriv(
            ENCRYPTION_ALGORITHM,
            key,
            Buffer.from(ivEncoded, 'base64url')
        );
        decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64url'));

        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
            decipher.final(),
        ]);

        return plaintext.toString('utf8');
    } catch {
        throw new Error('Failed to decrypt webhook signing secret');
    }
}
