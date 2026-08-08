# files

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
| `kind`           | `'image'` or `'pdf'` (auto-detected).                           |
| `size_bytes`     | Blob size in bytes; enforced against a default 20 MB cap.       |
| `width`/`height` | Optional image dimensions extracted via object URL.             |
| `ref_count`      | Number of referencing entities (messages).                      |
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
2. **Image metadata** — Uses an object URL to resolve dimensions without full decode; errors are swallowed gracefully.
3. **Transactions** — Critical write operations run inside Dexie transactions covering both metadata and blob tables to keep state consistent. Deduplication is rechecked inside the write transaction so concurrent identical uploads increment one canonical metadata row instead of overwriting its reference count.
4. **Transfer queue** — New files without a remote storage id are enqueued for upload; `ensureFileBlob` downloads missing blobs through the storage transfer queue when it is available.

---

## Usage tips

-   Always call `derefFile` when removing file references from messages to keep ref counts accurate.
-   `ref_count` represents unique live message edges, not upload attempts. Use the message-file helpers so duplicate or hook-pruned attachments are reconciled automatically.
-   Hook into `db.files.create:filter:input` to enforce custom size caps or rename files.
-   When batch deleting, prefer `softDeleteMany` first; run `hardDeleteMany` during periodic cleanups to reclaim storage.
