/**
 * Normalizes a storage hash while allowing each caller to state which
 * algorithm prefixes it accepts. This prevents upload quota matching from
 * accidentally accepting the MD5 form supported by legacy quota records.
 */
export type StorageHashAlgorithm = 'sha256' | 'md5';

export function normalizeStorageHash(
    value: string,
    allowedAlgorithms: readonly StorageHashAlgorithm[]
): string {
    let normalized = value;
    for (const algorithm of allowedAlgorithms) {
        normalized = normalized.replace(new RegExp(`^${algorithm}:`, 'i'), '');
    }
    return normalized.trim().toLowerCase();
}
