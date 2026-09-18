/**
 * Bounded HTTPS client for the central Library endpoints.
 *
 * The browser never talks to the central marketplace: the local server does.
 * Every response is validated before it is trusted, redirects are refused, the
 * body is size-limited and failures are mapped to the small set of states the
 * service and UI act on. No secret ever appears in a URL.
 */
import type { LibraryLinkConfig } from './config';

const MAX_RESPONSE_BYTES = 64 * 1024;
const PAIRING_ID_PATTERN = /^prs_[a-f0-9]{32}$/;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const TOKEN_PATTERN = /^lkl_[A-Za-z0-9_-]{43}$/;

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

export interface PolledPairingPayload {
    readonly status: RemotePairingStatus;
    readonly expiresAt: string;
    readonly retryAfterMs: number;
    readonly token?: string;
    readonly link?: RemoteLinkSummary;
}

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

export interface LinkedSessionPayload {
    readonly link: RemoteLinkSummary;
    readonly user: { readonly id: string; readonly displayName?: string };
    readonly scopes: readonly string[];
}

export interface LibraryLinkTransport {
    start(input: {
        readonly label: string;
        readonly origin: string;
    }): Promise<TransportResult<StartedPairingPayload>>;
    poll(pairingId: string, secret: string): Promise<TransportResult<PolledPairingPayload>>;
    verify(token: string): Promise<TransportResult<LinkedSessionPayload>>;
    revoke(token: string): Promise<TransportResult<{ readonly revoked: true }>>;
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
    const scopes = Array.isArray(value.scopes) && value.scopes.every((entry) => typeof entry === 'string')
        ? (value.scopes as string[])
        : null;
    if (!id || !label || !origin || !status || !createdAt || !expiresAt || !scopes) return null;
    if (status !== 'active' && status !== 'revoked') return null;
    const revokedAt = value.revokedAt === null || typeof value.revokedAt === 'string' ? value.revokedAt : null;
    return { id, label, origin, status, scopes, createdAt, expiresAt, revokedAt };
}

function parseStartedPairing(value: unknown): StartedPairingPayload | null {
    const pairing = isRecord(value) ? value.pairing : null;
    if (!isRecord(pairing) || !isRecord(value)) return null;
    const pairingId = stringField(pairing, 'id');
    const code = stringField(pairing, 'code');
    const verificationUrl = stringField(pairing, 'verificationUrl');
    const expiresAt = stringField(pairing, 'expiresAt');
    const retryAfterMs = positiveNumber(value, 'retryAfterMs');
    const secret = stringField(value, 'secret');
    if (!pairingId || !PAIRING_ID_PATTERN.test(pairingId)) return null;
    if (!code || !CODE_PATTERN.test(code)) return null;
    if (!verificationUrl || !/^https?:\/\//.test(verificationUrl)) return null;
    if (!expiresAt || retryAfterMs === null || !secret) return null;
    return { pairingId, code, verificationUrl, expiresAt, retryAfterMs, secret };
}

function parsePolledPairing(value: unknown): PolledPairingPayload | null {
    const pairing = isRecord(value) ? value.pairing : null;
    if (!isRecord(pairing) || !isRecord(value)) return null;
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
    return {
        status: status as RemotePairingStatus,
        expiresAt,
        retryAfterMs,
        ...(token ? { token } : {}),
        ...(link ? { link } : {}),
    };
}

function parseLinkedSession(value: unknown): LinkedSessionPayload | null {
    if (!isRecord(value)) return null;
    const link = parseLinkSummary(value.link);
    const user = isRecord(value.user) ? value.user : null;
    const userId = user ? stringField(user, 'id') : null;
    const scopes = Array.isArray(value.scopes) && value.scopes.every((entry) => typeof entry === 'string')
        ? (value.scopes as string[])
        : null;
    if (!link || !userId || !scopes) return null;
    const displayName = user ? stringField(user, 'displayName') : null;
    return { link, user: { id: userId, ...(displayName ? { displayName } : {}) }, scopes };
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
            return { ok: false, failure: failure('central-unreachable', 'The marketplace could not be reached.') };
        }

        if (!response.ok) {
            let code: string | null = null;
            try {
                const parsed = (await response.json()) as unknown;
                if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === 'string') {
                    code = parsed.error.code;
                }
            } catch {
                code = null;
            }
            return { ok: false, failure: mapHttpFailure(response.status, code) };
        }

        try {
            const text = await response.text();
            if (text.length > MAX_RESPONSE_BYTES) {
                return { ok: false, failure: failure('invalid-response', 'The marketplace response was too large.') };
            }
            return { ok: true, value: JSON.parse(text) as unknown };
        } catch {
            return { ok: false, failure: failure('invalid-response', 'The marketplace response was not valid JSON.') };
        }
    }

    return {
        async start(input) {
            const result = await request('/api/v1/connect/pairings', { method: 'POST', body: input });
            if (!result.ok) return result;
            const parsed = parseStartedPairing(result.value);
            if (!parsed) {
                return { ok: false, failure: failure('invalid-response', 'The marketplace sent an unexpected pairing response.') };
            }
            return { ok: true, value: parsed };
        },

        async poll(pairingId, secret) {
            if (!PAIRING_ID_PATTERN.test(pairingId)) {
                return { ok: false, failure: failure('pairing-not-found', 'This pairing is unknown or was replaced.') };
            }
            const result = await request(`/api/v1/connect/pairings/${pairingId}/poll`, {
                method: 'POST',
                headers: { 'x-or3-pairing-secret': secret },
            });
            if (!result.ok) return result;
            const parsed = parsePolledPairing(result.value);
            if (!parsed) {
                return { ok: false, failure: failure('invalid-response', 'The marketplace sent an unexpected pairing state.') };
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
                return { ok: false, failure: failure('invalid-response', 'The marketplace sent an unexpected session response.') };
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
                return { ok: false, failure: failure('invalid-response', 'The marketplace did not confirm the revocation.') };
            }
            return { ok: true, value: { revoked: true } };
        },
    };
}
