# Model catalog

The catalog opens newest first. **Platforms** are connections such as OpenRouter
and direct OpenAI; the model maker is separate from that connection. Existing
saved route IDs remain valid, including `@openai/` IDs. Models appear as each
platform completes, so a slow or unavailable platform does not delay another.

Choose **Use** on a row to select immediately, or open its details. Favorites,
Recently used, and Workspace picks narrow the same list. Recent selections are
saved per workspace. Search accepts names, IDs, platforms and capability terms
such as “tools” and “vision”. Embedding-only models are excluded from chat.
Input and output price sorts are separate, with unknown prices last. Arrow keys
move between rows; Home/End reach the first/last result, and Enter opens details.
Use and favorite actions also work with the keyboard.

Workspace admins can set a default, pin picks and hide models in **Workspace
settings → Workspace models**. Hidden routes cannot start new chat responses;
OpenRouter routing variants share their base route's restriction. Existing
history stays intact. Delegated children inherit the admitted workspace policy.
Personal fixed preferences and explicit chat/project selections retain their
normal precedence; a hidden selection is refused rather than rerouted silently.

When switching models, unsupported attachments stay in the draft. The composer
asks the user to choose another model or remove them. Unsupported tools require
an explicit choice to continue without tools; reasoning remains independent.
Normal response recovery keeps the ordinary reply/loading presentation.
Because OpenAI's model-list endpoint does not report capacity, OR3 shows only
models whose limits are in its host table; newly released models require a table update.
Direct OpenAI chat uses the Responses API, preserving supported sampling,
structured-output formats, and explicit strict tool schemas while allowing supported models to reason
while calling tools.

The host model service fetches OpenRouter model metadata and supplies small, pure filters. Import it from `~/core/auth/models-service`. It does not manage login, persist keys, send chat requests, or build a search index.

`shared/openrouter/catalog.ts` owns SDK pagination and mapping; the model service
remains the single browser cache owner. `shared/openrouter/selection.ts` owns
OpenRouter's legacy suffix and catalog-identity interpretation. A model's
missing tool metadata is unknown; OpenRouter's existing compatibility policy
still permits tools in that case. Search, routing and reasoning are separate
concepts even though the current menu presents the existing four choices.
The source variant presenters accept a descriptor list with opaque option
values and hide their control when it is empty; OpenRouter remains their
default list. Saved OpenRouter settings are still validated at the composer
boundary.

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
| `fetchModelCatalog({ force?, ttlMs? })` | Returns `{ data, source, fetchedAt, openAiPending?, openRouterPending?, stale? }`. The first usable platform is returned immediately. `openAiPending` or `openRouterPending` resolves to the remaining platform models. `fetchModels` waits for both lists. The optional `onPlatformStatus(platform, status, provenance?)` callback reports loading, ready, stale, unavailable or disconnected independently for each platform. Successful status notifications include the platform's source and original fetch time. The shared model store resolves a selected model as soon as its own metadata is ready, without waiting for unrelated platforms. If OpenRouter is unavailable, OpenAI models are returned alone. |
| `filterByText(models, query)` | Case-insensitive substring match over ID, name, and description. Empty query returns the input list. |
| `filterByModalities(models, { input?, output? })` | Requires every requested input/output modality in the advertised arrays. |
| `filterByContextLength(models, min)` | Uses top-provider context length, then model context length, then zero. |
| `filterByParameters(models, names)` | Requires every parameter in `supported_parameters`. |
| `filterByPriceBucket(models, bucket)` | Coarse UI heuristic; see below. |
| `resolveDefaultModel(settings, dependencies)` | Chooses an available fixed model, then available last selection, then the supplied recommended default; returns `{ id, reason }`. |

The `modelsService` namespace/default export groups fetch and filter functions. Import `resolveDefaultModel` separately. Model typing is defined in `shared/openrouter/types.ts` and re-exported by this module.

## Cache and errors

The chat composer loads saved preferences and cached models immediately. An empty disconnected chat waits until a connection is available or chat settings/model selection opens before fetching a live catalog. Returning conversations keep their catalog preparation, and sending still resolves the model metadata required for admission.

`useModelStore().loadCachedModels()` hydrates the existing fresh workspace KV cache without a network request. `useChatModelSelection` callers can supply `shouldFetchCatalog` to defer live loading; omitting it preserves eager loading. `useContextPreview` accepts an optional reactive `enabled` flag: `false` cancels pending advisory work, while the default preserves existing preview behavior.

The service stores `{ data, fetchedAt }` under `openrouter_model_catalog_v1` in localStorage. A fresh nonempty validated cache is returned without a request. `force: true` bypasses that initial cache check, but a failed network request can still return a stale nonempty cache. With no usable cache, fetching rejects with a normalized error. Cache writes are best effort when browser storage is unavailable. A missing legacy fetch timestamp is returned as `null`; loading or rewriting cached data does not make it a live response. The existing `fetchModels` list API and `ModelCatalogCache` type remain compatible.

The existing model store retains the fetch timestamp when saving its `MODELS_CATALOG` KV cache as `{ version: 1, data, fetchedAt }`. It also reads legacy lists, whose actual fetch time is unknown. These are the same existing caches, not another catalog. Forced store refreshes wait for an ordinary in-flight network load and then coalesce a genuinely forced request. A delayed KV hydration cannot publish over a newer network request; it returns the currently owned catalog/request instead.

Catalog, favorites, and recent-model memory are scoped to the active workspace.
Switching workspaces clears them immediately; old reads and pending refreshes
cannot publish or save into the destination workspace. Favorite changes save in
selection order, and an older hydration cannot replace a newer local choice.
New-chat model persistence stops if its composer is removed or navigates while
checking the newly created thread.

## Capacity readiness foundation

`useModelStore().resolveContextModel(selectedModelId, { signal? })` returns a captured metadata result or `{ ok: false, code: 'model_metadata_unavailable' }`. It validates capacity through the shared policy, keeps the original selected ID, prefers exact IDs across catalog/favorites before canonical-slug fallback after removing recognized routing/thinking suffixes for lookup, and freezes copied capacity facts. Valid catalog/favorite metadata can be used without transport. A missing or invalid record tries the normal cache path and one coalesced forced refresh; a later explicit call can recover. Favorite or legacy-cache records have cache provenance and an unknown fetch time.

Cancellation rejects the waiting caller promptly and leaves a shared refresh available to other callers. Unvalidated `per_request_limits` are not treated as selected-route authority. Native sends, retries, continuations, and tool loops use captured capacity facts with the workspace's optional context maximum to admit the complete provider payload. Ordinary requests preserve selected history; oversized requests stop with `context_full`. See [manual context compaction](/documentation/utils/manual-context-compaction) for draft preservation and recovery.

Fetching uses the shared SDK client and collects its paginated model results, then converts them to OR3's snake_case model shape. The configured API URL is `runtimeConfig.public.openRouter.baseUrl`.

Before constructing the catalog SDK client, the service awaits `hydrateUserApiKeyFromKv()` and reads the current `useUserApiKey()` value. Persist user keys through [the key APIs](/documentation/auth/reference). A successful catalog fetch is not proof that a saved personal key was validated.

Merged catalogs preserve each platform's source and fetch time. Cache reloads report `openai-cache` or `openrouter-cache` and retain those timestamps; rewriting a cache record does not renew metadata freshness. Legacy lists keep an unknown fetch time.

## Prices and capability checks

Prompt and completion prices are numeric strings **per token**. To display a per-million-token value, parse a finite number and multiply by 1,000,000; OR3's `app/utils/modelCatalog.ts` contains its display helpers. Other price fields represent their own billing units; do not apply that multiplier indiscriminately.

Price buckets use the larger of prompt and completion prices:

| Bucket | Current heuristic |
| --- | --- |
| `free` | Maximum is zero. |
| `low` | Greater than zero and at most 0.000002 per token. |
| `medium` | Greater than 0.000002 and at most 0.00001 per token. |
| `any` | No price filter. |

Missing, empty, invalid or negative prices stay unknown and never match a price bucket. The shared parser in `shared/ai/model-catalog.ts` owns this rule for UI and service filters. Small nonzero prices retain precision instead of rounding to free. Direct OpenAI entries show “Price unavailable” when no rate is supplied; details link to the relevant platform pricing source. These buckets are not a price quote or cost estimate. There is no “high” bucket, and `medium` does not include everything above “low.”

For capability checks, inspect `architecture.input_modalities`, `architecture.output_modalities`, `supported_parameters`, and context limits. Preserve unknown values rather than treating absent metadata as a supported capability. See [chat types](/documentation/types/chat-types) and [provider message preparation](/documentation/auth/openrouter-build).


## Adding a platform adapter

Use the existing `shared/ai` contracts and execution paths; a catalog entry alone
does not add an integration. `ModelRef` separates the runtime router ID from the
model ID. `modelIdentity()` in `shared/ai/model-catalog.ts` presents the platform,
route and maker without changing persisted route IDs. Its maker-qualified `modelId`
matches the same named model across platforms; aliases and snapshots remain distinct. Add any new platform's
identity mapping alongside its real adapter, credentials and transport.

- Normalize the catalog at its platform boundary. Preserve unknown prices and
  capabilities; do not invent model capacity. Supply verified limits before
  enabling sends. Model capabilities, application support and account access
  are distinct.
- Use the existing credential policy. Never return a key with a catalog entry.
  Publish catalog failures independently, preserving usable platform results.
- Map request history, reasoning and tool results through the adapter, and emit
  the shared stream events and usage shape. Keep cancellation and resume behavior
  consistent with the existing chat lifecycle.
- Keep public links platform-specific. Prices are per token internally; source
  links and display precision must not imply unknown or tiny rates are free.
- Extend the existing browser journeys with realistic fixtures: missing prices,
  duplicate names on different platforms, new IDs, stale data, partial outages,
  unsupported attachments and tools, and cross-platform conversation history.
  Capture screenshots/receipts. Run the targeted suites and typecheck before
  considering an adapter ready.

Workspace curation uses the existing private `WorkspaceSettingsStore`, key
`chat.models`, with `{ hidden: string[], pinned: string[], defaultModel: string | null }`.
The admin GET/POST endpoint is `/api/admin/workspace/models`; POST requires the
existing admin mutation protections. `/api/workspaces/models` returns only the
current authorized workspace's choices. Curation governs chat, not the separate
plugin AI allowlist. User-writable synced KV is never policy authority.

`GET /api/admin/workspace/model-catalog?workspaceId=…` supplies the admin picker under the same workspace authorization as curation. Deployment admins can use it without a chat login. It uses instance credentials unless the administrator has a chat session for the target workspace, where their own credential policy applies; it never borrows another workspace's personal keys. It returns `{ data, unavailable }`, retaining healthy platforms and reporting failed platform names for retry. No credentials are returned.
