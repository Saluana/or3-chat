import type { OpenRouterModel } from '~/core/auth/models-service';

/**
 * Pure helpers powering the model catalog UI.
 *
 * Everything here is framework-free so it can be unit tested and reused by
 * both the catalog modal and any future surfaces (model pickers, dashboards).
 */

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface ProviderInfo {
    /** OpenRouter id prefix, e.g. "anthropic" (from `anthropic/claude-3.5`). */
    slug: string;
    /** Human readable company name, e.g. "Anthropic". */
    name: string;
    /** simple-icons glyph name (without collection prefix) when available. */
    icon?: string;
    /**
     * Brand color used for the glyph / monogram tile.
     * `null` means the brand is monochrome and should follow theme text color
     * (keeps black logos visible in dark mode).
     */
    color: string | null;
    /** Short monogram used on the fallback tile (defaults to first letter). */
    monogram?: string;
}

/**
 * Registry of well known OpenRouter provider prefixes.
 * Unknown slugs fall back to a prettified name + hashed-hue monogram tile.
 */
const PROVIDER_REGISTRY: Record<string, ProviderInfo> = {
    openai: { slug: 'openai', name: 'OpenAI', icon: 'openai', color: null },
    anthropic: {
        slug: 'anthropic',
        name: 'Anthropic',
        icon: 'anthropic',
        color: '#D97757',
    },
    google: {
        slug: 'google',
        name: 'Google',
        icon: 'googlegemini',
        color: '#4285F4',
    },
    'x-ai': {
        slug: 'x-ai',
        name: 'xAI',
        icon: undefined,
        color: null,
        monogram: 'xAI',
    },
    'meta-llama': {
        slug: 'meta-llama',
        name: 'Meta',
        icon: 'meta',
        color: '#0082FB',
    },
    mistralai: {
        slug: 'mistralai',
        name: 'Mistral AI',
        icon: 'mistralai',
        color: '#FF7000',
    },
    cohere: {
        slug: 'cohere',
        name: 'Cohere',
        icon: undefined,
        color: '#39594D',
        monogram: 'C',
    },
    perplexity: {
        slug: 'perplexity',
        name: 'Perplexity',
        icon: 'perplexity',
        color: '#20B8CD',
    },
    deepseek: {
        slug: 'deepseek',
        name: 'DeepSeek',
        icon: 'deepseek',
        color: '#4D6BFE',
    },
    qwen: { slug: 'qwen', name: 'Qwen', icon: 'qwen', color: '#615CED' },
    alibaba: {
        slug: 'alibaba',
        name: 'Alibaba',
        icon: 'alibabacloud',
        color: '#FF6A00',
    },
    microsoft: {
        slug: 'microsoft',
        name: 'Microsoft',
        icon: 'microsoft',
        color: null,
    },
    nvidia: { slug: 'nvidia', name: 'NVIDIA', icon: 'nvidia', color: '#76B900' },
    amazon: {
        slug: 'amazon',
        name: 'Amazon',
        icon: 'amazonwebservices',
        color: '#FF9900',
    },
    openrouter: {
        slug: 'openrouter',
        name: 'OpenRouter',
        icon: 'openrouter',
        color: null,
    },
    huggingface: {
        slug: 'huggingface',
        name: 'Hugging Face',
        icon: 'huggingface',
        color: '#FF9D00',
    },
    ibm: { slug: 'ibm', name: 'IBM', icon: 'ibm', color: '#0F62FE' },
    databricks: {
        slug: 'databricks',
        name: 'Databricks',
        icon: 'databricks',
        color: '#FF3621',
    },
    snowflake: {
        slug: 'snowflake',
        name: 'Snowflake',
        icon: 'snowflake',
        color: '#29B5E8',
    },
    bytedance: {
        slug: 'bytedance',
        name: 'ByteDance',
        icon: 'bytedance',
        color: '#325AB4',
    },
    baidu: { slug: 'baidu', name: 'Baidu', icon: 'baidu', color: '#2932E1' },
    minimax: {
        slug: 'minimax',
        name: 'MiniMax',
        icon: 'minimax',
        color: null,
    },
    moonshotai: {
        slug: 'moonshotai',
        name: 'Moonshot AI',
        icon: undefined,
        color: null,
        monogram: 'K',
    },
    'z-ai': {
        slug: 'z-ai',
        name: 'Z.ai',
        icon: undefined,
        color: null,
        monogram: 'Z',
    },
    ai21: {
        slug: 'ai21',
        name: 'AI21 Labs',
        icon: undefined,
        color: null,
        monogram: 'A21',
    },
    liquid: {
        slug: 'liquid',
        name: 'Liquid AI',
        icon: undefined,
        color: null,
        monogram: 'L',
    },
    nousresearch: {
        slug: 'nousresearch',
        name: 'Nous Research',
        icon: undefined,
        color: null,
        monogram: 'N',
    },
    '01-ai': {
        slug: '01-ai',
        name: '01.AI',
        icon: undefined,
        color: null,
        monogram: '01',
    },
    inflection: {
        slug: 'inflection',
        name: 'Inflection',
        icon: undefined,
        color: '#5B3DF5',
        monogram: 'Pi',
    },
    reka: {
        slug: 'reka',
        name: 'Reka AI',
        icon: undefined,
        color: null,
        monogram: 'R',
    },
    thudm: {
        slug: 'thudm',
        name: 'Zhipu AI',
        icon: undefined,
        color: '#3B5BFD',
        monogram: 'GLM',
    },
    allenai: {
        slug: 'allenai',
        name: 'Allen AI',
        icon: undefined,
        color: '#F05237',
        monogram: 'AI2',
    },
    inception: {
        slug: 'inception',
        name: 'Inception',
        icon: undefined,
        color: null,
        monogram: 'In',
    },
    arcee: {
        slug: 'arcee-ai',
        name: 'Arcee AI',
        icon: undefined,
        color: null,
        monogram: 'A',
    },
};

/** Extract the provider prefix from a model id (`anthropic/claude-3.5` → `anthropic`). */
export function getProviderSlug(model: Pick<OpenRouterModel, 'id'>): string {
    const id = model.id || '';
    const idx = id.indexOf('/');
    return (idx === -1 ? id : id.slice(0, idx)).toLowerCase();
}

function prettifySlug(slug: string): string {
    return slug
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/** Resolve display info for any provider slug (registry hit or graceful fallback). */
export function getProviderInfo(slug: string): ProviderInfo {
    const hit = PROVIDER_REGISTRY[slug];
    if (hit) return hit;
    return {
        slug,
        name: prettifySlug(slug) || 'Unknown',
        icon: undefined,
        color: null,
        monogram: (slug.charAt(0) || '?').toUpperCase(),
    };
}

export function getModelProvider(model: Pick<OpenRouterModel, 'id'>): ProviderInfo {
    return getProviderInfo(getProviderSlug(model));
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface ModelCapabilities {
    /** Accepts image input. */
    vision: boolean;
    /** Non-text input or output beyond images (audio, video, file...). */
    multimodal: boolean;
    /** Produces image output. */
    imageOutput: boolean;
    /** Embedding model. */
    embedding: boolean;
    /** Function / tool calling. */
    tools: boolean;
    /** JSON / structured output support. */
    json: boolean;
    /** Reasoning effort support. */
    reasoning: boolean;
    /** Context window >= 128k tokens. */
    longContext: boolean;
    /** Both prompt and completion pricing are zero. */
    free: boolean;
    /** Cheap enough for high-volume use (<= $0.30 / 1M combined). */
    costEffective: boolean;
    /** Known open-weights family (llama, qwen, deepseek, ...). */
    openWeights: boolean;
    /** Released within the last ~45 days. */
    isNew: boolean;
    /** Upstream moderation enabled. */
    moderated: boolean;
}

const OPEN_WEIGHTS_RE =
    /llama|qwen|deepseek|gemma|mistral|mixtral|phi-|glm|kimi|gpt-oss|yi-|granite|minimax|olmo|dbrx|command-r|nova-lite|nova-micro|nova-pro|hermes|dolphin|nous|solar|exaone|mamba|falcon|stable-|openchat|wizardlm|vicuna|orca|mytho|toppy|l3\.|goliath|magnum|rocinante|midnight|sao10k|lumimaid|agnai|eva-|blossom|wayfarer|magnum|starcoder|codestral|devstral/i;

export function getContextLength(m: OpenRouterModel): number {
    return m.top_provider?.context_length ?? m.context_length ?? 0;
}

export function getInputPrice(m: OpenRouterModel): number {
    return Number(m.pricing?.prompt ?? 0) || 0;
}

export function getOutputPrice(m: OpenRouterModel): number {
    return Number(m.pricing?.completion ?? 0) || 0;
}

export function getCapabilities(m: OpenRouterModel): ModelCapabilities {
    const inputMods = m.architecture?.input_modalities ?? ['text'];
    const outputMods = m.architecture?.output_modalities ?? ['text'];
    const params = m.supported_parameters ?? [];
    const hasPricing =
        m.pricing != null &&
        (m.pricing.prompt != null || m.pricing.completion != null);
    const promptPrice = getInputPrice(m);
    const completionPrice = getOutputPrice(m);
    const ctx = getContextLength(m);

    const nonTextMods = [...inputMods, ...outputMods].filter((x) => x !== 'text');
    const idAndName = `${m.id} ${m.name ?? ''}`;

    const embedding =
        outputMods.includes('embeddings') ||
        inputMods.includes('embeddings') ||
        /\bembed/i.test(m.id);

    const createdMs = (m.created ?? 0) * 1000;
    const isNew =
        createdMs > 0 && Date.now() - createdMs < 45 * 24 * 60 * 60 * 1000;

    return {
        vision: inputMods.includes('image'),
        multimodal: nonTextMods.length > 0,
        imageOutput: outputMods.includes('image'),
        embedding,
        tools: params.includes('tools'),
        json:
            params.includes('response_format') ||
            params.includes('structured_outputs'),
        reasoning:
            !!m.reasoning ||
            params.includes('reasoning') ||
            params.includes('include_reasoning'),
        longContext: ctx >= 128_000,
        free: hasPricing && promptPrice === 0 && completionPrice === 0,
        costEffective:
            hasPricing &&
            promptPrice + completionPrice > 0 &&
            (promptPrice + completionPrice) * 1_000_000 <= 0.3,
        openWeights: OPEN_WEIGHTS_RE.test(idAndName),
        isNew,
        moderated: !!m.top_provider?.is_moderated,
    };
}

// ---------------------------------------------------------------------------
// Badges & "best for" tags
// ---------------------------------------------------------------------------

export interface ModelBadge {
    label: string;
    /** Visual tone mapped to a Nuxt UI badge color. */
    tone: 'primary' | 'success' | 'info' | 'warning' | 'neutral';
}

/**
 * Derive at most `max` salient badges for a model, ordered by importance.
 * Shown on catalog rows ("Long context", "Free", ...).
 */
export function getModelBadges(m: OpenRouterModel, max = 2): ModelBadge[] {
    const caps = getCapabilities(m);
    const badges: ModelBadge[] = [];

    if (caps.free) badges.push({ label: 'Free', tone: 'success' });
    if (caps.isNew) badges.push({ label: 'New', tone: 'primary' });
    if (caps.reasoning) badges.push({ label: 'Reasoning', tone: 'primary' });
    if (caps.longContext) badges.push({ label: 'Long context', tone: 'info' });
    if (caps.costEffective)
        badges.push({ label: 'Cost effective', tone: 'success' });
    if (caps.openWeights) badges.push({ label: 'Open weights', tone: 'info' });
    if (caps.vision && !caps.imageOutput)
        badges.push({ label: 'Vision', tone: 'neutral' });
    if (caps.imageOutput) badges.push({ label: 'Image gen', tone: 'neutral' });

    return badges.slice(0, Math.max(1, max));
}

/** "Best for" tags shown in the detail panel (derived from capabilities). */
export function getBestForTags(m: OpenRouterModel): string[] {
    const caps = getCapabilities(m);
    const tags: string[] = [];

    if (caps.reasoning) tags.push('Complex reasoning');
    if (caps.tools) tags.push('Agents & tools');
    if (caps.vision) tags.push('Image analysis');
    if (caps.longContext) tags.push('Long documents');
    if (caps.json) tags.push('Structured output');
    if (caps.embedding) tags.push('Semantic search');
    if (caps.imageOutput) tags.push('Image generation');
    if (caps.free || caps.costEffective) tags.push('High volume');
    if (tags.length === 0) tags.push('Everyday chat');

    return tags.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------

export type CatalogScope = 'all' | 'favorites';

export type CapabilityFilter =
    | 'all'
    | 'text'
    | 'vision'
    | 'tools'
    | 'reasoning'
    | 'free'
    | 'embedding'
    | 'long-context'
    | 'image-output'
    | 'json';

export type CatalogSort =
    | 'recommended'
    | 'name'
    | 'price-asc'
    | 'price-desc'
    | 'context-desc'
    | 'newest';

export function matchesCapability(
    m: OpenRouterModel,
    filter: CapabilityFilter
): boolean {
    if (filter === 'all') return true;
    const caps = getCapabilities(m);
    switch (filter) {
        case 'text':
            return !caps.multimodal && !caps.embedding;
        case 'vision':
            return caps.vision;
        case 'tools':
            return caps.tools;
        case 'reasoning':
            return caps.reasoning;
        case 'free':
            return caps.free;
        case 'embedding':
            return caps.embedding;
        case 'long-context':
            return caps.longContext;
        case 'image-output':
            return caps.imageOutput;
        case 'json':
            return caps.json;
        default:
            return true;
    }
}

export function sortModels(
    models: OpenRouterModel[],
    sort: CatalogSort
): OpenRouterModel[] {
    if (sort === 'recommended') return models;
    const copy = models.slice();
    switch (sort) {
        case 'name':
            copy.sort((a, b) =>
                (a.name || a.id).localeCompare(b.name || b.id)
            );
            break;
        case 'price-asc':
            copy.sort(
                (a, b) =>
                    getInputPrice(a) +
                    getOutputPrice(a) -
                    (getInputPrice(b) + getOutputPrice(b))
            );
            break;
        case 'price-desc':
            copy.sort(
                (a, b) =>
                    getInputPrice(b) +
                    getOutputPrice(b) -
                    (getInputPrice(a) + getOutputPrice(a))
            );
            break;
        case 'context-desc':
            copy.sort((a, b) => getContextLength(b) - getContextLength(a));
            break;
        case 'newest':
            copy.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
            break;
    }
    return copy;
}

export interface ProviderCount {
    slug: string;
    info: ProviderInfo;
    count: number;
}

/** Sidebar category row with pre-computed count. */
export interface CatalogCategoryEntry {
    key: CapabilityFilter;
    label: string;
    icon: string;
    count: number;
}

/** Count models per provider, sorted descending by count then name. */
export function countByProvider(models: OpenRouterModel[]): ProviderCount[] {
    const map = new Map<string, number>();
    for (const m of models) {
        const slug = getProviderSlug(m);
        map.set(slug, (map.get(slug) ?? 0) + 1);
    }
    return [...map.entries()]
        .map(([slug, count]) => ({ slug, info: getProviderInfo(slug), count }))
        .sort((a, b) => b.count - a.count || a.info.name.localeCompare(b.info.name));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a per-token price into a "per 1M tokens" currency string.
 * Accepts numbers or numeric strings. Defaults to USD.
 */
export function formatPerMillion(raw: unknown, currency = 'USD'): string {
    const perToken = Number(raw ?? 0) || 0;
    const perMillion = perToken * 1_000_000;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(perMillion);
    } catch {
        return `$${perMillion.toFixed(2)}`;
    }
}

/** 200000 → "200K", 1000000 → "1M", 32768 → "32.8K". */
export function formatTokenCount(n: number): string {
    if (!n || n <= 0) return '—';
    if (n >= 1_000_000) {
        const v = n / 1_000_000;
        return `${Number.isInteger(v) ? v : v.toFixed(1)}M`;
    }
    if (n >= 1_000) {
        const v = n / 1_000;
        return `${Number.isInteger(v) ? v : v.toFixed(1)}K`;
    }
    return `${n}`;
}

/** "text+image → text" style modality summary. */
export function formatModalities(m: OpenRouterModel): string {
    const input = (m.architecture?.input_modalities ?? ['text']).join(' + ');
    const output = (m.architecture?.output_modalities ?? ['text']).join(' + ');
    return `${capitalize(input)} → ${capitalize(output)}`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Unix seconds → "Apr 2024" (model release date). */
export function formatReleaseDate(created?: number): string | null {
    if (!created) return null;
    const d = new Date(created * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
