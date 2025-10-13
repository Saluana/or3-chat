# useModelStore

Shared catalog + favorites manager for OpenRouter models. Centralises fetching, caching, and filtering so every pane sees the same list without repeated network hits.

---

## Responsibilities

`useModelStore` exposes reactive state for the model catalog, favorites, search query, and filters. It layers three cache tiers (memory → Dexie → network) and dedupes concurrent fetches. Consumers can refresh, invalidate, or persist favorites with a single call.

-   Hydrates catalog from memory, Dexie (`kv` table), or network
-   Persists the catalog in Dexie for 48 hours by default
-   Dedupes in-flight fetches across callers
-   Manages favorites with persistence to `kv`
-   Exposes helper refs for search/filter UI

---

## Quick start

```ts
import { useModelStore } from '~/composables/chat/useModelStore';

const {
    catalog,
    favoriteModels,
    fetchModels,
    addFavoriteModel,
    removeFavoriteModel,
    searchQuery,
    filters,
} = useModelStore();

await fetchModels();
searchQuery.value = 'claude';
await addFavoriteModel(catalog.value[0]);
```

---

## API

| Export                       | Type                                                                                                             | Description                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `catalog`                    | `Ref<OpenRouterModel[]>`                                                                                         | Reactive catalog of models.                                       |
| `favoriteModels`             | `Ref<OpenRouterModel[]>`                                                                                         | Models the user has favorited (persisted).                        |
| `searchQuery`                | `Ref<string>`                                                                                                    | Shared search string for UI components.                           |
| `filters`                    | `Ref<{ input?: string[]; output?: string[]; minContext?: number; parameters?: string[]; price?: PriceBucket; }>` | Reactive filter state.                                            |
| `lastLoadedAt`               | `Ref<number \| undefined>`                                                                                       | Timestamp (ms) of the most recent catalog load.                   |
| `fetchModels(opts?)`         | `(opts?: { force?: boolean; ttlMs?: number }) => Promise<OpenRouterModel[]>`                                     | Populate catalog using cache layers; respects TTL unless `force`. |
| `refreshModels()`            | `() => Promise<OpenRouterModel[]>`                                                                               | Shortcut for `fetchModels({ force: true })`.                      |
| `invalidate()`               | `() => Promise<void>`                                                                                            | Clear memory cache and delete Dexie entry.                        |
| `getFavoriteModels()`        | `() => Promise<OpenRouterModel[]>`                                                                               | Load favorites from `kv` into memory.                             |
| `addFavoriteModel(model)`    | `(model: OpenRouterModel) => Promise<void>`                                                                      | Append to favorites (deduped) and persist.                        |
| `removeFavoriteModel(model)` | `(model: OpenRouterModel) => Promise<void>`                                                                      | Remove favorite and persist.                                      |
| `clearFavoriteModels()`      | `() => Promise<void>`                                                                                            | Remove all favorites and persist.                                 |

Constants:

```ts
MODELS_CACHE_KEY = 'MODELS_CATALOG';
MODELS_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
```

---

## Usage patterns

### Populate a model picker

```ts
const { catalog, fetchModels, searchQuery, filters } = useModelStore();

await fetchModels();

const filteredModels = computed(() => {
    return catalog.value.filter((model) => {
        if (searchQuery.value && !model.id.includes(searchQuery.value)) {
            return false;
        }
        if (
            filters.value.price &&
            model.price?.bucket !== filters.value.price
        ) {
            return false;
        }
        return true;
    });
});
```

### Sync favorites to UI

```ts
const {
    favoriteModels,
    addFavoriteModel,
    removeFavoriteModel,
    getFavoriteModels,
} = useModelStore();

await getFavoriteModels();

function toggleFavorite(model: OpenRouterModel) {
    if (favoriteModels.value.some((m) => m.id === model.id)) {
        removeFavoriteModel(model);
    } else {
        addFavoriteModel(model);
    }
}
```

### Force-refreshing the catalog

```ts
const { refreshModels } = useModelStore();

await refreshModels(); // bypasses cache and hits the network
```

---

## Internals

1. **Singleton refs** — `catalog`, `favoriteModels`, `filters`, etc. live at module scope so every caller shares the same reactive data.
2. **Cache layers** — `fetchModels` tries memory first, then Dexie (if supported), then network. TTL is configurable per call.
3. **Dexie persistence** — Catalog is stored via `kv.set(MODELS_CACHE_KEY, JSON.stringify(list))`; timestamps come from `rec.updated_at` (seconds) and are compared against the TTL.
4. **In-flight dedupe** — Network fetches share a module-level `inFlight` promise so parallel callers await the same request.
5. **Favorites persistence** — Favorites use a separate `kv` key (`favorite_models`) and are stored as JSON.
6. **Error handling** — On network failure it attempts to serve stale Dexie data; JSON parse failures purge the corrupt record.

---

## Tips & edge cases

-   **IndexedDB availability**: `canUseDexie()` guards against SSR and private modes that block IndexedDB. If Dexie is unavailable, caching falls back to memory only.
-   **TTL overrides**: Pass `fetchModels({ ttlMs: 15 * 60 * 1000 })` to tighten freshness requirements for specific views.
-   **Favorites dedupe**: `addFavoriteModel` ignores duplicates by `model.id`.
-   **Invalidation**: After calling `invalidate()`, make sure to call `fetchModels()` again to repopulate memory.
-   **Persistent filters/search**: Since refs are shared, updating `searchQuery` in one component immediately affects others (intended for synchronized UI).

---

## Related modules

-   `models-service` — underlying fetcher for OpenRouter models.
-   `kv` helpers — Dexie-backed storage used for both catalog and favorites.
-   `useAiSettings` — may use this store to pick the default model.
