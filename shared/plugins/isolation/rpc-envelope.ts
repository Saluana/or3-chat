/**
 * Versioned RPC envelopes for isolated plugin runtimes.
 * All host↔plugin messages must parse through these schemas before dispatch.
 */

export const RPC_ENVELOPE_VERSION = 1 as const;

/** Hard cap on serialized envelope size (bytes of UTF-8 JSON). */
export const RPC_MAX_MESSAGE_BYTES = 256 * 1024;

/**
 * Wire-shape bounds. Structured-clone messages arrive as ordinary objects, so
 * the byte ceiling must be measured from the value itself rather than from an
 * optional serialized string.
 */
export const RPC_MAX_WIRE_DEPTH = 32;
/** Total values (objects, arrays, primitives) allowed in one message. */
export const RPC_MAX_WIRE_NODES = 20_000;

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
    /**
     * Host-issued session identity, echoed by the sandbox on every request.
     * A sandbox cannot mint these values; the host rejects anything it did not
     * issue (see `session-authority`). Optional so existing hosts keep working.
     */
    readonly sessionId?: string;
    readonly sourceId?: string;
    readonly generation?: number;
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

const encoder = new TextEncoder();

function utf8ByteLength(text: string): number {
    return encoder.encode(text).byteLength;
}

export type WireMeasurement =
    | { readonly ok: true; readonly bytes: number; readonly nodes: number }
    | {
          readonly ok: false;
          readonly code: 'oversized' | 'invalid-envelope' | 'too-deep' | 'too-many-nodes';
          readonly message: string;
      };

/**
 * Bounded wire representation.
 *
 * Measures the JSON wire size of an already-decoded value while rejecting
 * unsupported values, excessive nesting and node floods. It never stringifies
 * an unbounded structure: a value that cannot be represented within the limits
 * is refused before any memory is allocated for it.
 *
 * Allowed values are exactly what the JSON wire format carries: null, boolean,
 * finite number, string, plain object and array. Everything else (functions,
 * symbols, bigints, class instances, typed arrays, Map/Set/Date, DOM nodes,
 * circular references) is refused, because a message that cannot round-trip
 * through JSON must not enter the RPC path.
 */
export function measureWireValue(
    value: unknown,
    options: {
        readonly maxBytes?: number;
        readonly maxDepth?: number;
        readonly maxNodes?: number;
    } = {}
): WireMeasurement {
    const maxBytes = options.maxBytes ?? RPC_MAX_MESSAGE_BYTES;
    const maxDepth = options.maxDepth ?? RPC_MAX_WIRE_DEPTH;
    const maxNodes = options.maxNodes ?? RPC_MAX_WIRE_NODES;
    let bytes = 0;
    let nodes = 0;
    const ancestors = new Set<object>();

    const overflow = (): WireMeasurement => ({
        ok: false,
        code: 'oversized',
        message: `RPC message exceeds ${maxBytes} bytes`,
    });

    const walk = (
        node: unknown,
        depth: number,
        inArray: boolean
    ): WireMeasurement | null => {
        nodes += 1;
        if (nodes > maxNodes) {
            return {
                ok: false,
                code: 'too-many-nodes',
                message: `RPC message exceeds ${maxNodes} values`,
            };
        }
        if (depth > maxDepth) {
            return {
                ok: false,
                code: 'too-deep',
                message: `RPC message nests deeper than ${maxDepth} levels`,
            };
        }

        if (node === null) {
            bytes += 4;
            return bytes > maxBytes ? overflow() : null;
        }
        switch (typeof node) {
            case 'boolean':
                bytes += node ? 4 : 5;
                return bytes > maxBytes ? overflow() : null;
            case 'number': {
                if (!Number.isFinite(node)) {
                    return {
                        ok: false,
                        code: 'invalid-envelope',
                        message: 'RPC wire values must use finite numbers',
                    };
                }
                bytes += String(node).length;
                return bytes > maxBytes ? overflow() : null;
            }
            case 'string': {
                bytes += 2 + escapedStringBytes(node);
                return bytes > maxBytes ? overflow() : null;
            }
            case 'undefined':
                // JSON drops `undefined` object properties and emits `null` for
                // array entries; charge the array form so the measure is never low.
                if (inArray) bytes += 4;
                return bytes > maxBytes ? overflow() : null;
            case 'function':
            case 'symbol':
            case 'bigint':
                return {
                    ok: false,
                    code: 'invalid-envelope',
                    message: `RPC wire values cannot contain ${typeof node}`,
                };
            default:
                break;
        }

        const record = node as object;
        if (ancestors.has(record)) {
            return {
                ok: false,
                code: 'invalid-envelope',
                message: 'RPC wire values cannot contain circular references',
            };
        }
        ancestors.add(record);
        try {
            if (Array.isArray(record)) {
                bytes += 2 + Math.max(0, record.length - 1);
                if (bytes > maxBytes) return overflow();
                for (const item of record) {
                    const failure = walk(item, depth + 1, true);
                    if (failure) return failure;
                }
                return null;
            }
            const prototype = Object.getPrototypeOf(record) as object | null;
            if (prototype !== Object.prototype && prototype !== null) {
                return {
                    ok: false,
                    code: 'invalid-envelope',
                    message: 'RPC wire values must be plain objects',
                };
            }
            bytes += 2;
            if (bytes > maxBytes) return overflow();
            for (const [key, item] of Object.entries(record)) {
                bytes += 2 + escapedStringBytes(key) + 1;
                if (bytes > maxBytes) return overflow();
                const failure = walk(item, depth + 1, false);
                if (failure) return failure;
            }
            return null;
        } finally {
            ancestors.delete(record);
        }
    };

    const failure = walk(value, 1, false);
    if (failure) return failure;
    return { ok: true, bytes, nodes };
}

/**
 * Conservative JSON string byte count: escapes and control characters are
 * counted as their longest encoding, so the measured value can only overstate
 * the real wire size.
 */
function escapedStringBytes(text: string): number {
    let total = 0;
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (character === '"' || character === '\\') {
            total += 2;
            continue;
        }
        if (code < 0x20) {
            total += 6;
            continue;
        }
        if (code >= 0xd800 && code <= 0xdfff) {
            // Lone surrogate: JSON.stringify escapes it as \uXXXX.
            total += 6;
            continue;
        }
        total += utf8ByteLength(character);
    }
    return total;
}

function fail(
    code: RpcParseFailure['code'],
    message: string
): RpcParseFailure {
    return { ok: false, code, message };
}

/**
 * Parse and validate a JSON-decoded RPC envelope.
 * Rejects unknown versions, malformed IDs, invalid shapes, unsupported values,
 * excessive nesting and messages that exceed the byte ceiling.
 *
 * The size check is derived from the value itself, never from a caller-supplied
 * serialized representation: a structured-clone object must be charged for the
 * bytes it actually occupies on the wire.
 */
export function parseRpcEnvelope(
    raw: unknown,
    options: { readonly maxBytes?: number } = {}
): RpcParseResult {
    const maxBytes = options.maxBytes ?? RPC_MAX_MESSAGE_BYTES;

    let value: unknown = raw;
    if (typeof raw === 'string') {
        if (utf8ByteLength(raw) > maxBytes) {
            return fail('oversized', `RPC message exceeds ${maxBytes} bytes`);
        }
        try {
            value = JSON.parse(raw) as unknown;
        } catch {
            return fail('invalid-envelope', 'RPC message is not valid JSON');
        }
    }

    const measured = measureWireValue(value, { maxBytes });
    if (!measured.ok) {
        return fail(
            measured.code === 'invalid-envelope' ? 'invalid-envelope' : 'oversized',
            measured.message
        );
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
            if (value.sessionId !== undefined && !isValidRpcId(value.sessionId)) {
                return fail('invalid-envelope', 'request.sessionId must be an opaque token when present');
            }
            if (value.sourceId !== undefined && !isValidRpcId(value.sourceId)) {
                return fail('invalid-envelope', 'request.sourceId must be an opaque token when present');
            }
            if (
                value.generation !== undefined &&
                (typeof value.generation !== 'number' ||
                    !Number.isInteger(value.generation) ||
                    value.generation < 0)
            ) {
                return fail(
                    'invalid-envelope',
                    'request.generation must be a non-negative integer when present'
                );
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
                ...(typeof value.sessionId === 'string'
                    ? { sessionId: value.sessionId }
                    : {}),
                ...(typeof value.sourceId === 'string'
                    ? { sourceId: value.sourceId }
                    : {}),
                ...(typeof value.generation === 'number'
                    ? { generation: value.generation }
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

/** Attach host-issued session identity to an outbound sandbox request. */
export function withHostSession(
    request: RpcRequestEnvelope,
    session: {
        readonly sessionId: string;
        readonly sourceId: string;
        readonly generation: number;
    }
): RpcRequestEnvelope {
    return {
        ...request,
        sessionId: session.sessionId,
        sourceId: session.sourceId,
        generation: session.generation,
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
