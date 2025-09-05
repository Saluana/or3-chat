// Unified file hash & image normalization utilities (Task 0)
// Keep minimal & pure for easy reuse and tree-shaking.

export interface NormalizedImageAttachment {
    kind: 'image';
    src: string; // data URL or remote URL
    hash?: string; // optional precomputed hash
    mime?: string; // optional mime type
}

// Tolerant hash parser: accepts array, JSON string, comma list, single hash.
export function parseHashes(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((h) => typeof h === 'string');
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return [];
        // Try JSON array
        if (s.startsWith('[')) {
            try {
                const arr = JSON.parse(s);
                if (Array.isArray(arr))
                    return arr.filter((h) => typeof h === 'string');
            } catch {}
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

// Merge previous assistant hashes with current (dedupe, preserve first-seen order)
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

// Normalize images param variants -> attachment objects.
export function normalizeImagesParam(
    input: unknown
): NormalizedImageAttachment[] {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : [input];
    const out: NormalizedImageAttachment[] = [];
    for (const item of arr) {
        if (!item) continue;
        if (typeof item === 'string') {
            out.push({ kind: 'image', src: item });
            continue;
        }
        if (typeof item === 'object') {
            const anyItem: any = item;
            const src =
                typeof anyItem.url === 'string'
                    ? anyItem.url
                    : typeof anyItem.data === 'string'
                    ? anyItem.data
                    : undefined;
            if (!src) continue;
            const mime =
                typeof anyItem.mime === 'string' ? anyItem.mime : undefined;
            const hash =
                typeof anyItem.hash === 'string' ? anyItem.hash : undefined;
            out.push({ kind: 'image', src, mime, hash });
        }
    }
    return out;
}
