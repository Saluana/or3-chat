import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';

const LEGACY_CIPHERTEXT_VERSION = 'v1';
const CIPHERTEXT_VERSION = 'v2';

export type ConnectCredentialPurpose =
    | 'authorization-delivery'
    | 'environment-access'
    | 'environment-tunnel';

export interface ConnectCredentialContext {
    purpose: ConnectCredentialPurpose;
    authorizationId?: string;
    environmentId: string;
    userId: string;
    workspaceId: string;
}

export function randomURLSecret(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
}

export function hashConnectSecret(value: string): string {
    return createHash('sha256')
        .update('or3-connect-v1\0')
        .update(value)
        .digest('base64url');
}

/**
 * Creates the database lookup for the low-entropy human confirmation phrase.
 *
 * The Connect encryption secret is held outside provider databases. Deriving a
 * purpose-specific HMAC key from it prevents a database-only snapshot from
 * brute-forcing the readable phrase space.
 */
export function createConnectUserCodeLookup(
    value: string,
    secret: string
): string {
    const key = createHmac(
        'sha256',
        Buffer.from(requireConnectServerSecret(secret), 'utf8')
    )
        .update('or3-connect-user-code-lookup-key-v1\0')
        .digest();
    return createHmac('sha256', key)
        .update('or3-connect-user-code-lookup-v1\0')
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
    secret: string,
    context: ConnectCredentialContext
): string {
    const key = deriveEncryptionKey(secret);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const binding = normalizeCredentialContext(context);
    cipher.setAAD(credentialAAD(binding));
    const plaintext = Buffer.from(
        JSON.stringify({ binding, value }),
        'utf8'
    );
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
    secret: string,
    context: ConnectCredentialContext
): T {
    const [version, nonceText, tagText, bodyText] = ciphertext.split('.');
    if (
        (version !== CIPHERTEXT_VERSION &&
            version !== LEGACY_CIPHERTEXT_VERSION) ||
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
    const binding = normalizeCredentialContext(context);
    decipher.setAAD(
        version === LEGACY_CIPHERTEXT_VERSION
            ? Buffer.from('or3-connect-credential-v1')
            : credentialAAD(binding)
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(bodyText, 'base64url')),
        decipher.final(),
    ]);
    const decoded = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (version === LEGACY_CIPHERTEXT_VERSION) {
        return decoded as T;
    }
    if (!isCredentialPayload(decoded)) {
        throw new Error('Invalid OR3 Connect credential payload');
    }
    const actual = normalizeCredentialContext(decoded.binding);
    if (!timingSafeTextEqual(JSON.stringify(actual), JSON.stringify(binding))) {
        throw new Error('OR3 Connect credential binding mismatch');
    }
    return decoded.value as T;
}

export function isLegacyConnectCredentialEnvelope(ciphertext: string): boolean {
    return ciphertext.startsWith(`${LEGACY_CIPHERTEXT_VERSION}.`);
}

export function createConnectRelayMetadataAuthenticator(
    context: Omit<ConnectCredentialContext, 'purpose' | 'authorizationId'> & {
        hostname: string;
        tunnelId: string;
        dnsRecordId: string;
    },
    secret: string
): string {
    const key = createHmac(
        'sha256',
        Buffer.from(requireConnectServerSecret(secret), 'utf8')
    )
        .update('or3-connect-relay-metadata-key-v1\0')
        .digest();
    return createHmac('sha256', key)
        .update('or3-connect-relay-metadata-v1\0')
        .update(context.environmentId)
        .update('\0')
        .update(context.userId)
        .update('\0')
        .update(context.workspaceId)
        .update('\0')
        .update(context.hostname)
        .update('\0')
        .update(context.tunnelId)
        .update('\0')
        .update(context.dnsRecordId)
        .digest('base64url');
}

function deriveEncryptionKey(secret: string): Buffer {
    const normalized = requireConnectServerSecret(secret);
    return createHash('sha256')
        .update('or3-connect-encryption-v1\0')
        .update(normalized)
        .digest();
}

function requireConnectServerSecret(secret: string): string {
    const normalized = secret.trim();
    if (normalized.length < 32) {
        throw new Error(
            'OR3 Connect encryption key must contain at least 32 characters'
        );
    }
    return normalized;
}

function normalizeCredentialContext(
    context: ConnectCredentialContext
): Required<ConnectCredentialContext> {
    const normalized = {
        purpose: context.purpose,
        authorizationId: context.authorizationId?.trim() ?? '',
        environmentId: context.environmentId.trim(),
        userId: context.userId.trim(),
        workspaceId: context.workspaceId.trim(),
    };
    if (
        ![
            'authorization-delivery',
            'environment-access',
            'environment-tunnel',
        ].includes(normalized.purpose) ||
        !normalized.environmentId ||
        !normalized.userId ||
        !normalized.workspaceId ||
        (normalized.purpose === 'authorization-delivery' &&
            !normalized.authorizationId)
    ) {
        throw new Error('Invalid OR3 Connect credential context');
    }
    return normalized;
}

function credentialAAD(context: Required<ConnectCredentialContext>): Buffer {
    return Buffer.from(
        [
            'or3-connect-credential-v2',
            context.purpose,
            context.authorizationId,
            context.environmentId,
            context.userId,
            context.workspaceId,
        ].join('\0'),
        'utf8'
    );
}

function isCredentialPayload(
    value: unknown
): value is { binding: ConnectCredentialContext; value: unknown } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'binding' in value &&
        'value' in value &&
        typeof value.binding === 'object' &&
        value.binding !== null
    );
}

function timingSafeTextEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, 'utf8');
    const rightBytes = Buffer.from(right, 'utf8');
    return (
        leftBytes.length === rightBytes.length &&
        timingSafeEqual(leftBytes, rightBytes)
    );
}
