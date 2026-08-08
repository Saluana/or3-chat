# schema

Central Zod schemas and generated TypeScript types for all Dexie tables.

---

## What does it do?

-   Defines runtime validation for every entity (`Project`, `Thread`, `Message`, etc.).
-   Supplies create-specific schemas that auto-populate IDs/timestamps via transforms.
-   Exports inferred TypeScript types to keep DB modules strongly typed.

---

## Schemas overview

| Schema                                        | Highlights                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `ProjectSchema`                               | Basic metadata with optional description/data and `clock` counter.         |
| `ThreadSchema`                                | Supports branching fields (`parent_thread_id`, `anchor_*`, `branch_mode`). |
| `ThreadCreateSchema`                          | Optional fields with defaults for `id`, `clock`, timestamps.               |
| `MessageSchema`                               | Includes `file_hashes` string column, `stream_id`, sparse `index`.         |
| `MessageCreateSchema`                         | Auto-generates `id`, `clock`, timestamps; leaves `index` optional.         |
| `PostSchema` / `PostCreateSchema`             | Covers generic posts plus normalized title/meta logic.                     |
| `KvSchema` / `KvCreateSchema`                 | Simple key-value store with optional `value`.                              |
| `AttachmentSchema` / `AttachmentCreateSchema` | Enforces URL+type/name, optional `deleted`.                                |
| `FileMetaSchema` / `FileMetaCreateSchema`     | Metadata for blobs, defaulting `ref_count` to 1 and `clock` to 0.          |
| `NotificationActionSchema`                    | Action with `navigate` or `callback` kind and optional target fields.      |
| `NotificationSchema` / `NotificationCreateSchema` | Inbox records scoped by `user_id` with actions, read state, and clocks. |

Derived types mirror the schemas exactly: `Project`, `Thread`, `ThreadCreate`, `Message`, `MessageCreate`, `Post`, `PostCreate`, `Kv`, `KvCreate`, `Attachment`, `AttachmentCreate`, `FileMeta`, `FileMetaCreate`, `NotificationAction`, `Notification`, and `NotificationCreate`.

---

## Helpers

-   `newId()` — UUID v4 from the shared runtime-compatible generator; prefers `crypto.randomUUID()`, falls back to `crypto.getRandomValues()`, and keeps UUID shape with a non-cryptographic last resort.
-   `nowSec()` — Unix timestamp (seconds) used as default for timestamps.

---

## Usage tips

-   Always run incoming data through `parseOrThrow(schema, value)` to catch invalid shapes before writing to Dexie.
-   When extending schema fields, update both the base schema and any related create schema so defaults stay aligned.
-   Compose new derived types via `z.infer<typeof Schema>` to keep type safety consistent across modules.
