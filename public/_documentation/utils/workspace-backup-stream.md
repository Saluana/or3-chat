# Workspace backup stream contract

This page records the host codec contract for source maintainers. For the
user-facing export/import flow and its safety choices, see [Back up and restore a workspace](/documentation/database/backup).

## Versioned JSONL format

`app/utils/workspace-backup-stream.ts` writes one JSON object per line. Version
1 uses a `meta` header with the database name/version, creation time, and each
table's declared row count, followed by `table-start`, `rows`, and `table-end`
records, then a required `end` marker. The format ID is
`or3-backup-stream`.

Export streams rows instead of collecting the whole database in memory. The
default batch size is 500 rows. `file_blobs` batches contain at most 20 rows
and flush at about 256 KiB of serialized blob data; a single large blob can
make a line exceed that threshold. Blob bytes are encoded as base64 with their
MIME type. Tables without inline keys are exported as explicit key/value
tuples, but import rejects these unsupported custom tables before clearing data.
Current OR3 workspace tables use inline key paths.

Before writing the terminal marker or committing the destination, export checks
its SHA-256 fingerprint against a second read in one database transaction.
The fingerprint covers table declarations, row counts, records, and each
blob's hash, MIME type, length, and bytes; only the informational export time
is excluded. Validation reads blobs without repeating base64 encoding and uses
native WebCrypto when available. It retains bounded batches, not a second
database or a complete in-memory backup.

Destination writes occur outside the validation transaction, so a slow download
does not hold a database read lock. Validation briefly delays concurrent writes
while reading the local snapshot. If content changed, export reports a retryable
error and aborts the destination without an `end` marker. A destination that
cannot retract bytes can leave an incomplete download; import rejects it.
Read, write, cancellation, and destination-close failures propagate to the
existing error/cancelled flow instead of reporting success.

## Import guarantees and boundaries

The importer targets the database passed by the caller. It rejects an
unsupported format/version, lines larger than 128 Mi characters, a different database name, a backup schema newer
than the running database, invalid or unknown table declarations, and
row-count/marker mismatches. Replace mode requires metadata for every current
table before clearing any rows.

Import runs in one Dexie read/write transaction. It requires every declared
table to finish with the declared row count and a terminal marker; it rejects
truncated streams, unsupported line types, and records after the terminal
marker. A transaction failure rolls back its table changes. Duplicate source primary keys fail across batches in every mode. The importer
uses the actual table key path, including compound keys, and tracks source
identities for the current table. Missing or invalid primary keys also fail;
transaction rollback preserves destination rows. In append mode, destination
key conflicts fail unless overwrite is enabled. Overwrite uses record-level
`bulkPut`; it is not a field-by-field merge.

This codec is not an unrelated-schema migration format and does not encrypt
its contents. Workspace backups can contain private conversations, files,
documents, and stored preferences; follow the [backup safety guidance](/documentation/database/backup#local-only-export).
The UI recognizes supported older Dexie exports separately; do not assume
those files use this stream format or these stream-import guarantees.
## Cloud archive

Cloud uses a separate binary format (`.or3cloud`), not base64 JSONL. `shared/storage/workspace-archive.ts` owns version 1: `OR3CLOUD1\n`, a metadata frame, bounded JSON row frames, original-file frames, and a terminal checksum/count frame. Each frame has one bounded JSON header ending in a newline followed by exactly its declared number of body bytes. The archive digest covers every pre-terminal header/body after the magic. Original file hashes independently verify each binary body. Missing originals, duplicate identities, dangling attachment references, trailing bytes, private device KV, and checksum/size mismatches are rejected.

`GET /api/workspaces/backup?workspaceId=…` uses an authorized consistent paged snapshot. It spools metadata to a private temporary server file, streams originals with backpressure, and removes the spool afterward. No archive-sized buffer or base64 file body is created. A storage failure truncates the stream; the client checks frame boundaries, counts, and the terminal frame before closing the destination successfully. Original-file content cannot imitate that terminal frame. An incomplete file must be discarded.

The browser validates the entire immutable backup File before creating a fresh workspace, hashing 1 MiB slices and yielding during validation to keep the UI responsive. It reuses slices for direct upload and re-reads bounded row bodies for authorized sync writes. It does not restore transport state or replace an existing Cloud workspace. See [backup and restore](/documentation/database/backup).
