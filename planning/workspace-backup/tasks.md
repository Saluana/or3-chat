---
artifact_id: 8f08d50a-7c1c-4c75-9096-91787a334dd0
title: Workspace Backup Import/Export Tasks
status: Draft
created: 2025-09-25
---

## 1. Prepare tooling & dependencies

-   [x] Add `dexie-export-import` to `package.json` and lockfile; ensure bun install updates bundle size minimally. _(Requirements: 1.1, 2.1, 6.1)_
-   [x] Create TypeScript declaration shim if needed for ESM import default interop. _(Requirements: 1.1, 2.1)_

## 2. Implement workspace backup composable

-   [x] Scaffold `useWorkspaceBackup.ts` with reactive state, options, and progress handling. _(Requirements: 1.1, 2.1, 6.1)_
-   [x] Integrate `exportDB`, `importDB`, `importInto`, `peakImportFile` with streaming progress callbacks. _(Requirements: 1.1, 2.1, 4.1, 6.1)_
-   [x] Add metadata validation (format name/version, database name, schema version). _(Requirements: 5.1)_
-   [x] Emit error reporting via `reportError` + `dbTry` wrappers; expose retry-friendly errors. _(Requirements: 1.1, 2.1, 5.1)_
-   [x] Expose helper for invalidating stores (`workspace:reloaded` hook + store refresh). _(Requirements: 2.1)_

## 3. Build Workspace Backup Dashboard app

-   [x] Create `app/components/modal/dashboard/workspace/WorkspaceBackupApp.vue` with export/import cards, progress indicators, and guidance header. _(Requirements: 1.1, 2.1, 6.1, 7.1)_
-   [x] Register a new `core:workspace-backup` tile in `Dashboard.vue` with icon `pixelarticons:briefcase-upload`, order ~45, and a single page pointing to the new component. _(Requirements: 8.1)_
-   [x] Implement export card with status badge, percent progress, and disabled state while streaming. _(Requirements: 1.1, 6.1)_
-   [x] Implement import card with file picker, metadata preview (table counts), mode radios, and overwrite toggle. _(Requirements: 2.1, 4.1, 5.1)_
-   [x] Wire composable actions to buttons with aria-live updates and integrate `reportError` toasts. _(Requirements: 1.1, 2.1, 6.1)_
-   [x] Surface inline guidance and link to documentation on safe backups. _(Requirements: 7.1)_

## 4. Warning and confirmation flow

-   [x] Create `WorkspaceBackupWarningModal.vue` (or reuse existing modal) in `app/components/modal/dashboard/workspace/` with forced acknowledgement checkbox. _(Requirements: 3.1)_
-   [ ] Block import execution until modal acknowledgement is confirmed; abort cleanly on cancel. _(Requirements: 3.1)_
-   [x] Display summary of selected mode (replace vs append) in the modal to reinforce consequences. _(Requirements: 3.1, 4.1)_

## 5. Append vs replace behavior

-   [x] Implement import execution branch: replace → `importDB` with `clearTablesBeforeImport: true`. _(Requirements: 4.1)_
-   [x] Implement append branch → `importInto` with `overwriteValues` toggle, conflict handling, and toast guidance. _(Requirements: 4.1)_
-   [x] Surface conflict summary to the user when overwrite is disabled and collisions occur. _(Requirements: 4.1, 5.1)_

## 6. UX polish & accessibility

-   [x] Add progress text (tables completed, rows processed) plus aria-live status updates. _(Requirements: 1.1, 2.1, 6.1)_
-   [x] Ensure controls auto-reset on success/failure and revoke object URLs after export. _(Requirements: 6.1)_
-   [x] Add keyboard/focus management for modal and main CTAs. _(Requirements: 3.1, 6.1)_
-   [x] Reset composable state on component unmount and surface toast when the Dashboard dynamic import fails. _(Requirements: 6.1, 8.1)_

## 7. Testing & QA

-   [x] Unit tests for composable (modes, validation, error paths) using mocked Dexie export/import. _(Requirements: 1.1, 2.1, 5.1, 6.1)_
-   [x] Component tests for page UI covering modal flow, state toggles, and accessibility attributes. _(Requirements: 3.1, 4.1, 6.1, 7.1)_
-   [x] E2E smoke (Playwright/Cypress) simulating export+import loops with stubbed Blob APIs. _(Requirements: 1.1, 2.1, 3.1, 4.1)_
-   [x] Manual regression checklist: replace import, append import, corrupt file rejection, quota error toast. _(Requirements: 1.1, 2.1, 3.1, 5.1)_

## 8. Documentation & rollout

-   [ ] Update existing docs (`docs/UI` or new README section) with backup instructions and safety tips. _(Requirements: 7.1)_
-   [ ] Announce feature in changelog / release notes with guidance to export before importing. _(Requirements: 7.1)_
