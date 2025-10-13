# useDocumentsList

Lightweight fetch-and-refresh composable for the documents sidebar. Loads recent Dexie `documents` entries, trims heavy fields, and keeps the list fresh when database hooks fire.

---

## What does it do?

`useDocumentsList(limit?)` gives you:

-   A `docs` ref with up to `limit` lightweight document summaries.
-   A `loading` flag optimised for SSR → client hydration.
-   An `error` ref populated when Dexie calls fail.
-   A `refresh()` function to reload on demand.
-   Automatic refresh when `db.documents.*` hook events fire on the client.

By trimming `content`, the sidebar avoids storing huge TipTap JSON strings in memory.

---

## Basic Example

```ts
import { useDocumentsList } from '~/composables/documents/useDocumentsList';

const { docs, loading, error, refresh } = useDocumentsList(100);

onMounted(() => {
    if (!loading.value && !docs.value.length) refresh();
});
```

---

## How to use it

### 1. Call the composable in setup

Optionally pass a `limit` (default `200`) to cap results. The first run sets `loading` to `true` so SSR and client HTML match.

### 2. Render the list

`docs.value` contains objects with metadata (`id`, `title`, `postType`, timestamps, `deleted`, `meta`). Bind them into your sidebar or dashboards.

### 3. Handle loading & errors

-   Show spinners while `loading.value` is `true`.
-   Read `error.value` when a fetch fails; a toast is already fired with "Document: list failed".

### 4. Refresh when needed

Call `refresh()` after bulk operations or when server-triggered changes need to propagate. On the client, the composable already listens for:

-   `db.documents.create:action:after`
-   `db.documents.update:action:after`
-   `db.documents.delete:action:*:after`

Those hooks come from the central `$hooks` engine via `useHookEffect` and ensure the list stays current.

---

## What you get back

| Property  | Type                  | Description                                       |
| --------- | --------------------- | ------------------------------------------------- |
| `docs`    | `Ref<Document[]>`     | Array of trimmed document records (no `content`). |
| `loading` | `Ref<boolean>`        | `true` while fetching from Dexie.                 |
| `error`   | `Ref<unknown>`        | Error value if the last fetch failed.             |
| `refresh` | `() => Promise<void>` | Reload the list manually.                         |

The returned `Document` objects keep `content: ''` to satisfy the type while staying lightweight.

---

## Under the hood

1. **Dexie fetch** – Uses `listDocuments(limit)` to query the `documents` store.
2. **Field pruning** – Maps results to a slimmer object before storing in the ref.
3. **Error handling** – Catches failures, stamps `error.value`, and raises a toast.
4. **Hook subscriptions** – Registers `useHookEffect` listeners on the client to refresh after create/update/delete actions.
5. **SSR friendly** – Leaves `loading` true during SSR so hydration sees the same markup.

---

## Edge cases & tips

-   **Server-only usage**: On the server, the hook listeners don’t run. Call `refresh()` manually if you render on the server and stream updates.
-   **Limit tuning**: Adjust `limit` depending on sidebar performance; the query already caps the results client-side.
-   **Custom toasts**: If you need custom messaging, catch `error.value` in your component and display additional context.
-   **Deleted docs**: Entries include a `deleted` flag so you can filter out soft-deleted documents if desired.

---

## Related

-   `~/db/documents` — Dexie helpers used under the hood.
-   `useDocumentsStore` — full document state with content + autosave.
-   `usePaneDocuments` — orchestrates pane-specific document selection.

---

## TypeScript

```ts
function useDocumentsList(limit?: number): {
    docs: Ref<Document[]>;
    loading: Ref<boolean>;
    error: Ref<unknown>;
    refresh: () => Promise<void>;
};
```
