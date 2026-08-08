# Workspace Backup Stream

Streams workspace backups to and from a versioned JSONL format. Exports Dexie tables line by line, keeps `file_blobs` lines small, and imports with strict validation.

Workspace backups move large datasets without loading everything into memory. Export writes a metadata header followed by per-table row batches; import replays those lines inside Dexie transactions with format, schema, and row-count checks.

---

## Purpose

`workspace-backup-stream` provides:

- **Line-delimited export** — JSONL with a versioned metadata header
- **Bounded lines** — `file_blobs` rows are batched and size-capped
- **Strict import** — Validates format, database name, and schema version
- **Safe conflict handling** — Choose add-only or overwrite semantics
- **Progress reporting** — Table and row counts during long operations
- **Format detection** — Distinguish stream backups from legacy Dexie exports

---

## Basic Example

```ts
import { streamWorkspaceExport } from '~/utils/workspace-backup-stream';

// fileHandle from window.showSaveFilePicker()
await streamWorkspaceExport({
    db,
    fileHandle,
    onProgress: ({ completedTables, totalTables }) => {
        console.log(`${completedTables}/${totalTables} tables done`);
    },
});
```

---

## How to use it

### 1. Export to a file handle

```ts
await streamWorkspaceExport({ db, fileHandle });
```

Optional: `chunkSize` (default 500 rows per batch) and `onProgress`.

### 2. Export to a writable stream

```ts
await streamWorkspaceExportToWritable({ db, writable });
```

Useful for streaming to the network or another destination. Accepts a
`WritableStreamDefaultWriter<Uint8Array>`.

### 3. Detect the backup format

```ts
const kind = await detectWorkspaceBackupFormat(file);
// 'stream' | 'dexie' | 'unknown'
```

Returns `'stream'` when the first line is a valid meta header, `'dexie'` for
legacy Dexie exports, and `'unknown'` otherwise.

### 4. Peek at metadata before importing

```ts
const meta = await peekWorkspaceBackupMetadata(file);
// { type: 'meta', format, version, databaseName, tables, ... }
```

Reads only the header line. Throws for unsupported format versions.

### 5. Import a backup

```ts
await importWorkspaceStream({
    db,
    file,
    clearTables: false,       // replace mode: clears all tables first
    overwriteValues: true,    // bulkPut instead of bulkAdd on key conflicts
    onProgress,
});
```

Import rules:

- The backup format and version must be supported
- `databaseName` must match the target database
- The backup schema version must not be newer than the app's
- Every declared table must exist; replace mode requires the backup to include every table
- Row counts are verified per table; truncated or over-declared backups throw
- Terminal marker is required — incomplete files throw
- Key conflicts with `overwriteValues: false` throw with a hint to enable overwrite or replace mode

---

## API Reference

### Constants

```ts
const WORKSPACE_BACKUP_FORMAT = 'or3-backup-stream';
const WORKSPACE_BACKUP_VERSION = 1;
```

### Line types

The format is JSONL. Each line is one of:

```ts
type WorkspaceBackupLine =
    | { type: 'meta'; format; version; databaseName; databaseVersion;
        createdAt; tables: WorkspaceBackupTableSummary[] }
    | { type: 'table-start'; table: string }
    | { type: 'rows'; table: string; rows: unknown[] }
    | { type: 'table-end'; table: string }
    | { type: 'end' };
```

`file_blobs` rows carry `{ hash, blob: { data: string; type: string } }`
where `data` is base64.

### Progress

```ts
interface WorkspaceBackupProgress {
    completedTables: number;
    totalTables: number;
    completedRows: number;
    totalRows: number;
}
```

---

## How it works

### Export

1. Reads table names, row counts, and inbound-key status for every table
2. Writes the meta header
3. For each table, writes `table-start`, then batches of rows, then `table-end`
4. `file_blobs` batches are capped at 20 rows and about 256KB of serialized data
5. Outbound tables (no inbound key) write explicit `key`/`value` tuples
6. Closes with the `end` marker and reports final progress

### Import

1. Validates the header (format, version, database name, schema version)
2. Validates table metadata and row counts
3. Optionally clears all tables inside the transaction
4. Streams lines, verifying markers and counts
5. Writes rows with `bulkPut` (overwrite) or `bulkAdd` (conflict-safe)

---

## Limitations

- Not for cross-database migration between unrelated schemas
- No encryption — backups are plain JSONL (encryption is a higher layer)
- `clearTables: true` is destructive and requires a complete backup
- Imports are validated against the current Dexie schema

---

## Related

- `useWorkspaceBackup` — Composable that wraps export and import flows
- `useWorkspaceManager` — Workspace lifecycle and DB selection
- `~/db/client` — `Or3DB` type

---

## TypeScript

```ts
async function detectWorkspaceBackupFormat(file: Blob): Promise<'stream' | 'dexie' | 'unknown'>;
async function streamWorkspaceExport(opts: {
    db: Or3DB;
    fileHandle: FileSystemFileHandle;
    chunkSize?: number;
    onProgress?: (p: WorkspaceBackupProgress) => void;
}): Promise<void>;
async function streamWorkspaceExportToWritable(opts: {
    db: Or3DB;
    writable: WritableStreamDefaultWriter<Uint8Array>;
    chunkSize?: number;
    onProgress?: (p: WorkspaceBackupProgress) => void;
}): Promise<void>;
async function peekWorkspaceBackupMetadata(file: Blob): Promise<WorkspaceBackupHeaderLine>;
async function importWorkspaceStream(opts: {
    db: Or3DB;
    file: Blob;
    clearTables: boolean;
    overwriteValues: boolean;
    onProgress?: (p: WorkspaceBackupProgress) => void;
}): Promise<void>;
```

---

Document generated from `app/utils/workspace-backup-stream.ts` implementation.
