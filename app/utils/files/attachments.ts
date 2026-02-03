/**
 * @module app/utils/files/attachments
 *
 * Purpose:
 * Normalizes file hash and image attachment inputs into consistent shapes.
 *
 * Behavior:
 * - Accepts tolerant inputs (arrays, JSON strings, comma lists)
 * - Deduplicates hashes while preserving order
 *
 * Constraints:
 * - Pure functions with no side effects
 */

/**
 * `NormalizedImageAttachment`
 *
 * Purpose:
 * Canonical image attachment shape used by chat and workflow utilities.
 */
export interface NormalizedImageAttachment {
    kind: 'image';
    src: string; // data URL or remote URL
    hash?: string; // optional precomputed hash
    mime?: string; // optional mime type
}

type MaybeImageLike = {
    url?: unknown;
    data?: unknown;
    mime?: unknown;
    hash?: unknown;
};

function parseJsonArray(raw: string): unknown[] | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * `parseHashes`
 *
 * Purpose:
 * Parses a hash payload into a string array.
 *
 * Behavior:
 * - Accepts arrays, JSON array strings, comma lists, or a single hash string
 */
export function parseHashes(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((h) => typeof h === 'string');
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return [];
        // Try JSON array
        if (s.startsWith('[')) {
            const arr = parseJsonArray(s);
            if (arr) return arr.filter((h) => typeof h === 'string');
        }
        // Comma separated fallback
        if (s.includes(','))
            return s
                .split(',')
                .map((x) => x.trim())
                .filter((x) => x.length > 0);
        return [s];
    }
    // Non-supported types ignored
    return [];
}

/**
 * `mergeAssistantFileHashes`
 *
 * Purpose:
 * Merges hash arrays while deduplicating and preserving first-seen order.
 */
export function mergeAssistantFileHashes(
    prev: string[] | null | undefined,
    current: string[] | null | undefined
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const h of Array.isArray(prev) ? prev : []) {
        if (typeof h === 'string' && !seen.has(h)) {
            seen.add(h);
            out.push(h);
        }
    }
    for (const h of Array.isArray(current) ? current : []) {
        if (typeof h === 'string' && !seen.has(h)) {
            seen.add(h);
            out.push(h);
        }
    }
    return out;
}

/**
 * `normalizeImagesParam`
 *
 * Purpose:
 * Normalizes mixed image inputs into attachment objects.
 */
export function normalizeImagesParam(
    input: unknown
): NormalizedImageAttachment[] {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : [input];
    const out: NormalizedImageAttachment[] = [];
    for (const item of arr) {
        const normalized = toNormalizedImage(item);
        if (normalized) out.push(normalized);
    }
    return out;
}

function toNormalizedImage(item: unknown): NormalizedImageAttachment | null {
    if (!item) return null;
    if (typeof item === 'string') {
        return { kind: 'image', src: item };
    }
    if (typeof item === 'object') {
        const imageLike = item as MaybeImageLike;
        const src =
            typeof imageLike.url === 'string'
                ? imageLike.url
                : typeof imageLike.data === 'string'
                ? imageLike.data
                : undefined;
        if (!src) return null;
        const mime =
            typeof imageLike.mime === 'string' ? imageLike.mime : undefined;
        const hash =
            typeof imageLike.hash === 'string' ? imageLike.hash : undefined;
        return { kind: 'image', src, mime, hash };
    }
    return null;
}
