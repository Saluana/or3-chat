import {
    createHash,
    createHmac,
    timingSafeEqual,
} from 'node:crypto';

export const CLOUDFLARE_ATTESTATION_MAX_AGE_MS =
    180 * 24 * 60 * 60 * 1_000;
const CLOUDFLARE_ATTESTATION_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const CLOUDFLARE_ATTESTATION_PREFIX = 'or3cf1';

export interface CloudflareValidationConfig {
    readonly accountId?: string;
    readonly zoneId?: string;
    readonly apiToken: string;
    readonly hostnameSuffix: string;
}

type CloudflareAttestationReason =
    | 'missing'
    | 'malformed'
    | 'mismatched'
    | 'stale'
    | 'future';

export type CloudflareAttestationValidation =
    | {
          readonly valid: true;
          readonly validatedAt: number;
          readonly expiresAt: number;
      }
    | {
          readonly valid: false;
          readonly reason: CloudflareAttestationReason;
      };

export interface ConnectCloudflareReadiness {
    readonly enabled: boolean;
    readonly status: 'disabled' | 'ready' | 'unverified' | 'degraded';
    readonly message?: string;
}

interface CloudflareAttestationPayload {
    readonly version: 1;
    readonly validatedAt: number;
    readonly configHash: string;
}

function normalizeConfig(config: CloudflareValidationConfig) {
    return {
        accountId: config.accountId?.trim() ?? '',
        zoneId: config.zoneId?.trim() ?? '',
        apiToken: config.apiToken.trim(),
        hostnameSuffix: config.hostnameSuffix
            .trim()
            .toLowerCase()
            .replace(/\.$/, ''),
    };
}

function canonicalConfig(config: CloudflareValidationConfig): string {
    const normalized = normalizeConfig(config);
    return JSON.stringify([
        normalized.accountId,
        normalized.zoneId,
        normalized.apiToken,
        normalized.hostnameSuffix,
    ]);
}

export function cloudflareValidationConfigHash(
    config: CloudflareValidationConfig
): string {
    return createHash('sha256')
        .update(canonicalConfig(config))
        .digest('base64url');
}

function signature(
    payload: string,
    config: CloudflareValidationConfig
): string {
    return createHmac('sha256', normalizeConfig(config).apiToken)
        .update(`${CLOUDFLARE_ATTESTATION_PREFIX}.${payload}`)
        .digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return (
        actualBytes.length === expectedBytes.length &&
        timingSafeEqual(actualBytes, expectedBytes)
    );
}

/**
 * Issue only after the Cloudflare tunnel + DNS canary and cleanup succeed.
 * The value contains no raw credentials and becomes invalid when any
 * Cloudflare setting changes.
 */
export function issueCloudflareValidationAttestation(
    config: CloudflareValidationConfig,
    validatedAt = Date.now()
): string {
    const payload: CloudflareAttestationPayload = {
        version: 1,
        validatedAt,
        configHash: cloudflareValidationConfigHash(config),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
        'base64url'
    );
    return [
        CLOUDFLARE_ATTESTATION_PREFIX,
        encodedPayload,
        signature(encodedPayload, config),
    ].join('.');
}

export function validateCloudflareValidationAttestation(input: {
    readonly attestation?: string;
    readonly config: CloudflareValidationConfig;
    readonly now?: number;
    readonly maxAgeMs?: number;
}): CloudflareAttestationValidation {
    const attestation = input.attestation?.trim() ?? '';
    if (!attestation) return { valid: false, reason: 'missing' };
    if (attestation.length > 2_048) {
        return { valid: false, reason: 'malformed' };
    }
    const [prefix, encodedPayload, actualSignature, extra] =
        attestation.split('.');
    if (
        prefix !== CLOUDFLARE_ATTESTATION_PREFIX ||
        !encodedPayload ||
        !actualSignature ||
        extra !== undefined
    ) {
        return { valid: false, reason: 'malformed' };
    }

    let decodedPayload: unknown;
    try {
        decodedPayload = JSON.parse(
            Buffer.from(encodedPayload, 'base64url').toString('utf8')
        );
    } catch {
        return { valid: false, reason: 'malformed' };
    }
    if (
        typeof decodedPayload !== 'object' ||
        decodedPayload === null ||
        Array.isArray(decodedPayload)
    ) {
        return { valid: false, reason: 'malformed' };
    }
    const payload = decodedPayload as Record<string, unknown>;
    if (
        payload.version !== 1 ||
        !Number.isSafeInteger(payload.validatedAt) ||
        typeof payload.configHash !== 'string' ||
        !signaturesMatch(
            actualSignature,
            signature(encodedPayload, input.config)
        ) ||
        payload.configHash !== cloudflareValidationConfigHash(input.config)
    ) {
        return { valid: false, reason: 'mismatched' };
    }
    const validatedAt = payload.validatedAt as number;

    const now = input.now ?? Date.now();
    if (validatedAt > now + CLOUDFLARE_ATTESTATION_FUTURE_SKEW_MS) {
        return { valid: false, reason: 'future' };
    }
    const maxAgeMs = input.maxAgeMs ?? CLOUDFLARE_ATTESTATION_MAX_AGE_MS;
    if (now - validatedAt > maxAgeMs) {
        return { valid: false, reason: 'stale' };
    }
    return {
        valid: true,
        validatedAt,
        expiresAt: validatedAt + maxAgeMs,
    };
}

export function describeCloudflareAttestationFailure(
    reason: CloudflareAttestationReason
): string {
    if (reason === 'missing') {
        return 'Cloudflare permissions have not been verified for this Connect configuration.';
    }
    if (reason === 'stale') {
        return 'Cloudflare permission verification is stale.';
    }
    if (reason === 'future') {
        return 'Cloudflare permission verification has an invalid timestamp.';
    }
    if (reason === 'mismatched') {
        return 'Cloudflare permission verification does not match the current account, zone, token, or hostname.';
    }
    return 'Cloudflare permission verification is malformed.';
}

export function resolveConnectCloudflareReadiness(input: {
    readonly requestedEnabled: boolean;
    readonly strict: boolean;
    readonly relayProvider: string;
    readonly attestation?: string;
    readonly config: CloudflareValidationConfig;
    readonly now?: number;
}): ConnectCloudflareReadiness {
    if (!input.requestedEnabled) {
        return { enabled: false, status: 'disabled' };
    }
    if (input.relayProvider !== 'cloudflare') {
        return { enabled: true, status: 'ready' };
    }
    const validation = validateCloudflareValidationAttestation({
        attestation: input.attestation,
        config: input.config,
        now: input.now,
    });
    if (validation.valid) {
        return { enabled: true, status: 'ready' };
    }
    const message = `${describeCloudflareAttestationFailure(
        validation.reason
    )} Re-run the OR3 Cloud wizard to verify it.`;
    if (validation.reason === 'stale') {
        return {
            enabled: true,
            status: 'unverified',
            message,
        };
    }
    if (input.strict) {
        return {
            enabled: false,
            status: 'degraded',
            message,
        };
    }
    return {
        enabled: true,
        status: 'unverified',
        message,
    };
}
