# Image library queries

Index-key queries for paging `file_meta` rows and browsing the image library.

---

## What does it do?

-   Exposes lightweight list queries scoped to verified raster images.
-   Reads one bounded metadata page from ordered `[gallery_state+sort+hash]` indexes.
-   Reads a compact summary corpus from the covering index for global counts, name ordering, and search.
-   Provides a rename helper that bumps `updated_at` for sorting freshness.

---

## API surface

| Function                     | Signature                                                                 | Description                                                              |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `listImageMetasPaged`        | `(offset = 0, limit = 50) => Promise<FileMeta[]>`                         | Returns newest-first non-deleted image meta rows (legacy offset paging). |
| `listDeletedImageMetasPaged` | `(offset = 0, limit = 50) => Promise<FileMeta[]>`                         | Returns soft-deleted image meta rows for bin views.                      |
| `listAllImageMetas`          | `(deleted = false) => Promise<FileMeta[]>`                                | Deprecated full-library scan; prefer `listImageSummaries`.               |
| `listImageSummaries`         | `() => Promise<ImageSummary[]>`                                           | Compact corpus from covering index keys; no `FileMeta` values read.      |
| `listImagePage`              | `(input) => Promise<ImagePage>`                                           | One bounded page with an exclusive `(sortValue, hash)` cursor.           |
| `getImageMetasByHashes`      | `(hashes) => Promise<FileMeta[]>`                                         | Ordered hydration for a known ID snapshot (name-order pages).            |
| `updateFileName`             | `(hash: string, name: string) => Promise<void>`                           | Renames a file (if found) and updates `updated_at`.                      |

### Page input

```ts
import { listImagePage } from '~/db/files-select';

export async function readFirstImagePage() {
  return listImagePage({ state: 'active', sort: 'newest', limit: 50 });
}
```

The result reports `items`, `hasMore`, `nextCursor`, and `missing`. `missing` counts selected index rows that disappeared before hydration; callers should discard that revision and re-run the query instead of advancing the cursor past it. Cursors are scoped to their `state` and `sort`, and invalid limits or mismatched cursors throw. Every scan is bounded to the requested `active` or `trash` partition on both ends, so an empty view never walks the opposite state's keys.

---

## Filtering rules

-   Images require `kind === 'image'` and one of the verified raster MIME types
    (`image/png`, `image/jpeg`, `image/webp`, or `image/gif`). Legacy rows with
    no `kind` field remain eligible when their MIME is one of those exact
    types. Generic files stay out of image-library queries even when their MIME
    begins with `image/`.
-   The local `gallery_state` field encodes that eligibility: `deleted: true`
    maps to `trash`, and `false` (or a legacy missing flag, matching
    `listImageMetasPaged`) maps to `active`. Rows that fail the raster rules
    have no `gallery_state` and are never indexed by these queries.
-   Active and trash views are separate; `gallery_state` is never synchronized
    and is recomputed at the Dexie write boundary.

---

## Indexes

| Index                                                              | Use                            |
| ------------------------------------------------------------------ | ------------------------------ |
| `[gallery_state+created_at+hash]`                                  | Newest/oldest keyset pages.    |
| `[gallery_state+size_bytes+hash]`                                  | Largest/smallest keyset pages. |
| `[gallery_state+name+mime_type+created_at+size_bytes+hash]`        | Covering summary corpus.       |

Timestamp/size pages scan keys only and hydrate at most `limit` full rows. Name
ordering sorts the compact corpus with `localeCompare(..., { sensitivity: 'base' })`
and a deterministic hash tie-breaker; it does not rely on IndexedDB string order.

---

## Usage tips

-   The gallery and viewer share preview URLs within the active workspace. Switching workspaces revokes cached URLs, cancels pending preview loads, and clears displayed previews. The next workspace must resolve its own blob even when a file hash is the same.
-   A gallery upload batch belongs to the workspace generation captured when its file picker opens (or when a direct file-change event starts). Switching workspaces while the picker is open rejects that selection; switching during the batch stops the remaining files. Files already committed remain in the original workspace. Switching away and back does not resume that batch.
-   Combine with `createOrRefFile` / `softDeleteFile` from `files.ts` for lifecycle actions.
-   Use `listImagePage` plus a persisted cursor for Load more; do not grow offsets.
-   Global counts and search totals come from `listImageSummaries`, which is O(N) in compact keys and separate from page hydration.

Gallery download, clipboard copy, and delayed command-palette selection retain their originating workspace generation. A switch, including switching away and back, discards stale reads before opening a viewer, starting a download, or writing converted clipboard bytes. A clipboard write already accepted by the browser cannot be recalled; completion feedback is suppressed after a switch.

Chat attachments and command-palette thumbnails share a separate raster-thumbnail cache. Workspace changes clear its URLs, pending reads/decodes, dimensions, retention and cleanup timers. Mounted consumers clear file/PDF names and discard late metadata or downloads. Prefetch resets on workspace generation even when thread/hash identifiers remain unchanged, then accepts fresh reads for the current workspace. Same-workspace reuse and raster validation remain supported.
Each mounted palette thumbnail rebuilds its own retention after a switch, including
the fallback without IntersectionObserver. Removing one shared-hash thumbnail does
not revoke the URL still retained by another.
Prefetch resets also preserve references already acquired in the new workspace;
normal thread reset/disposal and injected-cache cleanup keep their existing behavior.
