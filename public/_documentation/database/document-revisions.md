# document-revisions

Document revision manifests and chunks stored in the shared `posts` table, with retention pruning.

---

## What does it do?

-   Saves snapshots of documents as revision manifests plus encoded content chunks.
-   Stores manifests and chunks in the `posts` table using internal post types.
-   Encodes snapshots in a Web Worker (gzip or identity base64url).
-   Prunes old revisions to a retention budget and repairs orphaned chunks.

---

## Internal post types

| Post type                       | Row holds                                                     |
| ------------------------------- | ------------------------------------------------------------- |
| `or3:document-revision`         | JSON manifest (version 1) describing one saved revision.      |
| `or3:document-revision-chunk`   | One encoded content chunk; `title` links back to its manifest.|

Manifest lookups use the `posts` compound index `[postType+title]`, where `title` holds the document id.

---

## Data structures

| Type                          | Meaning                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `DocumentRevisionManifest`    | Metadata: revision id, document id, source, timestamps, encoding, byte counts, chunk ids, file hashes. |
| `CompleteDocumentRevision`    | A manifest plus its decoded snapshot (`title` and TipTap `content`).     |
| `DocumentRevisionSource`      | `'auto'`, `'manual'`, `'ai'`, or `'restore'`.                            |

The retention budget is 5 MB total encoded size (`DOCUMENT_REVISION_BUDGET_BYTES`).

---

## API surface

| Function                              | Description                                                              |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `readDocumentRevision(manifest)`      | Loads chunks and decodes the snapshot in a worker; null when incomplete. |
| `listCompleteDocumentRevisions(documentId)` | Returns decoded revisions for a document, newest first.           |
| `createDocumentRevision(input)`       | Encodes a snapshot, writes manifest plus chunks, prunes; null when unchanged. |
| `selectRevisionIdsForRetention(manifests, now?, budgetBytes?)` | Picks revisions to keep: 20 newest, one daily checkpoint per day over 14 days, always the newest. |
| `pruneDocumentRevisions(documentId)`  | Deletes revisions outside the retention set; returns `{ removed, overBudget }`. |
| `repairOrphanRevisionChunks(options)` | Deletes chunks older than 7 days whose manifest row is missing.          |

---

## Implementation notes

1. **Deduplication** — Creating a revision with the same title/content hash as the newest kept revision returns null and writes nothing.
2. **Budget** — Retention caps total encoded size at 5 MB. When over budget, the oldest preferred checkpoints are dropped until the cap is met; the newest revision is never removed.
3. **Worker encoding** — Snapshots are encoded and decoded in a Web Worker (`encodeRevisionInWorker` and `decodeRevisionInWorker`).
4. **Sync safety** — Every stored row is checked against the sync payload size limit before writing.
5. **Chunk links** — Chunk rows use `revisionId:chunk:N` ids and carry the revision id in `title`; the manifest stores the chunk id list.

---

## Usage tips

-   Use `listCompleteDocumentRevisions` to render a document history picker.
-   Call `createDocumentRevision` after document edits to create checkpoints; it prunes automatically.
-   Call `repairOrphanRevisionChunks` after workspace import with `bootstrapComplete: true` to clean up dangling chunks.
