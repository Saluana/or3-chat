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
| `FileMetaSchema` / `FileMetaCreateSchema`     | Metadata for blobs, defaulting `ref_count` and `clock`.                    |

---

## Helpers

-   `newId()` — Returns `crypto.randomUUID()` when available, fallback to timestamp string.
-   `nowSec()` — Unix timestamp (seconds) used as default for timestamps.

---

## Usage tips

-   Always run incoming data through `parseOrThrow(schema, value)` to catch invalid shapes before writing to Dexie.
-   When extending schema fields, update both the base schema and any related create schema so defaults stay aligned.
-   Compose new derived types via `z.infer<typeof Schema>` to keep type safety consistent across modules.
