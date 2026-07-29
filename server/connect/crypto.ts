import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';

const CIPHERTEXT_VERSION = 'v1';

export function randomURLSecret(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
}

export function hashConnectSecret(value: string): string {
    return createHash('sha256')
        .update('or3-connect-v1\0')
        .update(value)
        .digest('base64url');
}

export function safeSecretEqual(left: string, right: string): boolean {
    const leftHash = Buffer.from(hashConnectSecret(left));
    const rightHash = Buffer.from(hashConnectSecret(right));
    return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
}

export function encryptConnectCredential(
    value: unknown,
    secret: string
): string {
    const key = deriveEncryptionKey(secret);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('or3-connect-credential-v1'));
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
        CIPHERTEXT_VERSION,
        nonce.toString('base64url'),
        tag.toString('base64url'),
        encrypted.toString('base64url'),
    ].join('.');
}

export function decryptConnectCredential<T>(
    ciphertext: string,
    secret: string
): T {
    const [version, nonceText, tagText, bodyText] = ciphertext.split('.');
    if (
        version !== CIPHERTEXT_VERSION ||
        !nonceText ||
        !tagText ||
        !bodyText
    ) {
        throw new Error('Invalid OR3 Connect credential envelope');
    }
    const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveEncryptionKey(secret),
        Buffer.from(nonceText, 'base64url')
    );
    decipher.setAAD(Buffer.from('or3-connect-credential-v1'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(bodyText, 'base64url')),
        decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
}

function deriveEncryptionKey(secret: string): Buffer {
    const normalized = secret.trim();
    if (normalized.length < 32) {
        throw new Error(
            'OR3 Connect encryption key must contain at least 32 characters'
        );
    }
    return createHash('sha256')
        .update('or3-connect-encryption-v1\0')
        .update(normalized)
        .digest();
}
