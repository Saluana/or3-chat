# Workspace Backup

The workspace backup modal gives you a safe way to export or restore everything stored in the local OR3 database (projects, threads, messages, documents, and cached files). Backups are written as JSON Lines files with the `.or3.jsonl` extension so they can stream efficiently even when the dataset is large.

## Accessing the backup tools

-   Open the **Dashboard → Workspace** modal from the command palette or sidebar shortcuts.
-   Locate the **Workspace backup** section. All actions (peek, export, import) are available in that single panel so you never have to leave the app shell.

## Exporting your workspace

1. Click **Export workspace**.
2. Choose a destination filename. The app suggests `or3-workspace-<timestamp>.or3.jsonl` to help you manage versions.
3. Keep the tab open until the progress badge reaches 100%. Large workspaces will continue streaming in the background—cancelling the download leaves the existing data untouched.

Exports run entirely in your browser and stream table-by-table so they remain responsive. If the File System Access API is unavailable, the UI falls back to **StreamSaver**—make sure the Service Worker prompt is accepted so the file can be saved.

## Importing a backup

1. Click **Browse backup** and pick a `.or3.jsonl`, `.jsonl`, or `.json` file. The app validates the metadata before any records are touched.
2. After the **Metadata validated** badge appears, review the detected table counts and confirm they match your expectations.
3. Select an import mode:
    - **Replace**: clears the current workspace before loading the backup.
    - **Append**: merges rows into the existing data. Enable **Overwrite on key conflict** if you want newer records in the backup to replace duplicates.
4. Press **Import workspace** and keep the modal open until the progress badge reaches 100%.

Stream backups restore in-place without reloading the page, and the hooks system dispatches `workspace:reloaded` so connected panes update automatically.

## Safety tips

-   **Verify the version**: the metadata check blocks backups created by a newer schema. Update the app first if you see a version mismatch error.
-   **Keep originals read-only**: store exported files in a secure, immutable location (cloud drive, external disk) so accidental edits cannot corrupt the JSON Lines structure.
-   **Trust the source**: only import files you created or obtained from a trusted collaborator. The importer validates table names and row shapes, but unexpected content can still clutter your workspace.
-   **Stay powered**: because imports run in a single transaction, avoid closing the tab or letting your device sleep until the completion announcement appears in the live region.
-   **Test on a fresh profile**: if you are unsure about the state of a backup, try importing it into a separate browser profile first to validate the contents before touching your main workspace.

For deeper implementation details, review `app/utils/workspace-backup-stream.ts` and the `useWorkspaceBackup` composable.
