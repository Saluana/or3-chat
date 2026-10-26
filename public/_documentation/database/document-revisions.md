# Document history

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

The retention target is 5 MiB of encoded revision content per document (`DOCUMENT_REVISION_BUDGET_BYTES`). It is best effort because the newest complete revision and checkpoints required by currently valid chat Undo receipts are retained.

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
2. **Budget** — Retention prunes toward 5 MiB. When over budget, the oldest preferred checkpoints are dropped; the newest revision is never removed. A newest snapshot larger than the budget can leave `overBudget: true`.
3. **Worker encoding** — Snapshots are encoded and decoded in a Web Worker (`encodeRevisionInWorker` and `decodeRevisionInWorker`). When the browser reports offline, the already-loaded local codec handles both operations without fetching a worker script. Requests cross the worker boundary as detached JSON data, including nested reactive document attributes. A failed dispatch rejects the request and releases its pending callback; acceptance preserves the proposal for retry if checkpoint creation fails.
4. **Sync safety** — Every stored row is checked against the sync payload size limit before writing.
5. **Chunk links** — Chunk rows use `revisionId:chunk:N` ids and carry the revision id in `title`; the manifest stores the chunk id list.

---

## Usage tips

-   Use `listCompleteDocumentRevisions` to render a document history picker.
-   Call `createDocumentRevision` after document edits to create checkpoints; it prunes automatically.
-   Call `repairOrphanRevisionChunks` after workspace import with `bootstrapComplete: true` to clean up dangling chunks.


## Recovery and live history

Open history panels observe the relevant workspace/document revision rows and
refresh after automatic, AI, manual and external saves. An existing preview stays
open while its revision remains available. Subscriptions are disposed on scope
change and unmount.

Automatic history failures are shown separately from local body-save failures.
The editor retries after 5, 30 and 60 seconds, then waits for an explicit **Retry
saved version** or a later edit. Retries keep document, workspace and account
ownership and never overwrite the body. Restoring a version locks editing while
preparing the pre-restore checkpoint and refuses intervening changes.

Pruning verifies complete, checksummed checkpoints before selecting retention.
It validates canonical chunk IDs, row types and parent ownership; a manifest
cannot authorize deleting an unrelated post. Incomplete deliveries have a
seven-day grace period, and cleanup preserves all history if none is readable.
Assessed rows and the current document are rechecked in the deletion transaction.
Chat Apply/Undo runs this same retention after its atomic checkpoint/content/
receipt commit. Receipts for the current document revision pin their Undo
checkpoint; obsolete receipts do not retain history indefinitely.
