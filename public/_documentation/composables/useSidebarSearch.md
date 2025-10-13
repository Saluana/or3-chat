# useSidebarSearch

Unified search composable that indexes threads, projects, and documents for the sidebar search bar. Uses Orama for fast client-side search with a substring fallback to guarantee results.

---

## What does it do?

`useSidebarSearch(threads, projects, documents)` returns reactive state and helpers that:

-   Build (and rebuild) a shared Orama index when underlying data changes.
-   Debounce queries (120 ms) and return results grouped by type.
-   Provide a substring fallback if Orama throws or returns zero hits.
-   Track readiness/busy states and expose a manual `rebuild()` + `runSearch()` API.

The composable mirrors the pattern established in `useThreadSearch` but spans multiple datasets.

---

## Basic Example

```ts
import { useSidebarSearch } from '~/composables/sidebar/useSidebarSearch';

const threads = useThreads();
const projects = useProjects();
const documents = useDocuments();

const { query, threadResults, projectResults, documentResults, ready, busy } =
    useSidebarSearch(threads, projects, documents);

watch(query, (value) => console.debug('Searching for', value));
```

---

## How to use it

### 1. Pass in reactive sources

Provide `Ref<Thread[]>`, `Ref<Project[]>`, and `Ref<Post[]>`. The composable watches for changes and rebuilds the index only when counts or `updated_at` signatures change.

### 2. Bind the query input

`query` is a writable `ref<string>`. Watch or v-model it in your search input. Typing triggers a debounced search.

### 3. Render grouped results

Use `threadResults`, `projectResults`, and `documentResults` to populate search dropdowns or grouped lists.

### 4. Handle readiness/loading

-   `ready` flips to `true` after the first successful index build.
-   `busy` reports when the index rebuild is in progress.

### 5. Manual maintenance

-   Call `rebuild()` to force an index rebuild (e.g., after external imports).
-   Call `runSearch()` to re-run the query without changing `query.value`.

---

## What you get back

`useSidebarSearch` returns:

| Property          | Type                  | Description                                        |
| ----------------- | --------------------- | -------------------------------------------------- |
| `query`           | `Ref<string>`         | Current search string.                             |
| `threadResults`   | `Ref<Thread[]>`       | Matching threads.                                  |
| `projectResults`  | `Ref<Project[]>`      | Matching projects.                                 |
| `documentResults` | `Ref<Post[]>`         | Matching documents (filtered to non-deleted docs). |
| `ready`           | `Ref<boolean>`        | `true` once the Orama index is built.              |
| `busy`            | `Ref<boolean>`        | `true` while rebuilding.                           |
| `rebuild`         | `() => Promise<void>` | Forces index rebuild.                              |
| `runSearch`       | `() => Promise<void>` | Runs search against current query.                 |

---

## Under the hood

1. **Document signature** – `computeSignature()` combines dataset counts + latest `updated_at` to decide when to rebuild.
2. **Orama index** – Builds a schema with `id`, `kind`, `title`, `updated_at`, and indexes all eligible records.
3. **ID maps** – Maintains `id → entity` dictionaries per kind for quick result mapping.
4. **Search pipeline** – Runs Orama search with limit 500. If no hits or an error occurs, falls back to case-insensitive substring matching.
5. **Debounce** – Uses a `setTimeout` to delay searches by 120 ms, mirroring other search composables.

---

## Edge cases & tips

-   **Empty query**: Returns full datasets (threads, projects, docs) instead of empty results.
-   **Deleted docs**: Filters out posts with `postType !== 'doc'` or `deleted === true` in both index build and fallback.
-   **Index rebuild storms**: The signature guard prevents redundant rebuilds even when watchers fire frequently.
-   **Fallback warning**: Logs a warning once (`[useSidebarSearch] fallback substring search used`) to aid debugging.
-   **Stale searches**: Uses incremental `lastQueryToken` to discard results from outdated async calls.

---

## Related

-   `useThreadSearch` — single-domain search the pattern was based on.
-   `~/core/search/orama` — shared Orama helpers (`createDb`, `buildIndex`, `searchWithIndex`).
-   `~/composables/sidebar/useSidebarSections` — consumer of the search results to display grouped lists.

---

## TypeScript

```ts
function useSidebarSearch(
    threads: Ref<Thread[]>,
    projects: Ref<Project[]>,
    documents: Ref<Post[]>
): {
    query: Ref<string>;
    threadResults: Ref<Thread[]>;
    projectResults: Ref<Project[]>;
    documentResults: Ref<Post[]>;
    ready: Ref<boolean>;
    busy: Ref<boolean>;
    rebuild: () => Promise<void>;
    runSearch: () => Promise<void>;
};
```
