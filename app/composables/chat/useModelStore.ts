/**
 * @module composables/chat/useModelStore
 *
 * **Purpose**
 * Manages the OpenRouter model catalog with local caching, favorites, and search/filter.
 * Fetches models from OpenRouter API, caches in Dexie KV for 48h TTL, and provides
 * reactive state for UI consumption. Supports favorite models persistence.
 *
 * **Responsibilities**
 * - Fetch model catalog from OpenRouter API or models-service
 * - Cache catalog in Dexie KV with TTL (48h default)
 * - Load favorites from KV and persist changes
 * - Provide reactive search query and filters (input/output, context, price, parameters)
 * - Dedupe parallel fetch requests via in-flight promise
 *
 * **Non-responsibilities**
 * - Does NOT send API requests directly (delegates to models-service)
 * - Does NOT manage API keys (see auth/models-service)
 * - Does NOT apply model selection to chat (see useAi.ts)
 * - Does NOT validate model availability (caller should check catalog)
 *
 * **Singleton State Pattern**
 * - Module-scoped refs (`catalog`, `favoriteModels`, `searchQuery`, `filters`) ensure all callers share state
 * - Previously, each invocation created new refs, so favoriting in modal didn't propagate to chat input
 * - State persists across component mount/unmount (session lifetime)
 * - Catalog and favorites are persisted to KV (survive page reload)
 *
 * **Caching Strategy**
 * - Catalog cached in KV with key `MODELS_CATALOG` (TTL: 48h)
 * - `fetchModels({ force: true })` bypasses cache and fetches fresh
 * - `fetchModels({ ttlMs })` uses custom TTL for cache freshness check
 * - In-flight promise dedupes parallel fetches (singleton pattern)
 *
 * **Favorites Persistence**
 * - Favorites stored in KV with key `FAVORITE_MODELS`
 * - Updated via `addFavorite(model)` / `removeFavorite(modelId)`
 * - Validated against Zod schema on load
 *
 * **Performance**
 * - In-memory catalog typically 200-500 models (5-50KB JSON)
 * - Search/filter operations are client-side (no backend queries)
 * - Lazy-load: catalog not fetched until first access
 * - Stale-while-revalidate: shows cached data immediately, fetches fresh in background
 *
 * **Error Handling**
 * - Fetch errors logged but do not throw (returns cached or empty array)
 * - KV read errors logged and fall back to empty state
 * - Write errors should propagate (caller handles)
 */

import { kv } from '~/db';
import { ref } from 'vue';

import modelsService, {
    type OpenRouterModel,
    type PriceBucket,
    type ModelCatalogResult,
} from '~/core/auth/models-service';

import { openRouterModelListSchema } from '~~/shared/openrouter/types';
import { stripModelVariantSuffix } from '~~/shared/openrouter/model-variants';
import { admitChatContext, type ContextModelMetadata } from '~~/shared/chat/context-budget';

// Module-level in-flight promise for deduping parallel fetches across composable instances
let inFlight: Promise<OpenRouterModel[]> | null = null;
// Retain the latest existing request identity after settlement. A delayed
// cache read must not regain ownership when inFlight becomes null again.
let latestCatalogRequest: Promise<OpenRouterModel[]> | null = null;
// Request identity alone cannot detect completion of the same owner while
// a cache read is held. Capture live publication too before awaiting KV.
let catalogPublication = 0;
let inFlightForced = false;
let catalogSource: 'openrouter-live' | 'openrouter-cache' = 'openrouter-cache';
let catalogFetchedAt: number | null = null;

export type ContextModelReadiness =
    | { ok: false; code: 'model_metadata_unavailable' }
    | { ok: true; selectedModelId: string; modelId: string; source: ModelCatalogResult['source'];
        fetchedAt: number | null; metadata: ContextModelMetadata };

/** Decode the existing cache key; legacy lists retain unknown fetch provenance. */
function decodeCatalog(raw: string): Pick<ModelCatalogResult, 'data' | 'fetchedAt'> | null {
    const parsed: unknown = JSON.parse(raw);
    const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : null;
    if (envelope && envelope.version !== 1) return null;
    const validated = openRouterModelListSchema.safeParse(envelope ? envelope.data : parsed);
    if (!validated.success) return null;
    const timestamp = envelope?.fetchedAt;
    return { data: validated.data, fetchedAt: typeof timestamp === 'number'
        && Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null };
}

/** Cancel one waiter promptly without canceling the catalog refresh shared by other callers. */
function waitForCatalog<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Model preparation canceled.', 'AbortError')); };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        void pending.then((value) => {
            signal.removeEventListener('abort', abort); resolve(value);
        }, (error: unknown) => {
            signal.removeEventListener('abort', abort); reject(error);
        });
    });
}

export const MODELS_CACHE_KEY = 'MODELS_CATALOG';
export const MODELS_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function canUseDexie() {
    try {
        return (
            typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
        );
    } catch {
        return false;
    }
}

// --- Singleton reactive state (shared across all composable callers) ---
// These are intentionally hoisted so that different components (e.g. SettingsModal
// and ChatInputDropper) mutate the SAME refs. Previously, each invocation of
// useModelStore() created new refs, so favoriting a model in the modal did not
// propagate to the chat input until a full reload re-hydrated from KV.
const favoriteModels = ref<OpenRouterModel[]>([]);
const catalog = ref<OpenRouterModel[]>([]);
const searchQuery = ref('');
const filters = ref<{
    input?: string[];
    output?: string[];
    minContext?: number;
    parameters?: string[];
    price?: PriceBucket;
}>({});
// Reactive timestamp (ms) of when catalog was last loaded into memory
const lastLoadedAt = ref<number | undefined>(undefined);

export function useModelStore() {
    function isFresh(ts: number | undefined, ttl: number) {
        if (!ts) return false;
        return Date.now() - ts < ttl;
    }

    async function loadFromDexie(
        ttl: number
    ): Promise<OpenRouterModel[] | null> {
        if (!canUseDexie()) return null;
        const requestOwner = latestCatalogRequest;
        const publication = catalogPublication;
        try {
            const rec = await kv.get(MODELS_CACHE_KEY);
            if (requestOwner !== latestCatalogRequest || publication !== catalogPublication) return inFlight ?? catalog.value;
            if (!rec) return null;
            // rec.updated_at is seconds in Kv schema; convert to ms
            const updatedAtMs = rec.updated_at
                ? rec.updated_at * 1000
                : undefined;
            if (!updatedAtMs || !isFresh(updatedAtMs, ttl)) {
                if (import.meta.dev)
                    console.debug(
                        '[models-cache] dexie record stale or missing timestamp',
                        {
                            updatedAtMs,
                            ttl,
                        }
                    );
                return null;
            }
            const raw = rec.value;
            if (!raw || typeof raw !== 'string') return null;
            try {
                const validated = decodeCatalog(raw);
                if (!validated) return null;
                catalog.value = validated.data;
                lastLoadedAt.value = validated.fetchedAt ?? updatedAtMs;
                catalogSource = 'openrouter-cache';
                catalogFetchedAt = validated.fetchedAt;
                if (import.meta.dev)
                    console.debug(
                        '[models-cache] dexie hit — hydrated catalog from cache',
                        {
                            updatedAtMs,
                            count: validated.data.length,
                        }
                    );
                // Removed dexie source console.log
                return validated.data;
            } catch (parseErr) {
                console.warn(
                    '[models-cache] JSON parse failed; deleting corrupt record',
                    parseErr
                );
                // best-effort cleanup
                try {
                    await kv.delete(MODELS_CACHE_KEY);
                } catch {
                    /* intentionally empty */
                }
                return null;
            }
        } catch (e) {
            console.warn('[models-cache] Dexie load failed', e);
            return null;
        }
    }

    async function saveToDexie(list: OpenRouterModel[], fetchedAt: number | null) {
        if (!canUseDexie()) return;
        try {
            await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1, data: list, fetchedAt }));
            if (import.meta.dev)
                console.debug('[models-cache] saved catalog to Dexie', {
                    count: list.length,
                });
        } catch (e) {
            console.warn('[models-cache] Dexie save failed', e);
        }
    }

    async function invalidate() {
        if (import.meta.dev) {
            console.info(
                '[models-cache] invalidate called — clearing memory + Dexie (if available)'
            );
        }
        catalog.value = [];
        lastLoadedAt.value = undefined;
        catalogSource = 'openrouter-cache';
        catalogFetchedAt = null;
        if (!canUseDexie()) return;
        try {
            await kv.delete(MODELS_CACHE_KEY);
            if (import.meta.dev)
                console.debug('[models-cache] Dexie record deleted');
        } catch (e) {
            console.warn('[models-cache] Dexie delete failed', e);
        }
    }

    async function fetchModels(opts?: { force?: boolean; ttlMs?: number }): Promise<OpenRouterModel[]> {
        const ttl = opts?.ttlMs ?? MODELS_TTL_MS;

        // Memory fast-path
        if (
            !opts?.force &&
            catalog.value.length &&
            isFresh(lastLoadedAt.value, ttl)
        ) {
            if (import.meta.dev)
                console.debug(
                    '[models-cache] memory hit — returning in-memory catalog',
                    {
                        lastLoadedAt: lastLoadedAt.value,
                        count: catalog.value.length,
                    }
                );
            // Removed memory source console.log
            return catalog.value;
        }

        // Try Dexie if available and not forced
        if (!opts?.force) {
            const dexieHit = await loadFromDexie(ttl);
            if (dexieHit) return dexieHit;
            if (import.meta.dev)
                console.debug(
                    '[models-cache] no fresh Dexie hit; proceeding to network fetch'
                );
        }

        // Dedupe in-flight network requests
        if (inFlight) {
            if (!opts?.force || inFlightForced) return inFlight;
            // A forced refresh must not inherit a normal service cache hit.
            // Wait for that owner, then coalesce one genuinely forced refresh.
            await inFlight.catch(() => undefined);
            return fetchModels(opts);
        }

        const fetchPromise = (async () => {
            if (import.meta.dev) {
                console.info('[models-cache] loading model catalog');
            }
            try {
                const result = await modelsService.fetchModelCatalog(opts);
                const list = result.data;
                catalogPublication += 1;
                catalog.value = list;
                lastLoadedAt.value = result.fetchedAt ?? undefined;
                catalogSource = result.source;
                catalogFetchedAt = result.fetchedAt;
                if (import.meta.dev) {
                    console.info('[models-cache] catalog loaded', {
                        source: result.source, fetchedAt: result.fetchedAt,
                    });
                }
                // Removed network source console.log
                // persist async (don't block response)
                saveToDexie(list, result.fetchedAt).catch(() => {});
                return list;
            } catch (err) {
                console.warn('[models-cache] network fetch failed', err);
                // On network failure, attempt to serve stale Dexie record (even if expired)
                // BUT: max stale age is 7 days to prevent serving extremely outdated data
                const MAX_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
                if (canUseDexie()) {
                    try {
                        const rec = await kv.get(MODELS_CACHE_KEY);
                        const raw = rec?.value;
                        const updatedAtMs = rec?.updated_at
                            ? rec.updated_at * 1000
                            : 0;
                        const staleness = Date.now() - updatedAtMs;

                        if (
                            raw &&
                            typeof raw === 'string' &&
                            staleness < MAX_STALE_AGE_MS
                        ) {
                            try {
                                const validated = decodeCatalog(raw);
                                if (
                                    validated &&
                                    validated.data.length
                                ) {
                                    catalog.value = validated.data;
                                    lastLoadedAt.value =
                                        validated.fetchedAt ?? updatedAtMs;
                                    catalogSource = 'openrouter-cache';
                                    catalogFetchedAt = validated.fetchedAt;
                                    console.warn(
                                        '[models-cache] network failed; serving stale cached models',
                                        {
                                            count: validated.data.length,
                                            staleDays: Math.floor(
                                                staleness /
                                                    (24 * 60 * 60 * 1000)
                                            ),
                                        }
                                    );
                                    return validated.data;
                                }
                            } catch {
                                // corrupted; best-effort delete
                                try {
                                    await kv.delete(MODELS_CACHE_KEY);
                                } catch (deleteErr: unknown) {
                                    if (import.meta.dev) {
                                        console.warn(
                                            '[models-cache] failed to delete corrupt record',
                                            deleteErr
                                        );
                                    }
                                }
                            }
                        } else if (staleness >= MAX_STALE_AGE_MS) {
                            if (import.meta.dev) {
                                console.warn(
                                    '[models-cache] stale cache too old, not serving'
                                );
                            }
                        }
                    } catch (e) {
                        console.warn(
                            '[models-cache] Dexie read during network failure failed',
                            e
                        );
                    }
                }
                throw err;
            }
        })();

        const pending = fetchPromise.finally(() => {
            if (inFlight === pending) { inFlight = null; inFlightForced = false; }
        });
        inFlight = pending;
        latestCatalogRequest = pending;
        inFlightForced = opts?.force === true;
        return pending;
    }

    /** Capture validated catalog facts. This prepares metadata only, never a chat turn. */
    async function resolveContextModel(selectedModelId: string, opts?: { signal?: AbortSignal }): Promise<ContextModelReadiness> {
        const signal = opts?.signal;
        const checkCanceled = () => {
            if (signal?.aborted) throw new DOMException('Model preparation canceled.', 'AbortError');
        };
        checkCanceled();
        const withoutThinking = selectedModelId.endsWith(':thinking') ? selectedModelId.slice(0, -':thinking'.length) : selectedModelId;
        const lookupId = stripModelVariantSuffix(withoutThinking);
        const lookup = (): Extract<ContextModelReadiness, { ok: true }> | undefined => {
            const exact = [
                { model: catalog.value.find((model) => model.id === lookupId), source: catalogSource, fetchedAt: catalogFetchedAt },
                { model: favoriteModels.value.find((model) => model.id === lookupId), source: 'openrouter-cache' as const, fetchedAt: null },
            ];
            const candidates = exact.some((candidate) => candidate.model) ? exact : [
                { model: catalog.value.find((model) => model.canonical_slug === lookupId), source: catalogSource, fetchedAt: catalogFetchedAt },
                { model: favoriteModels.value.find((model) => model.canonical_slug === lookupId), source: 'openrouter-cache' as const, fetchedAt: null },
            ];
            for (const candidate of candidates) {
                if (!candidate.model || !admitChatContext({ model: candidate.model, inputTokens: 0 }).ok) continue;
                const model = candidate.model;
                const metadata = Object.freeze({ context_length: model.context_length,
                    architecture: model.architecture ? Object.freeze({
                        input_modalities: Object.freeze([...(model.architecture.input_modalities ?? [])]),
                    }) : undefined,
                    top_provider: model.top_provider ? Object.freeze({ context_length: model.top_provider.context_length,
                        max_completion_tokens: model.top_provider.max_completion_tokens }) : undefined });
                return Object.freeze({ ok: true, selectedModelId, modelId: model.id,
                    source: candidate.source, fetchedAt: candidate.fetchedAt, metadata });
            }
        };
        let known = lookup();
        if (known) return known;
        try {
            await waitForCatalog(fetchModels(), signal);
            checkCanceled(); known = lookup();
            if (known) return known;
            await waitForCatalog(fetchModels({ force: true }), signal);
        } catch {
            checkCanceled();
            // Failed refresh can still leave valid last-known metadata.
        }
        checkCanceled();
        return lookup() ?? { ok: false, code: 'model_metadata_unavailable' };
    }

    async function persist() {
        try {
            await kv.set(
                'favorite_models',
                JSON.stringify(favoriteModels.value)
            );
        } catch (e) {
            console.warn('[useModelStore] persist favorites failed', e);
        }
    }

    async function addFavoriteModel(model: OpenRouterModel) {
        if (favoriteModels.value.some((m) => m.id === model.id)) return; // dedupe
        favoriteModels.value.push(model);
        await persist();
    }

    async function removeFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value = favoriteModels.value.filter(
            (m) => m.id !== model.id
        );
        await persist();
    }

    async function clearFavoriteModels() {
        favoriteModels.value = [];
        await persist();
    }

    async function getFavoriteModels() {
        try {
            const record = await kv.get('favorite_models');
            const raw = record?.value;
            if (raw && typeof raw === 'string') {
                const parsed: unknown = JSON.parse(raw);
                const validated = openRouterModelListSchema.safeParse(parsed);
                favoriteModels.value = validated.success ? validated.data : [];
            } else {
                favoriteModels.value = [];
            }
        } catch {
            favoriteModels.value = [];
        }
        return favoriteModels.value;
    }

    // Convenience wrapper to force network refresh
    async function refreshModels() {
        return fetchModels({ force: true });
    }

    return {
        favoriteModels,
        catalog,
        searchQuery,
        filters,
        fetchModels,
        loadCachedModels: () => loadFromDexie(MODELS_TTL_MS),
        resolveContextModel,
        refreshModels,
        invalidate,
        getFavoriteModels,
        addFavoriteModel,
        removeFavoriteModel,
        clearFavoriteModels,
        lastLoadedAt,
    };
}
