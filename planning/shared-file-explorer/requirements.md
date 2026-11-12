# Requirements

## Introduction

Add nested folder organization to project contents and the workspace Files tab, with one shared explorer implementation. Provide the familiar navigation, selection, rename, and drag-and-drop interactions of a desktop file browser while preserving OR3's existing project context, catalog, and local-first behavior. This is a feature plan; it does not authorize deployment, package publication, or production data changes.

## Context

The inspected `or3-chat` checkout uses Bun 1.3.14, Nuxt 4.6.2, Vue, Nuxt UI 4.12.0, Reka UI 2.11.0, Dexie 4.4.x, Vitest, and Playwright. `SidebarProjectsPage.vue` owns Project Home/Recent activity/Knowledge/Memory/Settings; `SidebarProjectsSection.vue` renders shortcuts through `SidebarProjectRoot.vue` and `SidebarProjectChild.vue`. An older `SidebarProjectTree.vue` uses `UTree`, but is not the active project page integration. Project entries in `normalizeProjectData.ts` are flat chat/doc/file references, with chat ownership separately governed by `threads.project_id` and project helpers. `WorkspaceFilesPane.vue` lists documents and `or3:file` catalog posts with search, preview, uploads, Trash, and extension actions. Existing internal posts and the `[postType+title]` index support scoped records; workspace operations capture authorization and revisions. SQLite and Convex provide canonical sync with capability admission, LWW, tombstones, and snapshot recovery; deployment also supports local/static use. Existing project, storage, cloud sync, backup, and workspace-scale browser harnesses provide verification seams.

## Assumptions

- A project remains the ownership/context boundary. Folders are containers inside a project, not nested projects or new AI contexts.
- Projects need folders for chats, native documents, and saved file references. Files needs folders for native documents and catalog files, not chats.
- The same file/document can have a different placement in Files and in each associated project. Its content and title remain shared; renaming content is visible everywhere.
- A content item has at most one placement in each scope. Existing chat branch families remain grouped and are organized by their root chat; individual branches are not independently placed.
- Project Home gains an Explorer/Recent activity view choice, with Explorer initially selected for this feature. Brief, creation controls, Knowledge, Memory, and Settings remain available.
- Files uses a folder navigator plus the existing content list, rather than replacing previews/actions with an entirely new file manager.
- Folder names are trimmed, 1–255 Unicode code points, and reject control characters, `/`, `\\`, `.` and `..`. Equal sibling names are permitted, including offline concurrent creates; stable IDs and visible selection distinguish them. No item is overwritten by a name collision.
- Sorting is folders first, then the selected name/modified/type order with a stable ID tie-break. Folder dragging changes parentage, not arbitrary sibling order.
- Desktop drag-and-drop and keyboard/touch **Move to…** are required. Native touch dragging is not required for the first delivery.
- Removing a folder keeps its contents by promoting its direct children to the removed folder's parent. Content Trash/removal remains a separate, explicitly named action.
- Plain file drops upload into the destination folder. Operating-system directory import is outside this delivery. Re-uploading identical bytes retains existing catalog deduplication and does not silently move an already organized file.
- The verification target is 5,000 content items, 500 folders, and a 20-level chain per scope. These are test fixtures, not new product limits.
- Cloud organization is enabled only with a qualified provider capability. Existing flat project/file functionality remains usable on a provider without folder support until that workspace contains unsupported records.

## Out of Scope

- Editing application code during this planning task; npm releases, production updates, and provider migration.
- Mirroring the OS filesystem, directory watching/import, symlinks, ZIP folder export, or a full IDE.
- Cross-workspace moves, cross-project folder moves, and cross-surface drag semantics. Existing explicit Add to project / Move chat actions continue to handle membership.
- New folder-level permissions, inherited AI instructions, automatic context inclusion, or changes to project memory.
- Arbitrary sibling ordering, duplicate file copies, aliases within one scope, recursive folder-to-Trash, or durable undo history.
- New sync tables/services, independent ownership stores, or a generalized explorer plugin framework.

## Requirements

### R1: Nested folders in both scopes

**User Story:** As a workspace member, I want folders and subfolders in projects and Files, so that I can organize growing collections.

**Acceptance Criteria:**
- R1.AC1: WHEN an authorized writer creates, renames, expands, or collapses folders at root or within another folder THEN the system SHALL support both project and Files scopes, including empty folders and the 20-level verification fixture.
- R1.AC2: WHEN a folder is renamed or moved THEN its ID and descendants' content identities SHALL remain unchanged.
- R1.AC3: IF a name violates the stated name rules THEN the editor SHALL retain the draft and show a validation error without writing records.
- R1.AC4: WHEN equal sibling names are created or synchronized THEN both records SHALL remain accessible without overwriting either record.

### R2: Project explorer integration

**User Story:** As a project user, I want to organize chats, documents, and files together without changing their project behavior.

**Acceptance Criteria:**
- R2.AC1: WHEN Project Home opens THEN Explorer SHALL show its live folders, owned chat families, native documents, and saved file references; Recent activity SHALL remain available through the view choice.
- R2.AC2: WHEN the user opens a chat, document, or file THEN the existing chat pane, document editor, or file preview SHALL open; folder expansion SHALL not activate a content pane.
- R2.AC3: WHEN a user creates a chat/document or adds a saved file with a folder selected THEN the item SHALL be associated through the existing project APIs and placed in that folder; a failed placement SHALL leave saved content accessible and report its actual location.
- R2.AC4: WHEN a project shortcut is expanded THEN its contents SHALL use the same explorer behavior and hierarchy as Project Home, subject to existing workspace-profile visibility restrictions.

### R3: Files browser integration

**User Story:** As a Files user, I want folder navigation and a detailed content list, so that organizing files preserves the existing library workflow.

**Acceptance Criteria:**
- R3.AC1: WHEN Files opens THEN its folder navigator, current-folder list, and root-to-current breadcrumbs SHALL agree on the active folder.
- R3.AC2: WHEN the user selects a folder THEN the list SHALL show its direct child folders and eligible files/documents, retaining preview, download, rename, type/project filters, and registered file actions.
- R3.AC3: WHEN the user uploads through the button or drops ordinary files onto a writable folder THEN successful new catalog entries SHALL appear in that destination and failures SHALL be reported individually using the existing upload flow.
- R3.AC4: IF an upload reuses an existing catalog record THEN the system SHALL retain that record's placement and offer Reveal instead of silently moving it; directory drops SHALL report that folder import is unsupported.

### R4: Shared behavior and extension compatibility

**User Story:** As a maintainer, I want one implementation of explorer interactions, so that Projects and Files do not diverge.

**Acceptance Criteria:**
- R4.AC1: WHEN either surface creates/removes a folder, changes selection, renames a folder, or moves entries THEN it SHALL use the same typed folder operations and interaction controller.
- R4.AC2: WHEN existing project-tree or file extension actions apply to a content row THEN they SHALL receive their existing payload and access checks; folders SHALL not be presented as files, documents, chats, or projects to those handlers.
- R4.AC3: WHEN a theme changes or the explorer unmounts/switches workspace THEN semantic theme styles SHALL update and owned observations, drag registrations, timers, and extension subscriptions SHALL be released.

### R5: Selection and movement

**User Story:** As a user, I want to move one or more entries with drag-and-drop or a menu, so that organization is efficient on every supported input method.

**Acceptance Criteria:**
- R5.AC1: WHEN using pointer selection THEN click, platform Ctrl/Cmd toggle, and Shift range SHALL select rows; selection ranges SHALL follow currently visible rows.
- R5.AC2: WHEN dragging selected entries THEN the UI SHALL identify the count and destination, allow drops onto empty/collapsed folders or scope root, expand a hovered eligible folder after 600 ms, and scroll the containing viewport near its edges.
- R5.AC3: IF a drop targets a selected folder, one of its descendants, another scope, a content leaf, or a read-only destination THEN the UI SHALL reject the drop and write no movement records.
- R5.AC4: WHEN a selection includes an ancestor and its descendant THEN movement SHALL process the ancestor once and preserve the descendant relationship; a batch move SHALL either commit all its local placement edits or none.
- R5.AC5: WHEN the user invokes Move to… by keyboard, context menu, or touch THEN the same destination validation and move operation SHALL run; Escape during dragging or destination selection SHALL cancel without writing.
- R5.AC6: WHEN the latest successful move or rename is undone in the current session THEN the inverse SHALL apply only if affected records still match the saved post-operation revisions; otherwise the UI SHALL report the conflict without overwriting newer work.

### R6: Safe folder removal and content lifecycle

**User Story:** As a user, I want removal actions to state what happens to contents, so that organizing folders cannot delete my work unexpectedly.

**Acceptance Criteria:**
- R6.AC1: WHEN Remove folder is confirmed THEN direct children SHALL move to the folder's parent in the same local transaction as the folder tombstone; descendants, content records, and stored bytes SHALL be retained.
- R6.AC2: WHEN an item is removed from a project THEN its project placement SHALL no longer be shown, while its Files location and content SHALL remain governed by existing membership/lifecycle rules.
- R6.AC3: WHEN a file/document is trashed THEN normal explorers SHALL hide it; WHEN restored THEN it SHALL return to its saved folder if available, otherwise scope root.
- R6.AC4: WHEN a project is deleted THEN its folder/placement metadata SHALL be retired with existing project cleanup, while the existing retention of chats, documents, and files SHALL remain unchanged.
- R6.AC5: WHEN a destination folder disappears during intake THEN saved content SHALL remain reachable at scope root with feedback; if workspace access is revoked THEN no new placement SHALL be written.

### R7: Independent placement and unchanged authority

**User Story:** As a user, I want folder organization to preserve content identity and project context.

**Acceptance Criteria:**
- R7.AC1: WHEN an item moves inside one scope THEN its placements in other scopes, blob count, blob hashes, file reference counts, project membership, chat ownership, source modes, and project instructions SHALL remain unchanged.
- R7.AC2: IF a placement references an item that is absent, deleted, no longer a member, or excluded by workspace-profile rules THEN it SHALL not grant access or display that item.
- R7.AC3: WHEN a chat family is reorganized THEN its branches SHALL remain grouped under the root and its current project owner SHALL remain authoritative.
- R7.AC4: WHEN the content title changes through an existing editor or synced update THEN every visible placement SHALL show that current title.

### R8: Persistence, offline operation, and recovery

**User Story:** As a local-first user, I want organization to survive reload, backup, and synchronization.

**Acceptance Criteria:**
- R8.AC1: WHEN folder/placement changes commit locally offline THEN reload SHALL preserve them and reconnect SHALL use the existing durable sync outbox.
- R8.AC2: WHEN concurrent devices edit the same organization record THEN existing clock/HLC conflict rules SHALL determine the stored winner; independent record changes SHALL remain independent.
- R8.AC3: IF synchronized records form a cycle or reference a missing/deleted/wrong-scope parent THEN every client SHALL deterministically display an acyclic reachable projection, identify recovered entries, and perform no automatic repair writes merely by reading.
- R8.AC4: WHEN a fresh device installs a snapshot or a workspace backup is restored into a disposable workspace THEN organization SHALL reconstruct with unchanged content hashes and no duplicate content records.
- R8.AC5: WHEN earlier flat data is opened THEN all eligible items SHALL appear at scope root without a bulk backfill or rewriting existing project/catalog content.

### R9: Authorization and version admission

**User Story:** As a workspace owner, I want folder operations to obey workspace access and client/provider compatibility boundaries.

**Acceptance Criteria:**
- R9.AC1: WHILE a member has viewer access the explorer SHALL permit reading/navigation and disable mutations; direct attempts SHALL also fail at the operation and canonical provider boundaries.
- R9.AC2: IF the account, workspace, authorization revision, or permission changes during an operation THEN the operation SHALL abort before a new unauthorized commit and SHALL never retry against the newly active workspace.
- R9.AC3: WHEN an older client attempts to read or modify organization records THEN gateway and direct-provider paths SHALL return the established explicit update-required boundary before admitting incompatible records or advancing the affected read cursor.
- R9.AC4: IF the configured provider lacks the organization capability THEN the app SHALL disable creation/mutation of organization records and explain the required update; unchanged flat Files/project behavior SHALL remain available where its existing capability is supported.
- R9.AC5: IF an incoming organization record has invalid shape, scope identity, immutable identity fields, or forbidden file ownership fields THEN the canonical provider SHALL reject the batch atomically before mutation/version allocation.

### R10: Navigation, search, and sorting

**User Story:** As a user, I want nesting to improve organization without making content harder to find.

**Acceptance Criteria:**
- R10.AC1: WHEN a folder-aware search runs THEN it SHALL search descendants within the selected scope, include ancestor paths, and provide Reveal in folder that expands ancestors and focuses the target.
- R10.AC2: WHEN Files is opened with a `recordId` from global search THEN it SHALL reveal that record's current folder and retain the existing preview/open behavior.
- R10.AC3: WHEN a folder is renamed/moved or an item changes without a row-count change THEN paths, results, and reveal targets SHALL update from the existing observation/search infrastructure.
- R10.AC4: WHEN sorting changes THEN folders SHALL remain first, with deterministic tie-breaking; the selected sort and expanded folders SHALL survive reload per workspace/scope/device without entering content sync.

### R11: Keyboard, accessibility, and responsive behavior

**User Story:** As a keyboard, screen-reader, or mobile user, I want to organize content without relying on dragging or hover.

**Acceptance Criteria:**
- R11.AC1: WHEN navigating the tree with arrows, Home/End, Enter, and platform selection keys THEN focus, expansion, selection, and activation SHALL follow accessible tree semantics; typing in rename fields SHALL not trigger tree shortcuts.
- R11.AC2: WHEN renaming THEN Enter SHALL save and Escape SHALL cancel; after move, removal, cancellation, and closing a menu/dialog THEN focus SHALL return to a visible relevant row or parent.
- R11.AC3: WHEN move/rename/removal succeeds or fails THEN an accessible live region SHALL announce the outcome; valid/invalid targets SHALL be distinguishable without color alone.
- R11.AC4: WHEN rendered at 320, 768, and 1440 CSS pixels in light/dark themes THEN creation, navigation, and action menus SHALL remain reachable without whole-page horizontal overflow; Files SHALL collapse its folder navigator on narrow screens.
- R11.AC5: WHILE reduced motion is requested the explorer SHALL suppress decorative movement, and touch actions SHALL remain available without hover or native dragging.

### R12: Bounded rendering and observable failures

**User Story:** As a user with a large library, I want responsive browsing and explicit save failures.

**Acceptance Criteria:**
- R12.AC1: WHEN browsing the verification fixture in a production browser build on a recorded reference machine THEN warm folder expansion and local selection SHALL settle within 200 ms at p95 across 30 interactions, with fewer than 150 mounted content rows per viewport.
- R12.AC2: WHEN the explorer initially loads THEN it SHALL read organization/catalog metadata without downloading file bytes or parsing document bodies for display; file contents SHALL load only through existing search/preview paths.
- R12.AC3: IF local persistence fails or a revision is stale THEN the UI SHALL retain selection/edit input where applicable, remove pending visual state, announce the failure, and permit retry after refreshing; it SHALL not falsely show Saved.
- R12.AC4: WHEN cloud synchronization rejects a committed local change THEN existing sync error/recovery UI SHALL report it; the explorer SHALL distinguish local success from cloud convergence and SHALL not erase queued work automatically.

### R13: Documentation and repeatable verification

**User Story:** As a maintainer, I want documented behavior and repeatable evidence, so that the feature can be maintained and safely shipped.

**Acceptance Criteria:**
- R13.AC1: WHEN implementation is complete THEN the relevant public project/files/sync/theme or extension documentation and `docmap.json`, plus both affected provider READMEs, SHALL describe behavior and capability rollout.
- R13.AC2: WHEN browser qualification completes THEN it SHALL produce screenshots, a Playwright trace, and a JSON receipt containing fixture seed, source SHAs, profile, record identities/parents, operation outcomes, unchanged hashes, and performance measurements.
- R13.AC3: WHEN final verification is performed THEN affected host/provider suites, typechecks, dependency build checks, and disposable backup/sync journeys SHALL pass, with any pre-existing unrelated failure explicitly identified.
