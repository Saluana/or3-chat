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
 * @see shared/openrouter/client for SDK client factory
 * @see core/search/useModelSearch for search indexing on top of this catalog
 */

import {
    createOpenRouterClient,
    getRequestOptions,
} from '~~/shared/openrouter/client';
import { useRuntimeConfig } from '#imports';
import { normalizeSDKError } from '~~/shared/openrouter/errors';
import {
    sdkModelToLocal,
    type OpenRouterModel,
} from '~~/shared/openrouter/types';

// Re-export the type from shared location for consumers
export type { OpenRouterModel } from '~~/shared/openrouter/types';

/** Shape of the cached model catalog stored in localStorage. */
export interface ModelCatalogCache {
    data: OpenRouterModel[];
    fetchedAt: number;
}

const CACHE_KEY = 'openrouter_model_catalog_v1';

function readApiKey(): string | null {
    try {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('openrouter_api_key');
    } catch {
        return null;
    }
}

function saveCache(data: OpenRouterModel[]): void {
    try {
        if (typeof window === 'undefined') return;
        const payload: ModelCatalogCache = { data, fetchedAt: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
        // localStorage may fail in private browsing - ignore
    }
}

function loadCache(): ModelCatalogCache | null {
    try {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ModelCatalogCache;
        if (!Array.isArray(parsed.data)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function toNumber(x?: string | number | null): number | null {
    if (x === undefined || x === null) return null;
    const n = typeof x === 'string' ? Number(x) : x;
    return Number.isFinite(n) ? n : null;
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
    const ttlMs = opts?.ttlMs ?? 1000 * 60 * 60; // 1 hour
    if (!opts?.force) {
        const cached = loadCache();
        if (
            cached &&
            Date.now() - cached.fetchedAt <= ttlMs &&
            cached.data.length
        ) {
            return cached.data;
        }
    }

    const key = readApiKey();
    const runtimeConfig = useRuntimeConfig() as {
        public?: { openRouter?: { baseUrl?: string } };
    };
    const client = createOpenRouterClient({
        apiKey: key ?? '',
        serverURL: runtimeConfig.public?.openRouter?.baseUrl,
    });

    try {
        const response = await client.models.list({}, getRequestOptions());
        // SDK returns ModelsListResponse with .data array
        const sdkModels = response.data;

        // Map SDK model type to our OpenRouterModel interface
        const models: OpenRouterModel[] = sdkModels.map(sdkModelToLocal);

        saveCache(models);
        return models;
    } catch (error) {
        // Fallback to cache on any error
        const cached = loadCache();
        if (cached?.data.length) return cached.data;

        const normalized = normalizeSDKError(error);
        throw new Error(`Failed to fetch models: ${normalized.message}`);
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
        const p = toNumber(m.pricing?.prompt) ?? 0;
        const c = toNumber(m.pricing?.completion) ?? 0;
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
