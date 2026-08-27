import { redactInternSecrets } from './redaction';

export type InternErrorCode =
    | 'aborted'
    | 'conflict'
    | 'forbidden'
    | 'http'
    | 'not_found'
    | 'offline'
    | 'protocol'
    | 'timeout'
    | 'unauthorized'
    | 'unavailable'
    | 'validation_failed';

export interface InternErrorOptions {
    status?: number;
    remoteCode?: string;
    requestId?: string;
    retryable?: boolean;
    details?: unknown;
    cause?: unknown;
    secrets?: readonly string[];
}

function safeCause(cause: unknown, secrets: readonly string[]): Error | undefined {
    if (cause === undefined) return undefined;
    const message =
        cause instanceof Error
            ? cause.message
            : typeof cause === 'string'
              ? cause
              : 'Request failed';
    const safe = new Error(String(redactInternSecrets(message, secrets)));
    safe.name = cause instanceof Error ? cause.name : 'Error';
    return safe;
}

export class InternClientError extends Error {
    readonly code: InternErrorCode;
    readonly status?: number;
    readonly remoteCode?: string;
    readonly requestId?: string;
    readonly retryable: boolean;
    readonly details?: unknown;
    override readonly cause?: Error;

    constructor(
        code: InternErrorCode,
        message: string,
        options: InternErrorOptions = {}
    ) {
        const secrets = options.secrets ?? [];
        super(String(redactInternSecrets(message, secrets)));
        this.name = 'InternClientError';
        this.code = code;
        this.status = options.status;
        this.remoteCode = options.remoteCode;
        this.requestId = options.requestId;
        this.retryable = options.retryable ?? false;
        this.details =
            options.details === undefined
                ? undefined
                : redactInternSecrets(options.details, secrets);
        this.cause = safeCause(options.cause, secrets);
    }
}

export class InternUnavailableError extends InternClientError {
    readonly capability?: string;

    constructor(
        message: string,
        options: InternErrorOptions & { capability?: string } = {}
    ) {
        super('unavailable', message, {
            retryable: false,
            ...options,
        });
        this.name = 'InternUnavailableError';
        this.capability = options.capability;
    }
}

export type InternResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: InternClientError };

export function internOk<T>(value: T): InternResult<T> {
    return { ok: true, value };
}

export function internErr<T = never>(
    error: InternClientError
): InternResult<T> {
    return { ok: false, error };
}

export function asInternClientError(error: unknown): InternClientError {
    if (error instanceof InternClientError) return error;
    return new InternClientError('protocol', 'Unexpected client failure', {
        cause: error,
    });
}

export async function toInternResult<T>(
    value: Promise<T> | (() => Promise<T>)
): Promise<InternResult<T>> {
    try {
        return internOk(
            await (typeof value === 'function' ? value() : value)
        );
    } catch (error) {
        return internErr(asInternClientError(error));
    }
}

export function requireInternCapability<T>(
    value: T | null | undefined | false,
    capability: string
): InternResult<T> {
    if (value === undefined || value === null || value === false) {
        return internErr(
            new InternUnavailableError(
                `The selected host does not advertise ${capability}.`,
                { capability }
            )
        );
    }
    return internOk(value);
}
