# Model Catalog

Pure, framework-free helpers that power the model catalog UI. Derive provider info, capabilities, badges, filters, and formatted labels from OpenRouter model records.

Model catalog helpers turn raw `OpenRouterModel` data into what the UI actually shows: provider logos, capability badges, "best for" tags, price strings, and token counts. They are pure functions, so they are easy to unit test and safe to reuse outside the catalog modal.

---

## Purpose

`modelCatalog` provides:

- **Provider resolution** — Slug extraction, display info, and graceful fallbacks
- **Capability derivation** — Vision, tools, reasoning, JSON, free, and more
- **Badges and tags** — Short labels for rows and detail panels
- **Filtering and sorting** — Catalog scopes, capability filters, sort orders
- **Formatting** — Prices, token counts, modalities, release dates

All functions take `OpenRouterModel` from `~/core/auth/models-service`.

---

## Provider helpers

### `getProviderSlug(model)`

Extract the provider prefix from a model id. `anthropic/claude-3.5` becomes
`anthropic`. Unknown shapes return the whole id lowercased.

```ts
function getProviderSlug(model: Pick<OpenRouterModel, 'id'>): string
```

### `getProviderInfo(slug)`

Resolve display info for a provider slug.

```ts
function getProviderInfo(slug: string): ProviderInfo
```

Known slugs hit a built-in registry with name, icon, brand color, and
monogram. Unknown slugs fall back to a prettified name, no icon, and a
single-letter monogram.

```ts
interface ProviderInfo {
    slug: string;            // e.g. 'anthropic'
    name: string;            // e.g. 'Anthropic'
    icon?: string;           // simple-icons glyph name
    color: string | null;    // brand color, or null for monochrome
    monogram?: string;       // fallback tile letter
}
```

### `getModelProvider(model)`

Shorthand for `getProviderInfo(getProviderSlug(model))`.

```ts
function getModelProvider(model: Pick<OpenRouterModel, 'id'>): ProviderInfo
```

---

## Capabilities

### `getCapabilities(m)`

Derive a capability summary from a model record.

```ts
function getCapabilities(m: OpenRouterModel): ModelCapabilities
```

```ts
interface ModelCapabilities {
    vision: boolean;         // accepts image input
    multimodal: boolean;     // non-text input or output beyond images
    imageOutput: boolean;    // produces image output
    embedding: boolean;      // embedding model
    tools: boolean;          // function calling
    json: boolean;           // structured output
    reasoning: boolean;      // reasoning support
    longContext: boolean;    // context window >= 128k tokens
    free: boolean;           // zero prompt and completion pricing
    costEffective: boolean;  // <= $0.30 per 1M combined tokens
    openWeights: boolean;    // known open-weights family
    isNew: boolean;          // released within ~45 days
    moderated: boolean;      // upstream moderation enabled
}
```

### Number accessors

```ts
function getContextLength(m: OpenRouterModel): number;
function getInputPrice(m: OpenRouterModel): number;
function getOutputPrice(m: OpenRouterModel): number;
```

Each returns 0 when the source field is missing.

---

## Badges and tags

### `getModelBadges(m, max?)`

Derive up to `max` salient badges (default 2), ordered by importance.

```ts
function getModelBadges(m: OpenRouterModel, max?: number): ModelBadge[]
```

Candidates include `Free`, `New`, `Reasoning`, `Long context`, `Cost
effective`, `Open weights`, `Vision`, and `Image gen`.

```ts
interface ModelBadge {
    label: string;
    tone: 'primary' | 'success' | 'info' | 'warning' | 'neutral';
}
```

### `getBestForTags(m)`

"Best for" tags shown in the detail panel, derived from capabilities.
Examples: `Complex reasoning`, `Agents & tools`, `Long documents`, `Structured
output`. Falls back to `Everyday chat`. Returns at most 5.

```ts
function getBestForTags(m: OpenRouterModel): string[]
```

---

## Filtering and sorting

### Types

```ts
type CatalogScope = 'all' | 'favorites';

type CapabilityFilter =
    | 'all' | 'text' | 'vision' | 'tools' | 'reasoning'
    | 'free' | 'embedding' | 'long-context' | 'image-output' | 'json';

type CatalogSort =
    | 'recommended' | 'name' | 'price-asc' | 'price-desc'
    | 'context-desc' | 'newest';
```

### `matchesCapability(m, filter)`

Return `true` when a model matches a capability filter. `'all'` matches
everything; `'text'` matches non-multimodal, non-embedding models.

```ts
function matchesCapability(m: OpenRouterModel, filter: CapabilityFilter): boolean
```

### `sortModels(models, sort)`

Return a sorted copy of the model list. `'recommended'` returns the list
unchanged.

```ts
function sortModels(models: OpenRouterModel[], sort: CatalogSort): OpenRouterModel[]
```

### `countByProvider(models)`

Count models per provider, sorted by count descending then name.

```ts
function countByProvider(models: OpenRouterModel[]): ProviderCount[]
```

```ts
interface ProviderCount {
    slug: string;
    info: ProviderInfo;
    count: number;
}
```

---

## Formatting

```ts
// $0.000001 per token → "$1.00" per 1M tokens
function formatPerMillion(raw: unknown, currency?: string): string;

// 200000 → "200K", 1000000 → "1M", 32768 → "32.8K"
function formatTokenCount(n: number): string;

// "text+image → text" style modality summary
function formatModalities(m: OpenRouterModel): string;

// Unix seconds → "Apr 2024", null when missing or invalid
function formatReleaseDate(created?: number): string | null;
```

`formatPerMillion` defaults to USD and falls back to a plain `$X.XX` string
when `Intl.NumberFormat` fails.

---

## Related

- `useModelStore` — Store composable that consumes the catalog
- `models-service` — `OpenRouterModel` type source
- `useDashboardPlugins` — Provider-aware dashboard surface

---

## TypeScript

Full export list:

```ts
getProviderSlug(model): string;
getProviderInfo(slug: string): ProviderInfo;
getModelProvider(model): ProviderInfo;
getContextLength(m): number;
getInputPrice(m): number;
getOutputPrice(m): number;
getCapabilities(m): ModelCapabilities;
getModelBadges(m, max?): ModelBadge[];
getBestForTags(m): string[];
matchesCapability(m, filter): boolean;
sortModels(models, sort): OpenRouterModel[];
countByProvider(models): ProviderCount[];
formatPerMillion(raw, currency?): string;
formatTokenCount(n): string;
formatModalities(m): string;
formatReleaseDate(created?): string | null;
```

---

Document generated from `app/utils/modelCatalog.ts` implementation.
