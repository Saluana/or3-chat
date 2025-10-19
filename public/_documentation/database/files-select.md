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
| `updateFileName`             | `(hash: string, name: string) => Promise<void>`   | Renames a file (if found) and updates `updated_at`. |

---

## Filtering rules

-   Images are detected via `kind === 'image'` or `mime_type` prefix `image/`.
-   Deleted and non-deleted lists are separated to simplify UI logic.

---

## Usage tips

-   Combine with `createOrRefFile` / `softDeleteFile` from `files.ts` for lifecycle actions.
-   Use `offset`/`limit` for infinite scroll; Dexie performs the filtering client-side so keep limits small (<= 100) for snappy results.
