import { Or3NetRequestError } from './types';

function isOr3NetRequestErrorLike(cause: unknown): cause is {
    message: string;
    status: number;
    code?: string;
    retryAfterMs?: number;
} {
    if (!(cause instanceof Error)) {
        return false;
    }

    if (cause instanceof Or3NetRequestError) {
        return true;
    }

    const candidate = cause as {
        status?: unknown;
        code?: unknown;
        retryAfterMs?: unknown;
    };
    return (
        typeof candidate.status === 'number' &&
        (candidate.code === undefined || typeof candidate.code === 'string') &&
        (candidate.retryAfterMs === undefined ||
            typeof candidate.retryAfterMs === 'number')
    );
}

function formatRetryDelay(retryAfterMs: number): string {
    if (retryAfterMs < 60_000) {
        return `${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`;
    }

    const minutes = Math.ceil(retryAfterMs / 60_000);
    return `${minutes}m`;
}

function appendRetryHint(message: string, retryAfterMs?: number): string {
    if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs)) {
        return message;
    }

    return `${message} Try again in ${formatRetryDelay(retryAfterMs)}.`;
}

export function formatOr3NetUiError(cause: unknown): string {
    if (!(cause instanceof Error)) {
        return String(cause);
    }

    if (!isOr3NetRequestErrorLike(cause)) {
        return cause.message;
    }

    switch (cause.code) {
        case 'rate.limit_exceeded':
            return appendRetryHint('OR3 Net rate-limited this action.', cause.retryAfterMs);
        case 'auth.insufficient_scope':
            return 'OR3 Net rejected this action because the current token lacks the required scope. Refresh the connection or verify workspace access.';
        case 'auth.workspace_mismatch':
            return 'OR3 Net rejected this action because the workspace binding is stale. Refresh the connection and try again.';
        case 'auth.token_expired':
        case 'auth.token_invalid':
            return 'The OR3 Net session is no longer valid. Refresh the connection and try again.';
        case 'capability.expired':
        case 'resource.expired':
            return 'This OR3 Net launch expired. Request a fresh launch and try again.';
        case 'capability.revoked':
            return 'This OR3 Net launch was revoked. Request a new launch if you still need access.';
        case 'resource.not_found':
            return 'OR3 Net could not find that resource in the active workspace.';
        default:
            break;
    }

    if (cause.status === 429) {
        return appendRetryHint(cause.message || 'OR3 Net rate-limited this action.', cause.retryAfterMs);
    }

    return cause.message;
}
