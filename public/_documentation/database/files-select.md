# files-select

Read-only helpers for paging `file_meta` rows when browsing uploads or the recycle bin.

---

## What does it do?

-   Exposes lightweight list queries scoped to image-like files.
-   Applies simple paging (`offset`, `limit`) over an `updated_at` index.
-   Provides a rename helper that bumps `updated_at` for sorting freshness.

---

## API surface

| Function                     | Signature                                         | Description                                         |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `listImageMetasPaged`        | `(offset = 0, limit = 50) => Promise<FileMeta[]>` | Returns newest-first non-deleted image meta rows.   |
| `listDeletedImageMetasPaged` | `(offset = 0, limit = 50) => Promise<FileMeta[]>` | Returns soft-deleted image meta rows for bin views. |
| `listAllImageMetas`          | `(deleted = false) => Promise<FileMeta[]>`        | Returns every image-like row (live or deleted) for library-wide search and counts; binary payloads stay lazy. |
| `updateFileName`             | `(hash: string, name: string) => Promise<void>`   | Renames a file (if found) and updates `updated_at`. |

---

## Filtering rules

-   Images require `kind === 'image'` and one of the verified raster MIME types
    (`image/png`, `image/jpeg`, `image/webp`, or `image/gif`). Legacy rows with
    no `kind` field remain eligible when their MIME is one of those exact
    types. Generic files stay out of image-library queries even when their MIME
    begins with `image/`.
-   Deleted and non-deleted lists are separated to simplify UI logic.

---

## Usage tips

-   Combine with `createOrRefFile` / `softDeleteFile` from `files.ts` for lifecycle actions.
-   Use `offset`/`limit` for infinite scroll; Dexie performs the filtering client-side so keep limits small (<= 100) for snappy results.
