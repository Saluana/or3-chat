import { parseModelPrice } from '~~/shared/ai/model-catalog';
/**
 * @module app/core/auth/models-service
 *
 * Purpose:
 * Fetches the OpenRouter model catalog, caches it in localStorage, and
 * provides the canonical model list used by search, selectors, and chat.
 *
 * Responsibilities:
 * - Fetch models from OpenRouter via the shared SDK client
 * - Cache the catalog in localStorage with configurable TTL (default 1 hour)
 * - Return cached data on network failure (resilient fallback)
 * - Normalize SDK model types to the local `OpenRouterModel` shape
 *
 * Non-responsibilities:
 * - Does not handle model search or indexing (see core/search/)
 * - Does not manage the API key lifecycle (see useUserApiKey / useOpenrouter)
 *
 * Constraints:
 * - Client-only (guards against SSR via `typeof window` checks)
 * - localStorage may be unavailable in private browsing; cache writes fail silently
 *
 * @see shared/openrouter/sdk-v1-compat for catalog pagination
 * @see core/search/useModelSearch for search indexing on top of this catalog
 */

import { hydrateUserApiKeyFromKv, useUserApiKey } from './useUserApiKey';
import { getCachedSessionPayload } from '~/composables/auth/useSessionContext';
import { fetchBrowserOpenRouterCatalog } from '~~/shared/openrouter/catalog';
import { normalizeSDKError } from '~~/shared/openrouter/errors';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import { OPENAI_MODEL_PREFIX } from '~~/shared/openai/models';
import { openAiKeyHeaders } from './useOpenAiKey';
import { isServerRouteAvailable } from '~/utils/chat/server-route';
import { useRuntimeConfig } from '#imports';
import { openRouterModelListSchema } from '~~/shared/openrouter/types';

// Re-export the type from shared location for consumers
export type { OpenRouterModel } from '~~/shared/openrouter/types';

/** Shape of the cached model catalog stored in localStorage. */
export interface ModelCatalogCache {
    data: OpenRouterModel[];
    fetchedAt: number;
}

export interface CatalogProvenance {
    /** Null means a legacy cache did not retain an actual fetch timestamp. */
    fetchedAt: number | null;
    source: 'openrouter-live' | 'openrouter-cache' | 'openai-live' | 'openai-cache';
}

export interface ModelCatalogResult extends CatalogProvenance {
    data: OpenRouterModel[];
    stale?: boolean;
    openRouterPending?: Promise<OpenRouterModel[]>;
    /** A second provider can finish independently of the available OpenRouter catalog. */
    openAiPending?: Promise<OpenRouterModel[]>;
}

export type PlatformCatalogStatus = 'loading' | 'ready' | 'stale' | 'unavailable' | 'disconnected';
export type CatalogOptions = { force?: boolean; ttlMs?: number; onPlatformStatus?: (platform: 'openai' | 'openrouter', status: PlatformCatalogStatus, provenance?: CatalogProvenance) => void };

const CACHE_KEY = 'openrouter_model_catalog_v1';

function saveCache(data: OpenRouterModel[], fetchedAt: number): void {
    try {
        if (typeof window === 'undefined') return;
        const payload: ModelCatalogCache = { data, fetchedAt };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
        // localStorage may fail in private browsing - ignore
    }
}

function loadCache(): Pick<ModelCatalogResult, 'data' | 'fetchedAt'> | null {
    try {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { data?: unknown; fetchedAt?: unknown };
        const validated = openRouterModelListSchema.safeParse(parsed.data);
        if (!validated.success) return null;
        return { data: validated.data, fetchedAt: typeof parsed.fetchedAt === 'number'
            && Number.isSafeInteger(parsed.fetchedAt) && parsed.fetchedAt > 0 ? parsed.fetchedAt : null };
    } catch {
        return null;
    }
}

/**
 * Purpose:
 * Fetches the full OpenRouter model catalog, using localStorage as a
 * read-through cache. Falls back to stale cache on network errors.
 *
 * Behavior:
 * 1. Check localStorage cache; return if fresh (within `ttlMs`).
 * 2. Call OpenRouter SDK `models.list()`.
 * 3. Persist result to localStorage and return.
 * 4. On error, return stale cache if available; otherwise throw.
 *
 * @param opts.force - Bypass cache and always fetch from network.
 * @param opts.ttlMs - Cache lifetime in ms (default 1 hour).
 *
 * @example
 * ```ts
 * const models = await fetchModels();
 * const fresh  = await fetchModels({ force: true });
 * ```
 */
export async function fetchModels(opts?: {
    force?: boolean;
    ttlMs?: number;
}): Promise<OpenRouterModel[]> {
    const result = await fetchModelCatalog(opts);
    return [...result.data, ...await (result.openAiPending ?? Promise.resolve([])), ...await (result.openRouterPending ?? Promise.resolve([]))];
}

/** Same catalog/cache path, with transport provenance for capacity preparation. */
export async function fetchModelCatalog(opts?: CatalogOptions): Promise<ModelCatalogResult> {
    const report = opts?.onPlatformStatus;
    report?.('openai', 'loading'); report?.('openrouter', 'loading');
    const openAi = fetchOpenAiModels().then(data => {
        const result = { data, source: 'openai-live' as const, fetchedAt: Date.now() };
        report?.('openai', data.length ? 'ready' : 'disconnected', result);
        return result;
    }, error => { report?.('openai', 'unavailable'); throw error; });
    const openRouter = fetchOpenRouterModelCatalog(opts).then(result => {
        report?.('openrouter', result.stale ? 'stale' : result.data.length ? 'ready' : 'disconnected', result); return result;
    }, error => { report?.('openrouter', 'unavailable'); throw error; });
    // Publish the first usable platform immediately; the slower one cannot hold it hostage.
    const usable = <T extends ModelCatalogResult>(pending: Promise<T>) => pending.then(result => {
        if (!result.data.length) throw new Error('No models available.');
        return result;
    });
    const first = await Promise.any([usable(openRouter), usable(openAi)]).catch(() => openRouter);
    return first.source === 'openai-live'
        ? { ...first, openRouterPending: openRouter.then(result => result.data, () => []) }
        : { ...first, openAiPending: openAi.then(result => result.data, () => []) };
}

/** Models for a configured OpenAI key; no key or no server is disconnected, failures are reported. */
async function fetchOpenAiModels(): Promise<OpenRouterModel[]> {
    // OpenAI chat runs only through the OR3 server. Local deployments can use only
    // this device's key; Cloud may hold a personal or an instance key for the account.
    const deviceKey = await openAiKeyHeaders(OPENAI_MODEL_PREFIX);
    if (useRuntimeConfig().public.ssrAuthEnabled === true
        ? getCachedSessionPayload()?.session?.authenticated === false
        : !deviceKey['x-or3-openai-key'] || !isServerRouteAvailable()) return [];
    const response = await fetch('/api/openai/models', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            signal: AbortSignal.timeout(20_000),
            headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', ...deviceKey }, body: '{}' });
    if (!response.ok) throw new Error('OpenAI models unavailable.');
    return openRouterModelListSchema.parse(await response.json());
}

async function fetchOpenRouterModelCatalog(opts?: {
    force?: boolean;
    ttlMs?: number;
}): Promise<ModelCatalogResult> {
    const ttlMs = opts?.ttlMs ?? 1000 * 60 * 60; // 1 hour
    if (!opts?.force) {
        const cached = loadCache();
        if (
            cached &&
            cached.fetchedAt !== null &&
            Date.now() - cached.fetchedAt <= ttlMs &&
            cached.data.length
        ) {
            return { ...cached, source: 'openrouter-cache' };
        }
    }

    const { apiKey } = useUserApiKey();
    const runtimeConfig = useRuntimeConfig() as {
        public?: { ssrAuthEnabled?: boolean; openRouter?: { baseUrl?: string } };
    };
    await hydrateUserApiKeyFromKv();
    const key = apiKey.value;
    try {
        if (runtimeConfig.public?.ssrAuthEnabled === true) {
            // The Cloud route needs an account. A loaded signed-out session keeps the cache.
            const payload = getCachedSessionPayload();
            if (payload && payload.session?.authenticated !== true)
                return { ...(loadCache() ?? { data: [], fetchedAt: null }), source: 'openrouter-cache' };
            const response = await fetch('/api/openrouter/models', { signal: AbortSignal.timeout(20_000), method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: '{}' });
            if (!response.ok) throw new Error('OpenRouter model catalog unavailable.');
            const data = openRouterModelListSchema.parse(await response.json());
            const fetchedAt = Date.now(); saveCache(data, fetchedAt);
            return { data, fetchedAt, source: 'openrouter-live' };
        }
        const models = await fetchBrowserOpenRouterCatalog(key ?? '', runtimeConfig.public?.openRouter?.baseUrl);

        const fetchedAt = Date.now();
        saveCache(models, fetchedAt);
        return { data: models, fetchedAt, source: 'openrouter-live' };
    } catch (error) {
        // Fallback to cache on any error
        const cached = loadCache();
        if (cached?.data.length) return { ...cached, source: 'openrouter-cache', stale: true };

        const normalized = normalizeSDKError(error);
        const { raw: _raw, ...metadata } = normalized;
        throw Object.assign(new Error(normalized.message, { cause: error }), metadata);
    }
}

/**
 * Purpose:
 * Substring match filter over the model catalog.
 *
 * Behavior:
 * Matches against `id`, `name`, and `description` (case-insensitive).
 *
 * Constraints:
 * - Pure function; does not mutate inputs
 * - Intended for quick fallback search or client-side filtering
 */
export function filterByText(
    models: OpenRouterModel[],
    q: string
): OpenRouterModel[] {
    const query = q.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => {
        const hay = `${m.id}\n${m.name || ''}\n${
            m.description || ''
        }`.toLowerCase();
        return hay.includes(query);
    });
}

/**
 * Purpose:
 * Filter models by declared input and output modalities.
 *
 * Behavior:
 * - If `opts.input` is provided, all requested modalities must be present in
 *   `architecture.input_modalities`
 * - If `opts.output` is provided, all requested modalities must be present in
 *   `architecture.output_modalities`
 */
export function filterByModalities(
    models: OpenRouterModel[],
    opts: { input?: string[]; output?: string[] } = {}
): OpenRouterModel[] {
    const { input, output } = opts;
    if (!input && !output) return models;
    return models.filter((m) => {
        const inOk =
            !input ||
            input.every((i) => m.architecture?.input_modalities?.includes(i));
        const outOk =
            !output ||
            output.every((o) => m.architecture?.output_modalities?.includes(o));
        return inOk && outOk;
    });
}

/**
 * Purpose:
 * Filter models by minimum context length.
 */
export function filterByContextLength(
    models: OpenRouterModel[],
    minCtx: number
): OpenRouterModel[] {
    if (!minCtx) return models;
    return models.filter((m) => {
        const ctx = m.top_provider?.context_length ?? m.context_length ?? 0;
        return (ctx || 0) >= minCtx;
    });
}

/**
 * Purpose:
 * Filter models by supported OpenAI-compatible parameters.
 *
 * Behavior:
 * Requires every requested parameter to exist in `supported_parameters`.
 */
export function filterByParameters(
    models: OpenRouterModel[],
    params: string[]
): OpenRouterModel[] {
    if (!params.length) return models;
    return models.filter((m) => {
        const supported = m.supported_parameters || [];
        return params.every((p) => supported.includes(p));
    });
}

/**
 * Purpose:
 * Coarse price heuristic bucket for UI filtering.
 *
 * Constraints:
 * - Buckets are not authoritative pricing tiers
 * - Boundaries are intentionally heuristic and may change
 */
export type PriceBucket = 'free' | 'low' | 'medium' | 'any';

/**
 * Purpose:
 * Filter models into a coarse price bucket.
 *
 * Behavior:
 * Uses the maximum of prompt and completion price as the effective price.
 */
export function filterByPriceBucket(
    models: OpenRouterModel[],
    bucket: PriceBucket
): OpenRouterModel[] {
    if (bucket === 'any') return models;
    return models.filter((m) => {
        const p = parseModelPrice(m.pricing?.prompt);
        const c = parseModelPrice(m.pricing?.completion);
        if (p === null || c === null) return false;
        const max = Math.max(p, c);
        if (bucket === 'free') return max === 0;
        if (bucket === 'low') return max > 0 && max <= 0.000002; // heuristic
        // bucket === 'medium'
        return max > 0.000002 && max <= 0.00001;
    });
}

/**
 * Purpose:
 * Convenience namespace export for the model catalog service.
 *
 * Constraints:
 * - Prefer importing specific functions for tree-shaking in leaf modules
 */
export const modelsService = {
    fetchModels,
    fetchModelCatalog,
    filterByText,
    filterByModalities,
    filterByContextLength,
    filterByParameters,
    filterByPriceBucket,
};

export default modelsService;

// --- Default model resolution (fixed vs last-selected with fallback) ---
/**
 * Purpose:
 * Minimal AI settings needed to resolve the default model.
 */
export interface AiSettingsForModel {
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null;
}

/**
 * Purpose:
 * Dependency injection surface for default model resolution.
 *
 * Constraints:
 * - `recommendedDefault()` must return an available model ID
 */
export interface ModelResolverDeps {
    isAvailable: (id: string) => boolean;
    lastSelectedModelId: () => string | null;
    recommendedDefault: () => string;
}

/**
 * Purpose:
 * Resolve which model ID should be used by default.
 *
 * Behavior:
 * - If settings are fixed and the fixed model is available, returns it
 * - Else, uses last selected model if available
 * - Else, falls back to the provided recommended default
 */
export function resolveDefaultModel(
    set: AiSettingsForModel,
    d: ModelResolverDeps
): { id: string; reason: 'fixed' | 'lastSelected' | 'recommended' } {
    if (
        set.defaultModelMode === 'fixed' &&
        set.fixedModelId &&
        d.isAvailable(set.fixedModelId)
    ) {
        return { id: set.fixedModelId, reason: 'fixed' };
    }
    const last = d.lastSelectedModelId();
    if (last && d.isAvailable(last))
        return { id: last, reason: 'lastSelected' };
    return { id: d.recommendedDefault(), reason: 'recommended' };
}
