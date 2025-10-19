# useThreadSearch

Thread-specific search composable that powers the sidebar query field. Builds a small Orama index over thread titles, debounces input, and falls back to substring matching when required.

---

## What does it do?

`useThreadSearch(threads)` delivers:

-   A writable `query` ref bound to the search input.
-   A reactive `results` list kept in sync with Orama hits or substring fallback.
-   Automatic index rebuilds when the thread collection grows or shrinks.
-   Debounced searches (120 ms) to avoid excessive recomputation.
-   Convenience helpers (`rebuild`, `runSearch`) plus ready/busy flags.

---

## Basic Example

```ts
import { useThreadSearch } from '~/composables/threads/useThreadSearch';

const threads = useThreads(); // Ref<Thread[]>

const { query, results, ready, busy, rebuild } = useThreadSearch(threads);

watch(results, (list) => console.debug('Thread matches', list.length));

// Force rebuild after an import
await rebuild();
```

---

## How to use it

### 1. Pass a reactive thread array

Provide a `Ref<Thread[]>`. The composable rebuilds the index whenever the array length changes. For title-only edits, call `rebuild()` manually.

### 2. Bind `query`

Use `v-model="query.value"` (or simply `v-model="query"`) on your search input. Typing triggers debounced searches; clearing it restores the full thread list.

### 3. Render `results`

Loop over `results.value` to render matches ordered by relevance or fallback order.

### 4. Observe status

-   `ready.value` becomes `true` after the first successful index build.
-   `busy.value` is `true` while an index rebuild is in flight.

### 5. Control manually when needed

Call `await rebuild()` before heavy operations, or `await runSearch()` to refresh results after custom filters.

---

## What you get back

| Property    | Type                  | Description                        |
| ----------- | --------------------- | ---------------------------------- |
| `query`     | `Ref<string>`         | Current search string.             |
| `results`   | `Ref<Thread[]>`       | Matching threads.                  |
| `ready`     | `Ref<boolean>`        | Indicates the index is built.      |
| `busy`      | `Ref<boolean>`        | `true` when rebuilding the index.  |
| `rebuild`   | `() => Promise<void>` | Forces index rebuild.              |
| `runSearch` | `() => Promise<void>` | Runs search for the current query. |

---

## Under the hood

1. **Index build** — Uses `createDb`/`buildIndex` from `~/core/search/orama` with schema `{ id, title, updated_at }`.
2. **ID map** — Maintains an `id → Thread` dictionary for quick hit resolution.
3. **Debounce** — Delays `runSearch()` by 120 ms after each query change via `setTimeout`.
4. **Fallback** — If Orama returns zero hits or throws, filters by `title.toLowerCase().includes(query)` and logs a warning once.
5. **Stale guard** — Uses `lastQueryToken` to ignore late async responses when queries change quickly.

---

## Edge cases & tips

-   **Untitled threads**: Empty titles default to `'Untitled Thread'` before indexing, so they still appear.
-   **Empty query**: Returns the full thread list to mirror the sidebar UX.
-   **Large datasets**: Increase the search limit in the composed call if you need more than 200 hits.
-   **SSR**: Safe to import on the server; the index only builds on the client when watchers run.

---

## Related

-   `useSidebarSearch` — multi-entity search that also covers projects and documents.
-   `useThreadHistoryActions` — companion registry for thread dropdown actions.
-   `~/core/search/orama` — shared Orama helpers used throughout the app.

---

## TypeScript

```ts
function useThreadSearch(threads: Ref<Thread[]>): {
    query: Ref<string>;
    results: Ref<Thread[]>;
    ready: Ref<boolean>;
    busy: Ref<boolean>;
    rebuild: () => Promise<void>;
    runSearch: () => Promise<void>;
};
```
