/**
 * Typed helpers for the host capabilities a portable plugin may call.
 *
 * The host owns the provider credential and the model prices; a plugin only
 * names a model and a prompt. Every call is attributed to the plugin, admitted
 * against a reserved spend bound and disclosed with its real usage, so a plugin
 * UI can show the separate provider cost without ever seeing a key.
 *
 * The `call` shape matches `PortableClient['call']`, so this module imports no
 * runtime code and can be used from a sandboxed worker.
 */

import { pluginOk, type PluginErrorCode, type PluginResult } from './results';

/** Host capability method names. Identity is always stamped by the host. */
export const HOST_CAPABILITY_METHODS = {
    /** Approved model allowlist with disclosed prices and enforced limits. */
    models: 'ai.models',
    /** One governed completion on a host model. */
    complete: 'ai.complete',
} as const;

export type HostCall = <T = unknown>(
    method: string,
    params?: Readonly<Record<string, unknown>>,
    options?: { readonly deadlineMs?: number }
) => Promise<{ readonly ok: true; readonly result: T } | { readonly ok: false; readonly code: string; readonly message: string }>;

export interface HostModelInfo {
    readonly id: string;
    readonly label: string;
    /** False when the host has no price for the model; such a model is refused. */
    readonly priced: boolean;
    readonly promptPerMillion: number | null;
    readonly completionPerMillion: number | null;
}

export interface HostModelCatalog {
    readonly configured: boolean;
    readonly models: readonly HostModelInfo[];
    readonly limits: {
        readonly maxOutputTokens: number;
        readonly spendLimitUsd: number;
        readonly maxConcurrentCalls: number;
        readonly deadlineMs: number;
    };
}

export interface HostCompletion {
    readonly text: string;
    readonly model: string;
    readonly usage: {
        readonly promptTokens: number;
        readonly completionTokens: number;
        readonly spendUsd: number;
    };
}

/**
 * Complete mapping from host RPC refusal codes to the SDK's error codes. An
 * unknown code becomes `internal`, never `permission-denied`: collapsing a
 * provider or budget failure into a permission problem destroys the actionable
 * copy a plugin UI is expected to show.
 */
const HOST_RPC_ERROR_CODES: Readonly<Record<string, PluginErrorCode>> = Object.freeze({
    'permission-denied': 'permission-denied',
    'policy-denied': 'permission-denied',
    'grant-denied': 'permission-denied',
    'not-found': 'not-found',
    'invalid-input': 'invalid-input',
    'invalid-envelope': 'invalid-input',
    oversized: 'invalid-input',
    conflict: 'conflict',
    replay: 'conflict',
    'budget-exceeded': 'quota-exceeded',
    'quota-exceeded': 'quota-exceeded',
    'deadline-exceeded': 'timeout',
    timeout: 'timeout',
    cancelled: 'aborted',
    aborted: 'aborted',
    'network-failure': 'network-error',
    'network-error': 'network-error',
    unavailable: 'host-unavailable',
    'host-unavailable': 'host-unavailable',
    backpressure: 'host-unavailable',
    internal: 'internal',
});

const RETRYABLE_RPC_CODES: ReadonlySet<string> = new Set([
    'network-failure',
    'network-error',
    'unavailable',
    'host-unavailable',
    'backpressure',
    'deadline-exceeded',
    'timeout',
]);

function toResultError(code: string, message: string): PluginResult<never> {
    return {
        ok: false,
        error: {
            code: HOST_RPC_ERROR_CODES[code] ?? 'internal',
            message,
            retryable: RETRYABLE_RPC_CODES.has(code),
        },
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function isModelInfo(value: unknown): value is HostModelInfo {
    const record = asRecord(value);
    if (!record) return false;
    return (
        typeof record.id === 'string' &&
        record.id.length > 0 &&
        typeof record.label === 'string' &&
        typeof record.priced === 'boolean'
    );
}

function readLimits(value: unknown): HostModelCatalog['limits'] {
    const record = asRecord(value);
    const read = (key: string, fallback: number): number =>
        typeof record?.[key] === 'number' && Number.isFinite(record[key]) ? (record[key] as number) : fallback;
    return {
        maxOutputTokens: read('maxOutputTokens', 0),
        spendLimitUsd: read('spendLimitUsd', 0),
        maxConcurrentCalls: read('maxConcurrentCalls', 0),
        deadlineMs: read('deadlineMs', 0),
    };
}

/**
 * The models this host approves, with the prices and limits a UI may disclose.
 * An unconfigured host answers `configured: false` instead of pretending, and a
 * malformed payload is refused rather than half-trusted.
 */
export async function listHostModels(call: HostCall): Promise<PluginResult<HostModelCatalog>> {
    const result = await call<unknown>(HOST_CAPABILITY_METHODS.models);
    if (!result.ok) return toResultError(result.code, result.message);
    const catalog = asRecord(result.result);
    if (!catalog) {
        return {
            ok: false,
            error: { code: 'internal', message: 'The host returned an unusable model list', retryable: false },
        };
    }
    const models = Array.isArray(catalog.models) ? catalog.models.filter(isModelInfo) : [];
    return pluginOk({
        configured: catalog.configured === true,
        models,
        limits: readLimits(catalog.limits),
    });
}

/** One governed completion. The host decides the provider, price and limits. */
export async function completeWithHostModel(
    call: HostCall,
    input: {
        readonly model: string;
        readonly prompt: string;
        readonly maxOutputTokens?: number;
    }
): Promise<PluginResult<HostCompletion>> {
    const result = await call<unknown>(HOST_CAPABILITY_METHODS.complete, {
        model: input.model,
        prompt: input.prompt,
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    });
    if (!result.ok) return toResultError(result.code, result.message);
    const completion = asRecord(result.result);
    const usage = asRecord(completion?.usage);
    if (
        !completion ||
        typeof completion.text !== 'string' ||
        typeof completion.model !== 'string' ||
        typeof usage?.spendUsd !== 'number'
    ) {
        return {
            ok: false,
            error: {
                code: 'internal',
                message: 'The host returned an unusable completion',
                retryable: false,
            },
        };
    }
    return pluginOk({
        text: completion.text,
        model: completion.model,
        usage: {
            promptTokens: typeof usage.promptTokens === 'number' ? usage.promptTokens : 0,
            completionTokens: typeof usage.completionTokens === 'number' ? usage.completionTokens : 0,
            spendUsd: usage.spendUsd,
        },
    });
}
