# client

Dexie database client that defines the `Or3DB` schema, typed tables, and versioning rules.

---

## What does it do?

-   Establishes the IndexedDB database named `or3-db`.
-   Declares typed `Dexie.Table` instances for every entity.
-   Applies the current version `15` schema while preserving explicit upgrade paths for older installs.
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
| `file_meta`     | `hash`      | `[kind+deleted]`, `mime_type`, `clock`, `created_at`, `updated_at`                                                                                                                                                                                                                                                                       |
| `file_blobs`    | `hash`      | (none)                                                                                                                                                                                                                                                                                                                                   |
| `posts`         | `id`        | `title`, `postType`, `[postType+title]`, `deleted`, `created_at`, `updated_at`                                                                                                                                                                                                                                                           |
| `pending_ops`   | `id`        | `tableName`, `status`, `createdAt`, `[tableName+pk]`                                                                                                                                                                                                                                                                                     |
| `tombstones`    | `id`        | `[tableName+pk]`, `deletedAt`                                                                                                                                                                                                                                                                                                            |
| `sync_state`    | `id`        | (none)                                                                                                                                                                                                                                                                                                                                   |
| `sync_runs`     | `id`        | `startedAt`, `status`                                                                                                                                                                                                                                                                                                                    |
| `file_transfers`| `id`        | `hash`, `direction`, `state`, `workspace_id`, `created_at`, `updated_at`, `retry_at`, `lease_owner`, `lease_expires_at`, `[hash+direction]`, `[state+created_at]`, `[state+workspace_id]`, `[state+workspace_id+created_at]`, `[state+lease_expires_at]`, `[state+workspace_id+lease_expires_at]`, `[state+workspace_id+retry_at]`    |
| `notifications` | `id`        | `user_id`, `[user_id+read_at]`, `[user_id+created_at]`, `[user_id+thread_id]`, `type`, `deleted`, `clock`, `created_at`, `updated_at`                                                                                                                                                                                                   |

-   `pending_ops`, `tombstones`, `sync_state`, and `sync_runs` are sync tables added in version 7.
-   `file_transfers` is a local-only transfer queue added in version 8, with durable leases and retry scheduling added in version 13.
-   `notifications` was added in version 12.
-   `file_blobs` stores raw binary objects; the rest are JSON-like metadata rows.

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
