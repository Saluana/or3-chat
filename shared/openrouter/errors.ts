import { normalizeError, presentError, type ErrorSource, type CredentialSource } from '../errors';
// shared/openrouter/errors.ts
// Centralized error handling for OpenRouter SDK
// Maps SDK errors to user-friendly normalized errors

import {
    BadRequestResponseError,
    UnauthorizedResponseError,
    PaymentRequiredResponseError,
    ForbiddenResponseError,
    NotFoundResponseError,
    TooManyRequestsResponseError,
    RequestTimeoutResponseError,
    InternalServerResponseError,
    BadGatewayResponseError,
    ServiceUnavailableResponseError,
    EdgeNetworkTimeoutResponseError,
    ProviderOverloadedResponseError,
    UnprocessableEntityResponseError,
} from '@openrouter/sdk/models/errors';

export type { ErrorCode } from '../errors';
import type { ErrorCode } from '../errors';

export interface NormalizedError {
    code: ErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    raw?: unknown;
    source?: ErrorSource;
    credentialSource?: CredentialSource;
    providerCode?: string | number;
    retryAfterMs?: number;
}

export type OpenRouterStreamFailureKind =
    | 'transport'
    | 'protocol'
    | 'provider';

/**
 * Error thrown by the raw-fetch OpenRouter streaming path.
 * Carries enough metadata for the caller to decide whether to retry.
 */
export class OpenRouterStreamError extends Error {
    code?: ErrorCode;
    source: ErrorSource;
    credentialSource?: CredentialSource;
    status: number;
    retryAfterMs: number | undefined;
    retryable: boolean;
    kind: OpenRouterStreamFailureKind;
    providerCode: string | number | undefined;
    finishReason: string | undefined;

    constructor(
        message: string,
        {
            code,
            status,
            source = 'provider',
            credentialSource,
            retryAfterMs,
            retryable,
            kind = 'transport',
            providerCode,
            finishReason,
        }: {
            code?: ErrorCode;
            status: number;
            source?: ErrorSource;
            credentialSource?: CredentialSource;
            retryAfterMs?: number;
            retryable: boolean;
            kind?: OpenRouterStreamFailureKind;
            providerCode?: string | number;
            finishReason?: string;
        }
    ) {
        super(message);
        this.name = 'OpenRouterStreamError';
        this.code = code;
        this.status = status;
        this.source = source;
        this.credentialSource = credentialSource;
        this.retryAfterMs = retryAfterMs;
        this.retryable = retryable;
        this.kind = kind;
        this.providerCode = providerCode;
        this.finishReason = finishReason;
    }
}

/** A syntactically invalid or contract-breaking upstream SSE response. */
export class OpenRouterProtocolError extends OpenRouterStreamError {
    constructor(message: string) {
        super(message, {
            status: 0,
            retryable: false,
            kind: 'protocol',
        });
        this.name = 'OpenRouterProtocolError';
    }
}

/** A valid stream event in which the upstream provider reports failure. */
export class OpenRouterProviderError extends OpenRouterStreamError {
    constructor(
        message: string,
        options: {
            status?: number;
            retryable?: boolean;
            providerCode?: string | number;
            finishReason?: string;
        } = {}
    ) {
        super(message, {
            status: options.status ?? 0,
            retryable: options.retryable ?? false,
            kind: 'provider',
            providerCode: options.providerCode,
            finishReason: options.finishReason,
        });
        this.name = 'OpenRouterProviderError';
    }
}

/**
 * Map SDK error classes to normalized error objects.
 * This enables consistent error handling across all SDK calls.
 */
function classifySDKError(error: unknown): NormalizedError {
    // SDK typed errors
    if (error instanceof UnauthorizedResponseError) {
        return {
            code: 'ERR_AUTH',
            message: 'Invalid or expired API key. Please re-authenticate.',
            status: 401,
            retryable: false,
            raw: error,
        };
    }

    if (error instanceof PaymentRequiredResponseError) {
        return {
            code: 'ERR_CREDITS',
            message:
                'Insufficient credits. Please add credits at openrouter.ai/credits',
            status: 402,
            retryable: false,
            raw: error,
        };
    }

    if (error instanceof ForbiddenResponseError) {
        return {
            code: 'ERR_FORBIDDEN',
            message:
                'Access denied. Your key may not have required permissions.',
            status: 403,
            retryable: false,
            raw: error,
        };
    }

    if (error instanceof TooManyRequestsResponseError) {
        return {
            code: 'ERR_RATE_LIMIT',
            message: 'Rate limit exceeded. Please try again in a moment.',
            status: 429,
            retryable: true,
            raw: error,
        };
    }

    if (error instanceof BadRequestResponseError) {
        const errData = error.error;
        return {
            code: 'ERR_BAD_REQUEST',
            message: errData.message || 'Invalid request parameters.',
            status: 400,
            retryable: false,
            raw: error,
        };
    }

    if (error instanceof NotFoundResponseError) {
        return {
            code: 'ERR_NOT_FOUND',
            message: 'Requested resource not found.',
            status: 404,
            retryable: false,
            raw: error,
        };
    }

    if (
        error instanceof RequestTimeoutResponseError ||
        error instanceof EdgeNetworkTimeoutResponseError
    ) {
        return {
            code: 'ERR_TIMEOUT',
            message: 'Request timed out. Please try again.',
            status: error instanceof RequestTimeoutResponseError ? 408 : 524,
            retryable: true,
            raw: error,
        };
    }

    if (error instanceof InternalServerResponseError) {
        return {
            code: 'ERR_SERVER',
            message: 'OpenRouter service error. Please try again later.',
            status: 500,
            retryable: true,
            raw: error,
        };
    }

    if (
        error instanceof BadGatewayResponseError ||
        error instanceof ServiceUnavailableResponseError
    ) {
        return {
            code: 'ERR_PROVIDER',
            message: 'AI provider temporarily unavailable. Please try again.',
            status: error instanceof BadGatewayResponseError ? 502 : 503,
            retryable: true,
            raw: error,
        };
    }

    if (error instanceof ProviderOverloadedResponseError) {
        return {
            code: 'ERR_OVERLOADED',
            message: 'AI provider is overloaded. Please try again in a moment.',
            status: 529,
            retryable: true,
            raw: error,
        };
    }

    if (error instanceof UnprocessableEntityResponseError) {
        const errData = error.error;
        return {
            code: 'ERR_BAD_REQUEST',
            message: errData.message || 'Invalid request parameters.',
            status: 422,
            retryable: false,
            raw: error,
        };
    }

    // Generic error fallback
    if (error instanceof Error) {
        // Check for AbortError (user cancellation)
        if (error.name === 'AbortError') {
            return {
                code: 'ERR_ABORTED',
                message: 'Request was cancelled.',
                status: 0,
                retryable: false,
                raw: error,
            };
        }

        return {
            code: 'ERR_UNKNOWN',
            message: error.message || 'An unexpected error occurred.',
            status: 0,
            retryable: true,
            raw: error,
        };
    }

    return {
        code: 'ERR_UNKNOWN',
        message: 'An unexpected error occurred.',
        status: 0,
        retryable: true,
        raw: error,
    };
}

export function normalizeSDKError(error: unknown): NormalizedError {
    const classified = classifySDKError(error);
    const metadata = normalizeError({
        ...(error && typeof error === 'object' ? error : {}),
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message : undefined,
        code: classified.code, status: classified.status || (error as { status?: number } | null)?.status,
        source: 'provider', retryable: classified.code === 'ERR_UNKNOWN' ? undefined : classified.retryable,
    });
    return { ...metadata, status: metadata.status ?? 0,
        message: presentError(metadata).message, raw: error };
}
