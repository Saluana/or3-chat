// ModelsService: Fetch OpenRouter models, cache, and provide simple filters
// Uses OpenRouter SDK for API calls
// Usage: import { modelsService } from "~/utils/models-service";

import { createOpenRouterClient, getRequestOptions } from '../../../shared/openrouter/client';
import { normalizeSDKError } from '../../../shared/openrouter/errors';
import { sdkModelToLocal } from '../../../shared/openrouter/types';

export interface OpenRouterModel {
    id: string; // e.g. "deepseek/deepseek-r1-0528:free"
    name: string;
    description?: string;
    created?: number;
    architecture?: {
        input_modalities?: string[];
        output_modalities?: string[];
        tokenizer?: string;
        instruct_type?: string;
    };
    top_provider?: {
        is_moderated?: boolean;
        context_length?: number;
        max_completion_tokens?: number;
    };
    pricing?: {
        prompt?: string; // USD per input token (stringified number)
        completion?: string; // USD per output token
        image?: string;
        request?: string;
        web_search?: string;
        internal_reasoning?: string;
        input_cache_read?: string;
        input_cache_write?: string;
    };
    canonical_slug?: string;
    context_length?: number;
    hugging_face_id?: string;
    per_request_limits?: Record<string, unknown>;
    supported_parameters?: string[]; // e.g. ["temperature","top_p","reasoning"]
}

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
    const client = createOpenRouterClient({ apiKey: key ?? '' });

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

// Filters
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

export type PriceBucket = 'free' | 'low' | 'medium' | 'any';

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
export interface AiSettingsForModel {
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null;
}

export interface ModelResolverDeps {
    isAvailable: (id: string) => boolean;
    lastSelectedModelId: () => string | null;
    recommendedDefault: () => string;
}

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
