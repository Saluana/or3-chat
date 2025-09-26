---
artifact_id: 9a1b3e35-39f7-4bf9-86a8-4da9dfca8a2b
title: Workspace Backup Import/Export Requirements
status: Draft
created: 2025-09-25
---

## Introduction

Add a dedicated workspace backup page inside the Dashboard modal that lives as its own app tile. The page lets users safely export the entire local Dexie database to a Blob (download) and re-import backups. The feature must prioritize clarity, prevent data loss through explicit warnings, and maintain strong performance by streaming data via `dexie-export-import`.

## Requirements

### 1. Workspace export

**User Story 1.1** — As a workspace maintainer, I want to export my entire workspace to a downloadable file so that I can back up or transfer my data.

Acceptance Criteria:

-   WHEN the user opens the Dashboard modal → selects the Workspace Backup app AND clicks the "Export workspace" action, THEN the system SHALL stream the full IndexedDB contents to a Blob using `exportDB` and trigger a file download with a timestamped filename.
-   WHEN the export starts, THEN the system SHALL disable duplicate export triggers and show progress feedback until completion or failure.
-   IF the export fails, THEN the system SHALL surface an error toast tagged with `domain: 'db'` and offer a retry action.

### 2. Workspace import

**User Story 2.1** — As a workspace maintainer, I want to import a previously exported backup so that I can restore my workspace on this device.

Acceptance Criteria:

-   WHEN the user selects a valid backup Blob on the Dashboard page and confirms import, THEN the system SHALL load the Blob metadata via `peakImportFile` before running the import.
-   WHEN the import begins, THEN the system SHALL display progress feedback and block additional import/export actions until completion or failure.
-   IF the import finishes successfully, THEN the system SHALL invalidate in-memory stores and refresh views so the restored content is immediately visible without a manual reload.
-   IF the import fails, THEN the system SHALL report the error using `reportError` with `ERR_DB_WRITE_FAILED` and provide guidance to retry or contact support.

### 3. Import safety guardrails

**User Story 3.1** — As a cautious user, I want clear warnings before importing so that I do not accidentally wipe my current workspace.

Acceptance Criteria:

-   WHEN the user initiates an import from the Dashboard page, THEN the UI SHALL show a modal warning stating that importing may replace current workspace data and advising an export backup.
-   WHEN the user confirms the warning, THEN the system SHALL proceed only after the user explicitly acknowledges the risk (e.g., checkbox or typed confirmation).
-   IF the user cancels the warning dialog, THEN the system SHALL abort without mutating the database.

### 4. Import mode options

**User Story 4.1** — As a power user, I want to choose how the import is applied so that I can either replace or merge the data with the current workspace.

Acceptance Criteria:

-   WHEN the import dialog is shown, THEN the system SHALL present mutually exclusive options: (a) **Replace:** clears existing tables before import; (b) **Append:** keeps current data and bulk inserts new records.
-   WHEN the user selects **Replace**, THEN the system SHALL call `importDB` (or `importInto` with `clearTablesBeforeImport: true`) to overwrite tables atomically.
-   WHEN the user selects **Append**, THEN the system SHALL call `importInto` with `clearTablesBeforeImport: false` and `overwriteValues` reflecting user preference (default off).
-   IF append mode results in primary-key conflicts and `overwriteValues` is false, THEN the system SHALL surface a conflict summary and guide the user to retry with overwrite enabled.

### 5. Validation and safety checks

**User Story 5.1** — As a user, I want validation safeguards so that corrupted or incompatible backups do not break my workspace.

Acceptance Criteria:

-   WHEN a Blob is selected, THEN the system SHALL validate that `formatName === 'dexie'`, `formatVersion === 1`, and the database name matches `or3-db`; otherwise, it SHALL warn and reject the file.
-   IF the backup version is newer than the current schema version, THEN the system SHALL block import and prompt the user to update the app first.
-   WHEN validations fail, THEN the system SHALL not mutate the current workspace.

### 6. Performance and UX

**User Story 6.1** — As a user on a slow device, I want the backup process to remain responsive so that the UI does not freeze.

Acceptance Criteria:

-   WHEN export or import runs, THEN the system SHALL use the streaming APIs (`numRowsPerChunk`, `chunkSizeBytes`) to avoid loading the entire database into memory.
-   WHEN long-running operations complete, THEN the UI SHALL re-enable controls and dismiss progress indicators without requiring a page reload.
-   WHEN operations run, THEN the system SHALL ensure screen-reader announcements or descriptive aria-live text communicates status for accessibility.

### 7. Documentation and support

**User Story 7.1** — As a support-minded developer, I want built-in guidance so users understand how to back up safely.

Acceptance Criteria:

-   WHEN the user opens the Dashboard workspace backup page, THEN the UI SHALL include brief guidance explaining backup workflow, file retention, and limitations.
-   WHEN warnings or errors surface, THEN the system SHALL link to in-app documentation or display inline tips about quota limits and recovery steps.

### 8. Dashboard integration

**User Story 8.1** — As a returning user, I want the workspace backup tools accessible from the Dashboard modal as a dedicated app tile so that they are easy to spot and launch directly.

Acceptance Criteria:

-   WHEN the Dashboard modal opens, THEN a "Workspace Backup" tile SHALL appear in the grid with icon `pixelarticons:briefcase-upload` and an order that keeps it near other core utilities.
-   WHEN the user clicks the "Workspace Backup" tile, THEN the workspace backup page SHALL render within the Dashboard modal without navigating to a standalone route.
-   IF the plugin fails to register, THEN the Dashboard SHALL remain functional, and the user SHALL receive a toast explaining that workspace backups are temporarily unavailable.
