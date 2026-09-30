# Requirements

## Introduction

Resolve screenshot finding 6: opening the image library loads all image metadata and parses every active document before displaying a small page. Deliver a reference-only document query, bounded gallery page reads, and separate global search/count computation. This is an implementation plan, not an implementation or release authorization.

## Context

Inspected `/Users/brendon/Documents/or3/or3-chat`, branch `or3-cloud`, commit `db8c35fee38dfeee304175cacf0e333e16ad69a3`; the checkout was clean. This is Nuxt 4/Vue 3/TypeScript, Bun, Dexie ~4.4, Orama, and Vitest with fake IndexedDB. The documentation entry point is `public/_documentation/docmap.json`. `app/pages/images/index.vue` calls `listAllImageMetas(false/true)` and `listDocuments(Number.MAX_SAFE_INTEGER)`, builds global filters/search, and slices 50 rows. Documents are `posts` with `postType: 'doc'`, serialized `content`, and already-maintained `file_hashes`. `listDocuments` sorts, applies full-entity output hooks, and parses content. Schema version is 15. File and document data also arrive through sync, snapshots, and backup restore. Existing preview components load binary data lazily.

## Assumptions

- Scope is finding 6. Finding 7 is only partially visible and sidebar pagination is a separate task.
- “Used in docs” means referenced by persisted, non-deleted documents, not message `ref_count` or synthetic document list output.
- Missing/malformed `file_hashes` continues to mean no usable references. Repairing historical document bodies is a separate task; the gallery must not perform that repair.
- Preserve the six existing sort modes, generated-name heuristic, verified raster eligibility, search by name/type, and lazy previews.
- It is acceptable for global search/count initialization to visit all compact index entries. It must not load document bodies or retain every full `FileMeta` record, and it must not block the default first page.
- Use a small number of local derived index fields, not a new synced entity or provider API. The one-time upgrade may visit source rows without parsing document content.

## Out of Scope

- Sidebar/document-list pagination, editor changes, reference-count redesign, and a general search framework.
- New dependencies, services, provider schemas, release/deployment work, or changes to preview-cache behavior.
- Claiming that the old gallery downloads every image blob, or that global search/count work can be constant-time.

## Requirements

### R1: Reference-only reads

**User Story:** As a user with large documents, I want library browsing to avoid loading their content.

**Acceptance Criteria:**
- R1.AC1: WHEN the gallery initializes after upgrade THEN it SHALL read document reference index keys without fetching `posts` values, parsing document content, calling `listDocuments`, or invoking full-document output filters.
- R1.AC2: WHEN references are queried THEN the result SHALL deduplicate valid hashes from active `doc` posts only and SHALL safely ignore null, missing, malformed, and non-string reference entries using existing parsing semantics.
- R1.AC3: WHEN existing `listDocuments` or `getDocument` callers run THEN their return types, content parsing, and hooks SHALL retain their contracts.

### R2: Bounded pages and stable ordering

**User Story:** As a user with many images, I want each Load more action to read only the next display page.

**Acceptance Criteria:**
- R2.AC1: WHEN the initial/default gallery page loads THEN it SHALL display at most 50 records, fetch at most 50 full image metadata records plus an optional lookahead, and SHALL not wait for document references, global summaries, or Orama construction.
- R2.AC2: WHEN timestamp/size pages are requested THEN selection SHALL use ordered index keys with an exclusive continuation bound and hash tie-breaker, without growing offsets or reloading the previous full metadata pages.
- R2.AC3: WHEN any of the six sort modes is used on an unchanged dataset THEN all eligible results SHALL appear exactly once in the correct order, including ties. Timestamp order SHALL use `created_at`; name order SHALL retain case-insensitive `localeCompare` behavior with a deterministic tie-breaker.
- R2.AC4: WHEN eligibility is evaluated THEN verified PNG/JPEG/WebP/GIF rows and supported legacy missing-kind rows SHALL follow existing raster rules; generic image-looking files SHALL remain excluded and active/trash results SHALL remain separate.

### R3: Global search and counts

**User Story:** As a user, I want search and category counts to describe the whole library.

**Acceptance Criteria:**
- R3.AC1: WHEN category counts finish loading THEN they SHALL describe all eligible records independently of the loaded pages and current search; “Used in docs” SHALL count unique active images referenced by active documents.
- R3.AC2: WHEN searching by name/type THEN eligible matches beyond row 50 and beyond Orama's current 200-hit cap SHALL remain discoverable, sortable, and pageable; the displayed matching total SHALL equal all matches in the active view.
- R3.AC3: IF Orama fails, is unavailable, or returns no global matches THEN the existing case-insensitive substring fallback SHALL search the whole compact corpus.
- R3.AC4: WHEN name ordering or global search requires an in-memory corpus THEN it SHALL contain only the required summary fields/IDs, not document content, blobs, or all full `FileMeta` rows.

### R4: Updates, scope, and errors

**User Story:** As a user editing or syncing a workspace, I want the library to show current data from the correct workspace.

**Acceptance Criteria:**
- R4.AC1: WHEN local CRUD, rename, document reference changes, remote sync, snapshot bootstrap, or restore changes relevant data THEN reference indexes, counts, search, and affected pages SHALL refresh even if row counts remain unchanged.
- R4.AC2: WHEN workspace, view, sort, query, or data revision changes THEN cursors SHALL reset and results from obsolete requests SHALL not publish; workspace changes SHALL immediately clear old workspace state and selection.
- R4.AC3: IF a query fails THEN the UI SHALL expose the failure/retry state and SHALL not represent failure as an empty library or a zero count; all pending subscriptions/timers SHALL be disposed on unmount.
- R4.AC4: WHEN selection, upload, rename, restore, soft/hard delete, or command-palette opening is used THEN existing action semantics SHALL remain intact, including Select all visible and opening an unloaded hash directly.

### R5: Safe local indexing

**User Story:** As an existing local or cloud user, I want indexes upgraded without changing my data or sync contract.

**Acceptance Criteria:**
- R5.AC1: WHEN an existing database upgrades THEN the next unused schema version SHALL populate derived indexes transactionally, without parsing document bodies, changing source fields/clocks, creating pending sync operations, or deleting data.
- R5.AC2: WHEN source writes commit or abort THEN derived keys SHALL reflect the committed source state atomically across create, put, update, modify, bulk operations, delete, sync, and restore paths.
- R5.AC3: WHEN sync serializes data THEN local index fields SHALL be stripped; incoming or restored derived values SHALL be recomputed from canonical fields rather than trusted.
- R5.AC4: WHEN the change is delivered THEN real IndexedDB integration coverage, relevant regression suites, one typecheck, documentation updates, and final diff inspection SHALL be recorded.
