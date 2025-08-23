import { nowSec } from './util';

// Default maximum number of files (hashes) per message.
const DEFAULT_MAX_MESSAGE_FILE_HASHES = 6;
// Allow runtime override via public env (bounded 1..12 to avoid abuse)
const envLimitRaw = (import.meta as any).env?.NUXT_PUBLIC_MAX_MESSAGE_FILES;
let resolvedLimit = DEFAULT_MAX_MESSAGE_FILE_HASHES;
if (envLimitRaw) {
    const n = parseInt(envLimitRaw, 10);
    if (!isNaN(n) && n >= 1 && n <= 12) resolvedLimit = n;
}
// Primary export used across app (UI + DB)
export const MAX_FILES_PER_MESSAGE = resolvedLimit;
// Backward compatibility alias (internal usage)
export const MAX_MESSAGE_FILE_HASHES = MAX_FILES_PER_MESSAGE;

/** Parse serialized JSON array of file hashes into a bounded string array */
export function parseFileHashes(serialized?: string | null): string[] {
    if (!serialized) return [];
    try {
        const arr = JSON.parse(serialized);
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

/** Serialize array of hashes enforcing max + dedupe while preserving first occurrence ordering */
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

/** Utility to create standard timestamp numbers (proxy re-export) */
export function nowSecNumber(): number {
    return nowSec();
}
