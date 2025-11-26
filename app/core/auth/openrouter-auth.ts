import { err, reportError, type ErrorCode } from '~/utils/errors';
import { createOpenRouterClient } from '../../../shared/openrouter/client';
import { normalizeSDKError } from '../../../shared/openrouter/errors';

export interface ExchangeResultSuccess {
    ok: true;
    userKey: string;
    status: number;
}
export interface ExchangeResultFail {
    ok: false;
    status: number;
    reason: 'network' | 'bad-response' | 'no-key';
}
export type ExchangeResult = ExchangeResultSuccess | ExchangeResultFail;

export interface ExchangeParams {
    code: string;
    verifier: string;
    codeMethod: string;
    fetchImpl?: typeof fetch;
    attempt?: number;
}

/**
 * Map SDK error codes to app-level ErrorCode for reporting.
 * SDK errors that don't have a direct mapping use ERR_NETWORK as fallback.
 */
function mapToErrorCode(sdkCode: string): ErrorCode {
    switch (sdkCode) {
        case 'ERR_AUTH':
            return 'ERR_AUTH';
        case 'ERR_RATE_LIMIT':
            return 'ERR_RATE_LIMIT';
        case 'ERR_TIMEOUT':
            return 'ERR_TIMEOUT';
        case 'ERR_ABORTED':
        case 'ERR_NETWORK':
        default:
            return 'ERR_NETWORK';
    }
}

export async function exchangeOpenRouterCode(
    p: ExchangeParams
): Promise<ExchangeResult> {
    // SDK OAuth doesn't require auth for exchange
    const client = createOpenRouterClient({ apiKey: '' });

    try {
        const response = await client.oAuth.exchangeAuthCodeForAPIKey({
            code: p.code,
            codeVerifier: p.verifier,
            codeChallengeMethod: p.codeMethod as 'S256' | 'plain',
        });

        // SDK response contains { key: string }
        const userKey = response.key;

        if (!userKey) {
            reportError(
                err('ERR_AUTH', 'Auth exchange returned no key', {
                    severity: 'error',
                    tags: {
                        domain: 'auth',
                        stage: 'exchange',
                    },
                }),
                { toast: true }
            );
            return { ok: false, status: 200, reason: 'no-key' };
        }

        return { ok: true, userKey, status: 200 };
    } catch (error) {
        const normalized = normalizeSDKError(error);

        if (normalized.code === 'ERR_ABORTED') {
            return { ok: false, status: 0, reason: 'network' };
        }

        reportError(
            err(mapToErrorCode(normalized.code), normalized.message, {
                severity: 'error',
                tags: {
                    domain: 'auth',
                    stage: 'exchange',
                    attempt: p.attempt || 1,
                },
                retryable: normalized.retryable,
            }),
            { toast: true }
        );

        return { ok: false, status: normalized.status, reason: 'bad-response' };
    }
}
