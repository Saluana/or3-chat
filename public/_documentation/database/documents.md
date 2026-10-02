# Documents

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

## Live editor content and autosave

Source editors use `app/composables/documents/useDocumentsStore.ts` to stage title/content changes and debounce writes (currently 750 ms). Cached content and a scheduled save are not evidence of local durability. Explicitly flush and confirm the saved/error state before a workflow depends on that content being persisted.

The document cache and staged writes belong to the originating workspace database. Copied or imported documents with the same ID in different workspaces have separate state. A pending save or read completion after a workspace switch stays in its original database; it cannot replace the active workspace's cached document or save notification. Failed saves retain their staged changes for retry in the original workspace.

Resolve the exact mounted editor through `app/composables/documents/useDocumentEditorSessions.ts`. Modern sessions use pane/tab identity, so a split view can select the intended editor. Session capture and local-durability methods serve different purposes. An inactive document generally supplies saved read-only content rather than a live editor snapshot.

Releasing a cached document drops heavy content and timers. The current `releaseDocument` implementation suppresses flush errors during release, so release alone is not a successful-save acknowledgement. Keep save/error handling explicit before navigation or teardown, and preserve workspace admission guards.

## Document AI proposals

The document AI composer accepts a request, attachments, saved/plugin slash actions, and document/chat references. Slash actions insert a prompt without immediately sending it. References are deduplicated and resolved again before submission; a missing/deleted reference or a reference to the current document is refused.

The request separates the user prompt, frozen editable document context, and escaped read-only reference context. With a selection, only that selection is writable through a single replace_selection operation. Without a selection, the cursor block is the default target unless the request calls for broader edits. Large documents use bounded local context plus outline/chunk lookup instead of duplicating the entire document in every request.

Reference content counts toward context limits but does not grant editable block references. Proposed operations must validate against the frozen snapshot and enter the review UI. Only accepting the proposal writes the edit. Changes to the document, stale snapshots, workspace switches, and another pending proposal can invalidate edit authority.

Source hooks `ai.document.edit:filter:request` and `ai.document.edit:action:before` expose editable context and separate referenceContext; preserve that distinction. The implementation is `app/composables/documents/useDocumentAiAgent.ts`. Its live editor bridge also serves [document tools in chat](/documentation/utils/chat-tools).
