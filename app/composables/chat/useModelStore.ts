import { getKvRecordByName, setKvByName } from '~/db/kv';
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
import { getWorkspaceGeneration, getDb, subscribeActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { ref } from 'vue';

import modelsService, {
    type OpenRouterModel,
    type PriceBucket,
    type ModelCatalogResult,
    type CatalogProvenance,
    type PlatformCatalogStatus,
} from '~/core/auth/models-service';

import { isOpenAiModel } from '~~/shared/openai/models';
import { openRouterModelListSchema } from '~~/shared/openrouter/types';
import { openRouterCatalogLookupId } from '~~/shared/openrouter/selection';
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
let remainingModelsInFlight: Promise<void> | null = null;
type Platform = 'openai' | 'openrouter';
type CatalogOrigins = Partial<Record<Platform, CatalogProvenance>>;
let catalogOrigins: CatalogOrigins = {};
const modelPlatform = (id: string): Platform => isOpenAiModel(id) ? 'openai' : 'openrouter';
const cachedOrigin = (id: string, fetchedAt: number | null): CatalogProvenance => ({ source: `${modelPlatform(id)}-cache`, fetchedAt });

function oldestFetch(list: OpenRouterModel[], origins: CatalogOrigins): number | null {
    const dates = [...new Set(list.map(model => modelPlatform(model.id)))].map(platform => origins[platform]?.fetchedAt ?? null);
    return dates.length && dates.every((date): date is number => date !== null) ? Math.min(...dates) : null;
}

export type ContextModelReadiness =
    | { ok: false; code: 'model_metadata_unavailable' }
    | { ok: true; selectedModelId: string; modelId: string; source: ModelCatalogResult['source'];
        fetchedAt: number | null; metadata: ContextModelMetadata };

/** Decode the existing cache key; legacy lists retain unknown fetch provenance. */
function decodeCatalog(raw: string): (Pick<ModelCatalogResult, 'data' | 'fetchedAt'> & { origins: CatalogOrigins }) | null {
    const parsed: unknown = JSON.parse(raw);
    const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : null;
    if (envelope && envelope.version !== 1) return null;
    const validated = openRouterModelListSchema.safeParse(envelope ? envelope.data : parsed);
    if (!validated.success) return null;
    const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
    const saved = envelope?.origins as CatalogOrigins | undefined;
    const origins: CatalogOrigins = {};
    for (const model of validated.data) {
        const platform = modelPlatform(model.id);
        // Rehydrated metadata is cached, even when originally fetched live.
        origins[platform] = cachedOrigin(model.id, timestamp(saved?.[platform]?.fetchedAt ?? envelope?.fetchedAt));
    }
    return { data: validated.data, fetchedAt: oldestFetch(validated.data, origins), origins };
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

// A guarded write the workspace left behind is refused on purpose, not a failure.
const isCancelled = (e: unknown) => (e as { rpcCode?: unknown } | null)?.rpcCode === 'cancelled';

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
const recentModelIds = ref<string[]>([]);
let recentWrites = Promise.resolve();
let recentRevision = 0;
const catalog = ref<OpenRouterModel[]>([]);
const platformStatus = ref<Partial<Record<'openai' | 'openrouter', PlatformCatalogStatus>>>({});
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

let favoriteRevision = 0;
let favoriteWrites = Promise.resolve();
let stopWorkspace: (() => void) | undefined;
function resetCatalog() {
    catalogPublication++;
    latestCatalogRequest = null;
    inFlight = null;
    inFlightForced = false;
    remainingModelsInFlight = null;
    catalog.value = [];
    platformStatus.value = {};
    lastLoadedAt.value = undefined;
    catalogOrigins = {};
}
function resetMemory() {
    resetCatalog();
    favoriteModels.value = [];
    favoriteRevision++;
    favoriteWrites = Promise.resolve();
    recentModelIds.value = [];
    recentRevision++;
    recentWrites = Promise.resolve();
}
if (import.meta.hot) import.meta.hot.dispose(() => { stopWorkspace?.(); resetMemory(); });

export function useModelStore() {
    if (typeof window !== 'undefined' && !stopWorkspace) {
        stopWorkspace = subscribeActiveWorkspaceDb(resetMemory);
    }
    function isFresh(ts: number | undefined, ttl: number) {
        if (!ts) return false;
        return Date.now() - ts < ttl;
    }

    async function loadFromDexie(
        ttl: number
    ): Promise<OpenRouterModel[] | null> {
        if (!canUseDexie()) return null;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const current = () => db === getDb() && generation === getWorkspaceGeneration();
        const requestOwner = latestCatalogRequest;
        const publication = catalogPublication;
        try {
            const rec = await kv.get(MODELS_CACHE_KEY, db);
            if (!current()) return null;
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
                if (!validated || Object.values(validated.origins).some(origin => origin.fetchedAt !== null && !isFresh(origin.fetchedAt, ttl))) return null;
                catalog.value = validated.data;
                lastLoadedAt.value = validated.fetchedAt ?? updatedAtMs;
                catalogOrigins = validated.origins;
                if (import.meta.dev)
                    console.debug(
                        '[models-cache] dexie hit — hydrated catalog from cache',
                        {
                            updatedAtMs,
                            count: validated.data.length,
                        }
                    );
                return validated.data;
            } catch (parseErr) {
                console.warn(
                    '[models-cache] JSON parse failed; deleting corrupt record',
                    parseErr
                );
                // best-effort cleanup
                try {
                    await kv.delete(MODELS_CACHE_KEY, db, { isValid: current });
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

    async function saveToDexie(list: OpenRouterModel[], origins: CatalogOrigins, db: Or3DB, isValid: () => boolean) {
        if (!canUseDexie()) return;
        try {
            await kv.set(MODELS_CACHE_KEY, JSON.stringify({ version: 1, data: list, fetchedAt: oldestFetch(list, origins), origins }), db, { isValid });
            if (import.meta.dev)
                console.debug('[models-cache] saved catalog to Dexie', {
                    count: list.length,
                });
        } catch (e) {
            if (!isCancelled(e)) console.warn('[models-cache] Dexie save failed', e);
        }
    }

    async function invalidate() {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const current = () => db === getDb() && generation === getWorkspaceGeneration();
        resetCatalog();
        recentModelIds.value = [];
        recentRevision++;
        if (!canUseDexie()) return;
        try {
            await kv.delete(MODELS_CACHE_KEY, db, { isValid: current });
            if (import.meta.dev)
                console.debug('[models-cache] Dexie record deleted');
        } catch (e) {
            if (!isCancelled(e)) console.warn('[models-cache] Dexie delete failed', e);
        }
    }

    async function fetchModels(opts?: { force?: boolean; ttlMs?: number }): Promise<OpenRouterModel[]> {
        const ttl = opts?.ttlMs ?? MODELS_TTL_MS;
        const db = getDb();
        const workspaceGeneration = getWorkspaceGeneration();
        const current = () => db === getDb() && workspaceGeneration === getWorkspaceGeneration();

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
            return catalog.value;
        }

        // Try Dexie if available and not forced
        if (!opts?.force) {
            const dexieHit = await loadFromDexie(ttl);
            if (!current()) return [];
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
            return current() ? fetchModels(opts) : [];
        }

        const fetchPromise = (async () => {
            const ownsRequest = () => current() && latestCatalogRequest === pending;
            if (import.meta.dev) {
                console.info('[models-cache] loading model catalog');
            }
            try {
                const origins: CatalogOrigins = {};
                const result = await modelsService.fetchModelCatalog({ ...opts, onPlatformStatus(platform, status, provenance) {
                    if (provenance) origins[platform] = { source: provenance.source, fetchedAt: provenance.fetchedAt };
                    queueMicrotask(() => {
                        if (ownsRequest())
                            platformStatus.value = { ...platformStatus.value, [platform]: status };
                    });
                } });
                if (!ownsRequest()) return catalog.value;
                const list = result.data;
                catalogPublication += 1;
                catalog.value = list;
                for (const model of list) origins[modelPlatform(model.id)] ??= { source: result.source, fetchedAt: result.fetchedAt };
                catalogOrigins = { ...origins };
                lastLoadedAt.value = oldestFetch(list, catalogOrigins) ?? undefined;
                if (import.meta.dev) {
                    console.info('[models-cache] catalog loaded', {
                        source: result.source, fetchedAt: result.fetchedAt,
                    });
                }
                // persist async (don't block response)
                if (!result.openAiPending && !result.openRouterPending) void saveToDexie(list, catalogOrigins, db, ownsRequest).catch(() => {});
                if (result.openAiPending || result.openRouterPending) remainingModelsInFlight = (result.openAiPending ?? result.openRouterPending)!.then(models => {
                    if (!ownsRequest()) return;
                    const merged = [...list, ...models];
                    catalogPublication += 1;
                    catalog.value = merged;
                    catalogOrigins = { ...origins };
                    lastLoadedAt.value = oldestFetch(merged, catalogOrigins) ?? undefined;
                    void saveToDexie(merged, catalogOrigins, db, ownsRequest).catch(() => {});
                });
                return list;
            } catch (err) {
                if (!ownsRequest()) return [];
                console.warn('[models-cache] network fetch failed', err);
                // On network failure, attempt to serve stale Dexie record (even if expired)
                // BUT: max stale age is 7 days to prevent serving extremely outdated data
                const MAX_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
                if (canUseDexie()) {
                    try {
                        const rec = await kv.get(MODELS_CACHE_KEY, db);
                        if (!ownsRequest()) return [];
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
                                    validated.data.length &&
                                    Object.values(validated.origins).every(origin => origin.fetchedAt === null || isFresh(origin.fetchedAt, MAX_STALE_AGE_MS))
                                ) {
                                    catalog.value = validated.data;
                                    lastLoadedAt.value =
                                        validated.fetchedAt ?? updatedAtMs;
                                    catalogOrigins = validated.origins;
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
                                    await kv.delete(MODELS_CACHE_KEY, db, { isValid: ownsRequest });
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
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const checkCanceled = () => {
            if (signal?.aborted || db !== getDb() || generation !== getWorkspaceGeneration())
                throw new DOMException('Model preparation canceled.', 'AbortError');
        };
        checkCanceled();
        const lookupId = openRouterCatalogLookupId(selectedModelId);
        const lookup = (): Extract<ContextModelReadiness, { ok: true }> | undefined => {
            const exact = [
                { model: catalog.value.find((model) => model.id === lookupId), fromCatalog: true },
                { model: favoriteModels.value.find((model) => model.id === lookupId), fromCatalog: false },
            ];
            const candidates = exact.some((candidate) => candidate.model) ? exact : [
                { model: catalog.value.find((model) => model.canonical_slug === lookupId), fromCatalog: true },
                { model: favoriteModels.value.find((model) => model.canonical_slug === lookupId), fromCatalog: false },
            ];
            for (const candidate of candidates) {
                if (!candidate.model || !admitChatContext({ model: candidate.model, inputTokens: 0 }).ok) continue;
                const model = candidate.model;
                const metadata = Object.freeze({ context_length: model.context_length,
                    architecture: model.architecture ? Object.freeze({
                        input_modalities: Object.freeze([...(model.architecture.input_modalities ?? [])]),
                        output_modalities: Object.freeze([...(model.architecture.output_modalities ?? [])]),
                        tokenizer: model.architecture.tokenizer,
                    }) : undefined,
                    top_provider: model.top_provider ? Object.freeze({ context_length: model.top_provider.context_length,
                        max_completion_tokens: model.top_provider.max_completion_tokens }) : undefined });
                return Object.freeze({ ok: true, selectedModelId, modelId: model.id,
                    ...(candidate.fromCatalog ? catalogOrigins[modelPlatform(model.id)] ?? cachedOrigin(model.id, null) : cachedOrigin(model.id, null)), metadata });
            }
        };
        let known = lookup();
        if (known) return known;
        try {
            // Workspace changes clear memory. A send must also restore saved
            // model metadata when the picker has not mounted again yet.
            await waitForCatalog(getFavoriteModels(), signal);
            checkCanceled(); known = lookup();
            if (known) return known;
            await waitForCatalog(fetchModels(), signal);
            checkCanceled(); known = lookup();
            if (known) return known;
            if (remainingModelsInFlight) await waitForCatalog(remainingModelsInFlight, signal);
            checkCanceled(); known = lookup();
            if (known) return known;
            await waitForCatalog(fetchModels({ force: true }), signal);
            checkCanceled(); known = lookup();
            if (known) return known;
            if (remainingModelsInFlight) await waitForCatalog(remainingModelsInFlight, signal);
        } catch {
            checkCanceled();
            // Failed refresh can still leave valid last-known metadata.
        }
        checkCanceled();
        return lookup() ?? { ok: false, code: 'model_metadata_unavailable' };
    }

    function persistFavorites(): Promise<void> {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const value = JSON.stringify(favoriteModels.value);
        favoriteRevision++;
        const current = () => db === getDb() && generation === getWorkspaceGeneration();
        const write = favoriteWrites.then(async () => {
            if (!current()) return;
            await kv.set('favorite_models', value, db, { isValid: current });
        });
        favoriteWrites = write.catch(error => { console.warn('[useModelStore] persist favorites failed', error); });
        return favoriteWrites;
    }

    async function addFavoriteModel(model: OpenRouterModel) {
        if (favoriteModels.value.some(entry => entry.id === model.id)) return;
        favoriteModels.value.push(model);
        await persistFavorites();
    }

    async function removeFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value = favoriteModels.value.filter(entry => entry.id !== model.id);
        await persistFavorites();
    }

    async function clearFavoriteModels() {
        favoriteModels.value = [];
        await persistFavorites();
    }

    async function getFavoriteModels() {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const revision = favoriteRevision;
        const current = () => db === getDb() && generation === getWorkspaceGeneration() && revision === favoriteRevision;
        try {
            await favoriteWrites;
            if (!current()) return favoriteModels.value;
            const record = await kv.get('favorite_models', db);
            if (!current()) return favoriteModels.value;
            const parsed: unknown = record?.value ? JSON.parse(record.value) : [];
            const validated = openRouterModelListSchema.safeParse(parsed);
            favoriteModels.value = validated.success ? validated.data : [];
        } catch {
            if (current()) favoriteModels.value = [];
        }
        return favoriteModels.value;
    }

    async function loadRecentModels() {
        const db = getDb(); const generation = getWorkspaceGeneration();
        const revision = recentRevision;
        const result = await getKvRecordByName('RECENT_MODELS', db);
        if (db !== getDb() || generation !== getWorkspaceGeneration() || revision !== recentRevision) return;
        try { const ids: unknown = JSON.parse(result.row?.value ?? '[]');
            recentModelIds.value = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 20) : [];
        } catch { recentModelIds.value = []; }
    }
    function recordRecentModel(id: string) {
        const db = getDb(); const generation = getWorkspaceGeneration();
        const isCurrent = () => db === getDb() && generation === getWorkspaceGeneration();
        recentWrites = recentWrites.catch(() => {}).then(async () => {
            if (!isCurrent()) return;
            // A send can happen before the catalog opens and hydrates recent choices.
            await loadRecentModels();
            if (!isCurrent()) return;
            recentRevision++;
            const route = openRouterCatalogLookupId(id);
            recentModelIds.value = [route, ...recentModelIds.value.filter(value => value !== route)].slice(0, 20);
            await setKvByName('RECENT_MODELS', JSON.stringify(recentModelIds.value), db, { isValid: isCurrent });
        });
        return recentWrites;
    }
    // Convenience wrapper to force network refresh
    async function refreshModels() {
        return fetchModels({ force: true });
    }

    /**
     * The picker publishes the first platform that answers. Callers that choose
     * or list models must also wait for the slower platform, or they would treat
     * a partial catalog as complete and substitute another model.
     */
    async function ensureCompleteCatalog(opts?: { ttlMs?: number }): Promise<OpenRouterModel[]> {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        if (!catalog.value.length) await fetchModels(opts);
        if (remainingModelsInFlight) await remainingModelsInFlight;
        return db === getDb() && generation === getWorkspaceGeneration() ? catalog.value : [];
    }

    return {
        favoriteModels,
        catalog,
        platformStatus,
        recentModelIds, loadRecentModels, recordRecentModel,
        searchQuery,
        filters,
        fetchModels,
        loadCachedModels: () => loadFromDexie(MODELS_TTL_MS),
        resolveContextModel,
        refreshModels,
        ensureCompleteCatalog,
        invalidate,
        getFavoriteModels,
        addFavoriteModel,
        removeFavoriteModel,
        clearFavoriteModels,
        lastLoadedAt,
    };
}
