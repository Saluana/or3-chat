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
    ChatError,
} from '@openrouter/sdk/models/errors';

export interface NormalizedError {
    code: string;
    message: string;
    status: number;
    retryable: boolean;
    raw?: unknown;
}

/**
 * Map SDK error classes to normalized error objects.
 * This enables consistent error handling across all SDK calls.
 */
export function normalizeSDKError(error: unknown): NormalizedError {
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
            message: 'Access denied. Your key may not have required permissions.',
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
            message:
                'AI provider is overloaded. Please try again in a moment.',
            status: 529,
            retryable: true,
            raw: error,
        };
    }

    if (error instanceof ChatError) {
        const errData = error.error;
        return {
            code: 'ERR_CHAT',
            message: errData.message || 'Chat request failed.',
            status: 400,
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

/**
 * Check if an error is an SDK error type.
 * Useful for conditional handling.
 */
export function isSDKError(error: unknown): boolean {
    return (
        error instanceof UnauthorizedResponseError ||
        error instanceof PaymentRequiredResponseError ||
        error instanceof ForbiddenResponseError ||
        error instanceof TooManyRequestsResponseError ||
        error instanceof BadRequestResponseError ||
        error instanceof NotFoundResponseError ||
        error instanceof RequestTimeoutResponseError ||
        error instanceof InternalServerResponseError ||
        error instanceof BadGatewayResponseError ||
        error instanceof ServiceUnavailableResponseError ||
        error instanceof EdgeNetworkTimeoutResponseError ||
        error instanceof ProviderOverloadedResponseError ||
        error instanceof ChatError
    );
}
