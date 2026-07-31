# client

Dexie database client that defines the `Or3DB` schema, typed tables, and versioning rules.

---

## What does it do?

-   Establishes the single IndexedDB database named `or3-db`.
-   Declares typed `Dexie.Table` instances for every entity (projects, threads, messages, etc.).
-   Applies the current version `15` schema while preserving explicit upgrade paths for older installs.

---

## Tables & indexes

| Table         | Primary key | Secondary indexes                                                                                                                                                       |
| ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`    | `id`        | `name`, `clock`, `created_at`, `updated_at`                                                                                                                             |
| `threads`     | `id`        | `[project_id+updated_at]`, `parent_thread_id`, `[parent_thread_id+anchor_index]`, `status`, `pinned`, `deleted`, `last_message_at`, `clock`, `created_at`, `updated_at` |
| `messages`    | `id`        | `[thread_id+index]`, `thread_id`, `index`, `role`, `deleted`, `stream_id`, `clock`, `created_at`, `updated_at`                                                          |
| `kv`          | `id`        | `&name`, `clock`, `created_at`, `updated_at`                                                                                                                            |
| `attachments` | `id`        | `type`, `name`, `clock`, `created_at`, `updated_at`                                                                                                                     |
| `file_meta`   | `hash`      | `[kind+deleted]`, `mime_type`, `clock`, `created_at`, `updated_at`                                                                                                      |
| `file_blobs`  | `hash`      | (none)                                                                                                                                                                  |
| `posts`       | `id`        | `title`, `postType`, `deleted`, `created_at`, `updated_at`                                                                                                              |

> ℹ️ `file_blobs` stores raw Binary Large Objects; the rest are JSON-like metadata rows.

---

## Usage

```ts
import { db } from '~/app/db';

await db.open();
const allThreads = await db.threads.toArray();
```

-   Prefer the higher-level modules (`threads.ts`, `messages.ts`, etc.) for business logic and hook coverage.
-   Only change the schema via `this.version(<next>).stores({...})` and bump the version number; ensure you migrate existing data when necessary.

---

## Versioning tips

-   Add new schema changes with `this.version(<next>).stores({...})` and a transactional upgrade when stored rows need repair.
-   Older clients cannot open a database created by a newer schema. Restore backups only into the same or a newer application version.
-   Workspace database instances are held in a bounded LRU cache. The active workspace is kept hot while inactive connections are evicted, and closed cached instances can reopen if browser storage is cleared.
