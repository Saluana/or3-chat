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
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
        if (SENSITIVE_DETAIL_KEY_PATTERN.test(key)) {
            result[key] = '[redacted]';
            continue;
        }
        if (value === null || value === undefined) {
            result[key] = value;
        } else if (typeof value === 'string') {
            result[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            result[key] = value;
        } else if (value instanceof Error) {
            result[key] = value.message;
        } else {
            try {
                const serialized = JSON.stringify(value);
                result[key] =
                    serialized && serialized.length > 200
                        ? `${serialized.slice(0, 200)}…`
                        : serialized;
            } catch {
                result[key] = '[unserializable]';
            }
        }
    }
    return result;
}

