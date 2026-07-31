export type PluginErrorCode =
    | 'permission-denied'
    | 'not-found'
    | 'invalid-input'
    | 'conflict'
    | 'quota-exceeded'
    | 'network-error'
    | 'timeout'
    | 'aborted'
    | 'host-unavailable'
    | 'internal';

export interface PluginError {
    readonly code: PluginErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: Readonly<Record<string, unknown>>;
}

export type PluginResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: PluginError };

export function pluginOk<T>(value: T): PluginResult<T> {
    return Object.freeze({ ok: true, value });
}

export function pluginError(
    code: PluginErrorCode,
    message: string,
    options: {
        readonly retryable?: boolean;
        readonly details?: Readonly<Record<string, unknown>>;
    } = {}
): PluginResult<never> {
    return Object.freeze({
        ok: false,
        error: Object.freeze({
            code,
            message,
            retryable: options.retryable ?? false,
            ...(options.details === undefined ? {} : { details: options.details }),
        }),
    });
}
