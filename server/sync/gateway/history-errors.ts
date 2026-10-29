import { normalizeError } from '~~/shared/errors';

/** Provider history failures must carry structured metadata; unknown failures remain retryable. */
export class BackgroundHistoryUnsupportedError extends Error {
    constructor(providerId?: string) {
        super(`Sync provider "${providerId || 'unknown'}" does not support background generation history v1`);
        this.name = 'BackgroundHistoryUnsupportedError';
    }
}

/** Normalize provider metadata at the history adapter boundary, never from message text. */
export function normalizeHistoryProviderFailure(error: unknown): Error & { historyFailure: 'blocked' | 'retry' } {
    const value = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
    const metadata = normalizeError(error, { source: 'sync' });
    const status = metadata.status;
    const code = value.code;
    const blockedCodes = ['VALIDATION_ERROR', 'OVERSIZED', 'ERR_SYNC_PAYLOAD_TOO_LARGE', 'UNAUTHORIZED', 'FORBIDDEN', 'CONFLICT', 'SUPERSEDED', 'UNSUPPORTED', 'ERR_VALIDATION', 'ERR_AUTH', 'ERR_FORBIDDEN', 'ERR_BAD_REQUEST'];
    const transientStatus = typeof status === 'number' && (status === 408 || status === 429 || status >= 500);
    const blocked = !transientStatus && (
        (typeof status === 'number' && status >= 400 && status < 500) ||
        (typeof code === 'string' && blockedCodes.includes(code)) ||
        blockedCodes.includes(metadata.code) ||
        value.retryable === false
    );
    return Object.assign(new Error(error instanceof Error ? error.message : 'Background history provider failure', { cause: error }), {
        historyFailure: blocked ? 'blocked' as const : 'retry' as const,
        code: metadata.code,
        status: metadata.status,
        retryAfterMs: metadata.retryAfterMs,
    });
}
