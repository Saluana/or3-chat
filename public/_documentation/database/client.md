# client

Dexie database client that defines the `Or3DB` schema, typed tables, and versioning rules.

---

## What does it do?

-   Establishes the IndexedDB database named `or3-db`.
-   Declares typed `Dexie.Table` instances for every entity.
-   Applies the current version `17` schema while preserving explicit upgrade paths for older installs.
-   Installs deterministic local derived-index hooks on every database instance, including workspace DBs.
-   Provides workspace-scoped database instances named `or3-db-${workspaceId}` held in a bounded LRU cache.

---

## Tables & indexes

| Table           | Primary key | Secondary indexes                                                                                                                                                                                                                                                                                                                        |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`      | `id`        | `name`, `clock`, `created_at`, `updated_at`                                                                                                                                                                                                                                                                                              |
| `threads`       | `id`        | `project_id`, `[project_id+updated_at]`, `parent_thread_id`, `[parent_thread_id+anchor_index]`, `status`, `pinned`, `deleted`, `last_message_at`, `clock`, `created_at`, `updated_at`                                                                                                                                                    |
| `messages`      | `id`        | `[thread_id+index+order_key]`, `[thread_id+index]`, `thread_id`, `index`, `role`, `deleted`, `stream_id`, `clock`, `created_at`, `updated_at`, `data.type`, `[data.type+data.executionState]`                                                                                                                                            |
| `kv`            | `id`        | `&name`, `clock`, `created_at`, `updated_at`                                                                                                                                                                                                                                                                                             |
| `attachments`   | `id`        | `type`, `name`, `clock`, `created_at`, `updated_at`                                                                                                                                                                                                                                                                                      |
| `file_meta`     | `hash`      | `[kind+deleted]`, `mime_type`, `clock`, `created_at`, `updated_at`, `gallery_state`, `[gallery_state+created_at+hash]`, `[gallery_state+size_bytes+hash]`, `[gallery_state+name+mime_type+created_at+size_bytes+hash]`                                                                                                                   |
| `file_blobs`    | `hash`      | (none)                                                                                                                                                                                                                                                                                                                                   |
| `posts`         | `id`        | `title`, `postType`, `[postType+title]`, `document_reference_key`, `deleted`, `created_at`, `updated_at`                                                                                                                                                                                                                                 |
| `pending_ops`   | `id`        | `tableName`, `status`, `createdAt`, `[tableName+pk]`, `[status+readyAt+createdAt+id]`                                                                                                                                                                                                                                                    |
| `tombstones`    | `id`        | `[tableName+pk]`, `deletedAt`                                                                                                                                                                                                                                                                                                            |
| `sync_state`    | `id`        | (none)                                                                                                                                                                                                                                                                                                                                   |
| `sync_runs`     | `id`        | `startedAt`, `status`                                                                                                                                                                                                                                                                                                                    |
| `file_transfers`| `id`        | `hash`, `direction`, `state`, `workspace_id`, `created_at`, `updated_at`, `retry_at`, `lease_owner`, `lease_expires_at`, `[hash+direction]`, `[state+created_at]`, `[state+workspace_id]`, `[state+workspace_id+created_at]`, `[state+lease_expires_at]`, `[state+workspace_id+lease_expires_at]`, `[state+workspace_id+retry_at]`    |
| `notifications` | `id`        | `user_id`, `[user_id+read_at]`, `[user_id+created_at]`, `[user_id+thread_id]`, `type`, `deleted`, `clock`, `created_at`, `updated_at`                                                                                                                                                                                                   |

-   `pending_ops`, `tombstones`, `sync_state`, and `sync_runs` are sync tables added in version 7.
-   `file_transfers` is a local-only transfer queue added in version 8, with durable leases and retry scheduling added in version 13.
-   `notifications` was added in version 12.
-   `file_blobs` stores raw binary objects; the rest are JSON-like metadata rows.

### Local derived indexes (version 16)

Version 16 adds two sparse, local-only derived fields and their indexes:

-   `posts.document_reference_key` — `[serializedFileHashes, documentId]` for active `postType === 'doc'` rows with nonempty `file_hashes`.
-   `file_meta.gallery_state` — `'active' | 'trash'` for rows that pass the verified raster rules.

Derived keys are recomputed at the Dexie write boundary on create, update, bulk write, remote apply, snapshot install, and backup restore; they are stripped from sync payloads by `sanitizePayloadForSync` and never trusted from incoming data. The v16 upgrade populates them for existing rows without parsing document bodies.

### Outbox due-time projection (version 17)

Version 17 adds one local-only scheduling field and its index:

-   `pending_ops.readyAt` — `nextAttemptAt ?? 0`, where `0` means immediately eligible. `createdAt` remains an ordering tie-breaker, not an eligibility condition.

The v17 upgrade backfills `readyAt` transactionally from the same projection rule without rewriting operation identity, revisions, attempts, statuses, or payloads; legacy rows with absent retry times stay discoverable (`readyAt: 0`). Every `pending_ops` create/update path recomputes `readyAt` from the effective committed row (including when `nextAttemptAt` is cleared), so capture, retry, deferral, manual retry, bulk writes, and startup recovery keep the index current in the same transaction. A failed migration aborts opening rather than clearing the queue.

`[status+readyAt+createdAt+id]` serves status-scoped due ranges (`readyAt <= now`, inclusive) already ordered by `(readyAt, createdAt, id)` before limiting. `readyAt` is stripped before wire-size calculation and provider submission and never leaves the device.

---

## Usage

```ts
import { db } from '~/app/db';

await db.open();
const allThreads = await db.threads.toArray();
```

-   Prefer the higher-level modules (`threads.ts`, `messages.ts`, etc.) for business logic and hook coverage.
-   Use `getDb()` instead of importing `db` directly; the bare `db` reference goes stale when the active workspace changes.
-   Only change the schema via `this.version(<next>).stores({...})` and bump the version number; ensure you migrate existing data when necessary.

---

## Versioning tips

-   Add new schema changes with `this.version(<next>).stores({...})` and a transactional upgrade when stored rows need repair.
-   Older clients cannot open a database created by a newer schema. Restore backups only into the same or a newer application version.
-   Workspace database instances are held in a bounded LRU cache. The active workspace is kept hot while inactive connections are evicted, and closed cached instances can reopen if browser storage is cleared.
