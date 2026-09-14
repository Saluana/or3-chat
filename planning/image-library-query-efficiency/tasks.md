# Tasks

## 1. Confirm contracts and establish regression fixtures

- [x] 1.1 Recheck checkout, applicable instructions, docmap, and the recorded code paths; add failing reference-read and pagination/search cases in canonical suites.
      Requirements: R1, R2, R3
      Done when: current gallery behavior is reproduced, relevant fixtures include >200 matches and large document bodies, and baseline key/value read measurements are recorded.

## 2. Local index schema and write invariants

- [x] 2.1 Implement Index derivation and the next unused schema upgrade for sparse document reference and image state/ordering/summary indexes.
      Requirements: R1, R2, R5
      Done when: a real v15 upgrade produces correct keys without parsing bodies or altering canonical data, and rollback/CRUD/bulk tests pass.
- [x] 2.2 Integrate derived-field stripping with existing sync sanitization and verify actual remote apply, snapshot, and backup restore paths.
      Requirements: R4, R5
      Done when: local fields do not appear in outbox wire payloads, incoming derived values are recomputed, and restore/sync tests demonstrate current indexes without extra sync operations.

## 3. Reference-only query milestone

- [x] 3.1 Add Document hash query, switch the gallery reference caller, and retain all existing full-document APIs/hooks.
      Requirements: R1, R5
      Done when: reference fixtures pass and the gallery reference path makes zero post-value reads and zero body parses after migration.

## 4. Page queries and global compact data

- [x] 4.1 Implement Gallery queries for summary keys and timestamp/size keyset pages with hash tie-breakers and bounded hydration.
      Requirements: R2, R3, R5
      Done when: real IndexedDB tests cover all page boundaries/eligibility cases and load-more reads do not repeat prior value pages.
- [x] 4.2 Adapt Image search and library helpers to compact summaries, complete Orama hit batches, global counts, and revision-bound locale-name ID ordering.
      Requirements: R2, R3
      Done when: >200 matching results remain pageable and correctly sorted, fallback searches globally, and every category/matching count is exact.

## 5. Gallery integration and lifecycle

- [x] 5.1 Replace `visibleLimit` over all metadata with Gallery state page results, independent aggregate states, and filter/sort/query cursor resets.
      Requirements: R2, R3, R4
      Done when: default first page renders without waiting for aggregates/Orama, Load more fetches another bounded page, and pending/failed aggregates are not shown as zero.
- [x] 5.2 Integrate data/workspace invalidation, stale-request rejection, error/retry handling, and cleanup using existing DB subscription patterns.
      Requirements: R3, R4, R5
      Done when: same-count edits, sync writes, workspace changes, slow-search races, and unmount scenarios pass production-backed controller tests.
- [x] 5.3 Reconcile upload/rename/delete/restore and selection with page state; retain direct unloaded-hash command-palette opening and existing lazy previews.
      Requirements: R2, R4
      Done when: canonical destructive-action, viewer/grid/cache, selection, and palette-opening checks pass without classifying off-page hashes as mutation failures.

## 6. Final verification and documentation

- [x] 6.1 Run all affected database/migration, gallery/search, sync sanitization/apply, and backup regression tests, then one typecheck and disposable browser smoke.
      Requirements: R1, R2, R3, R4, R5
      Done when: relevant checks pass, any pre-existing failures are separated with evidence, and measured initial reads meet R1/R2 bounds after upgrade. Record global corpus and upgrade costs separately.
- [x] 6.2 Update mapped public docs, simplify the implementation, and inspect the final diff.
      Requirements: R1, R2, R3, R4, R5
      Done when: `database/documents.md`, `database/files-select.md`, `database/client.md`, and affected schema/type/composable pages accurately describe the new local APIs/indexes; `docmap.json` is refreshed; `bun run check:docs` passes; no unrelated changes remain. Provider READMEs need changes only if an actual provider-facing contract changes, which this design avoids.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 | Index derivation; Document hash query; Verification and documentation | 1.1, 2.1, 3.1, 6.1, 6.2 |
| R2 | Index derivation; Gallery queries; Gallery state; Verification and documentation | 1.1, 2.1, 4.1, 4.2, 5.1, 5.3, 6.1, 6.2 |
| R3 | Gallery queries; Image search; Gallery state; Verification and documentation | 1.1, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2 |
| R4 | Index derivation; Gallery state; Verification and documentation | 2.2, 5.1, 5.2, 5.3, 6.1, 6.2 |
| R5 | Index derivation; Document hash query; Gallery queries; Verification and documentation | 2.1, 2.2, 3.1, 4.1, 5.2, 6.1, 6.2 |

## Definition of Done

- All R1–R5 acceptance criteria pass and the traceability matrix has no gaps.
- Gallery startup reads no document bodies; full metadata hydration is page-bounded; search/counts are global and use compact data.
- Migration, sync, restore, workspace isolation, and destructive UI actions have direct regression evidence.
- Targeted tests, all affected high-risk suites, one typecheck, docs validation, and final diff review are recorded.
- Final handoff reports changed paths, checks/results, before/after measurements, and the remaining O(N) compact search/count work. No release, deployment, or unrelated sidebar change is included.
