/**
 * @module server/plugins/error-handler
 *
 * Purpose:
 * Centralized error handling and structured logging for all API errors.
 *
 * Responsibilities:
 * - Logs errors as structured JSON with request context.
 * - Excludes stack traces from HTTP responses in production.
 * - Provides consistent error format for clients.
 */
import { defineNitroPlugin } from 'nitropack/runtime';
import { getRequestURL, getMethod } from 'h3';

interface ErrorLogEntry {
    level: 'error';
    message: string;
    status: number;
    method: string;
    path: string;
    timestamp: string;
    stack?: string;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === 'string' && error.length > 0) {
        return error;
    }
    return 'Internal server error';
}

function getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
}

function getErrorStatus(error: unknown): number {
    if (!error || typeof error !== 'object') {
        return 500;
    }
    const withStatus = error as { statusCode?: unknown; status?: unknown };
    if (typeof withStatus.statusCode === 'number') {
        return withStatus.statusCode;
    }
    if (typeof withStatus.status === 'number') {
        return withStatus.status;
    }
    return 500;
}

export default defineNitroPlugin((nitro) => {
    nitro.hooks.hook('error', (error, { event }) => {
        if (!event) {
            // Non-HTTP error (e.g., startup error)
            console.error('[error]', error);
            return;
        }

        const url = getRequestURL(event);
        const path = url.pathname;
        const method = getMethod(event);
        const status = getErrorStatus(error);

        const logEntry: ErrorLogEntry = {
            level: 'error',
            message: getErrorMessage(error),
            status,
            method,
            path,
            timestamp: new Date().toISOString(),
        };

        // Only include stack traces in non-production environments
        if (process.env.NODE_ENV !== 'production') {
            logEntry.stack = getErrorStack(error);
        }

        // Log as structured JSON
        console.error(JSON.stringify(logEntry));
    });
});
