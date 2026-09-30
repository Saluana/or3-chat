# Messages

Thread message CRUD utilities with hook integration, sparse indexing, and attachment support.

---

## What does it do?

-   Creates, upserts, and queries messages with schema validation.
-   Manages sparse indexes (`index` field) to support fast insertion and ordered retrieval.
-   Exposes transactional helpers for append/move/copy/insert operations that also update thread timestamps.
-   Provides normalization tools like `normalizeThreadIndexes`.

---

## Key data fields

| Field         | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `id`          | Message UUID (auto-generated for create flows).                 |
| `thread_id`   | Foreign key to the parent thread.                               |
| `role`        | Stored as a string; the hook entity adapter casts its type without runtime normalization. |
| `data`        | Unknown structured payload used by renderers; narrow before use.          |
| `index`       | Sparse ordering integer (default increments by 1000).           |
| `order_key`   | HLC-derived ordering key that breaks `index` ties deterministically. |
| `file_hashes` | Serialized JSON array of file hashes; use `files-util` helpers. |
| `clock`       | Revision counter.                                               |

---

## API surface

| Function                                          | Description                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `createMessage(input)`                            | Validates payload (including array → string conversion for `file_hashes`) and writes a row. |
| `upsertMessage(value)` / `upsertMessageInDb(db, value)` | Validates and replaces a row; the `InDb` variant targets an explicit DB.              |
| `patchMessageInDb(db, id, patch, fallback?, ifCurrent?)` | Merges owned fields into the latest row without replacing concurrent updates. |
| `messagesByThread(threadId)`                      | Fetches ordered messages, applying output filters.                                          |
| `getMessage(id)` / `messageByStream(streamId)`    | Targeted lookups with output filters.                                                       |
| `softDeleteMessage(id)` / `hardDeleteMessage(id)` | Delete flows with before/after hook actions.                                                |
| `appendMessage(input)` / `appendMessageToDb(db, input)` | Transactionally inserts at end of thread and updates timestamps.                      |
| `moveMessage(messageId, toThreadId)`              | Moves a message to another thread and reindexes.                                            |
| `copyMessage(messageId, toThreadId)`              | Duplicates a message into another thread with new ID.                                       |
| `insertMessageAfter(afterId, input)`              | Inserts between two messages, normalizing indexes as needed.                                |
| `normalizeThreadIndexes(threadId, start?, step?)` | Reassigns sequential indexes (default 1000 spacing).                                        |
| `compareMessageOrder(a, b)`                       | Orders by `index`, then `order_key`, then `id`; used by `messagesByThread`.                 |

---

## Hooks

-   `db.messages.create:filter:input` / `:action:before/after`
-   `db.messages.upsert`, `db.messages.byThread:filter:output`, `db.messages.get:filter:output`
-   Action hooks for delete, append, move, copy, insert, and normalize operations.

These hooks allow feature modules to enrich messages (e.g., auto-tagging, analytics) and react to lifecycle changes.

`patchMessageInDb` runs preparation hooks before opening its write transaction.
Its optional synchronous `ifCurrent` callback then receives the stored row
(`undefined` if it was deleted) inside that transaction. Returning `false` skips
the write and after hook, even when a fallback was supplied. Chat finalization
uses this guard to avoid saving over a newer generation or resurrecting a deleted
message after an asynchronous hook.

---

## Sparse indexing strategy

-   New messages default to increments of `1000`, leaving gaps for future inserts.
-   `insertMessageAfter` uses midpoint spacing; when no gap remains it calls `normalizeThreadIndexes` to re-sequence.
-   Dexie compound index `[thread_id+index]` keeps ordering queries fast; `messagesByThread` also sorts by `order_key` then `id` to break ties deterministically.

---

## Usage tips

-   Creation helpers accept hash arrays and serialize them; full-row upserts use the stored JSON string contract. Use [message-file helpers](/documentation/database/message-files) to change an existing message's attachments.
-   Use `appendMessage` rather than manual `createMessage` when you need thread timestamps updated.
-   Keep sparse indexes. Insert helpers normalize only when needed; do not renumber entire threads after every edit.
