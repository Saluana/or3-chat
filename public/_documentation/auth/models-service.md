# Model catalog

The host model service fetches OpenRouter model metadata and supplies small, pure filters. Import it from `~/core/auth/models-service`. It does not manage login, persist keys, send chat requests, or build a search index.

## Fetch and filter

Run this from a client-side Nuxt context where runtime configuration is available:

```ts
import {
  fetchModels,
  filterByText,
  filterByModalities,
  filterByContextLength,
  filterByParameters,
} from '~/core/auth/models-service';

export async function findImageToolModels(query: string) {
  let models = await fetchModels();
  models = filterByText(models, query);
  models = filterByModalities(models, { input: ['text', 'image'], output: ['text'] });
  models = filterByContextLength(models, 32_000);
  return filterByParameters(models, ['tools']);
}
```

Filtering metadata does not guarantee that a particular account can use a model, that a provider is available, or that a request will succeed. Use current catalog IDs rather than a hard-coded list of recommended models.

| Function | Contract |
| --- | --- |
| `fetchModels({ force?, ttlMs? })` | Returns `OpenRouterModel[]`; defaults to a one-hour cache TTL. |
| `fetchModelCatalog({ force?, ttlMs? })` | Uses the same path and returns `{ data, source, fetchedAt }`. Source is live only after an SDK catalog response; cache fallback retains its original fetch time. |
| `filterByText(models, query)` | Case-insensitive substring match over ID, name, and description. Empty query returns the input list. |
| `filterByModalities(models, { input?, output? })` | Requires every requested input/output modality in the advertised arrays. |
| `filterByContextLength(models, min)` | Uses top-provider context length, then model context length, then zero. |
| `filterByParameters(models, names)` | Requires every parameter in `supported_parameters`. |
| `filterByPriceBucket(models, bucket)` | Coarse UI heuristic; see below. |
| `resolveDefaultModel(settings, dependencies)` | Chooses an available fixed model, then available last selection, then the supplied recommended default; returns `{ id, reason }`. |

The `modelsService` namespace/default export groups fetch and filter functions. Import `resolveDefaultModel` separately. Model typing is defined in `shared/openrouter/types.ts` and re-exported by this module.

## Cache and errors

The service stores `{ data, fetchedAt }` under `openrouter_model_catalog_v1` in localStorage. A fresh nonempty validated cache is returned without a request. `force: true` bypasses that initial cache check, but a failed network request can still return a stale nonempty cache. With no usable cache, fetching rejects with a normalized error. Cache writes are best effort when browser storage is unavailable. A missing legacy fetch timestamp is returned as `null`; loading or rewriting cached data does not make it a live response. The existing `fetchModels` list API and `ModelCatalogCache` type remain compatible.

The existing model store retains the fetch timestamp when saving its `MODELS_CATALOG` KV cache as `{ version: 1, data, fetchedAt }`. It also reads legacy lists, whose actual fetch time is unknown. These are the same existing caches, not another catalog. Forced store refreshes wait for an ordinary in-flight network load and then coalesce a genuinely forced request. A delayed KV hydration cannot publish over a newer network request; it returns the currently owned catalog/request instead.

## Capacity readiness foundation

`useModelStore().resolveContextModel(selectedModelId, { signal? })` returns a captured metadata result or `{ ok: false, code: 'model_metadata_unavailable' }`. It validates capacity through the shared policy, keeps the original selected ID, prefers exact IDs across catalog/favorites before canonical-slug fallback after removing recognized routing/thinking suffixes for lookup, and freezes copied capacity facts. Valid catalog/favorite metadata can be used without transport. A missing or invalid record tries the normal cache path and one coalesced forced refresh; a later explicit call can recover. Favorite or legacy-cache records have cache provenance and an unknown fetch time.

Cancellation rejects the waiting caller promptly and leaves a shared refresh available to other callers. Unvalidated `per_request_limits` are not treated as selected-route authority. This is metadata preparation only: ordinary native send/loop admission, draft preservation on budget rejection and independent server capacity resolution remain pending. The host's existing native fallback/reserve/trimming behavior has not been replaced by this foundation.

Fetching uses the shared SDK client and collects its paginated model results, then converts them to OR3's snake_case model shape. The configured API URL is `runtimeConfig.public.openRouter.baseUrl`.

The current catalog implementation reads the **legacy** localStorage `openrouter_api_key` entry when constructing the catalog client. That is a compatibility read, not the canonical persistence path for user keys. Do not copy it into new code or store credentials there; use [the key APIs](/documentation/auth/reference). A successful catalog fetch is not proof that a saved personal key was used or validated.

## Prices and capability checks

Prompt and completion prices are numeric strings **per token**. To display a per-million-token value, parse a finite number and multiply by 1,000,000; OR3's `app/utils/modelCatalog.ts` contains its display helpers. Other price fields represent their own billing units; do not apply that multiplier indiscriminately.

Price buckets use the larger of prompt and completion prices:

| Bucket | Current heuristic |
| --- | --- |
| `free` | Maximum is zero. |
| `low` | Greater than zero and at most 0.000002 per token. |
| `medium` | Greater than 0.000002 and at most 0.00001 per token. |
| `any` | No price filter. |

Missing or invalid prices become zero in this helper, so `free` can include unknown pricing. These buckets are not a price quote or cost estimate. There is no “high” bucket, and `medium` does not include everything above “low.”

For capability checks, inspect `architecture.input_modalities`, `architecture.output_modalities`, `supported_parameters`, and context limits. Preserve unknown values rather than treating absent metadata as a supported capability. See [chat types](/documentation/types/chat-types) and [provider message preparation](/documentation/auth/openrouter-build).
