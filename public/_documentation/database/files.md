# File storage

File storage layer that deduplicates blobs by hash, keeps metadata in Dexie, and exposes hook-friendly lifecycle helpers.

---

## What does it do?

-   Generates content hashes (`computeFileHash`) to reuse existing uploads.
-   Stores binary blobs in `file_blobs` and metadata in `file_meta` with ref counting.
-   Emits numerous hooks so extensions can validate, annotate, or track file usage.
-   Supports soft delete, restore, hard delete, and reference counting operations.

---

## Data structures

| Field            | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `hash`           | SHA-256 hash (`sha256:` prefix) used as primary key for both metadata and blob tables; legacy MD5 hashes remain readable. |
| `name`           | Display name supplied by uploader.                              |
| `mime_type`      | MIME type (defaults to `application/octet-stream`).             |
| `kind`           | `'image'`, `'pdf'`, or generic `'file'`; only verified PNG/JPEG/WebP/GIF bytes use image processing. |
| `size_bytes`     | Blob size in bytes; enforced against a default 20 MB cap.       |
| `width`/`height` | Optional image dimensions extracted via object URL.             |
| `ref_count`      | Derived local ownership count; canonical retained rows govern deletion. |
| `deleted`        | Soft delete flag set by `softDeleteFile`/`softDeleteMany`.      |

The max size cap defaults to 20 MB and is configurable via `or3.limits.maxFileSizeBytes` in runtime config.

---

## API surface

| Function                           | Description                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `createOrRefFile(file, name)`      | Dedupes by hash, increments ref count, stores blob + metadata, runs before/after hooks. |
| `getFileMeta(hash)`                | Loads metadata and applies output filters.                                              |
| `getFileBlob(hash)`                | Returns the stored `Blob`; falls back to `ensureFileBlob` when missing locally.         |
| `ensureFileBlob(hash)`             | Ensures a blob exists locally, downloading through the storage transfer queue (client only). |
| `softDeleteFile(hash)`             | Marks a single file as deleted.                                                         |
| `softDeleteMany(hashes)`           | Batch soft delete inside a transaction.                                                 |
| `restoreMany(hashes)`              | Clears `deleted` flag for multiple files.                                               |
| `hardDeleteMany(hashes)`           | Removes metadata and blob entries entirely.                                             |
| `derefFile(hash)`                  | Decrements ref count (never below zero).                                                |
| `changeRefCount(hash, delta)`      | Internal helper exported for testing/hooks (invokes `db.files.refchange`).              |
| `fileDeleteError(message, cause?)` | Convenience error factory with tags for delete flows.                                   |

---

## Hooks

-   `db.files.create:filter:input` and `db.files.create:action:(before|after)`
-   `db.files.get:filter:output`
-   `db.files.refchange:action:after`
-   `db.files.delete:action:(soft|hard):(before|after)`
-   `db.files.restore:action:(before|after)`

These make it easy to inject custom validation, analytics, or audit trails around file lifecycle events.

---

## Implementation notes

1. **Perf markers** — In dev mode the module records `performance.measure` spans for create/ref operations.
2. **File classification** — Missing MIME uses `application/octet-stream`; unknown, active, or signature-mismatched content is stored as generic `file`. Only verified PNG/JPEG/WebP/GIF bytes use the image dimension decoder. PDF handling remains MIME based.
3. **Transactions** — Critical write operations run inside Dexie transactions covering both metadata and blob tables to keep state consistent. Deduplication is rechecked inside the write transaction so concurrent identical uploads increment one canonical metadata row instead of overwriting its reference count.
4. **Transfer queue** — New files without a remote storage id are enqueued for upload; `ensureFileBlob` downloads missing blobs through the storage transfer queue when it is available.

---

## Usage tips

-   Use [message-file helpers](/documentation/database/message-files) to remove a reference. They decrement counts themselves; do not call `derefFile` again afterward.
-   `ref_count` represents unique live message edges, not upload attempts. Use the message-file helpers so duplicate or hook-pruned attachments are reconciled automatically.
-   Hook into `db.files.create:filter:input` to enforce custom size caps or rename files.
-   Local soft/hard deletion refuses hashes retained by live messages, posts, catalog entries, or revisions, including logically trashed items. It rechecks canonical edges inside the write transaction after before-delete hooks. A zero `ref_count` is insufficient authority to delete bytes.

## Catalog ownership

`app/db/workspace-files.ts` uses existing `posts`, `file_meta`, and transfer
storage. One `or3:file` post has a deterministic hash-derived identity, an
independent user title, one original `file_hashes` entry, and a bounded text
excerpt. `meta['or3.workspace-item']` contains versioned logical Trash and text
coverage; updates preserve unrelated metadata. Native documents without this
namespace remain visible. Unsupported namespaced states are hidden and refused
by mutation helpers.

Catalog intake, rename, Trash, Restore, text enablement, and permanent removal
require a captured workspace operation. Writes compare observed revisions
inside their transactions. Intake uses the existing attachment policy hook and
blob persistence. Catalog ownership survives removal of an originating message.
Item removal tombstones the post, releases its ownership edge, and never
directly deletes shared bytes or unrelated checkpoints.

Sync requests carry `workspaceItemCapability: 'v1'`. The canonical provider
must reject old-writer omission against incoming **and stored** posts/projects
before mutation. Old readers receive an explicit update boundary for affected
pages. SQLite native support and Convex template/provider updates are separate
publication dependencies; D1 does not advertise transactional workspace-item
admission. Cloud UI remains gated pending full provider/live qualification.
