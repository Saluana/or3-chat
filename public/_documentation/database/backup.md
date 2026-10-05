# Back up and restore a workspace

Open **Workspace Backup** from the dashboard. It exports or restores the active on-device workspace, not a complete server deployment. Keep a fresh export before an import, browser reset, or risky change.

## Export

Select **Export workspace**, choose the destination when prompted, and wait for completion. The current export is a JSONL stream containing database metadata and table records. The browser uses a save picker when supported and a streaming-download fallback otherwise. Cancelling the picker cancels the export.

Export checks that the streamed records match one consistent local snapshot
before completing the file. If chat or sync activity changes those records,
wait for that activity to finish and export again. A failed or cancelled export
can leave an incomplete download in browsers that cannot retract written bytes;
discard that download and retry. A destination that fails to commit the file is
reported as an export error.

An export stays bound to the workspace selected when **Export workspace** was clicked, including while hooks, the save picker, or the streaming fallback are loading. Switching workspaces during that wait does not retarget the export.

Keep the downloaded file in a safe place. Backups can contain private conversations, document content, files, and stored preferences or credentials; they are not encrypted by this export flow. Successful download proves that an export was produced, not that it has been restored successfully on another installation.

## Inspect before importing

Select a backup file and review the displayed database/version metadata. The importer recognizes stream backups and supported older Dexie backup files. Use the same or a newer compatible application schema; backups from a newer database version can be rejected.

Choose the destination workspace before importing and keep it selected for the operation. The backup workflow uses the active browser database; a backup's filename does not authorize or select a Cloud workspace.

| Mode | Effect |
| --- | --- |
| Replace workspace | Clears current tables and restores backup records. Export current data first. |
| Append / merge | Adds backup records without clearing current tables. Conflicting records depend on the overwrite option. |
| Overwrite records on key conflict | Allows append mode to replace conflicting values; this is not a field-by-field merge. |

Streaming replace validates that every current table is declared before clearing data. Duplicate source primary keys, including file hashes across separate batches, are rejected inside the import transaction; all changes roll back. The overwrite option only permits a source record to replace a destination record, not duplicate source identities. Its import transaction rolls back when the stream is truncated, has unknown record types, lacks a terminal marker, or contains trailing records. Do not generalize those guarantees to every historical format or invent a recovery policy from a partial backup; inspect the actual error and format.

After completion, reopen representative chats and documents and check attachments. If restoring on Cloud, check sync/transfer behavior separately. Restoring a local backup is not equivalent to restoring the server's canonical store or remote objects.

## Integrate backup controls in source UI

Use `useWorkspaceBackup` from `~/composables/core/useWorkspaceBackup` during client component setup. Its existing dashboard caller is `app/components/dashboard/workspace/WorkspaceBackupApp.vue`.

The workflow is export, or peek metadata → user chooses mode/overwrite → import. Its state contains progress, currentStep, error, and format/metadata. The default import mode is **replace**, so never immediately import after a file is selected without presenting that choice.

Methods can report failure through `state.error`/`currentStep` rather than rejecting. A resolved promise alone does not prove success. Preserve the existing before/after/error/cancelled hooks and `workspace:reloaded` event after successful restore. The stream codec lives in `app/utils/workspace-backup-stream.ts`.

See [database safety](/documentation/database/safe-changes) and [Cloud recovery](/documentation/cloud/deployment-operations) for their distinct boundaries.
