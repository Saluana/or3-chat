import { sha256 } from '@noble/hashes/sha2.js';

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
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, canonicalize(child)]));
}

export function toolCallFingerprint(name: string, argumentsJson: string): string {
    let normalized = argumentsJson;
    try {
        normalized = JSON.stringify(canonicalize(JSON.parse(argumentsJson)));
    } catch {
        // Malformed arguments remain fingerprintable without accepting them.
    }
    const digest = sha256(new TextEncoder().encode(JSON.stringify([name, normalized])));
    // Old diagnostic fingerprints deliberately conflict: they cannot safely
    // establish argument equality for a completed or uncertain execution.
    return `sha256:v1:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
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

