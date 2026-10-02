import { presentError, errorDiagnostics } from '~~/shared/errors';
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
import { emitWebhookSystemHook } from '../utils/webhooks/runtime';

interface ErrorLogEntry {
    level: 'error';
    message: string;
    status: number;
    method: string;
    path: string;
    timestamp: string;
    stack?: string;
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
            console.error('[error]', errorDiagnostics(error));
            return;
        }

        const url = getRequestURL(event);
        const path = url.pathname;
        const method = getMethod(event);
        const status = getErrorStatus(error);

        const logEntry: ErrorLogEntry = {
            level: 'error',
            message: presentError(error).message,
            status,
            method,
            path,
            timestamp: new Date().toISOString(),
        };



        // Log as structured JSON
        console.error(JSON.stringify(logEntry));

        if (status >= 500 && path.startsWith('/api/sync')) {
            void emitWebhookSystemHook('sync:action:error', {
                source: 'sync',
                message: logEntry.message,
                status,
                method,
                path,
            });
        } else if (status >= 500 && path.startsWith('/api/storage')) {
            void emitWebhookSystemHook('storage:action:error', {
                source: 'storage',
                message: logEntry.message,
                status,
                method,
                path,
            });
        }
    });
});
