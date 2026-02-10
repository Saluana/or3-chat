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
        const status = (error as any).statusCode || 500;

        const logEntry: ErrorLogEntry = {
            level: 'error',
            message: error.message || 'Internal server error',
            status,
            method,
            path,
            timestamp: new Date().toISOString(),
        };

        // Only include stack traces in non-production environments
        if (process.env.NODE_ENV !== 'production') {
            logEntry.stack = error.stack;
        }

        // Log as structured JSON
        console.error(JSON.stringify(logEntry));
    });
});
