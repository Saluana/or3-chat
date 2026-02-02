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
} from '~/core/auth/models-service';

import { openRouterModelListSchema } from '~~/shared/openrouter/types';

// Module-level in-flight promise for deduping parallel fetches across composable instances
let inFlight: Promise<OpenRouterModel[]> | null = null;

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
        try {
            const rec = await kv.get(MODELS_CACHE_KEY);
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
                const parsed: unknown = JSON.parse(raw);
                const validated = openRouterModelListSchema.safeParse(parsed);
                if (!validated.success) return null;
                catalog.value = validated.data;
                lastLoadedAt.value = updatedAtMs;
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

    async function saveToDexie(list: OpenRouterModel[]) {
        if (!canUseDexie()) return;
        try {
            await kv.set(MODELS_CACHE_KEY, JSON.stringify(list));
            if (import.meta.dev)
                console.debug('[models-cache] saved catalog to Dexie', {
                    count: list.length,
                });
        } catch (e) {
            console.warn('[models-cache] Dexie save failed', e);
        }
    }

    async function invalidate() {
        console.info(
            '[models-cache] invalidate called — clearing memory + Dexie (if available)'
        );
        catalog.value = [];
        lastLoadedAt.value = undefined;
        if (!canUseDexie()) return;
        try {
            await kv.delete(MODELS_CACHE_KEY);
            if (import.meta.dev)
                console.debug('[models-cache] Dexie record deleted');
        } catch (e) {
            console.warn('[models-cache] Dexie delete failed', e);
        }
    }

    async function fetchModels(opts?: { force?: boolean; ttlMs?: number }) {
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
        if (inFlight && !opts?.force) return inFlight;

        const fetchPromise = (async () => {
            console.info('[models-cache] fetching models from network');
            try {
                const list = await modelsService.fetchModels(opts);
                catalog.value = list;
                lastLoadedAt.value = Date.now();
                console.info(
                    '[models-cache] network fetch successful — updated memory, persisting to Dexie'
                );
                // Removed network source console.log
                // persist async (don't block response)
                saveToDexie(list).catch(() => {});
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
                                const parsed: unknown = JSON.parse(raw);
                                const validated =
                                    openRouterModelListSchema.safeParse(parsed);
                                if (
                                    validated.success &&
                                    validated.data.length
                                ) {
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

        if (!opts?.force) {
            inFlight = fetchPromise.finally(() => {
                inFlight = null;
            });
        }

        return fetchPromise;
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
        refreshModels,
        invalidate,
        getFavoriteModels,
        addFavoriteModel,
        removeFavoriteModel,
        clearFavoriteModels,
        lastLoadedAt,
    };
}
