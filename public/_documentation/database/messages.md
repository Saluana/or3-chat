# messages

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
| `role`        | `'user' \| 'assistant' \| 'system'` (validated via schema).     |
| `data`        | Arbitrary payload (serialized JSON) used by renderers.          |
| `index`       | Sparse ordering integer (default increments by 1000).           |
| `file_hashes` | Serialized JSON array of file hashes; use `files-util` helpers. |
| `clock`       | Revision counter.                                               |

---

## API surface

| Function                                          | Description                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `createMessage(input)`                            | Validates payload (including array → string conversion for `file_hashes`) and writes a row. |
| `upsertMessage(value)`                            | Validates and replaces a row.                                                               |
| `messagesByThread(threadId)`                      | Fetches ordered messages, applying output filters.                                          |
| `getMessage(id)` / `messageByStream(streamId)`    | Targeted lookups with output filters.                                                       |
| `softDeleteMessage(id)` / `hardDeleteMessage(id)` | Delete flows with before/after hook actions.                                                |
| `appendMessage(input)`                            | Transactionally inserts at end of thread and updates timestamps.                            |
| `moveMessage(messageId, toThreadId)`              | Moves a message to another thread and reindexes.                                            |
| `copyMessage(messageId, toThreadId)`              | Duplicates a message into another thread with new ID.                                       |
| `insertMessageAfter(afterId, input)`              | Inserts between two messages, normalizing indexes as needed.                                |
| `normalizeThreadIndexes(threadId, start?, step?)` | Reassigns sequential indexes (default 1000 spacing).                                        |

---

## Hooks

-   `db.messages.create:filter:input` / `:action:before/after`
-   `db.messages.upsert`, `db.messages.byThread:filter:output`, `db.messages.get:filter:output`
-   Action hooks for delete, append, move, copy, insert, and normalize operations.

These hooks allow feature modules to enrich messages (e.g., auto-tagging, analytics) and react to lifecycle changes.

---

## Sparse indexing strategy

-   New messages default to increments of `1000`, leaving gaps for future inserts.
-   `insertMessageAfter` uses midpoint spacing; when no gap remains it calls `normalizeThreadIndexes` to re-sequence.
-   Dexie compound index `[thread_id+index]` keeps ordering queries fast.

---

## Usage tips

-   Always feed `file_hashes` as string arrays; the module serializes and bounds automatically.
-   Use `appendMessage` rather than manual `createMessage` when you need thread timestamps updated.
-   Call `normalizeThreadIndexes` after bulk edits to keep indexes tidy.
