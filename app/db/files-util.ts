/** Default maximum number of files (hashes) per message */
const DEFAULT_MAX_MESSAGE_FILE_HASHES = 6;

/** Allow runtime override via public env (bounded 1..12 to avoid abuse) */
const envLimitRaw: string | undefined = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env.NUXT_PUBLIC_MAX_MESSAGE_FILES;
let resolvedLimit = DEFAULT_MAX_MESSAGE_FILE_HASHES;
if (envLimitRaw) {
    const n = parseInt(envLimitRaw, 10);
    if (!isNaN(n) && n >= 1 && n <= 12) resolvedLimit = n;
}

/** Primary export used across app (UI + DB) */
export const MAX_FILES_PER_MESSAGE: number = resolvedLimit;

/** Backward compatibility alias (internal usage) */
export const MAX_MESSAGE_FILE_HASHES: number = MAX_FILES_PER_MESSAGE;

/**
 * Parse serialized JSON array of file hashes into a bounded string array.
 * Returns empty array for invalid input. Enforces MAX_MESSAGE_FILE_HASHES limit.
 */
export function parseFileHashes(
    serialized: string | null | undefined
): string[] {
    if (!serialized) return [];
    try {
        const arr: unknown = JSON.parse(serialized);
        if (!Array.isArray(arr)) return [];
        const filtered: string[] = [];
        for (const v of arr) {
            if (typeof v === 'string') {
                filtered.push(v);
                if (filtered.length >= MAX_MESSAGE_FILE_HASHES) break;
            }
        }
        return filtered;
    } catch {
        return [];
    }
}

/**
 * Serialize array of hashes enforcing max + dedupe while preserving first occurrence ordering.
 * Invalid entries (non-string) are skipped. Returns JSON string.
 */
export function serializeFileHashes(hashes: string[]): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of hashes) {
        if (typeof h !== 'string') continue;
        if (seen.has(h)) continue;
        seen.add(h);
        out.push(h);
        if (out.length >= MAX_MESSAGE_FILE_HASHES) break;
    }
    return JSON.stringify(out);
}
