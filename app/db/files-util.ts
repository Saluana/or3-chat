/**
 * @module app/db/files-util
 *
 * Purpose:
 * Shared helpers for handling message file hash lists.
 *
 * Responsibilities:
 * - Enforce per-message file hash limits
 * - Serialize and parse hash lists safely
 *
 * Non-responsibilities:
 * - File metadata lookup or storage
 */
import { or3Config } from '~~/config.or3';

/**
 * Purpose:
 * Maximum number of files allowed per message.
 *
 * Behavior:
 * Reads the limit from OR3 configuration at import time.
 *
 * Constraints:
 * - Static at runtime unless the module is reloaded.
 *
 * Non-Goals:
 * - Does not enforce limits at persistence time.
 */
export const MAX_FILES_PER_MESSAGE: number = or3Config.limits.maxFilesPerMessage;

/**
 * Purpose:
 * Backward compatibility alias for max file hashes per message.
 *
 * Behavior:
 * Mirrors `MAX_FILES_PER_MESSAGE`.
 *
 * Constraints:
 * - Intended for internal usage only.
 *
 * Non-Goals:
 * - Does not introduce a new limit value.
 */
export const MAX_MESSAGE_FILE_HASHES: number = MAX_FILES_PER_MESSAGE;

/**
 * Purpose:
 * Parse stored file hash arrays into a bounded list.
 *
 * Behavior:
 * Parses JSON input and returns only string hashes up to the configured limit.
 *
 * Constraints:
 * - Returns an empty array for invalid JSON or invalid shapes.
 *
 * Non-Goals:
 * - Does not validate hash format.
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
 * Purpose:
 * Serialize file hashes for storage on message rows.
 *
 * Behavior:
 * Deduplicates hashes, preserves first occurrence order, and enforces the max.
 *
 * Constraints:
 * - Skips invalid non-string values.
 *
 * Non-Goals:
 * - Does not validate hash format.
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
