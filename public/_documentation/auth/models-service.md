# modelsService

Service for fetching, caching, and filtering OpenRouter's model catalog. Provides utilities to query available models by text, modalities, context length, parameters, and pricing tier.

Think of `modelsService` as your model marketplace — it keeps an up-to-date catalog of 200+ OpenRouter models with powerful filtering to find exactly what you need.

---

## What does it do?

`modelsService` manages the OpenRouter model catalog by:

- Fetching the latest model list from OpenRouter API
- Caching models locally (1 hour TTL by default)
- Filtering by text search, modalities, context, parameters, and price
- Resolving default model based on settings and availability

---

## Basic Example

```ts
import { modelsService } from '~/core/auth/models-service';

// Fetch all models
const models = await modelsService.fetchModels();

// Filter by text
const gpts = modelsService.filterByText(models, 'gpt');

// Find vision models
const vision = modelsService.filterByModalities(models, {
  input: ['image'],
  output: ['text']
});

// Find cheap models
const cheap = modelsService.filterByPriceBucket(models, 'free');
```

---

## How to use it

### 1. Fetch models

```ts
// Get all available models
const models = await modelsService.fetchModels();

// Force refresh (ignore cache)
const fresh = await modelsService.fetchModels({ force: true });

// Custom TTL (2 hours)
const models = await modelsService.fetchModels({ ttlMs: 2 * 60 * 60 * 1000 });
```

### 2. Search by text

```ts
const query = 'claude';
const claudes = modelsService.filterByText(models, query);
// Searches: id, name, description
```

### 3. Filter by modalities

```ts
// Vision models (image input)
const vision = modelsService.filterByModalities(models, {
  input: ['image']
});

// Models that can generate images
const imageGen = modelsService.filterByModalities(models, {
  output: ['image']
});

// Text-to-image models
const txt2img = modelsService.filterByModalities(models, {
  input: ['text'],
  output: ['image']
});
```

### 4. Filter by context length

```ts
// Models with at least 100K context
const longContext = modelsService.filterByContextLength(models, 100000);
```

### 5. Filter by supported parameters

```ts
// Models supporting reasoning
const reasoning = modelsService.filterByParameters(models, ['reasoning']);

// Models supporting temperature and top_p
const flexible = modelsService.filterByParameters(models, [
  'temperature',
  'top_p'
]);
```

### 6. Filter by price

```ts
// Free models
const free = modelsService.filterByPriceBucket(models, 'free');

// Low-cost models (< $0.000002 per token)
const budget = modelsService.filterByPriceBucket(models, 'low');

// Medium cost
const medium = modelsService.filterByPriceBucket(models, 'medium');

// All models
const any = modelsService.filterByPriceBucket(models, 'any');
```

### 7. Resolve default model

```ts
import { resolveDefaultModel } from '~/core/auth/models-service';

const selected = resolveDefaultModel(
  {
    defaultModelMode: 'fixed',
    fixedModelId: 'anthropic/claude-3-sonnet'
  },
  {
    isAvailable: (id) => models.some(m => m.id === id),
    lastSelectedModelId: () => localStorage.getItem('last_model'),
    recommendedDefault: () => 'openai/gpt-oss-120b'
  }
);

// Result: { id: 'anthropic/claude-3-sonnet', reason: 'fixed' }
```

---

## Model Format

Each model object has:

```ts
interface OpenRouterModel {
  id: string;                          // e.g. 'anthropic/claude-3-sonnet'
  name: string;
  description?: string;
  created?: number;                    // Unix timestamp
  architecture?: {
    input_modalities?: string[];       // ['text', 'image']
    output_modalities?: string[];      // ['text']
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    is_moderated?: boolean;
    context_length?: number;           // Max input tokens
    max_completion_tokens?: number;    // Max output tokens
  };
  pricing?: {
    prompt?: string;                   // USD per 1M input tokens
    completion?: string;               // USD per 1M output tokens
    image?: string;
    request?: string;
    web_search?: string;
    internal_reasoning?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  canonical_slug?: string;
  context_length?: number;             // Alternative field
  hugging_face_id?: string;
  supported_parameters?: string[];     // ['temperature', 'top_p', 'reasoning']
}
```

---

## Caching Strategy

### Default cache

- **Key**: `'openrouter_model_catalog_v1'` in localStorage
- **TTL**: 1 hour
- **Size**: ~50KB (all models JSON)

### Cache invalidation

```ts
// Force refresh
await modelsService.fetchModels({ force: true });

// Manual clear
localStorage.removeItem('openrouter_model_catalog_v1');
```

### Fallback

If fetch fails, returns last cached data if available.

---

## Common patterns

### Multi-filter query

```ts
let results = models;

// Start with all models
results = modelsService.filterByText(results, 'claude');
results = modelsService.filterByModalities(results, { input: ['image'] });
results = modelsService.filterByContextLength(results, 100000);
results = modelsService.filterByPriceBucket(results, 'low');

console.log(`Found ${results.length} models`);
```

### Vision model selector

```ts
async function getVisionModels() {
  const models = await modelsService.fetchModels();
  return modelsService.filterByModalities(models, {
    input: ['image'],
    output: ['text']
  }).sort((a, b) => {
    // Sort by price (cheapest first)
    const aPrice = toNumber(a.pricing?.prompt) ?? Infinity;
    const bPrice = toNumber(b.pricing?.prompt) ?? Infinity;
    return aPrice - bPrice;
  });
}
```

### Model availability check

```ts
async function isModelAvailable(modelId: string) {
  const models = await modelsService.fetchModels();
  return models.some(m => m.id === modelId);
}
```

### Find best for task

```ts
async function findBestModel(task: 'vision' | 'reasoning' | 'text') {
  let models = await modelsService.fetchModels();
  
  switch (task) {
    case 'vision':
      models = modelsService.filterByModalities(models, { input: ['image'] });
      break;
    case 'reasoning':
      models = modelsService.filterByParameters(models, ['reasoning']);
      break;
  }
  
  // Sort by price
  models = modelsService.filterByPriceBucket(models, 'low');
  
  return models[0] || null;
}
```

---

## Important notes

### Authentication

- Without API key: Sees all models
- With API key: Sees additional info (pricing, context limits)
- Never expose key in requests; use server-side if needed

### Price format

Prices are **stringified decimals**:
- `"0.00001"` = $0.00001 per token
- `"0"` = Free
- Can be converted with `Number(string)`

Price buckets are heuristic:
- **free**: $0
- **low**: > $0 and ≤ $0.000002
- **medium**: > $0.000002 and ≤ $0.00001

### Context length

- **Input context**: Maximum tokens for prompt history
- **Max completion**: Maximum tokens model can generate
- Some models return both, some only one

### Modalities

Common modalities:
- **input**: `'text'`, `'image'`, `'audio'`
- **output**: `'text'`, `'image'`, `'audio'`

Check model docs for exact support.

### Rate limits

- No explicit rate limits for model listing
- Queries cached locally for 1 hour
- Multiple rapid fetches use same cache

---

## Filtering chaining

All filters return a new array, safe to chain:

```ts
const result = modelsService.filterByText(
  modelsService.filterByModalities(
    modelsService.filterByPriceBucket(models, 'low'),
    { input: ['text'] }
  ),
  'claude'
);
```

---

## Default model resolution

Helper to pick default model based on settings:

```ts
interface AiSettingsForModel {
  defaultModelMode: 'lastSelected' | 'fixed';
  fixedModelId: string | null;
}

interface ModelResolverDeps {
  isAvailable: (id: string) => boolean;
  lastSelectedModelId: () => string | null;
  recommendedDefault: () => string;
}

function resolveDefaultModel(
  set: AiSettingsForModel,
  deps: ModelResolverDeps
): { id: string; reason: 'fixed' | 'lastSelected' | 'recommended' }
```

Priority:
1. **Fixed**: Use configured fixed model if available
2. **Last selected**: Use previously selected model if available
3. **Recommended**: Fall back to recommended default

---

## Related

- `useChat` — uses models for API calls
- `useModelStore` — wraps this service in composable
- `useAiSettings` — stores default model preference
- OpenRouter API docs — model catalog endpoint

---

## TypeScript

```ts
export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  // ... (see Model Format section)
}

export interface ModelCatalogCache {
  data: OpenRouterModel[];
  fetchedAt: number;
}

export interface AiSettingsForModel {
  defaultModelMode: 'lastSelected' | 'fixed';
  fixedModelId: string | null;
}

export interface ModelResolverDeps {
  isAvailable: (id: string) => boolean;
  lastSelectedModelId: () => string | null;
  recommendedDefault: () => string;
}

export type PriceBucket = 'free' | 'low' | 'medium' | 'any';

export async function fetchModels(opts?: {
  force?: boolean;
  ttlMs?: number;
}): Promise<OpenRouterModel[]>;

export function filterByText(
  models: OpenRouterModel[],
  q: string
): OpenRouterModel[];

export function filterByModalities(
  models: OpenRouterModel[],
  opts?: { input?: string[]; output?: string[] }
): OpenRouterModel[];

export function filterByContextLength(
  models: OpenRouterModel[],
  minCtx: number
): OpenRouterModel[];

export function filterByParameters(
  models: OpenRouterModel[],
  params: string[]
): OpenRouterModel[];

export function filterByPriceBucket(
  models: OpenRouterModel[],
  bucket: PriceBucket
): OpenRouterModel[];

export function resolveDefaultModel(
  set: AiSettingsForModel,
  deps: ModelResolverDeps
): { id: string; reason: 'fixed' | 'lastSelected' | 'recommended' };

export const modelsService: {
  fetchModels: typeof fetchModels;
  filterByText: typeof filterByText;
  filterByModalities: typeof filterByModalities;
  filterByContextLength: typeof filterByContextLength;
  filterByParameters: typeof filterByParameters;
  filterByPriceBucket: typeof filterByPriceBucket;
};
```

---

Document generated from `app/core/auth/models-service.ts` implementation.
