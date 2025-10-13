# client

Dexie database client that defines the `Or3DB` schema, typed tables, and versioning rules.

---

## What does it do?

-   Establishes the single IndexedDB database named `or3-db`.
-   Declares typed `Dexie.Table` instances for every entity (projects, threads, messages, etc.).
-   Collapses historical migrations into version `5` so existing installs stay compatible without upgrade churn.

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

-   Keep version pegged at `5` until you add columns or indexes. When you bump, implement Dexie upgrade paths to migrate data.
-   Since older migrations were consolidated, new changes should avoid breaking existing user stores—plan upgrades carefully.
