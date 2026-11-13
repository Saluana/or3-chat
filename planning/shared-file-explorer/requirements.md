# Requirements

## Introduction

Add nested folder organization to project contents and the workspace Files tab through shared folder operations and interaction behavior. This revision specifies how selection, activation, destinations, scope labels, filtering, bulk actions, and recovery behave, and brings a local/static Files slice ahead of cloud admission. Phase 1 is the initial delivery; explicitly marked Phase 2 criteria are follow-up work and are not part of Phase 1 completion. Existing requirement and acceptance-criterion IDs are retained.

## Context

The host checkout uses Bun, Nuxt/Vue, Nuxt UI `UTree`, Reka UI, Dexie, Vitest, and Playwright. `SidebarProjectsPage.vue` is a sidebar page containing Project Home/activity/Knowledge/Memory/Settings; `SidebarProjectsSection.vue` owns Home shortcuts. `SidebarProjectTree.vue` has only comment/documentation references and is not the active integration. `WorkspaceFilesPane.vue` currently reads full `posts` values ordered by `updated_at`, pages 50 rows with Load more, and hosts preview/upload/Trash/plugin actions. `app/db/derived-indexes.ts` and `documents.ts:listDocumentFileHashes` already demonstrate local derived index keys and key-only reads without document bodies. Sync pushes are capped at 100 operations and 2 MiB; `outbox-manager.ts` warns at 500 queued operations (a warning threshold, not a hard storage cap). SQLite and Convex are external provider repositories; sibling clones were available in this authoring workspace, but are not included in an `or3-chat` checkout. Their versions and paths must be independently recorded for cloud implementation.

## Assumptions

- Folders organize content within a project or Files; they do not change ownership, AI context, source modes, permissions, or project memory.
- Files contains native documents and catalog files. Projects additionally contain owned chat families, organized by their root chat, with branches kept together.
- Each item has one placement per scope. The content/title is shared; the Files location and each project location are independent and are always labeled as such.
- Phase 1 Files uses folders in the existing list plus breadcrumbs at every width. Preview is an overlay below 1024px, with a two-pane list/preview layout allowed above that width. There is no third navigation column.
- A project with no saved view preference opens Recent activity until it has a live folder, then Explorer. Explicit view choice is remembered per account/workspace/project/device even if folder counts change. Files defaults to Recently modified; Name is the other Phase 1 sort.
- Plain content click selects and opens. Ctrl/Cmd/Shift click changes selection without opening. A tree folder click selects and toggles expansion; a Files-list folder click selects and navigates. Checkboxes and touch Select mode never activate content.
- Top-level project New chat/New document/Add file create or associate at project root. Folder menus expose explicit `New … in [folder]`. Files upload/new-folder buttons show the current destination (`Upload to Research`, `New folder in Research`), including root.
- Folder names are trimmed, 1–255 Unicode code points, and reject control characters, `/`, backslash, `.` and `..`. Local create/rename/move refuses a same-parent folder name after Unicode NFC normalization and locale-independent `toLowerCase()`. Concurrent duplicates arriving through sync are retained and distinguished; no distributed uniqueness/merge protocol is added.
- Folder removal is labeled **Remove folder, keep contents**. Nonempty removal confirms counts and destination; empty removal commits immediately. Recursive folder Trash is not included.
- Bulk Trash in Files applies to selected files/documents. Bulk Remove from project applies to selected content references/chat families. Selecting any folder disables these bulk content actions with an explanation; nothing is silently skipped.
- Every explorer command is limited to 100 changed canonical records, including hidden placements, related family/source rows, and the folder tombstone. No automatic chunked mutation jobs are introduced. Selection may exceed that limit, but the operation refuses before writing and explains how to reduce it.
- The scale fixture remains 5,000 content items, 500 folders, and a 20-level chain. This is a verification target, not a product size limit. Indentation caps visually at four levels; logical depth remains available through paths and accessibility metadata.
- Phase 2 contains guarded move/rename Undo, Type sort, an optional wide-screen Files navigator, and full shared trees in Home shortcuts. Phase 1 shortcuts retain navigation/opening and explicit Move to… without duplicating a full explorer.
- A temporary local/static dev/test flag isolates the early vertical slice from cloud sync. It is removed before Phase 1 delivery; qualified provider capability becomes the cloud gate.

## Out of Scope

- Application implementation during this planning task, publishing packages/images, deployment, or modifying production data.
- OS filesystem mirroring, directory import/watch, symlinks, archive export, arbitrary sibling ordering, or a full IDE.
- Cross-workspace moves, cross-project folder moves, cross-surface dragging, duplicate content copies, or multiple aliases within one scope.
- Project-folder OS uploads in Phase 1: reject with actionable feedback directing users to Knowledge/Add source or Files. Existing explicit association paths remain available.
- Folder-level permissions/instructions, recursive folder-to-Trash, bulk permanent deletion, durable undo history, or a generalized explorer plugin framework.
- New synchronized tables/services/queues or eager materialized path caches. A justified local derived metadata index is in scope.

## Requirements

### R1: Nested folders in both scopes

**User Story:** As a workspace member, I want folders and subfolders in projects and Files, so that I can organize growing collections.

**Acceptance Criteria:**

- R1.AC1: WHEN an authorized writer creates, renames, expands, or collapses folders THEN both scopes SHALL support root, empty folders, and the 20-level fixture.
- R1.AC2: WHEN a folder is renamed or moved THEN its ID and descendants' content identities SHALL remain unchanged.
- R1.AC3: IF a name is invalid or duplicates a live sibling folder under the stated comparison rule THEN local create/rename/move SHALL refuse before writing and retain the draft/selection with a specific error.
- R1.AC4: WHEN concurrent duplicate sibling folders arrive through sync THEN both SHALL remain accessible, with a visible short identity suffix, and SHALL never be merged or overwritten automatically.

### R2: Project explorer integration

**User Story:** As a project user, I want to organize content without losing the current project workflow.

**Acceptance Criteria:**

- R2.AC1: WHEN Project Home opens THEN it SHALL honor the saved view choice, otherwise use Recent activity with no live folders and Explorer with live folders; both views SHALL remain selectable alongside existing brief/Knowledge/Memory/Settings controls.
- R2.AC2: WHEN a content row receives a plain click outside Select mode or row activation through Enter THEN it SHALL select and open the existing chat pane/editor/preview; modified clicks, checkbox activation, and disclosure controls SHALL not activate a pane.
- R2.AC3: WHEN top-level New/Add controls are used THEN the destination SHALL be project root regardless of selection; WHEN a folder's explicitly labeled create/add action is used THEN its captured destination SHALL be used, with actual saved location reported after any placement failure.
- R2.AC4: WHEN a Home shortcut is used in Phase 1 THEN existing navigation/opening SHALL remain and eligible row menus SHALL offer scoped Move to…; a full nested shortcut explorer SHALL not be duplicated there.
- R2.AC5: WHEN project content has a different Files location THEN Show in Files and Show in project [name] actions SHALL reveal the named scope without moving or duplicating content.
- R2.AC6: WHEN Phase 2 expands a project shortcut THEN it SHALL reuse the full shared tree and preserve lazy loading and workspace-profile restrictions.

### R3: Files browser integration

**User Story:** As a Files user, I want folder navigation within the content list while keeping previews, uploads, and existing actions.

**Acceptance Criteria:**

- R3.AC1: WHEN Files opens in Phase 1 THEN direct child folders and content SHALL appear in one list with root-to-current breadcrumbs, without a persistent folder navigator.
- R3.AC2: WHEN a plain-clicked list folder opens THEN breadcrumbs and listing SHALL navigate together; existing file/document preview, download, rename, filters, Trash, and plugin actions SHALL remain available.
- R3.AC3: WHEN the labeled upload button or an OS file drop targets a Files folder/breadcrumb THEN new catalog entries SHALL use that captured destination; failed files SHALL be reported individually.
- R3.AC4: IF upload reuses an existing catalog record THEN its location SHALL remain unchanged and Show in Files SHALL be offered; directory drops SHALL explicitly report unsupported folder import.
- R3.AC5: WHEN an inspector shows a file/document THEN it SHALL label `Files location` separately from `Project [name] location`, show root explicitly, and offer scope-named reveal actions; the title editor SHALL explain that renaming changes the shared title.
- R3.AC6: WHEN Phase 2 adds a Files navigator THEN it SHALL be optional at widths of at least 1280px and SHALL collapse when insufficient space remains for the list/preview; Phase 1 navigation SHALL stay usable without it.

### R4: Shared behavior and extension compatibility

**User Story:** As a maintainer, I want shared behavior without replacing existing content owners or plugin contracts.

**Acceptance Criteria:**

- R4.AC1: WHEN either surface creates/removes/renames a folder, changes selection, or moves entries THEN it SHALL use the same typed domain operations and interaction controller.
- R4.AC2: WHEN an existing extension action applies to a row THEN it SHALL receive its existing single-item payload/access checks; it SHALL not receive folders or a fabricated bulk payload.
- R4.AC3: WHEN theme/scope/account changes or a surface unmounts THEN styling SHALL update and its observers, registrations, timers, and scoped pending state SHALL be released.
- R4.AC4: WHEN a row menu opens on one of several selected rows THEN it SHALL show applicable bulk actions with counts and hide single-item plugin/rename actions; WHEN opened on an unselected row THEN selection SHALL reset to that row and show its single-item actions.

### R5: Selection and movement

**User Story:** As a user, I want predictable single and multiple selection with equivalent movement on desktop and touch.

**Acceptance Criteria:**

- R5.AC1: WHEN a content row receives a plain click outside Select mode THEN it SHALL select and open; Ctrl/Cmd click SHALL toggle selection and Shift click SHALL select the full ordered result range without opening, including unmounted virtual rows.
- R5.AC2: WHEN dragging selected entries THEN the count/destination SHALL be shown; empty/collapsed folders, Files breadcrumb segments, and the project header SHALL be valid container/root targets; eligible folder hover SHALL expand after 600 ms and viewport-edge scrolling SHALL work.
- R5.AC3: IF a target is a selected folder, descendant, other scope, content leaf, read-only destination, or would create a duplicate sibling folder name THEN the drop SHALL refuse with no writes.
- R5.AC4: WHEN a selection contains an ancestor and descendant THEN the ancestor SHALL move once with its subtree; a move within the mutation budget SHALL commit all local placement changes or none.
- R5.AC5: WHEN Move to… is invoked by keyboard/menu/touch THEN the same validation SHALL run; the dialog SHALL support folder-name filtering with ancestor paths and New folder in [destination]; Escape SHALL cancel the move without relocating entries, while a folder separately created in the dialog SHALL remain.
- R5.AC6: WHEN Phase 2 Undo is invoked from the success toast or Cmd/Ctrl+Z with explorer focus THEN the latest organization move/folder rename SHALL revert only if affected revisions/destinations still match; otherwise it SHALL explain the conflict and retain current data.
- R5.AC7: WHEN touch Select mode or a checkbox is used THEN selection SHALL change without opening/navigating; a persistent selection toolbar SHALL offer count, select-all/clear, Move to…, and eligible bulk content actions.
- R5.AC8: WHEN dragging an unselected row THEN only that row SHALL be selected/moved and no content pane SHALL open as a consequence of drag initiation.
- R5.AC9: WHEN ordinary OS files are dropped on a project folder/header in Phase 1 THEN the app SHALL prevent browser navigation and show that project-folder upload is unsupported, naming Knowledge/Add source or Files as supported alternatives.

### R6: Safe removal and bulk content lifecycle

**User Story:** As a user, I want explicit removal semantics and bulk content actions without unexpected data loss.

**Acceptance Criteria:**

- R6.AC1: WHEN Remove folder, keep contents is invoked on a nonempty folder THEN confirmation SHALL state direct file/document/chat-family and subfolder counts, hidden/trashed entries, and the named destination; on confirmation within budget, child promotion and folder tombstone SHALL commit atomically. Empty folders SHALL skip confirmation.
- R6.AC2: WHEN Remove [N] items from project [name] is confirmed THEN existing membership/source/chat-family APIs SHALL remove only the selected associations, preserve underlying content/Files placement, and report item-level successes/failures.
- R6.AC3: WHEN Files items are trashed/restored THEN normal listings SHALL hide/reveal them; Trash SHALL label the retained library placement `Files location` and the effective restore destination `Restores to`, without presenting a project placement or a mutable path as an immutable original location.
- R6.AC4: WHEN a project is deleted THEN all its organization SHALL become ineligible through the canonical project tombstone without requiring an unbounded metadata cascade; existing retention of chats/documents/files SHALL remain unchanged.
- R6.AC5: IF an intake destination is removed THEN saved content SHALL use its nearest readable live ancestor or root, with location feedback; IF access is revoked THEN no new placement SHALL be written.
- R6.AC6: WHEN Move [N] items to Trash is confirmed in Files THEN selected files/documents SHALL use existing policy/editor-settlement/Trash helpers; any selected folder SHALL disable the bulk action with an explanation rather than being silently skipped.
- R6.AC7: IF a bulk content action partially fails or loses authorization THEN the UI SHALL report completed/failed/unattempted counts, retain failed selection, and retry only failed/unattempted items after fresh validation; it SHALL not claim group atomicity or offer permanent deletion.

### R7: Independent placement and unchanged authority

**User Story:** As a user, I want clear scope-specific organization that preserves content identity and project context.

**Acceptance Criteria:**

- R7.AC1: WHEN an item moves within one scope THEN other placements, blob hashes/counts, file references, membership, chat ownership, source modes, and instructions SHALL remain unchanged.
- R7.AC2: IF an item is missing/deleted/ineligible/no longer a member THEN its placement SHALL grant no visibility or access.
- R7.AC3: WHEN organizing a chat family THEN branches SHALL remain grouped and the current owner SHALL remain authoritative.
- R7.AC4: WHEN a title changes through an editor/sync THEN every placement SHALL show the current shared title.
- R7.AC5: WHEN Move to…, create, remove, reveal, or location feedback is shown THEN it SHALL name Files or project [name] and its destination path; a Files filter for a project SHALL still represent Files locations, not that project's hierarchy.

### R8: Persistence, offline operation, and recovery

**User Story:** As a local-first user, I want organization to survive reload, concurrency, backup, and sync.

**Acceptance Criteria:**

- R8.AC1: WHEN an admitted organization change commits offline THEN reload SHALL preserve it and existing outbox sync SHALL transmit it on reconnect.
- R8.AC2: WHEN devices concurrently edit an organization row THEN existing clock/HLC rules SHALL choose the stored winner and independent rows SHALL remain independent.
- R8.AC3: IF a parent is deleted but its retained folder payload is readable THEN projection SHALL follow its parent chain to the nearest live same-scope ancestor; missing/unreadable/wrong-scope ancestry or cycles SHALL recover deterministically to a reachable hierarchy without read-triggered writes.
- R8.AC4: WHEN a snapshot or disposable backup restore installs organization THEN IDs/placements/content hashes SHALL reconstruct without duplicate content or trusting imported derived index fields.
- R8.AC5: WHEN earlier flat data is opened THEN eligible items SHALL appear at root without bulk placement backfill or canonical content rewrites.
- R8.AC6: WHEN an entry is recovered THEN the UI SHALL explain the specific cause and destination (for example `Research was removed; shown in Projects / Alpha`) and offer scoped Move to…; after tombstone payload GC it SHALL explicitly explain root fallback.

### R9: Authorization and version admission

**User Story:** As a workspace owner, I want access checks and the cost of enabling organization to be explicit.

**Acceptance Criteria:**

- R9.AC1: WHILE access is read-only the UI SHALL permit navigation and disable mutations; direct operation/provider attempts SHALL also refuse writes.
- R9.AC2: IF account/workspace/authorization changes during work THEN new unauthorized commits SHALL stop and SHALL not retry in the new scope.
- R9.AC3: WHEN an older client reaches organization rows/tombstones through pull/watch/snapshot or writes THEN the relevant canonical/gateway path SHALL return update-required before admitting incompatible data or advancing that page's cursor; this can stop the workspace's entire sync stream.
- R9.AC4: IF provider/backend support is unqualified THEN Cloud organization mutations SHALL stay disabled while existing flat functions remain available where already supported.
- R9.AC5: IF a record violates shape, immutable identity, scope key, or ownership-field rules THEN canonical admission SHALL reject before applying its batch/version allocation.
- R9.AC6: BEFORE the first Cloud organization mutation on a device/workspace THEN a one-time notice SHALL explain that organization requires all devices to run a compatible client, older clients may stop syncing, and deleting folders does not undo the version boundary while history/tombstones remain; Cancel SHALL create no record.

### R10: Navigation, filters, and sorting

**User Story:** As a user, I want predictable filtered results and location discovery.

**Acceptance Criteria:**

- R10.AC1: WHEN search or a type/project filter is active in Files THEN results SHALL be flat content rows with a Files path column and a This folder / All Files toggle; This folder SHALL include descendants, default on activation, and omit nonmatching empty folder rows.
- R10.AC2: WHEN global search opens Files with `recordId` THEN Show in Files SHALL navigate/reveal its effective folder, clear incompatible filters, and retain preview/open behavior.
- R10.AC3: WHEN organization/title/membership changes without row-count changes THEN paths, search results, eligibility, and reveal targets SHALL update.
- R10.AC4: WHEN unfiltered browsing is sorted THEN folders SHALL precede content, Files SHALL default to Recently modified, Name SHALL be available, and selection/preferences SHALL be scoped correctly; filtered flat results SHALL have no folder grouping.
- R10.AC5: WHEN a project search runs THEN results SHALL name that project and show its paths; Show in project [name] SHALL clear the search, expand ancestors, and focus/open the target.
- R10.AC6: WHEN Phase 2 Type sort is selected THEN it SHALL sort by documented normalized type with deterministic name/ID ties and retain folders-first only in unfiltered browsing.

### R11: Keyboard, accessibility, and responsive behavior

**User Story:** As a keyboard, screen-reader, or mobile user, I want all core organization actions to be discoverable without dragging.

**Acceptance Criteria:**

- R11.AC1: WHEN explorer focus is outside editable controls THEN arrows/Home/End/Enter, F2 rename, Delete/Backspace contextual removal, Cmd/Ctrl+A select result set, and 700 ms buffered type-ahead SHALL follow the interaction table in design; input fields SHALL retain native/editor shortcuts.
- R11.AC2: WHEN renaming THEN Enter SHALL save and Escape SHALL cancel; after actions/dialogs focus SHALL return to a visible relevant item or parent.
- R11.AC3: WHEN actions succeed/fail THEN accessible announcements SHALL state the scope/outcome; valid targets and recovery states SHALL use text/icons as well as color.
- R11.AC4: WHEN displayed at 320/768/1440px THEN controls SHALL remain reachable without whole-page horizontal overflow; project indentation SHALL cap at 48px (four 12px steps), long names SHALL truncate with keyboard/pointer-accessible full-name/path tooltips, and Files preview SHALL not force a third column.
- R11.AC5: WHILE reduced motion or touch input is used THEN decorative movement/hover dependencies SHALL be removed and Select mode/checkboxes/Move to… SHALL remain available.

### R12: Read strategy, budgets, and failures

**User Story:** As a user with a large library, I want bounded rendering, complete selection semantics, and explicit write limits.

**Acceptance Criteria:**

- R12.AC1: WHEN browsing the scale fixture in a recorded production browser build THEN warm folder navigation/selection SHALL settle within 200 ms p95 over 30 interactions, with fewer than 150 mounted rows per viewport through virtualization rather than cumulative Load more.
- R12.AC2: WHEN enumerating Files for browsing/type filters THEN the reader SHALL use local metadata index keys and file metadata without reading document/catalog post bodies or downloading blobs; opening content and explicit full-text search SHALL use existing body-reading owners. A one-time bounded schema-upgrade backfill is an explicit exception.
- R12.AC3: IF persistence/revision checks fail THEN the UI SHALL retain recoverable selection/input, remove pending state, explain retry, and SHALL not falsely report Saved.
- R12.AC4: WHEN cloud sync rejects a local commit THEN existing sync recovery SHALL report it without discarding queued work or presenting local success as cloud convergence.
- R12.AC5: IF a command would change more than 100 canonical records, including related/hidden records, or would make the queue reach the 500-operation warning threshold THEN explorer admission SHALL refuse before mutation with counts and next steps; local-only mode SHALL keep the 100-record limit but omit the irrelevant sync-queue check.
- R12.AC6: WHEN virtual rows are unmounted THEN their ordered metadata IDs SHALL remain available for Shift/Cmd-or-Ctrl+A selection; changing folder/filter/sort SHALL clear range anchors and selection, and search SHALL explicitly label any existing result limit.
- R12.AC7: WHEN local index upgrade, remote apply, or restore runs THEN the derived metadata SHALL be recomputed from canonical fields, excluded from sync/revision fingerprints, and SHALL create no additional canonical outbox edits during backfill.

### R13: Documentation, phases, and verification

**User Story:** As a maintainer, I want portable instructions and repeatable evidence for each delivered phase.

**Acceptance Criteria:**

- R13.AC1: WHEN Phase 1 is complete THEN public project/Files/sync guides and docmap SHALL describe interaction/scopes/limits/version cutover; external provider READMEs SHALL document their separately qualified changes.
- R13.AC2: WHEN qualification completes THEN screenshots, successful-run traces, and JSON receipts SHALL record seeds, source SHAs, profile, IDs/parents, item-level outcomes, unchanged hashes, queue boundaries, and performance samples.
- R13.AC3: WHEN Phase 1 is declared complete THEN its affected tests/typechecks/builds and disposable local/cloud journeys SHALL pass; missing provider checkouts SHALL be reported as an external cloud dependency, not treated as a passed check or blocker to local iteration.
- R13.AC4: WHEN executing the plan THEN a flagged local/static Files vertical slice SHALL be reviewed before provider work; Phase 2 criteria R2.AC6, R3.AC6, R5.AC6, and R10.AC6 SHALL be separately tracked and not required to ship Phase 1.
