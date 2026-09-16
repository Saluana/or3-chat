/**
 * @module app/core/auth/openrouter-auth
 *
 * Purpose:
 * Handles the OpenRouter OAuth PKCE code exchange. Receives an authorization
 * code from the callback page and exchanges it for a user API key via the
 * OpenRouter SDK.
 *
 * Responsibilities:
 * - Exchange an authorization code + PKCE verifier for an API key
 * - Map SDK error codes to the app-level `ErrorCode` union
 * - Report structured errors via `reportError()` with toast feedback
 *
 * Non-responsibilities:
 * - Does not initiate the OAuth flow (see useOpenrouter.ts)
 * - Does not persist the obtained key (caller is responsible)
 *
 * Constraints:
 * - Relies on the shared OpenRouter SDK client (no direct fetch)
 * - Error mapping is intentionally conservative; unknown codes fall to ERR_NETWORK
 *
 * @see core/auth/useOpenrouter for the login flow initiator
 * @see shared/openrouter/errors for SDK error normalization
 */
import { type ErrorCode } from '~/utils/errors';
import {
    createOpenRouterClient,
    normalizeSDKError,
    wrapLegacyOAuthExchangeArgs,
} from '~~/shared/openrouter';
import { useRuntimeConfig } from '#imports';

/** Successful code exchange: contains the user's API key. */
export interface ExchangeResultSuccess {
    ok: true;
    userKey: string;
    status: number;
}

/** Failed code exchange with a categorized reason. */
export interface ExchangeResultFail {
    ok: false;
    status: number;
    reason: 'network' | 'bad-response' | 'no-key';
    /** App-level error code for the callback page to render once. */
    errorCode?: ErrorCode;
    /** Redacted SDK message; the callback page decides user-facing wording. */
    errorMessage?: string;
}

/** Discriminated union returned by `exchangeOpenRouterCode`. */
export type ExchangeResult = ExchangeResultSuccess | ExchangeResultFail;

/**
 * Bounded deadline for the one-shot PKCE exchange. The authorization code is
 * single-use, so a retry cannot succeed and only delays showing the user a fresh
 * authorization prompt.
 */
const OAUTH_EXCHANGE_TIMEOUT_MS = 15_000;

export interface ExchangeParams {
    code: string;
    verifier: string;
    codeMethod: string;
    attempt?: number;
}

/**
 * Map SDK error codes to app-level ErrorCode for reporting.
 * SDK errors that don't have a direct mapping use ERR_NETWORK as fallback.
 *
 * Note: SDK error codes are defined in shared/openrouter/errors.ts.
 * Only codes that exist in both places (ErrorCode union and SDK normalizer)
 * should be mapped directly. All others fall through to ERR_NETWORK.
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
            // Unknown SDK codes fallback to generic network error
            return 'ERR_NETWORK';
    }
}

/**
 * Purpose:
 * Exchange an OAuth authorization code for an OpenRouter API key.
 *
 * Behavior:
 * Calls the OpenRouter SDK `oAuth.exchangeAuthCodeForAPIKey` endpoint.
 * On success, returns the API key string. On failure, reports a structured
 * error and returns a typed failure result.
 *
 * Errors:
 * - `ERR_AUTH`: Exchange returned no key or auth failure
 * - `ERR_RATE_LIMIT`: OpenRouter rate limit hit
 * - `ERR_NETWORK`: Network/abort/unknown error
 *
 * @throws Never throws; errors are reported via `reportError()` with toast.
 */
export async function exchangeOpenRouterCode(
    p: ExchangeParams
): Promise<ExchangeResult> {
    // SDK OAuth doesn't require auth for exchange
    const runtimeConfig = useRuntimeConfig() as {
        public?: { openRouter?: { baseUrl?: string } };
    };
    const client = createOpenRouterClient({
        apiKey: '',
        serverURL: runtimeConfig.public?.openRouter?.baseUrl,
    });

    try {
        const response = await client.oAuth.exchangeAuthCodeForAPIKey(
            wrapLegacyOAuthExchangeArgs({
                code: p.code,
                codeVerifier: p.verifier,
                codeChallengeMethod: p.codeMethod as 'S256' | 'plain',
            }),
            // The SDK otherwise retries connection errors and 5xx responses for
            // up to an hour. An authorization code is single-use, so retries
            // waste the user's time instead of recovering; fail fast and let the
            // callback page offer a fresh authorization.
            { retries: { strategy: 'none' }, timeoutMs: OAUTH_EXCHANGE_TIMEOUT_MS }
        );

        // SDK response contains { key: string }
        const userKey = response.key;

        if (!userKey) {
            return { ok: false, status: 200, reason: 'no-key' };
        }

        return { ok: true, userKey, status: 200 };
    } catch (error) {
        const normalized = normalizeSDKError(error);

        if (normalized.code === 'ERR_ABORTED') {
            return { ok: false, status: 0, reason: 'network' };
        }

        // The callback page is the single UI layer that owns error display. It
        // needs the mapped code to choose guidance (for example a confirmed CSP
        // violation versus an unclassified network failure) without a second
        // toast being emitted here.
        return {
            ok: false,
            status: normalized.status,
            reason: 'bad-response',
            errorCode: mapToErrorCode(normalized.code),
            errorMessage: normalized.message,
        };
    }
}
