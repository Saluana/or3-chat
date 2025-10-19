# useWorkspaceBackup

Full-featured workspace export/import controller for OR3. It coordinates Dexie exports, streaming backups, progress reporting, hook telemetry, and error handling so the UI can offer reliable backup workflows.

---

## What does it do?

`useWorkspaceBackup` manages every stage of backing up and restoring the local database:

-   Streams workspace exports to the File System Access API or StreamSaver fallback
-   Peeks backup files to surface metadata before import (format, table counts, etc.)
-   Imports backups in “replace” or “append” modes, with optional value overwrites
-   Tracks progress, step state, and errors in reactive refs for real-time UI updates
-   Dispatches hook events for extension telemetry and clean integrations

---

## Basic Example

```ts
import { useWorkspaceBackup } from '~/composables/core/useWorkspaceBackup';

const backup = useWorkspaceBackup();

async function exportNow() {
    await backup.exportWorkspace();
}

async function importFile(file: File) {
    await backup.peekBackup(file); // show metadata & ask user
    await backup.importWorkspace(file);
}
```

---

## How to use it

### 1. Create the composable

```ts
const backup = useWorkspaceBackup();
const { state } = backup;
```

`state` contains refs for loading indicators, progress bars, metadata, and errors—bind them straight into your component.

### 2. Export workflow

1. Call `backup.exportWorkspace()` in response to “Export” action.
2. Observe `state.isExporting`, `state.progress`, and `state.currentStep` for UI feedback.
3. On success, `currentStep` becomes `'done'`; reset the form with `backup.reset()` if you want to start fresh.

### 3. Inspect a backup file

1. Prompt the user for a file.
2. Call `await backup.peekBackup(file)`.
3. Read `state.backupMeta` (tables, counts) and `state.backupFormat` (`'stream'` or `'dexie'`).
4. Let the user choose `state.importMode` (`'replace' | 'append'`) and `state.overwriteValues` if appending.

### 4. Import workflow

1. Call `await backup.importWorkspace(file)`.
2. Watch `state.isImporting`, `state.progress`, and `state.currentStep`.
3. On completion, the composable fires `workspace:reloaded` hook so downstream stores can refresh.

### 5. Error handling

If any step fails, `state.error` holds an `AppError`. Show `state.currentStep === 'error'` to display a retry prompt. `backup.reset()` clears the state.

---

## API

```ts
const backup = useWorkspaceBackup();
```

### Returned object

| Property / Method       | Type                            | Description                                             |
| ----------------------- | ------------------------------- | ------------------------------------------------------- |
| `state`                 | `WorkspaceBackupState`          | Reactive refs for UI (see table below).                 |
| `exportWorkspace()`     | `() => Promise<void>`           | Streams the database to disk. No-op if already running. |
| `peekBackup(file)`      | `(file: Blob) => Promise<void>` | Reads metadata and sets `backupMeta`/`backupFormat`.    |
| `importWorkspace(file)` | `(file: Blob) => Promise<void>` | Imports according to `importMode`/`overwriteValues`.    |
| `reset()`               | `() => void`                    | Clears status flags, metadata, and errors.              |

### `WorkspaceBackupState`

| Ref               | Type                | Purpose                                              |
| ----------------- | ------------------- | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- | ----------- | ------ | --------- | -------------------------- |
| `isExporting`     | `Ref<boolean>`      | `true` while an export is in progress.               |
| `isImporting`     | `Ref<boolean>`      | `true` while an import is running.                   |
| `progress`        | `Ref<number>`       | 0–100 progress percentage.                           |
| `currentStep`     | `Ref<'idle'         | 'peeking'                                            | 'confirm'                                       | 'importing'                                 | 'exporting' | 'done' | 'error'>` | High-level step indicator. |
| `importMode`      | `Ref<'replace'      | 'append'>`                                           | Import strategy the user selected.              |
| `overwriteValues` | `Ref<boolean>`      | When appending, whether to replace conflicting rows. |
| `backupMeta`      | `Ref<ImportMetadata | null>`                                               | Metadata discovered during `peekBackup`.        |
| `backupFormat`    | `Ref<'stream'       | 'dexie'                                              | null>`                                          | Format derived from peek or auto-detection. |
| `error`           | `Ref<AppError       | null>`                                               | Last failure captured for UI display/reporting. |

`ImportMetadata` contains the Dexie database name/version plus table stats so you can present them to the user.

---

## Under the hood

1. **Module-level loaders** — Lazily imports `dexie-export-import` and `streamsaver` the first time they’re needed, caching promises for reuse.
2. **Export path** — Prefers the File System Access API (`showSaveFilePicker`) when available; otherwise falls back to StreamSaver with service worker shim. Progress is tracked by table/row counts from `streamWorkspaceExport` helpers.
3. **Peek** — Detects backup format by sniffing the file header. Dexie backups use `dexie-export-import`’s `peakImportFile`; stream backups parse the header line for metadata validation.
4. **Import** — Chooses between streaming import (`importWorkspaceStream`) and Dexie import (`importInto`). Appends respect `overwriteValues`; replace mode wipes tables first.
5. **Hooks** — Emits `workspace.backup.*` actions (`before`, `after`, `error`, `cancelled`) at each stage, plus `workspace:reloaded` after a successful import so other stores can resync.
6. **Error handling** — Wraps failures in `asAppError`, logs via `reportError`, and stores them in `state.error` with domain/action tags.

---

## Edge cases & tips

-   **Browser-only**: Every major action checks for `window`. In SSR contexts the composable will set an error explaining the limitation.
-   **Abort handling**: If the user cancels a save picker, the export resets to idle without surfacing an error.
-   **Version checks**: Both Dexie and stream imports validate database name/version; importing something from a newer schema raises a clear error.
-   **Chunk sizing**: Streaming exports use `STREAM_CHUNK_SIZE = 500` rows; Dexie imports default to ~1 MB chunks (`DEFAULT_KILOBYTES_PER_CHUNK`). Adjust in utilities if you need different throughput.
-   **Overwrite semantics**: In append mode, `overwriteValues` lets you merge data without wiping tables—set it via UI toggle before calling `importWorkspace`.
-   **Cleanup**: Call `reset()` after successful operations if you want to start a new flow without refreshing the page.

---

## Related

-   `~/utils/workspace-backup-stream.ts` — Implements the streaming codec used here.
-   `usePreviewCache` — Pair with this composable to manage heavy preview blobs alongside exports.
-   Hook reference in `docs/core-hook-map.md` — Lists the backup-related hooks emitted during each stage.
