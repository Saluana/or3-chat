/**
 * Bounded HTTPS client for the central Library endpoints.
 *
 * The browser never talks to the central marketplace: the local server does.
 * Every response is validated before it is trusted — including the verification
 * URL, which must be the configured marketplace origin's own `/link` page —
 * redirects are refused, bodies are size-limited while streaming, and failures
 * are mapped to the small set of states the service and UI act on. No secret
 * ever appears in a URL.
 */
import type { LibraryLinkConfig } from './config';
import { canonicalJson } from '~~/shared/plugins/descriptor-key';
import type { PluginAcquisitionReceipt } from '~~/shared/plugins/acquisition/contracts';

const MAX_RESPONSE_BYTES = 64 * 1024;
const PAIRING_ID_PATTERN = /^prs_[a-f0-9]{32}$/;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const TOKEN_PATTERN = /^lkl_[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^sha256-[a-f0-9]{64}$/;
const RECEIPT_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const RECEIPT_ID_PATTERN = /^acq_[A-Za-z0-9]{4,60}$/;
const RELEASE_ID_PATTERN = /^rel_[A-Za-z0-9._:-]{1,100}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const RECEIPT_KEY_CACHE_MS = 5 * 60_000;

export interface RemoteReceiptKey {
    readonly keyId: string;
    readonly algorithm: 'ed25519';
    readonly status: 'active' | 'retired' | 'compromised';
    readonly publicKeyJwk: { readonly kty: 'OKP'; readonly crv: 'Ed25519'; readonly x: string };
}

const receiptKeyCache = new Map<
    string,
    { readonly expiresAt: number; readonly keys: readonly RemoteReceiptKey[] }
>();

/** Test seam; production callers use the bounded module cache. */
export function clearLibraryReceiptKeyCache(): void {
    receiptKeyCache.clear();
}

export type LibraryTransportFailureCode =
    | 'central-unreachable'
    | 'central-rejected'
    | 'invalid-response'
    | 'link-invalid'
    | 'link-revoked'
    | 'link-expired'
    | 'account-restricted'
    | 'account-deleted'
    | 'rate-limited'
    | 'pairing-not-found'
    | 'pairing-unavailable';

export interface LibraryTransportFailure {
    readonly code: LibraryTransportFailureCode;
    readonly message: string;
    readonly retryable: boolean;
}

export type TransportResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly failure: LibraryTransportFailure };

export interface StartedPairingPayload {
    readonly pairingId: string;
    readonly code: string;
    readonly verificationUrl: string;
    readonly expiresAt: string;
    readonly retryAfterMs: number;
    readonly secret: string;
}

export type RemotePairingStatus =
    | 'pending'
    | 'approved'
    | 'denied'
    | 'consumed'
    | 'expired'
    | 'canceled';

export interface RemoteLinkSummary {
    readonly id: string;
    readonly label: string;
    readonly origin: string;
    readonly status: 'active' | 'revoked';
    readonly scopes: readonly string[];
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly revokedAt: string | null;
}

export interface RemoteLinkedUser {
    readonly id: string;
    readonly displayName?: string;
}

export interface PolledPairingPayload {
    readonly status: RemotePairingStatus;
    readonly expiresAt: string;
    readonly retryAfterMs: number;
    readonly token?: string;
    readonly link?: RemoteLinkSummary;
    readonly user?: RemoteLinkedUser;
}

export interface LinkedSessionPayload {
    readonly link: RemoteLinkSummary;
    readonly user: RemoteLinkedUser;
    readonly scopes: readonly string[];
}

/**
 * One acquired release as the marketplace reports it (task 10.1). Only what a
 * Library view needs: the release identity, when it was acquired and which
 * coverage allowed it.
 */
export interface RemoteAcquiredRelease {
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    readonly archiveSha256: string;
    readonly coverageKind: 'update-pass' | 'plus';
    readonly coverageUntil: string;
    readonly acquiredAt: string;
}

export interface RemoteLibraryEntitlements {
    readonly plus: { readonly status: 'active' | 'none' | 'ended'; readonly until: string | null };
    readonly pluginCoverage: readonly {
        readonly pluginId: string;
        readonly until: string;
        readonly status: 'valid' | 'refunded' | 'withdrawn';
    }[];
    readonly acquired: readonly RemoteAcquiredRelease[];
    readonly acquiredCursor: string | null;
}

/**
 * One covered acquisition as the marketplace records it. Acquisition is
 * idempotent on the central side, so retrying never requires a repurchase; the
 * artifact path is the only place the bytes may be fetched from.
 */
export interface RemoteAcquisition {
    readonly releaseId: string;
    readonly artifactPath: string;
    /** Structured receipt already verified against the marketplace key registry. */
    readonly receipt: PluginAcquisitionReceipt;
    readonly alreadyAcquired: boolean;
}

function parseRemoteAcquisition(value: unknown): RemoteAcquisition | null {
    if (!isRecord(value)) return null;
    const acquisition = value.acquisition;
    const release = value.release;
    if (!isRecord(acquisition) || !isRecord(release)) return null;
    if (typeof release.releaseId !== 'string' || typeof release.artifactPath !== 'string') {
        return null;
    }
    const receipt = parseAcquisitionReceipt(value.receipt);
    if (!receipt || receipt.payload.release.releaseId !== release.releaseId) return null;
    return {
        releaseId: release.releaseId,
        artifactPath: release.artifactPath,
        receipt,
        alreadyAcquired: acquisition.alreadyAcquired === true,
    };
}

function parseAcquisitionReceipt(value: unknown): PluginAcquisitionReceipt | null {
    if (!isRecord(value) || value.algorithm !== 'ed25519') return null;
    if (
        typeof value.keyId !== 'string' ||
        !RECEIPT_KEY_ID_PATTERN.test(value.keyId) ||
        typeof value.signature !== 'string' ||
        !BASE64URL_PATTERN.test(value.signature)
    ) {
        return null;
    }
    const payload = value.payload;
    if (!isRecord(payload) || payload.schemaVersion !== 1) return null;
    if (
        typeof payload.receiptId !== 'string' ||
        !RECEIPT_ID_PATTERN.test(payload.receiptId) ||
        typeof payload.marketplaceUserId !== 'string' ||
        payload.marketplaceUserId.length === 0 ||
        payload.marketplaceUserId.length > 80 ||
        !validTimestamp(payload.issuedAt)
    ) {
        return null;
    }
    const release = payload.release;
    if (
        !isRecord(release) ||
        typeof release.releaseId !== 'string' ||
        !RELEASE_ID_PATTERN.test(release.releaseId) ||
        typeof release.pluginId !== 'string' ||
        release.pluginId.length === 0 ||
        typeof release.version !== 'string' ||
        release.version.length === 0 ||
        !validHash(release.archiveSha256) ||
        !nullableHash(release.packageTreeSha256) ||
        !nullableHash(release.manifestSha256) ||
        !nullableHash(release.authoritySha256)
    ) {
        return null;
    }
    const coverage = payload.coverage;
    if (
        !isRecord(coverage) ||
        (coverage.kind !== 'update-pass' && coverage.kind !== 'plus') ||
        typeof coverage.grantId !== 'string' ||
        coverage.grantId.length === 0 ||
        coverage.grantId.length > 80 ||
        !validTimestamp(coverage.until)
    ) {
        return null;
    }
    return value as unknown as PluginAcquisitionReceipt;
}

function validTimestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validHash(value: unknown): value is `sha256-${string}` {
    return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function nullableHash(value: unknown): value is `sha256-${string}` | null {
    return value === null || validHash(value);
}

function parseReceiptKeys(value: unknown): readonly RemoteReceiptKey[] | null {
    if (!isRecord(value) || !Array.isArray(value.keys)) return null;
    const keys: RemoteReceiptKey[] = [];
    const seen = new Set<string>();
    for (const entry of value.keys) {
        if (!isRecord(entry)) return null;
        const jwk = entry.publicKeyJwk;
        if (
            typeof entry.keyId !== 'string' ||
            !RECEIPT_KEY_ID_PATTERN.test(entry.keyId) ||
            seen.has(entry.keyId) ||
            entry.algorithm !== 'ed25519' ||
            (entry.status !== 'active' &&
                entry.status !== 'retired' &&
                entry.status !== 'compromised') ||
            !isRecord(jwk) ||
            jwk.kty !== 'OKP' ||
            jwk.crv !== 'Ed25519' ||
            typeof jwk.x !== 'string' ||
            !BASE64URL_PATTERN.test(jwk.x)
        ) {
            return null;
        }
        seen.add(entry.keyId);
        keys.push({
            keyId: entry.keyId,
            algorithm: 'ed25519',
            status: entry.status,
            publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
        });
    }
    return keys;
}

function fromBase64Url(value: string): Uint8Array | null {
    if (!BASE64URL_PATTERN.test(value)) return null;
    try {
        const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

async function verifyAcquisitionReceipt(
    receipt: PluginAcquisitionReceipt,
    key: RemoteReceiptKey
): Promise<boolean> {
    const signature = fromBase64Url(receipt.signature);
    if (!signature) return false;
    try {
        const cryptoKey = await crypto.subtle.importKey(
            'jwk',
            key.publicKeyJwk as JsonWebKey,
            { name: 'Ed25519' },
            false,
            ['verify']
        );
        return await crypto.subtle.verify(
            { name: 'Ed25519' },
            cryptoKey,
            signature as unknown as BufferSource,
            new TextEncoder().encode(canonicalJson(receipt.payload)) as unknown as BufferSource
        );
    } catch {
        return false;
    }
}

export interface LibraryLinkTransport {
    start(input: {
        readonly label: string;
        readonly origin: string;
        readonly replace?: { readonly pairingId: string; readonly secret: string };
    }): Promise<TransportResult<StartedPairingPayload>>;
    poll(pairingId: string, secret: string): Promise<TransportResult<PolledPairingPayload>>;
    verify(token: string): Promise<TransportResult<LinkedSessionPayload>>;
    revoke(token: string): Promise<TransportResult<{ readonly revoked: true }>>;
    /** The linked account's purchases, for the local Library view (task 10.1). */
    entitlements(token: string): Promise<TransportResult<RemoteLibraryEntitlements>>;
    /**
     * Record (idempotently) an acquisition for one exact release and return the
     * path its bytes may be fetched from. Never a download itself.
     */
    acquire(token: string, releaseId: string): Promise<TransportResult<RemoteAcquisition>>;
}

const RETRYABLE_CODES: readonly LibraryTransportFailureCode[] = [
    'central-unreachable',
    'rate-limited',
    'pairing-unavailable',
];

function failure(
    code: LibraryTransportFailureCode,
    message: string
): LibraryTransportFailure {
    return { code, message, retryable: RETRYABLE_CODES.includes(code) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | null {
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function positiveNumber(source: Record<string, unknown>, key: string): number | null {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseLinkSummary(value: unknown): RemoteLinkSummary | null {
    if (!isRecord(value)) return null;
    const id = stringField(value, 'id');
    const label = stringField(value, 'label');
    const origin = stringField(value, 'origin');
    const status = stringField(value, 'status');
    const createdAt = stringField(value, 'createdAt');
    const expiresAt = stringField(value, 'expiresAt');
    const scopes =
        Array.isArray(value.scopes) && value.scopes.every((entry) => typeof entry === 'string')
            ? (value.scopes as string[])
            : null;
    if (!id || !label || !origin || !status || !createdAt || !expiresAt || !scopes) return null;
    if (status !== 'active' && status !== 'revoked') return null;
    const revokedAt =
        value.revokedAt === null || typeof value.revokedAt === 'string' ? value.revokedAt : null;
    return { id, label, origin, status, scopes, createdAt, expiresAt, revokedAt };
}

function parseLinkedUser(value: unknown): RemoteLinkedUser | null {
    if (!isRecord(value)) return null;
    const id = stringField(value, 'id');
    if (!id) return null;
    const displayName = stringField(value, 'displayName');
    return { id, ...(displayName ? { displayName } : {}) };
}

function parseStartedPairing(value: unknown, marketplaceOrigin: string): StartedPairingPayload | null {
    if (!isRecord(value)) return null;
    const pairing = value.pairing;
    if (!isRecord(pairing)) return null;
    const pairingId = stringField(pairing, 'id');
    const code = stringField(pairing, 'code');
    const verificationUrl = stringField(pairing, 'verificationUrl');
    const expiresAt = stringField(pairing, 'expiresAt');
    const retryAfterMs = positiveNumber(value, 'retryAfterMs');
    const secret = stringField(value, 'secret');
    if (!pairingId || !PAIRING_ID_PATTERN.test(pairingId)) return null;
    if (!code || !CODE_PATTERN.test(code)) return null;
    if (!expiresAt || retryAfterMs === null || !secret) return null;
    // The URL is presented to the user as "Open the marketplace", so it must be
    // this deployment's configured origin's own verification page — not any
    // http(s) string an upstream response happens to contain.
    if (!verificationUrl) return null;
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(verificationUrl);
    } catch {
        return null;
    }
    if (parsedUrl.origin !== marketplaceOrigin) return null;
    if (parsedUrl.pathname !== '/link') return null;
    if (parsedUrl.searchParams.get('code') !== code) return null;
    return {
        pairingId,
        code,
        verificationUrl: parsedUrl.toString(),
        expiresAt,
        retryAfterMs,
        secret,
    };
}

function parsePolledPairing(value: unknown): PolledPairingPayload | null {
    if (!isRecord(value)) return null;
    const pairing = value.pairing;
    if (!isRecord(pairing)) return null;
    const status = stringField(pairing, 'status');
    const expiresAt = stringField(pairing, 'expiresAt');
    const retryAfterMs = positiveNumber(pairing, 'retryAfterMs');
    if (
        !status ||
        !['pending', 'approved', 'denied', 'consumed', 'expired', 'canceled'].includes(status) ||
        !expiresAt ||
        retryAfterMs === null
    ) {
        return null;
    }
    const token = stringField(value, 'token');
    if (token !== null && !TOKEN_PATTERN.test(token)) return null;
    const link = value.link === undefined ? undefined : parseLinkSummary(value.link);
    if (value.link !== undefined && !link) return null;
    const user = value.user === undefined ? undefined : parseLinkedUser(value.user);
    if (value.user !== undefined && !user) return null;
    if (token && (!link || !user)) return null;
    return {
        status: status as RemotePairingStatus,
        expiresAt,
        retryAfterMs,
        ...(token ? { token } : {}),
        ...(link ? { link } : {}),
        ...(user ? { user } : {}),
    };
}

function parseLinkedSession(value: unknown): LinkedSessionPayload | null {
    if (!isRecord(value)) return null;
    const link = parseLinkSummary(value.link);
    const user = parseLinkedUser(value.user);
    const scopes =
        Array.isArray(value.scopes) && value.scopes.every((entry) => typeof entry === 'string')
            ? (value.scopes as string[])
            : null;
    if (!link || !user || !scopes) return null;
    return { link, user, scopes };
}

/**
 * Nitro serializes `createError` as `{ statusCode, statusMessage, message,
 * data: { error: { code, … } } }`. Reading only one shape would silently turn
 * precise states (account deleted, link revoked) into generic rejections.
 */
function errorCodeFrom(body: unknown): string | null {
    if (!isRecord(body)) return null;
    const data = body.data;
    if (isRecord(data) && isRecord(data.error) && typeof data.error.code === 'string') {
        return data.error.code;
    }
    if (isRecord(body.error) && typeof body.error.code === 'string') return body.error.code;
    if (typeof body.statusMessage === 'string' && body.statusMessage.length > 0) return body.statusMessage;
    return null;
}

function mapHttpFailure(status: number, code: string | null): LibraryTransportFailure {
    if (status === 401) {
        if (code === 'link-revoked') return failure('link-revoked', 'The marketplace revoked this link.');
        if (code === 'link-expired') return failure('link-expired', 'The marketplace link expired.');
        return failure('link-invalid', 'The marketplace did not accept this credential.');
    }
    if (status === 403 && code === 'account-restricted') {
        return failure('account-restricted', 'The marketplace account is restricted.');
    }
    if (status === 403 && code === 'account-deleted') {
        return failure('account-deleted', 'The marketplace account was deleted.');
    }
    if (status === 404 && code === 'pairing-not-found') {
        return failure('pairing-not-found', 'The marketplace no longer knows this pairing.');
    }
    if (status === 429) {
        return failure('rate-limited', 'The marketplace asked to slow down.');
    }
    if (status === 503) {
        return failure('pairing-unavailable', 'The marketplace cannot pair right now.');
    }
    if (status >= 500) {
        return failure('central-unreachable', 'The marketplace is unavailable right now.');
    }
    return failure('central-rejected', 'The marketplace rejected the request.');
}

/**
 * Reads at most `limit` bytes from the body stream. `response.text()` would
 * buffer an arbitrarily large body before the length check, so the limit is
 * enforced while reading. Returns null when the limit is exceeded.
 */
async function readBoundedText(response: Response, limit: number): Promise<string | null> {
    const body = response.body;
    if (!body) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > limit) return null;
        return new TextDecoder().decode(buffer);
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > limit) {
                await reader.cancel().catch(() => undefined);
                return null;
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return text;
    } finally {
        reader.releaseLock();
    }
}

/**
 * Validate the entitlements response before it reaches a view. A structurally
 * wrong payload is refused rather than rendered as an empty Library.
 */
export function parseLibraryEntitlements(value: unknown): RemoteLibraryEntitlements | null {
    if (!isRecord(value)) return null;
    const plus = value.plus;
    if (!isRecord(plus) || typeof plus.status !== 'string') return null;
    if (!['active', 'none', 'ended'].includes(plus.status)) return null;
    if (plus.until !== null && typeof plus.until !== 'string') return null;

    const coverage: { pluginId: string; until: string; status: 'valid' | 'refunded' | 'withdrawn' }[] = [];
    if (!Array.isArray(value.pluginCoverage)) return null;
    for (const entry of value.pluginCoverage) {
        if (!isRecord(entry)) return null;
        const pluginId = stringField(entry, 'pluginId');
        const until = stringField(entry, 'until');
        const status = entry.status;
        if (!pluginId || !until) return null;
        if (status !== 'valid' && status !== 'refunded' && status !== 'withdrawn') return null;
        coverage.push({ pluginId, until, status });
    }

    const acquired: RemoteAcquiredRelease[] = [];
    if (!Array.isArray(value.acquired)) return null;
    for (const entry of value.acquired) {
        if (!isRecord(entry)) return null;
        const releaseId = stringField(entry, 'releaseId');
        const pluginId = stringField(entry, 'pluginId');
        const version = stringField(entry, 'version');
        const archiveSha256 = stringField(entry, 'archiveSha256');
        const coverageUntil = stringField(entry, 'coverageUntil');
        const acquiredAt = stringField(entry, 'acquiredAt');
        const coverageKind = entry.coverageKind;
        if (!releaseId || !pluginId || !version || !archiveSha256 || !coverageUntil || !acquiredAt) {
            return null;
        }
        if (coverageKind !== 'update-pass' && coverageKind !== 'plus') return null;
        acquired.push({
            releaseId,
            pluginId,
            version,
            archiveSha256,
            coverageKind,
            coverageUntil,
            acquiredAt,
        });
    }

    const cursor = value.acquiredCursor;
    if (cursor !== null && cursor !== undefined && typeof cursor !== 'string') return null;

    return {
        plus: { status: plus.status as 'active' | 'none' | 'ended', until: plus.until as string | null },
        pluginCoverage: coverage,
        acquired,
        acquiredCursor: typeof cursor === 'string' ? cursor : null,
    };
}

export function createHttpLibraryLinkTransport(
    config: Pick<LibraryLinkConfig, 'registryOrigin' | 'requestTimeoutMs'>
): LibraryLinkTransport {
    async function request(
        path: string,
        init: { method: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> }
    ): Promise<TransportResult<unknown>> {
        let response: Response;
        try {
            response = await fetch(`${config.registryOrigin}${path}`, {
                method: init.method,
                headers: {
                    accept: 'application/json',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                    ...(init.headers ?? {}),
                },
                ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
                signal: AbortSignal.timeout(config.requestTimeoutMs),
                redirect: 'error',
            });
        } catch {
            return {
                ok: false,
                failure: failure('central-unreachable', 'The marketplace could not be reached.'),
            };
        }

        const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
        if (text === null) {
            return {
                ok: false,
                failure: failure('invalid-response', 'The marketplace response was too large.'),
            };
        }

        let parsed: unknown = null;
        try {
            parsed = text.length > 0 ? JSON.parse(text) : null;
        } catch {
            parsed = null;
        }

        if (!response.ok) {
            return { ok: false, failure: mapHttpFailure(response.status, errorCodeFrom(parsed)) };
        }
        if (parsed === null) {
            return {
                ok: false,
                failure: failure('invalid-response', 'The marketplace response was not valid JSON.'),
            };
        }
        return { ok: true, value: parsed };
    }

    async function receiptKeys(
        forceFresh = false
    ): Promise<TransportResult<readonly RemoteReceiptKey[]>> {
        const cached = receiptKeyCache.get(config.registryOrigin);
        if (!forceFresh && cached && cached.expiresAt > Date.now()) {
            return { ok: true, value: cached.keys };
        }
        const result = await request('/api/v1/catalog/trust/receipt-keys', { method: 'GET' });
        if (!result.ok) return result;
        const parsed = parseReceiptKeys(result.value);
        if (!parsed) {
            return {
                ok: false,
                failure: failure(
                    'invalid-response',
                    'The marketplace sent an unexpected receipt-key response.'
                ),
            };
        }
        receiptKeyCache.set(config.registryOrigin, {
            expiresAt: Date.now() + RECEIPT_KEY_CACHE_MS,
            keys: parsed,
        });
        return { ok: true, value: parsed };
    }

    return {
        async start(input) {
            const result = await request('/api/v1/connect/pairings', {
                method: 'POST',
                body: {
                    label: input.label,
                    origin: input.origin,
                    ...(input.replace ? { replace: input.replace } : {}),
                },
            });
            if (!result.ok) return result;
            const parsed = parseStartedPairing(result.value, config.registryOrigin);
            if (!parsed) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace sent an unexpected pairing response.'
                    ),
                };
            }
            return { ok: true, value: parsed };
        },

        async poll(pairingId, secret) {
            if (!PAIRING_ID_PATTERN.test(pairingId)) {
                return {
                    ok: false,
                    failure: failure('pairing-not-found', 'This pairing is unknown or was replaced.'),
                };
            }
            const result = await request(`/api/v1/connect/pairings/${pairingId}/poll`, {
                method: 'POST',
                headers: { 'x-or3-pairing-secret': secret },
            });
            if (!result.ok) return result;
            const parsed = parsePolledPairing(result.value);
            if (!parsed) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace sent an unexpected pairing state.'
                    ),
                };
            }
            return { ok: true, value: parsed };
        },

        async verify(token) {
            const result = await request('/api/v1/library/session', {
                method: 'GET',
                headers: { 'x-or3-library-token': token },
            });
            if (!result.ok) return result;
            const parsed = parseLinkedSession(result.value);
            if (!parsed) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace sent an unexpected session response.'
                    ),
                };
            }
            return { ok: true, value: parsed };
        },

        async entitlements(token) {
            const result = await request('/api/v1/library/entitlements', {
                method: 'GET',
                headers: { 'x-or3-library-token': token },
            });
            if (!result.ok) return result;
            const parsed = parseLibraryEntitlements(result.value);
            if (!parsed) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace sent an unexpected Library response.'
                    ),
                };
            }
            return { ok: true, value: parsed };
        },

        async acquire(token, releaseId) {
            const result = await request('/api/v1/library/acquisitions', {
                method: 'POST',
                headers: { 'x-or3-library-token': token },
                body: { releaseId },
            });
            if (!result.ok) return result;
            const parsed = parseRemoteAcquisition(result.value);
            if (!parsed) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace sent an unexpected acquisition response.'
                    ),
                };
            }
            if (parsed.releaseId !== releaseId) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace confirmed a different release than the one requested.'
                    ),
                };
            }
            // Key status is security-sensitive and the public endpoint has no
            // signed freshness envelope. Re-fetch it for every acquisition;
            // the cache is reserved for non-security callers/test seams.
            const keys = await receiptKeys(true);
            if (!keys.ok) return keys;
            const key = keys.value.find((candidate) => candidate.keyId === parsed.receipt.keyId);
            if (!key || key.status === 'compromised' || !(await verifyAcquisitionReceipt(parsed.receipt, key))) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace returned an untrusted acquisition receipt.'
                    ),
                };
            }
            return { ok: true, value: parsed };
        },

        async revoke(token) {
            const result = await request('/api/v1/library/session/revoke', {
                method: 'POST',
                headers: { 'x-or3-library-token': token },
            });
            if (!result.ok) return result;
            if (!isRecord(result.value) || result.value.revoked !== true) {
                return {
                    ok: false,
                    failure: failure(
                        'invalid-response',
                        'The marketplace did not confirm the revocation.'
                    ),
                };
            }
            return { ok: true, value: { revoked: true } };
        },
    };
}
