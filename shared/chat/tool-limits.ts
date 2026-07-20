import { sensitiveValueMetadata } from '../logging/sensitive-metadata';

export const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
export const MAX_TOOL_DURABLE_RESULT_BYTES = 256 * 1024;
export const MAX_TOOL_MODEL_RESULT_BYTES = 128 * 1024;
export const MAX_TOOL_UI_RESULT_BYTES = 32 * 1024;
export const MAX_STREAM_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_SSE_EVENT_BYTES = MAX_STREAM_OUTPUT_BYTES;

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

