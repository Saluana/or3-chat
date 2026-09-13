import { sensitiveValueMetadata } from '../logging/sensitive-metadata';
import { MAX_SYNC_PAYLOAD_BYTES } from '../sync/sanitize';

export const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
export const MAX_TOOL_DURABLE_RESULT_BYTES = 256 * 1024;
export const MAX_TOOL_MODEL_RESULT_BYTES = 128 * 1024;
export const MAX_TOOL_UI_RESULT_BYTES = 32 * 1024;
export const MAX_STREAM_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_SSE_EVENT_BYTES = MAX_STREAM_OUTPUT_BYTES;

/**
 * Largest generated message that can still be committed to canonical sync
 * history. Leaves headroom inside `MAX_SYNC_PAYLOAD_BYTES` for envelope fields
 * (ids, timestamps, error, tool metadata) and for `content` being serialized
 * both top-level and inside `data`.
 */
export const MAX_CANONICAL_MESSAGE_OUTPUT_BYTES =
    MAX_SYNC_PAYLOAD_BYTES - 32 * 1024;

/** Fixed terminal/envelope allowance used by the streaming budget check. */
export const CANONICAL_MESSAGE_FIXED_BYTES = 4 * 1024;

/**
 * Thrown when generated output would exceed the canonical message budget.
 * Accepted output is preserved; callers finalize with this error.
 */
export class OutputLimitExceededError extends Error {
    readonly code = 'OUTPUT_LIMIT' as const;

    constructor(
        readonly limitBytes: number,
        readonly observedBytes: number
    ) {
        super(
            `Generated message exceeds the canonical message limit ` +
                `(${observedBytes} > ${limitBytes} UTF-8 bytes)`
        );
        this.name = 'OutputLimitExceededError';
    }
}

export function isOutputLimitExceededError(
    error: unknown
): error is OutputLimitExceededError {
    return (
        error instanceof Error &&
        (error.name === 'OutputLimitExceededError' ||
            (error as { code?: unknown }).code === 'OUTPUT_LIMIT')
    );
}

export function utf8Bytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

export function assertUtf8Limit(value: string, maximum: number, label: string): void {
    const size = utf8Bytes(value);
    if (size > maximum) throw new Error(`${label} exceeds ${maximum} UTF-8 bytes (received ${size})`);
}

function omission(value: string, label: string, maximum: number): string {
    const metadata = sensitiveValueMetadata(value);
    return `[${label} omitted: ${metadata.utf8Bytes} UTF-8 bytes exceeds ${maximum}; ${metadata.fingerprint}]`;
}

export function projectToolResult(value: string): {
    durable: string;
    model: string;
    ui: string;
} {
    assertUtf8Limit(value, MAX_TOOL_DURABLE_RESULT_BYTES, 'Tool result');
    return {
        durable: value,
        model: utf8Bytes(value) <= MAX_TOOL_MODEL_RESULT_BYTES
            ? value
            : omission(value, 'tool result', MAX_TOOL_MODEL_RESULT_BYTES),
        ui: utf8Bytes(value) <= MAX_TOOL_UI_RESULT_BYTES
            ? value
            : omission(value, 'tool result', MAX_TOOL_UI_RESULT_BYTES),
    };
}

