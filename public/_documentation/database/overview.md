# Browser database

OR3 stores local workspace data in Dexie/IndexedDB. The local-first database is `or3-db`; authenticated workspaces use `or3-db-<workspaceId>`. Cloud sync builds on these local writes. It does not replace browser persistence.

These are **host source APIs**. Portable plugins use [SDK storage](/documentation/plugins/plugin-sdk), which enforces ownership and permissions, instead of importing Dexie or writing core tables.

## Start with a task

| Task | Guide |
| --- | --- |
| Save a preference or document | [Persist your first data](/documentation/database/first-data) |
| Handle workspace switches, transactions, and errors | [Make safe database changes](/documentation/database/safe-changes) |
| Find tables, indexes, and upgrades | [Database client](/documentation/database/client) |
| Choose a row/input type | [Database types](/documentation/types/database) |

## Pick the right storage

| Data | Storage and helper |
| --- | --- |
| Small preferences | [KV](/documentation/database/kv) |
| Chat records | [Threads](/documentation/database/threads) and [messages](/documentation/database/messages) |
| Project metadata | [Projects](/documentation/database/projects) |
| Custom records | [Posts](/documentation/database/posts); use a unique, non-reserved post type. |
| TipTap documents | [Documents](/documentation/database/documents), stored as `postType: 'doc'` posts. |
| Saved system prompts | [Prompts](/documentation/database/prompts), stored as `postType: 'prompt'` posts. |
| Uploaded bytes | [Files](/documentation/database/files): metadata and blobs. |
| Message/file relationships | [Message files](/documentation/database/message-files) |
| Legacy URL attachment records | [Attachments](/documentation/database/attachments); these do not own file blobs. |

Sync queues, tombstones, transfer state, and derived indexes belong to their existing subsystems. Do not use them as generic application storage or create another global database.

## Imports and helper namespaces

Nuxt's `~/` points to `app/`. Use `~/db`, not `~/app/db`. Import specific helpers from their module for clarity, or use the barrel's namespaces:

| Export from `~/db` | Contents |
| --- | --- |
| `create` | thread, message, kv, attachment, project, post, document. |
| `upsert` | Corresponding writes; `document` is `updateDocument(id, patch)`, not a full-row put. |
| `queries` | Read/query helpers across supported entities. |
| `del.soft` | Entity soft deletes; no KV member. |
| `del.hard` | Hard deletes, including KV by ID and name. |
| `tx` | appendMessage, moveMessage, copyMessage. |
| `kv` | Name-based get, set, delete; get returns the **row**, not its value. |

The barrel also re-exports common types. It does not export every module helper: use `~/db/posts` for `createPost` and `~/db/client` for `getDb`. Its legacy `db` export can become stale across workspace switches; new code should use `getDb()` at operation time.

## Backups and recovery

Use **Workspace Backup** to export the active workspace before destructive changes. Browser storage is specific to the profile and origin. Missing work after changing hosts, ports, or accounts can be a different database, not lost records. See [safe changes](/documentation/database/safe-changes) before resetting storage or introducing migrations.
