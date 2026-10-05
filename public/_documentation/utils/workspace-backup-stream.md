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
unsupported format/version, a different database name, a backup schema newer
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
documents, and stored preferences; follow the [backup safety guidance](/documentation/database/backup#export).
The UI recognizes supported older Dexie exports separately; do not assume
those files use this stream format or these stream-import guarantees.
