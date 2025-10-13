# attachments

Attachment table helpers for creating, updating, and deleting upload metadata with full hook coverage.

---

## What does it do?

-   Validates attachment payloads against `AttachmentCreateSchema`/`AttachmentSchema`.
-   Pipes all mutations through `dbTry` so quota and Dexie errors surface with contextual toasts.
-   Fires hook filters/actions around create, upsert, soft delete, hard delete, and reads.
-   Provides `nowSec()` driven soft delete flagging so rows stay recoverable until hard-deleted.

---

## Data shape

| Field        | Type      | Notes                                                |
| ------------ | --------- | ---------------------------------------------------- |
| `id`         | `string`  | Primary key supplied by caller.                      |
| `type`       | `string`  | Attachment type tag (image/pdf/etc).                 |
| `name`       | `string`  | Display name.                                        |
| `url`        | `string`  | Blob/object URL or remote link. Must be a valid URL. |
| `created_at` | `number`  | Unix timestamp (sec). Auto-defaulted by schema.      |
| `updated_at` | `number`  | Unix timestamp (sec). Auto-defaulted by schema.      |
| `deleted`    | `boolean` | Soft delete flag toggled by `softDeleteAttachment`.  |
| `clock`      | `number`  | Monotonic revision counter.                          |

---

## API surface

| Function               | Signature                                          | Description                                              |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `createAttachment`     | `(input: AttachmentCreate) => Promise<Attachment>` | Filter + validate + insert new attachment row.           |
| `upsertAttachment`     | `(value: Attachment) => Promise<void>`             | Filter + validate + replace existing attachment.         |
| `softDeleteAttachment` | `(id: string) => Promise<void>`                    | Marks an attachment as deleted and bumps `updated_at`.   |
| `hardDeleteAttachment` | `(id: string) => Promise<void>`                    | Removes the row outright (no blob storage handled here). |
| `getAttachment`        | `(id: string) => Promise<Attachment                | undefined>`                                              | Reads a single attachment and applies output filters. |

---

## Hook points

-   `db.attachments.create:filter:input` → mutate incoming payloads before validation.
-   `db.attachments.create:action:before/after`
-   `db.attachments.upsert:filter:input` + matching before/after actions.
-   `db.attachments.delete:action:soft:*` and `db.attachments.delete:action:hard:*` fire during deletes.
-   `db.attachments.get:filter:output` lets consumers normalize read results.

---

## Usage tips

-   Always supply a `clock` increment when calling `upsertAttachment`; schema enforces numeric clocks.
-   Soft deletes keep the blob data available; schedule `hardDeleteAttachment` when you want to reclaim disk.
-   Extend hooks to inject signed URLs or sanitize file names before persistence.
