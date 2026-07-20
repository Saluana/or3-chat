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

