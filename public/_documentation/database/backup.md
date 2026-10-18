# Back up and restore a workspace

Open **Workspace Backup** from the dashboard. Cloud exports include canonical workspace records and original files from server storage, including files absent from this browser. Local-only builds export their on-device database. Neither format is an operator deployment backup.

## Cloud backup and restore

Cloud exports stream a `.or3cloud` archive directly to disk with bounded buffers. SQLite and Convex archive snapshots include retained Trash metadata and originals; ordinary sync still sends tombstones. Updated providers are required: export refuses an ordinary snapshot fallback that could omit Trash. The server captures a consistent metadata snapshot, then streams binary originals with per-file hashes and an archive checksum. Browser caches, upload queues, sync cursors, tombstones, and known device-only credentials are excluded. Backup waits up to 30 seconds for local sync and uploads; unfinished work, missing originals, invalid references, or checksum failures prevent success. Finish outstanding work and retry. Keep local originals and discard incomplete downloads.

Select a `.or3cloud` file to restore. Validation checks the complete archive before creating anything. Restore uploads originals directly from the selected backup File and writes records through the existing authorized sync API with revisions newer than destination upload commits and new storage identities. Trash metadata is restored before an explicit soft-delete; original bytes stay in storage. Every restore write must be applied before success is reported. The destination is a **new workspace**; the source is never replaced. The new owner’s upload setting is raised if necessary to fit verified originals, within the supported 1 GiB ceiling. Other settings use the destination defaults. Rate limits defer the restore; leave the page open.

On failure, the backup and source remain intact, and the destination retains an **incomplete** label. Retry into another fresh workspace after fixing the reported problem. Interrupted direct uploads require selecting the saved source again. Local JSON/JSONL imports and in-place replacement are disabled on Cloud because they cannot replace canonical server state safely.

After success, reload and check representative conversations, documents, and attachments. Keep the archive until recovery is verified. Files are unencrypted; protect the archive as private workspace data.

The 2 GiB recovery journey is qualified with SQLite sync and filesystem storage. Convex archives are also qualified against a disposable backend with retained Trash originals and an unfinished upload. Convex uses a server-only backup snapshot and exact original read; ordinary downloads continue to refuse Trash. Install the matching provider artifact and deploy its updated schema, sync, storage and snapshot templates together. Older providers/backends fail closed. Missing or replaced originals prevent a complete archive; backup reads never remove source files or upload intents.

## Local-only export

Select **Export workspace**, choose the destination when prompted, and wait for completion. The current export is a JSONL stream containing database metadata and table records. The browser uses a save picker when supported and a streaming-download fallback otherwise. Cancelling the picker cancels the export.

Export checks that the streamed records match one consistent local snapshot
before completing the file. If chat or sync activity changes those records,
wait for that activity to finish and export again. A failed or cancelled export
can leave an incomplete download in browsers that cannot retract written bytes;
discard that download and retry. A destination that fails to commit the file is
reported as an export error.

An export stays bound to the workspace selected when **Export workspace** was clicked, including while hooks, the save picker, or the streaming fallback are loading. Switching workspaces during that wait does not retarget the export.

Keep the downloaded file in a safe place. Backups can contain private conversations, document content, files, and stored preferences or credentials; they are not encrypted by this export flow. Successful download proves that an export was produced, not that it has been restored successfully on another installation.

## Local-only import

Select a backup file and review the displayed database/version metadata. The importer recognizes stream backups and supported older Dexie backup files. Use the same or a newer compatible application schema; backups from a newer database version can be rejected.

Choose the destination workspace before importing and keep it selected for the operation. The backup workflow uses the active browser database; a backup's filename does not authorize or select a Cloud workspace.

| Mode | Effect |
| --- | --- |
| Replace workspace | Clears current tables and restores backup records. Export current data first. |
| Append / merge | Adds backup records without clearing current tables. Conflicting records depend on the overwrite option. |
| Overwrite records on key conflict | Allows append mode to replace conflicting values; this is not a field-by-field merge. |

Streaming replace validates that every current table is declared before clearing data. Duplicate source primary keys, including file hashes across separate batches, are rejected inside the import transaction; all changes roll back. The overwrite option only permits a source record to replace a destination record, not duplicate source identities. Its import transaction rolls back when the stream is truncated, has unknown record types, lacks a terminal marker, or contains trailing records. Do not generalize those guarantees to every historical format or invent a recovery policy from a partial backup; inspect the actual error and format.

After completion, reopen representative chats and documents and check attachments. Local restore accepts files up to 50 MiB each. A failed streaming restore rolls back the transaction, including Replace clears. Existing oversized local originals are preserved until the user explicitly replaces data. Local archives are not complete Cloud recovery copies.

## Integrate backup controls in source UI

Use `useWorkspaceBackup` from `~/composables/core/useWorkspaceBackup` during client component setup. Its existing dashboard caller is `app/components/dashboard/workspace/WorkspaceBackupApp.vue`.

The workflow is export, or peek metadata → user chooses mode/overwrite → import. Its state contains progress, currentStep, error, and format/metadata. The default local import mode is **append**, so never immediately import after a file is selected without presenting that choice.

Methods can report failure through `state.error`/`currentStep` rather than rejecting. A resolved promise alone does not prove success. Preserve the existing before/after/error/cancelled hooks and `workspace:reloaded` event after successful restore. The local stream codec lives in `app/utils/workspace-backup-stream.ts`; the Cloud framing and validation live in `shared/storage/workspace-archive.ts`. Cloud methods select the safe fresh-workspace flow automatically.

See [database safety](/documentation/database/safe-changes) and [Cloud recovery](/documentation/cloud/deployment-operations) for their distinct boundaries.
