/**
 * Versioned RPC envelopes for isolated plugin runtimes.
 * All host↔plugin messages must parse through these schemas before dispatch.
 */

export const RPC_ENVELOPE_VERSION = 1 as const;

/** Hard cap on serialized envelope size (bytes of UTF-8 JSON). */
export const RPC_MAX_MESSAGE_BYTES = 256 * 1024;

/** Correlation / message IDs must be opaque, non-empty, bounded tokens. */
const RPC_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export type RpcMessageKind =
    | 'request'
    | 'response'
    | 'event'
    | 'cancel'
    | 'error';

export type RpcErrorCode =
    | 'invalid-envelope'
    | 'unknown-version'
    | 'malformed-id'
    | 'oversized'
    | 'unknown-method'
    | 'grant-denied'
    | 'deadline-exceeded'
    | 'cancelled'
    | 'replay'
    | 'backpressure'
    | 'runtime-crash'
    | 'policy-denied'
    | 'budget-exceeded'
    | 'internal';

export interface RpcRequestEnvelope {
    readonly v: typeof RPC_ENVELOPE_VERSION;
    readonly kind: 'request';
    readonly id: string;
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly deadlineMs?: number;
    /** Plugin-supplied identity is never authoritative; host ignores this field. */
    readonly pluginId?: string;
}

export interface RpcResponseEnvelope {
    readonly v: typeof RPC_ENVELOPE_VERSION;
    readonly kind: 'response';
    readonly id: string;
    readonly ok: true;
    readonly result: unknown;
}

export interface RpcErrorEnvelope {
    readonly v: typeof RPC_ENVELOPE_VERSION;
    readonly kind: 'error';
    readonly id: string;
    readonly code: RpcErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
}

export interface RpcEventEnvelope {
    readonly v: typeof RPC_ENVELOPE_VERSION;
    readonly kind: 'event';
    readonly id: string;
    readonly name: string;
    readonly payload: Readonly<Record<string, unknown>>;
}

export interface RpcCancelEnvelope {
    readonly v: typeof RPC_ENVELOPE_VERSION;
    readonly kind: 'cancel';
    readonly id: string;
    readonly reason?: string;
}

export type RpcEnvelope =
    | RpcRequestEnvelope
    | RpcResponseEnvelope
    | RpcErrorEnvelope
    | RpcEventEnvelope
    | RpcCancelEnvelope;

export type RpcParseFailure = {
    readonly ok: false;
    readonly code: Extract<
        RpcErrorCode,
        'invalid-envelope' | 'unknown-version' | 'malformed-id' | 'oversized'
    >;
    readonly message: string;
};

export type RpcParseSuccess = {
    readonly ok: true;
    readonly envelope: RpcEnvelope;
};

export type RpcParseResult = RpcParseSuccess | RpcParseFailure;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRpcId(value: unknown): value is string {
    return typeof value === 'string' && RPC_ID_PATTERN.test(value);
}

function utf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}

function fail(
    code: RpcParseFailure['code'],
    message: string
): RpcParseFailure {
    return { ok: false, code, message };
}

/**
 * Parse and validate a JSON-decoded RPC envelope.
 * Rejects unknown versions, malformed IDs, invalid shapes, and oversized payloads.
 */
export function parseRpcEnvelope(
    raw: unknown,
    options: { readonly maxBytes?: number; readonly serialized?: string } = {}
): RpcParseResult {
    const maxBytes = options.maxBytes ?? RPC_MAX_MESSAGE_BYTES;
    if (options.serialized !== undefined) {
        if (utf8ByteLength(options.serialized) > maxBytes) {
            return fail('oversized', `RPC message exceeds ${maxBytes} bytes`);
        }
    } else if (typeof raw === 'string') {
        if (utf8ByteLength(raw) > maxBytes) {
            return fail('oversized', `RPC message exceeds ${maxBytes} bytes`);
        }
    }

    let value: unknown = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw) as unknown;
        } catch {
            return fail('invalid-envelope', 'RPC message is not valid JSON');
        }
        if (utf8ByteLength(JSON.stringify(value)) > maxBytes) {
            return fail('oversized', `RPC message exceeds ${maxBytes} bytes`);
        }
    }

    if (!isPlainObject(value)) {
        return fail('invalid-envelope', 'RPC envelope must be an object');
    }

    if (value.v !== RPC_ENVELOPE_VERSION) {
        return fail(
            'unknown-version',
            `Unsupported RPC envelope version: ${String(value.v)}`
        );
    }

    if (!isValidRpcId(value.id)) {
        return fail('malformed-id', 'RPC id must match opaque token pattern');
    }

    const kind = value.kind;
    switch (kind) {
        case 'request': {
            if (typeof value.method !== 'string' || value.method.length === 0) {
                return fail('invalid-envelope', 'request.method must be a non-empty string');
            }
            if (!isPlainObject(value.params)) {
                return fail('invalid-envelope', 'request.params must be an object');
            }
            if (
                value.deadlineMs !== undefined &&
                (typeof value.deadlineMs !== 'number' ||
                    !Number.isFinite(value.deadlineMs) ||
                    value.deadlineMs < 0)
            ) {
                return fail('invalid-envelope', 'request.deadlineMs must be a non-negative number');
            }
            if (value.pluginId !== undefined && typeof value.pluginId !== 'string') {
                return fail('invalid-envelope', 'request.pluginId must be a string when present');
            }
            const envelope: RpcRequestEnvelope = {
                v: RPC_ENVELOPE_VERSION,
                kind: 'request',
                id: value.id,
                method: value.method,
                params: value.params,
                ...(value.deadlineMs !== undefined
                    ? { deadlineMs: value.deadlineMs }
                    : {}),
                ...(typeof value.pluginId === 'string'
                    ? { pluginId: value.pluginId }
                    : {}),
            };
            return { ok: true, envelope };
        }
        case 'response': {
            if (value.ok !== true) {
                return fail('invalid-envelope', 'response.ok must be true');
            }
            if (!('result' in value)) {
                return fail('invalid-envelope', 'response.result is required');
            }
            const envelope: RpcResponseEnvelope = {
                v: RPC_ENVELOPE_VERSION,
                kind: 'response',
                id: value.id,
                ok: true,
                result: value.result,
            };
            return { ok: true, envelope };
        }
        case 'error': {
            if (typeof value.code !== 'string' || value.code.length === 0) {
                return fail('invalid-envelope', 'error.code must be a non-empty string');
            }
            if (typeof value.message !== 'string') {
                return fail('invalid-envelope', 'error.message must be a string');
            }
            if (
                value.details !== undefined &&
                !isPlainObject(value.details)
            ) {
                return fail('invalid-envelope', 'error.details must be an object when present');
            }
            const envelope: RpcErrorEnvelope = {
                v: RPC_ENVELOPE_VERSION,
                kind: 'error',
                id: value.id,
                code: value.code as RpcErrorCode,
                message: value.message,
                ...(value.details !== undefined
                    ? { details: value.details }
                    : {}),
            };
            return { ok: true, envelope };
        }
        case 'event': {
            if (typeof value.name !== 'string' || value.name.length === 0) {
                return fail('invalid-envelope', 'event.name must be a non-empty string');
            }
            if (!isPlainObject(value.payload)) {
                return fail('invalid-envelope', 'event.payload must be an object');
            }
            const envelope: RpcEventEnvelope = {
                v: RPC_ENVELOPE_VERSION,
                kind: 'event',
                id: value.id,
                name: value.name,
                payload: value.payload,
            };
            return { ok: true, envelope };
        }
        case 'cancel': {
            if (value.reason !== undefined && typeof value.reason !== 'string') {
                return fail('invalid-envelope', 'cancel.reason must be a string when present');
            }
            const envelope: RpcCancelEnvelope = {
                v: RPC_ENVELOPE_VERSION,
                kind: 'cancel',
                id: value.id,
                ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
            };
            return { ok: true, envelope };
        }
        default:
            return fail(
                'invalid-envelope',
                `Unknown RPC message kind: ${String(kind)}`
            );
    }
}

export function serializeRpcEnvelope(envelope: RpcEnvelope): string {
    return JSON.stringify(envelope);
}

export function createRpcRequest(
    input: Omit<RpcRequestEnvelope, 'v' | 'kind'>
): RpcRequestEnvelope {
    return {
        v: RPC_ENVELOPE_VERSION,
        kind: 'request',
        ...input,
    };
}

export function createRpcResponse(
    input: Omit<RpcResponseEnvelope, 'v' | 'kind' | 'ok'>
): RpcResponseEnvelope {
    return {
        v: RPC_ENVELOPE_VERSION,
        kind: 'response',
        ok: true,
        ...input,
    };
}

export function createRpcError(
    input: Omit<RpcErrorEnvelope, 'v' | 'kind'>
): RpcErrorEnvelope {
    return {
        v: RPC_ENVELOPE_VERSION,
        kind: 'error',
        ...input,
    };
}

export function createRpcEvent(
    input: Omit<RpcEventEnvelope, 'v' | 'kind'>
): RpcEventEnvelope {
    return {
        v: RPC_ENVELOPE_VERSION,
        kind: 'event',
        ...input,
    };
}

export function createRpcCancel(
    input: Omit<RpcCancelEnvelope, 'v' | 'kind'>
): RpcCancelEnvelope {
    return {
        v: RPC_ENVELOPE_VERSION,
        kind: 'cancel',
        ...input,
    };
}
