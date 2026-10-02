import { redactErrorText, errorDiagnostics } from '../errors';
export interface SensitiveValueMetadata {
    utf8Bytes: number;
    fingerprint: string;
}

/** Non-reversible correlation metadata for values that must never enter logs. */
export function sensitiveValueMetadata(value: string): SensitiveValueMetadata {
    const bytes = new TextEncoder().encode(value);
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return {
        utf8Bytes: bytes.byteLength,
        fingerprint: `fnv1a32:${hash.toString(16).padStart(8, '0')}`,
    };
}

const SENSITIVE_DETAIL_KEY_PATTERN =
    /(api[-_]?key|authorization|token|secret|password|ciphertext|credential)/i;

/**
 * Sanitizes lifecycle diagnostic details before they reach the console.
 * Renders primitives, truncates strings, summarizes errors, and replaces
 * credential-shaped values with a redaction marker.
 */
export function redactDiagnosticDetails(
    details?: Record<string, unknown>
): Record<string, unknown> | undefined {
    if (!details) return undefined;
    function sanitize(value: unknown, depth = 0): unknown {
        if (value instanceof Error) return errorDiagnostics(value);
        if (typeof value === 'string') return redactErrorText(value, 200);
        if (value === null || value === undefined || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
        if (depth >= 3) return '[details omitted]';
        if (Array.isArray(value)) return value.slice(0, 10).map(item => sanitize(item, depth + 1));
        if (typeof value !== 'object') return '[details omitted]';
        return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, entry]) => [
            redactErrorText(key, 64), SENSITIVE_DETAIL_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(entry, depth + 1),
        ]));
    }
    return sanitize(details) as Record<string, unknown>;
}
