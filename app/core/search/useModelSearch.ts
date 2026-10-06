/**
 * @module app/core/search/useModelSearch
 *
 * Purpose:
 * Vue composable that provides client-side full-text search over the
 * OpenRouter model catalog using Orama. Builds an index on first use and
 * rebuilds automatically when the model list changes.
 *
 * Behavior:
 * - Creates an Orama index covering id, slug, name, description, context
 *   length, and modalities
 * - Debounces query input at ~120 ms to avoid excessive re-indexing
 * - Falls back to substring search if Orama returns empty results or errors
 * - Uses a token-based race guard to drop stale search results
 *
 * Constraints:
 * - Client-only (`process.client` guard on index build)
 * - Orama is dynamically imported to keep it off the critical path
 * - Each catalog owns its index and pending searches
 * - Index is rebuilt only when `models.value.length` changes
 *
 * Non-goals:
 * - Does not handle model fetching (see core/auth/models-service)
 * - Does not provide server-side search
 *
 * @see core/search/orama for the Orama wrapper utilities
 * @see core/auth/models-service for the model catalog source
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import type { OpenRouterModel } from '~/core/auth/models-service';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';

// Simple Orama-based search composable for the model catalog.
// Builds an index client-side and performs search across id, slug, name, description, modalities.
// Debounced query for responsiveness.

interface ModelDoc {
    id: string;
    slug: string;
    name: string;
    description: string;
    ctx: number;
    modalities: string;
}

// Orama instance type (opaque to avoid @orama/orama type dependency)
type OramaInstance = Record<string, unknown>;

async function buildIndex(
    models: OpenRouterModel[]
): Promise<OramaInstance | null> {
    const db = (await createDb({
        id: 'string',
        slug: 'string',
        name: 'string',
        description: 'string',
        ctx: 'number',
        modalities: 'string',
    })) as OramaInstance | null;
    if (!db) return null;
    const docs: ModelDoc[] = models.map((m) => ({
        id: m.id,
        slug: m.canonical_slug || m.id,
        name: m.name || '',
        description: m.description || '',
        ctx: m.top_provider?.context_length ?? m.context_length ?? 0,
        modalities: [
            ...(m.architecture?.input_modalities || []),
            ...(m.architecture?.output_modalities || []),
        ].join(' '),
    }));
    await buildOramaIndex(db, docs);
    return db;
}

/**
 * Purpose:
 * Provide a reactive, client-side search experience over the OpenRouter model list.
 *
 * Behavior:
 * - Builds (or rebuilds) an Orama index when model count changes
 * - Debounces queries and maps hits back to `OpenRouterModel` objects
 * - Falls back to substring search when Orama fails or returns empty results
 *
 * Constraints:
 * - Client-only indexing
 * - Index and search lifetimes belong to the calling catalog
 */
export function useModelSearch(models: Ref<OpenRouterModel[]>) {
    const query = ref('');
    const results = ref<OpenRouterModel[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    let currentDb: OramaInstance | null = null;
    let lastIndexedCount = -1;
    let lastQueryToken = 0;
    let disposed = false;
    let indexBuild: Promise<void> | null = null;
    const idToModel = computed<Record<string, OpenRouterModel>>(() => Object.fromEntries(models.value.map(model => [model.id, model])));

    async function ensureIndex() {
        if (!process.client || disposed) return;
        if (indexBuild) return await indexBuild;
        if (models.value.length === lastIndexedCount) return;
        indexBuild = (async () => {
            busy.value = true;
            try {
                while (!disposed && models.value.length !== lastIndexedCount) {
                    const snapshot = models.value.slice();
                    let db: OramaInstance | null = null;
                    try { db = await buildIndex(snapshot); }
                    catch (error) { console.warn('[useModelSearch] Using substring search; index unavailable:', error); }
                    if (disposed) return;
                    if (snapshot.length !== models.value.length) continue;
                    currentDb = db;
                    lastIndexedCount = snapshot.length;
                }
            } finally { busy.value = false; }
        })();
        try { await indexBuild; }
        finally { indexBuild = null; }
    }

    const fallbackSearch = (raw: string) => {
        const lower = raw.toLowerCase();
        return models.value.filter(model => `${model.id}\n${model.canonical_slug ?? ''}\n${model.name}\n${model.description ?? ''}`.toLowerCase().includes(lower)).slice(0, 100);
    };
    async function runSearch(token: number) {
        if (disposed || token !== lastQueryToken) return;
        const raw = query.value.trim();
        ready.value = true;
        if (!raw) {
            results.value = models.value;
            return;
        }
        // Model identifiers use punctuation where display names use spaces.
        // Prefer those literal names/IDs before broad full-text description
        // matches consume the result limit and bury the requested model.
        const normalizeName = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const nameQuery = normalizeName(raw);
        const named = nameQuery ? models.value.filter((model) =>
            [model.id, model.canonical_slug ?? '', model.name]
                .some((value) => normalizeName(value).includes(nameQuery))) : [];
        if (named.length) {
            results.value = named.slice(0, 100);
            return;
        }
        results.value = fallbackSearch(raw);
        await ensureIndex();
        if (disposed || token !== lastQueryToken || !currentDb) return;
        try {
            const r = await searchWithIndex(currentDb, raw, 100);
            if (disposed || token !== lastQueryToken) return;
            const hits = (Array.isArray(r.hits) ? r.hits : []) as Array<{
                document?: { id?: string };
                id?: string;
            }>;
            const mapped = hits
                .map((h) => {
                    const doc = h.document || h; // support differing shapes
                    const docId = doc.id;
                    return docId ? idToModel.value[docId] : undefined;
                })
                .filter(
                    (m: OpenRouterModel | undefined): m is OpenRouterModel =>
                        !!m
                );
            results.value = mapped.length ? mapped : fallbackSearch(raw);
        } catch (err) {
            if (disposed || token !== lastQueryToken) return;
            results.value = fallbackSearch(raw);

            console.warn(
                '[useModelSearch] Fallback substring search used:',
                err
            );
        }
    }

    watch(models, () => {
        const token = ++lastQueryToken;
        void ensureIndex();
        void runSearch(token);
    }, { immediate: true });

    let searchTimeout: ReturnType<typeof setTimeout> | undefined;
    watch(query, () => {
        const token = ++lastQueryToken;
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            void runSearch(token);
        }, 120);
    }, { flush: 'sync' });
    onScopeDispose(() => { disposed = true; lastQueryToken++; clearTimeout(searchTimeout); });

    return { query, results, ready, busy, rebuild: ensureIndex };
}

export default useModelSearch;
