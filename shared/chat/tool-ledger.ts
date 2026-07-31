import { sensitiveValueMetadata } from '../logging/sensitive-metadata';

export type ToolLedgerState = 'pending' | 'running' | 'completed' | 'failed';

export interface ToolLedgerEntry {
    callId: string;
    name: string;
    argumentFingerprint: string;
    state: ToolLedgerState;
    result?: string;
    error?: string;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]));
}

export function toolCallFingerprint(name: string, argumentsJson: string): string {
    let normalized = argumentsJson;
    try {
        normalized = JSON.stringify(canonicalize(JSON.parse(argumentsJson)));
    } catch {
        // Malformed arguments remain fingerprintable without accepting them.
    }
    return sensitiveValueMetadata(`${name}\0${normalized}`).fingerprint;
}

export type ToolLedgerDecision =
    | { action: 'execute'; fingerprint: string }
    | { action: 'replay'; fingerprint: string; result: string }
    | { action: 'conflict'; fingerprint: string }
    | { action: 'running'; fingerprint: string }
    | { action: 'failed'; fingerprint: string; error: string };

export function decideToolCall(
    existing: ToolLedgerEntry | undefined,
    call: { id: string; name: string; arguments: string }
): ToolLedgerDecision {
    const fingerprint = toolCallFingerprint(call.name, call.arguments);
    if (!existing || existing.state === 'pending') return { action: 'execute', fingerprint };
    if (existing.name !== call.name || existing.argumentFingerprint !== fingerprint) {
        return { action: 'conflict', fingerprint };
    }
    if (existing.state === 'running') return { action: 'running', fingerprint };
    if (existing.state === 'completed') {
        return { action: 'replay', fingerprint, result: existing.result ?? '' };
    }
    return { action: 'failed', fingerprint, error: existing.error ?? 'Tool call previously failed' };
}

