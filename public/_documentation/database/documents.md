# documents

Document storage built on the shared `posts` table (`postType: 'doc'`) with TipTap JSON payloads and hook integration.

---

## What does it do?

-   Serializes rich-text documents into the `posts` table without introducing a new Dexie store.
-   Surfaces CRUD helpers that parse/merge content and titles through hook filters.
-   Provides soft- and hard-delete paths, plus `file_hashes` tracking derived from document content.
-   Provides a reference-only hash query that reads the sparse `document_reference_key` index without loading document bodies.

---

## Data structures

| Row              | Field                          | Meaning                                                                    |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `DocumentRow`    | `content: string`              | Raw JSON string persisted in Dexie.                                        |
|                  | `postType`                     | Always `'doc'`; used to discriminate from prompts/posts.                   |
|                  | `deleted: boolean`             | Soft delete flag toggled via `softDeleteDocument`.                         |
|                  | `file_hashes`                  | Serialized JSON array of hashes from embedded file nodes.                  |
|                  | `document_reference_key`       | Local-only `[serializedFileHashes, documentId]` index key for active docs. |
| `DocumentRecord` | `content: any`                 | Parsed TipTap JSON returned to callers.                                    |

`document_reference_key` is maintained by the Dexie write boundary (see `derived-indexes.ts`), is never synchronized, and is ignored when present in incoming payloads.

---

## API surface

| Function                    | Description                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `createDocument(input?)`    | Validates title/content, runs hooks, writes a new row, returns parsed record.              |
| `getDocument(id)`           | Loads a single document, applies output filters, returns parsed record.                    |
| `listDocuments(limit?)`     | Fetches non-deleted docs, sorts by `updated_at` desc, slices to limit, applies filters.    |
| `listDocumentFileHashes()`  | Unique file hashes referenced by active documents, from index keys only.                   |
| `updateDocument(id, patch)` | Re-resolves titles/content, fires before/after hooks, persists and returns updated record. |
| `softDeleteDocument(id)`    | Marks `deleted: true` and bumps `updated_at`.                                              |
| `hardDeleteDocument(id)`    | Removes the row entirely.                                                                  |

`listDocumentFileHashes()` is a storage-facts API: it does not return `DocumentRecord`s, does not parse `content`, and does not invoke `db.documents.list:filter:output`. Keep using `listDocuments`/`getDocument` when callers need full records and hook output filters.

---

## Hooks

-   `db.documents.title:filter` — customize title normalization per phase.
-   `db.documents.<stage>:filter:input/output` — mutate entities before persistence or after reads.
-   `db.documents.delete:action:*` — observe both soft and hard deletes.

`listDocumentFileHashes()` intentionally bypasses document output filters; index maintenance is not hook-driven and runs independently of sync capture suppression.

---

## Implementation notes

1. **Title normalization** — `normalizeTitle` trims empty strings to `'Untitled'`, then passes through the `db.documents.title:filter` hook with phase/id/raw context.
2. **Content safety** — `parseContent` guards against malformed JSON, returning an empty doc structure on error.
3. **Update payloads** — Build `DbUpdatePayload` objects so hooks receive full `existing`, `updated`, and `patch` context.
4. **File hashes** — `file_hashes` is derived from embedded file nodes in the content via `serializeDocumentFileHashes` on create and update.
5. **Reference index** — Active document rows receive a sparse `[file_hashes, id]` key at the Dexie write boundary; soft deletion removes it and restore recomputes it. `listDocumentFileHashes` enumerates only those keys and deduplicates with `parseDocumentFileHashes`.

---

## Usage tips

-   Use `listDocuments()` for sidebar listings; it already caps results and filters deleted rows.
-   Use `listDocumentFileHashes()` for “used in docs” membership or other reference facts where document content must stay unloaded.
-   Call `updateDocument` with partial patches—passing `content` as TipTap JSON automatically serializes to string.
-   Write hook extensions to auto-tag docs or enforce title casing.
