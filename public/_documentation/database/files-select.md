# files-select

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
listImagePage({
  state: 'active' | 'trash',
  sort: 'newest' | 'oldest' | 'largest' | 'smallest',
  limit: number,               // positive, finite; 50 for the gallery
  cursor?: ImageIndexedCursor, // exclusive [sortValue, hash] continuation
  hashes?: ReadonlySet<string>, // optional membership restriction
});
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

-   Combine with `createOrRefFile` / `softDeleteFile` from `files.ts` for lifecycle actions.
-   Use `listImagePage` plus a persisted cursor for Load more; do not grow offsets.
-   Global counts and search totals come from `listImageSummaries`, which is O(N) in compact keys and separate from page hydration.
