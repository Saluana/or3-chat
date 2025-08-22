// ModelsService: Fetch OpenRouter models, cache, and provide simple filters
// Source: https://openrouter.ai/api/v1/models
// Usage: import { modelsService } from "~/utils/models-service";

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

interface ModelsResponse {
    data: OpenRouterModel[];
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
    } catch {}
}

function loadCache(): ModelCatalogCache | null {
    try {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ModelCatalogCache;
        if (!Array.isArray(parsed?.data)) return null;
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

    const url = 'https://openrouter.ai/api/v1/models';
    const key = readApiKey();
    const headers: Record<string, string> = {};
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
        // Fallback to any cache on failure
        const cached = loadCache();
        if (cached?.data?.length) return cached.data;
        throw new Error(
            `Failed to fetch models: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as ModelsResponse;
    const list = Array.isArray(json?.data) ? json.data : [];
    saveCache(list);
    return list;
}

// Filters
export function filterByText(
    models: OpenRouterModel[],
    q: string
): OpenRouterModel[] {
    const query = q?.trim().toLowerCase();
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
    if (!params?.length) return models;
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
    if (!bucket || bucket === 'any') return models;
    return models.filter((m) => {
        const p = toNumber(m.pricing?.prompt) ?? 0;
        const c = toNumber(m.pricing?.completion) ?? 0;
        const max = Math.max(p, c);
        if (bucket === 'free') return max === 0;
        if (bucket === 'low') return max > 0 && max <= 0.000002; // heuristic
        if (bucket === 'medium') return max > 0.000002 && max <= 0.00001;
        return true;
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
