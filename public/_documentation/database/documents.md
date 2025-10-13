# documents

Document storage built on the shared `posts` table (`postType: 'doc'`) with TipTap JSON payloads and hook integration.

---

## What does it do?

-   Serializes rich-text documents into the `posts` table without introducing a new Dexie store.
-   Surfaces CRUD helpers that parse/merge content and titles through hook filters.
-   Provides soft- and hard-delete paths, plus a small `ensureDbOpen` helper used by feature modules.

---

## Data structures

| Row              | Field              | Meaning                                                  |
| ---------------- | ------------------ | -------------------------------------------------------- |
| `DocumentRow`    | `content: string`  | Raw JSON string persisted in Dexie.                      |
|                  | `postType`         | Always `'doc'`; used to discriminate from prompts/posts. |
|                  | `deleted: boolean` | Soft delete flag toggled via `softDeleteDocument`.       |
| `DocumentRecord` | `content: any`     | Parsed TipTap JSON returned to callers.                  |

---

## API surface

| Function                    | Description                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `createDocument(input?)`    | Validates title/content, runs hooks, writes a new row, returns parsed record.              |
| `getDocument(id)`           | Loads a single document, applies output filters, returns parsed record.                    |
| `listDocuments(limit?)`     | Fetches non-deleted docs, sorts by `updated_at` desc, slices to limit, applies filters.    |
| `updateDocument(id, patch)` | Re-resolves titles/content, fires before/after hooks, persists and returns updated record. |
| `softDeleteDocument(id)`    | Marks `deleted: true` and bumps `updated_at`.                                              |
| `hardDeleteDocument(id)`    | Removes the row entirely.                                                                  |
| `ensureDbOpen()`            | Opens Dexie when closed (no-op if already open).                                           |

---

## Hooks

-   `db.documents.title:filter` — customize title normalization per phase.
-   `db.documents.<stage>:filter:input/output` — mutate entities before persistence or after reads.
-   `db.documents.delete:action:*` — observe both soft and hard deletes.

---

## Implementation notes

1. **Title normalization** — `normalizeTitle` trims empty strings to `'Untitled'`, then passes through hook filters.
2. **Content safety** — `parseContent` guards against malformed JSON, returning an empty doc structure on error.
3. **Update payloads** — Build `DbUpdatePayload` objects so hooks receive full `existing`, `updated`, and `patch` context.

---

## Usage tips

-   Use `listDocuments()` for sidebar listings; it already caps results and filters deleted rows.
-   Call `updateDocument` with partial patches—passing `content` as TipTap JSON automatically serializes to string.
-   Write hook extensions to auto-tag docs or enforce title casing.
