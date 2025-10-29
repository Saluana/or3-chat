/**
 * Shared Orama search helpers for client-side indexing and search.
 * Preserves SSR safety, provides race-guard token pattern, and handles import failures gracefully.
 *
 * Design goals:
 * - Dynamic import to keep bundle small when search unused
 * - SSR-safe (only imports on client)
 * - Memoized import to avoid repeated loads
 * - Token-based race guard (caller owns tokens)
 * - Isolated DB instances per schema (no cross-contamination)
 */

type OramaModule = any;
type OramaInstance = any;

let oramaModuleCache: OramaModule | null = null;

/**
 * Dynamic import of Orama with SSR guard and friendly error.
 * Returns the Orama module or throws if unavailable.
 * Memoized after first successful import.
 */
export async function importOrama(): Promise<OramaModule> {
    if (typeof window === 'undefined') {
        throw new Error('Orama import attempted on server (SSR guard)');
    }

    if (oramaModuleCache) return oramaModuleCache;

    try {
        const mod = await import('@orama/orama');
        oramaModuleCache = mod;
        return mod;
    } catch (error) {
        throw new Error(`Failed to import Orama: ${error}`);
    }
}

/**
 * Create an isolated Orama database instance with the given schema.
 * Schema keys map to Orama types: 'string' | 'number' | 'boolean' | etc.
 *
 * @param schema - Record of field names to Orama type strings
 * @returns Promise resolving to a new Orama DB instance
 */
export async function createDb(
    schema: Record<string, string>
): Promise<OramaInstance> {
    const { create } = await importOrama();
    return create({ schema });
}

/**
 * Build/populate an Orama index by inserting documents.
 *
 * @param db - Orama database instance
 * @param docs - Array of documents to index
 * @returns Promise resolving to the DB instance (for chaining)
 */
export async function buildIndex<T = any>(
    db: OramaInstance,
    docs: T[]
): Promise<OramaInstance> {
    if (!docs.length) return db;
    const { insertMultiple } = await importOrama();
    await insertMultiple(db, docs);
    return db;
}

/**
 * Search the Orama index with a term and limit.
 *
 * @param db - Orama database instance
 * @param term - Search query string
 * @param limit - Max number of results (default 100)
 * @returns Promise resolving to Orama search results
 */
export async function searchWithIndex(
    db: OramaInstance,
    term: string,
    limit = 100
): Promise<{ hits: any[] }> {
    const { search } = await importOrama();
    const result = await search(db, {
        term,
        limit,
        // Return all document fields in search results, not just searchable ones
        returning: ['id', 'title', 'source', 'snippet'],
    });
    return result || { hits: [] };
}

/**
 * Token factory for race-guard pattern.
 * Each composable should maintain its own token counter.
 *
 * Usage:
 * ```ts
 * let tokenCounter = 0;
 * const token = ++tokenCounter;
 * const results = await searchWithIndex(db, query, limit);
 * if (token !== tokenCounter) return; // stale
 * ```
 */
export function createTokenCounter(): {
    next: () => number;
    current: () => number;
} {
    let counter = 0;
    return {
        next: () => ++counter,
        current: () => counter,
    };
}
