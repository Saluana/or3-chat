import { kv } from '~/db';
import modelsService, {
    type OpenRouterModel,
    type PriceBucket,
} from '~/utils/models-service';

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
            const rec: any = await kv.get(MODELS_CACHE_KEY);
            if (!rec) return null;
            // rec.updated_at is seconds in Kv schema; convert to ms
            const updatedAtMs = rec.updated_at
                ? rec.updated_at * 1000
                : undefined;
            if (!updatedAtMs || !isFresh(updatedAtMs, ttl)) {
                console.debug(
                    '[models-cache] dexie record stale or missing timestamp',
                    {
                        updatedAtMs,
                        ttl,
                    }
                );
                return null;
            }
            const raw = rec?.value;
            if (!raw || typeof raw !== 'string') return null;
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return null;
                catalog.value = parsed;
                lastLoadedAt.value = updatedAtMs;
                console.debug(
                    '[models-cache] dexie hit — hydrated catalog from cache',
                    {
                        updatedAtMs,
                        count: parsed.length,
                    }
                );
                console.log('[models-cache] pulled models from dexie', {
                    source: 'dexie',
                    count: parsed.length,
                });
                return parsed;
            } catch (e) {
                console.warn(
                    '[models-cache] JSON parse failed; deleting corrupt record',
                    e
                );
                // best-effort cleanup
                try {
                    await kv.delete(MODELS_CACHE_KEY);
                } catch {}
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
            console.debug(
                '[models-cache] memory hit — returning in-memory catalog',
                {
                    lastLoadedAt: lastLoadedAt.value,
                    count: catalog.value.length,
                }
            );
            console.log('[models-cache] pulled models from memory', {
                source: 'memory',
                count: catalog.value.length,
            });
            return catalog.value;
        }

        // Try Dexie if available and not forced
        if (!opts?.force) {
            const dexieHit = await loadFromDexie(ttl);
            if (dexieHit) return dexieHit;
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
                console.log('[models-cache] pulled models from network', {
                    source: 'network',
                    count: list.length,
                });
                // persist async (don't block response)
                saveToDexie(list).catch(() => {});
                return list;
            } catch (err) {
                console.warn('[models-cache] network fetch failed', err);
                // On network failure, attempt to serve stale Dexie record (even if expired)
                if (canUseDexie()) {
                    try {
                        const rec: any = await kv.get(MODELS_CACHE_KEY);
                        const raw = rec?.value;
                        if (raw && typeof raw === 'string') {
                            try {
                                const parsed = JSON.parse(raw);
                                if (Array.isArray(parsed) && parsed.length) {
                                    console.warn(
                                        '[models-cache] network failed; serving stale cached models',
                                        { count: parsed.length }
                                    );
                                    console.log(
                                        '[models-cache] pulled models from stale dexie after network failure',
                                        {
                                            source: 'stale-dexie',
                                            count: parsed.length,
                                        }
                                    );
                                    return parsed;
                                }
                            } catch (e) {
                                // corrupted; best-effort delete
                                try {
                                    await kv.delete(MODELS_CACHE_KEY);
                                } catch {}
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
            const record: any = await kv.get('favorite_models');
            const raw = record?.value;
            if (raw && typeof raw === 'string') {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    favoriteModels.value = parsed;
                } else {
                    favoriteModels.value = [];
                }
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
