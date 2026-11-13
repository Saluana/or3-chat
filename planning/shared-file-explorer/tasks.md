# Tasks

Execute sections 1–8 for Phase 1. Section 9 is Phase 2 and is not a prerequisite for shipping Phase 1. Each task is approximately 1–4 hours; split further when evidence expands its scope. Existing requirement/criterion IDs remain stable, while task numbers are resequenced for this revision. No publication or production deployment is authorized by this plan.

Provider paths are external dependencies, not host-checkout contents. A missing provider clone/backend blocks the cloud gate only; complete and review the local/static slice first. Enumerate boundary failures and write any necessary isolated tests before the corresponding implementation, without a separate front-loaded test-authoring project.

## 1. Ground the revision and prepare local review

- [ ] 1.1 Record host SHA/dirty paths and distinguish external provider availability (1h).
      Design: C10, C9.
      Requirements: R13.AC2, R13.AC3.
      Done when: the receipt identifies host and available sibling provider SHAs, deployed-backend prerequisites, applicable parent versus host policies, and baseline targeted commands; missing external paths are not reported as host failures.

- [ ] 1.2 Define the interaction/failure fixture and temporary local flag (2h).
      Design: C4, C6, C10.
      Requirements: R5.AC1, R5.AC7, R5.AC8, R12.AC5, R13.AC4.
      Done when: browser steps specify plain/modified clicks, touch selection, root/explicit destination, invalid drag, off-screen selection, and 100/101 writes; `OR3_EXPLORER_DEV` admits only the local/static dev/test profile with cloud sync disabled.

## 2. Build and review the local Files vertical slice

- [ ] 2.1 Implement record schemas, identity, visibility, and scoped reads (4h).
      Design: C1, C2, C3.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R4.AC2, R7.AC2, R8.AC5, R9.AC5.
      Done when: concrete folder/placement records and stable IDs work against existing posts, both internal types are excluded from ordinary editor/search/tool/plugin content rows, unplaced content remains at root, and necessary contract cases were written before production logic.

- [ ] 2.2 Add the local metadata key and safe additive migration (4h).
      Design: C11, C1.
      Requirements: R12.AC2, R12.AC7, R8.AC4.
      Done when: the next unused Dexie version adds only the derived index, bounded backfill emits no canonical edits, hooks rebuild local/remote/restored values, sanitization/revision fingerprints omit the field, and prewritten upgrade/rollback cases pass.

- [ ] 2.3 Implement key-only enumeration and a complete ordered result vector (4h).
      Design: C11, C3.
      Requirements: R10.AC4, R12.AC1, R12.AC2, R12.AC6.
      Done when: root/unplaced and folder-child sets resolve without post-value reads, file metadata joins use bounded batches, Recently modified/Name sort the complete set, and virtual row data has stable IDs.

- [ ] 2.4 Implement minimal create/rename/move with local admission (4h).
      Design: C1, C2.
      Requirements: R1.AC2, R1.AC3, R5.AC3, R5.AC4, R7.AC1, R9.AC2, R12.AC3, R12.AC5.
      Done when: fresh parent/name/revision checks, selected-ancestor normalization, the 100-record cap, and atomic organization writes work in local mode, without changing content/ownership; required transaction failure cases precede implementation.

- [ ] 2.5 Put folders/breadcrumbs and selection into the real Files list (4h).
      Design: C4, C5, C8, C11.
      Requirements: R3.AC1, R3.AC2, R5.AC1, R5.AC7, R10.AC4, R12.AC1, R12.AC6.
      Done when: cumulative Load more is replaced by virtualization, plain click opens, modified clicks/checkboxes select, touch Select mode works, and full-vector Shift/Select all behave without requiring mounted rows.

- [ ] 2.6 Qualify Move/drag interaction and review the local slice (4h).
      Design: C4, C5, C6, C10.
      Requirements: R5.AC2, R5.AC3, R5.AC5, R5.AC8, R11.AC2, R13.AC2, R13.AC4.
      Done when: real Files operations work through Move to… and one qualified drag engine, including unselected-row/root/breadcrumb/empty-folder targets; a successful browser trace, screenshot, and JSON receipt make the local slice reviewable before provider work begins.

## 3. Complete safe organization and bulk content operations

- [ ] 3.1 Implement collision handling and deterministic ancestor/cycle recovery (4h).
      Design: C1, C2, C3.
      Requirements: R1.AC3, R1.AC4, R8.AC2, R8.AC3, R8.AC6.
      Done when: local same-name create/rename/moves refuse (including collisions within a moved batch), synced duplicates survive visibly, deleted chains resolve to the nearest live ancestor, GC/cycles produce explained fallback, and reads perform no repair writes.

- [ ] 3.2 Implement bounded folder removal and exact confirmations (3h).
      Design: C2, C5.
      Requirements: R6.AC1, R6.AC3, R12.AC3, R12.AC5.
      Done when: Remove folder, keep contents counts direct/hidden entries and destination, empty removal skips confirmation, up-to-budget promotion/tombstone is atomic, and a 2,000-child folder refuses without writing.

- [ ] 3.3 Integrate placement eligibility with existing content/project lifecycle (3h).
      Design: C2, C3, C7, C8.
      Requirements: R6.AC2, R6.AC3, R6.AC4, R6.AC5, R7.AC1, R7.AC2, R7.AC3, R7.AC4.
      Done when: Trash/restore, detach/re-associate, intake fallback, and project deletion retain content safely; project deletion hides its scope without an unbounded organization cascade, and chat families/title changes remain canonical.

- [ ] 3.4 Compose bulk Files Trash through existing owning helpers (4h).
      Design: C12, C8, C2.
      Requirements: R4.AC2, R4.AC4, R6.AC6, R6.AC7, R9.AC2, R12.AC5.
      Done when: aggregate record admission and item-level transaction checks preserve policy/editor-settlement hooks, selected folders disable Trash explicitly, partial results retain unfinished selection, and retries do not repeat completed items.

- [ ] 3.5 Compose bulk project removal through existing membership owners (4h).
      Design: C12, C7, C2.
      Requirements: R6.AC2, R6.AC7, R7.AC1, R7.AC3, R9.AC1, R12.AC5.
      Done when: Remove N items from project names the scope/family effects, counts related canonical writes, preserves underlying Files/content state, and stops safely on revocation/fanout overflow with item-level results.

## 4. Finish shared interaction and responsive presentation

- [ ] 4.1 Implement scoped menus, selection toolbar, shortcuts, and focus rules (4h).
      Design: C4, C5, C12.
      Requirements: R4.AC1, R4.AC2, R4.AC4, R5.AC1, R5.AC7, R11.AC1, R11.AC2.
      Done when: the design input table is implemented, menu selection semantics are explicit, single-item plugins never receive bulk payloads, Delete uses context-specific confirmation, and editable controls retain native shortcuts.

- [ ] 4.2 Complete Move-dialog filtering/new-folder and scoped feedback (3h).
      Design: C3, C4, C5.
      Requirements: R5.AC5, R7.AC5, R8.AC6, R11.AC3.
      Done when: 500 folders remain navigable by search/path, root is always reachable, New folder names its destination, and recovery/action messages identify Files or the project plus a useful next action.

- [ ] 4.3 Complete drag cleanup, project-tree compatibility, and OS-drop handling (4h).
      Design: C5, C6.
      Requirements: R4.AC3, R5.AC2, R5.AC3, R5.AC8, R5.AC9, R11.AC5.
      Done when: mounted UTree targets safely register/dispose, the header remains a root target, hover/autoscroll/cancel work, drag never opens content, and project OS drops reject with supported alternatives rather than browser navigation.

- [ ] 4.4 Finish device preferences, indentation, responsive preview, and accessibility (4h).
      Design: C4, C5, C8.
      Requirements: R2.AC1, R3.AC1, R4.AC3, R10.AC4, R11.AC2, R11.AC3, R11.AC4, R11.AC5.
      Done when: explicit project choice/defaults and Recently modified persist correctly, 48px indentation/full-name tooltips preserve logical depth, 320/768/1440 layouts have no three-column squeeze, and live announcements/reduced-motion/focus behavior pass.

## 5. Integrate project destinations and Files scope/filter behavior

- [ ] 5.1 Add Explorer to Project Home with explicit root/in-folder creation (4h).
      Design: C7, C4, C5.
      Requirements: R2.AC1, R2.AC2, R2.AC3, R7.AC1, R7.AC3, R9.AC1.
      Done when: the active sidebar page honors the view rule, preserves existing sections, opens canonical content, and top-level creation is root while folder creation names/captures its destination.

- [ ] 5.2 Wire limited Phase 1 shortcuts and remove the dead tree component (2h).
      Design: C7, C4.
      Requirements: R2.AC4, R4.AC1, R4.AC2, R4.AC3.
      Done when: shortcuts retain existing navigation/opening and scoped Move to…, profile gates remain, and an import/reference check supports deleting unused `SidebarProjectTree.vue` plus stale comments without adding a second full tree.

- [ ] 5.3 Finish Files intake/inspector and scope-specific locations (4h).
      Design: C8, C7, C3.
      Requirements: R2.AC5, R3.AC3, R3.AC4, R3.AC5, R6.AC3, R6.AC5, R7.AC4, R7.AC5.
      Done when: Upload/New folder name the destination, deduplication preserves location, preview explains shared title and separate Files/project paths, reveal does not move content, and Trash/fallback labels identify library placement unambiguously.

- [ ] 5.4 Implement flat filtered results, path updates, and reveal (4h).
      Design: C3, C4, C8, C11.
      Requirements: R10.AC1, R10.AC2, R10.AC3, R10.AC4, R10.AC5, R12.AC2, R12.AC6.
      Done when: active filters/search hide ordinary folder rows, This folder / All Files controls descendant eligibility, explicit full-text search retains existing capped behavior, and Show in Files/project clears incompatible state and reveals the current path.

## 6. Add cloud admission after the local interaction gate

- [ ] 6.1 Add host capability and first-use compatibility notice (3h).
      Design: C9, C4.
      Requirements: R9.AC3, R9.AC4, R9.AC6.
      Done when: host/session/request schemas support the independent explorer capability, unsupported backends cannot create organization, and a once-per-device/workspace notice explains whole-workspace old-client sync stoppage with Cancel creating nothing.

- [ ] 6.2 Wire host transport/backup checks and queue admission (4h).
      Design: C9, C2, C12.
      Requirements: R8.AC1, R8.AC4, R9.AC3, R9.AC5, R12.AC4, R12.AC5.
      Done when: gateway push/pull/snapshot/backup carry/check the capability, queued statuses/coalescing are reused for transactional headroom, projected 499 admits and 500 refuses, and existing 100-op/2 MiB packing remains intact.

- [ ] 6.3 Implement and qualify external SQLite canonical admission (4h).
      Design: C9, C10.
      Requirements: R9.AC1, R9.AC3, R9.AC4, R9.AC5.
      Done when: a recorded provider SHA passes targeted cases for incoming/stored identity/type/deletes/tombstones/shape/roles in the canonical transaction; no incompatible page cursor advances, and D1 does not advertise unsupported admission.

- [ ] 6.4 Implement and qualify external Convex backend admission (4h).
      Design: C9, C10.
      Requirements: R8.AC2, R9.AC1, R9.AC3, R9.AC5.
      Done when: recorded disposable templates enforce equivalent push/pull/watch/snapshot/shape/identity/permission boundaries while preserving existing idempotency, versions, and LWW.

- [ ] 6.5 Wire external Convex direct/gateway capability and readiness (3h).
      Design: C9.
      Requirements: R9.AC3, R9.AC4, R9.AC5.
      Done when: both transports send the contract, a new package with an old deployed backend remains unqualified, and template artifacts are rebuilt through the provider's own verified scripts.

- [ ] 6.6 Integrate qualified provider contracts and close the local-only flag (3h).
      Design: C9, C10.
      Requirements: R13.AC1, R13.AC3, R13.AC4.
      Done when: host/provider compatibility checks use recorded exact dependencies/backend contracts, the temporary local flag is removed from delivered configuration, and local/static still works with provider-independent organization. Missing provider qualification is explicitly reported as a Phase 1 cloud gate; no package is published.

## 7. Verify Phase 1 with repeatable evidence

- [ ] 7.1 Complete the local Files behavior and retention journey (4h).
      Design: C8, C10, C11, C12.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R1.AC4, R3.AC1, R3.AC2, R3.AC3, R3.AC4, R3.AC5, R4.AC4, R6.AC1, R6.AC3, R6.AC5, R6.AC6, R6.AC7, R7.AC1, R7.AC4, R7.AC5, R10.AC1, R10.AC2, R13.AC2.
      Done when: the canonical storage harness proves scoped paths, upload reuse, collision rules, rename/moves, removal counts, bulk partial outcomes, Trash/restore, root fallback, search/reveal, and unchanged hashes with traces/screenshots/JSON receipts.

- [ ] 7.2 Complete the project/sidebar and input-method journey (4h).
      Design: C5, C6, C7, C10.
      Requirements: R2.AC1, R2.AC2, R2.AC3, R2.AC4, R2.AC5, R4.AC1, R4.AC2, R4.AC3, R5.AC1, R5.AC2, R5.AC3, R5.AC4, R5.AC5, R5.AC7, R5.AC8, R5.AC9, R6.AC2, R6.AC4, R7.AC2, R7.AC3, R10.AC3, R10.AC4, R10.AC5, R11.AC1, R11.AC2, R11.AC3, R11.AC4, R11.AC5.
      Done when: Chromium/WebKit plus touch/keyboard cases prove the interaction table, capped indentation/default views, explicit destinations, scope-independent placement, family grouping, header drop targets, OS-drop refusal, profile gates, and retained single-item extension actions.

- [ ] 7.3 Verify mutation/queue limits, faults, and index lifecycle (4h).
      Design: C2, C10, C11, C12.
      Requirements: R5.AC4, R6.AC7, R8.AC1, R9.AC1, R9.AC2, R12.AC3, R12.AC4, R12.AC5, R12.AC7.
      Done when: 100/101 changed rows, 600 selected items, 2,000 direct children, projected queue 499/500, related chat writes, quota/abort/revocation, migration rollback, and restore/snapshot key rebuild all have expected receipts and no false success or duplicate retry.

- [ ] 7.4 Qualify SQLite cloud convergence and backup recovery (4h).
      Design: C3, C9, C10.
      Requirements: R8.AC1, R8.AC2, R8.AC3, R8.AC4, R8.AC5, R8.AC6, R9.AC3, R9.AC4, R9.AC6, R13.AC2.
      Done when: two disposable devices prove offline opposite moves, deleted-parent late children, GC fallback, first-use notice/cancel, old-client workspace-sync refusal, new-device snapshot, and separate backup restore with unchanged hashes.

- [ ] 7.5 Qualify Convex direct/gateway convergence and stale-backend refusal (4h).
      Design: C9, C10.
      Requirements: R8.AC2, R8.AC3, R8.AC4, R9.AC3, R9.AC4, R9.AC5, R13.AC2, R13.AC3.
      Done when: externally recorded templates/provider versions pass the same graph/cursor/backup expectations through both transports; unsupported backend versions refuse organization before mutation.

- [ ] 7.6 Measure the full metadata/virtualization fixture (4h).
      Design: C3, C5, C10, C11.
      Requirements: R12.AC1, R12.AC2, R12.AC6, R13.AC2.
      Done when: a recorded production build meets p95 200 ms/<150 rows with 5,000 items/500 folders/20 depth, instrumentation proves no browsing post-body reads, Shift/select-all includes unmounted results, and capped full-text results are labeled separately.

## 8. Document and complete Phase 1

- [ ] 8.1 Update host public guides/docmap and external provider READMEs (3h).
      Design: C9, C10.
      Requirements: R13.AC1, R9.AC6.
      Done when: scope labels, click/touch/bulk behavior, limits, local migration, nearest-ancestor recovery, version cutover, external repository ownership, and phased scope are documented with working docmap entries.

- [ ] 8.2 Run the proportionate final Phase 1 verification (4h).
      Design: C10.
      Requirements: R13.AC2, R13.AC3.
      Done when: affected host/provider tests/typechecks, dependency/static/cloud builds, docs checks, and disposable journeys pass with exact profiles/SHAs; unavailable external prerequisites or unrelated existing failures are separately evidenced, never silently marked passed.

- [ ] 8.3 Inspect diffs, simplify, and finalize Phase 1 receipt (2h).
      Design: C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12.
      Requirements: R4.AC1, R7.AC1, R13.AC1, R13.AC2, R13.AC3, R13.AC4.
      Done when: no duplicate mutation path, dead prototype, temporary flag, speculative service, unsafe body read, ownership edge, or claimed Phase 2 control remains; all Phase 1 criteria have evidence and unrelated changes remain untouched.

## 9. Phase 2 follow-up — not a Phase 1 dependency

- [ ] 9.1 Add guarded move/folder-rename Undo (4h).
      Design: C2, C4, C5.
      Requirements: R5.AC6.
      Done when: success toasts expose Undo, explorer-focused Cmd/Ctrl+Z invokes the same one-session receipt, stale revisions/parents refuse safely, and editor/input shortcuts are untouched.

- [ ] 9.2 Add Type sorting (2h).
      Design: C4, C11.
      Requirements: R10.AC6.
      Done when: normalized displayed type sorting has stable name/ID ties, correct folder grouping, saved preference, and no new body reads.

- [ ] 9.3 Add the optional wide-screen Files navigator (4h).
      Design: C5, C8.
      Requirements: R3.AC6.
      Done when: navigator reuses the shared state at 1280px+, collapses before a cramped list/preview layout, and breadcrumbs/folders-in-list remain complete on every width.

- [ ] 9.4 Upgrade shortcuts to the full shared tree (3h).
      Design: C5, C7.
      Requirements: R2.AC6.
      Done when: nested shortcuts use the same behavior without duplicate data writes, retain lazy/profile gates, and preserve the indentation/selection rules.

- [ ] 9.5 Qualify and document Phase 2 separately (3h).
      Design: C10.
      Requirements: R2.AC6, R3.AC6, R5.AC6, R10.AC6, R13.AC1, R13.AC2.
      Done when: focused browser evidence covers Undo conflicts/input focus, Type sort, navigator responsiveness, and shortcut parity; docs and receipts distinguish the later delivery.

## Traceability Matrix

| Requirement | Design components | Phase 1 tasks | Phase 2 tasks |
| --- | --- | --- | --- |
| R1 Folders/names | C1, C2, C3, C5 | 2.1, 2.4, 3.1, 7.1 | — |
| R2 Project integration | C7, C4, C5 | 4.4, 5.1–5.3, 7.2 | 9.4–9.5 (AC6) |
| R3 Files integration | C8, C5, C6 | 2.5, 4.4, 5.3, 7.1 | 9.3, 9.5 (AC6) |
| R4 Shared behavior | C1, C4, C5, C7, C8, C12 | 2.1, 3.4, 4.1, 4.3–4.4, 5.2, 7.1–7.2, 8.3 | — |
| R5 Selection/moves | C2, C4, C5, C6 | 1.2, 2.4–2.6, 4.1–4.3, 7.2–7.3 | 9.1, 9.5 (AC6) |
| R6 Lifecycle/bulk | C2, C3, C7, C8, C12 | 3.2–3.5, 5.3, 7.1–7.3 | — |
| R7 Scope/authority | C1, C2, C3, C7, C8 | 2.1, 2.4, 3.3, 3.5, 4.2, 5.1, 5.3, 7.1–7.2, 8.3 | — |
| R8 Persistence/recovery | C1, C2, C3, C9 | 2.1–2.2, 3.1, 6.2, 6.4, 7.3–7.5 | — |
| R9 Access/cutover | C1, C2, C9, C12 | 2.1, 2.4, 3.4–3.5, 5.1, 6.1–6.5, 7.3–7.5, 8.1 | — |
| R10 Search/filter/sort | C3, C4, C7, C8, C11 | 2.3, 2.5, 4.4, 5.4, 7.1–7.2 | 9.2, 9.5 (AC6) |
| R11 Accessible input | C4, C5, C6, C8 | 2.6, 4.1–4.4, 7.2 | — |
| R12 Reads/limits/errors | C2, C4, C5, C11, C12 | 1.2, 2.2–2.5, 3.2, 3.4–3.5, 5.4, 6.2, 7.3, 7.6 | — |
| R13 Evidence/phases | C9, C10 | 1.1–1.2, 2.6, 6.6, 7.1, 7.4–7.6, 8.1–8.3 | 9.5 |

## Definition of Done

- **Phase 1:** all criteria except R2.AC6, R3.AC6, R5.AC6, and R10.AC6 have passing evidence. The flagged local slice was reviewed before cloud work; the temporary flag is absent from delivery.
- **Phase 2:** the four deferred criteria and their documentation/browser evidence pass independently; Phase 1 does not imply they exist.
- Shared organization and existing content owners preserve file identity, references, membership, AI context, plugin contracts, and profile restrictions.
- Metadata-only browsing, additive local migration, complete virtual selection, explicit batch/queue admission, bulk partial outcomes, ancestor recovery, and client-version notice meet the defined contracts.
- Qualified local/static and external SQLite/Convex configurations pass their appropriate checks. Missing external prerequisites are reported as open cloud work, not treated as success.
- Repeatable traces/screenshots/JSON receipts identify exact source SHAs, fixture seed, profiles, operation counts, hashes, and measured outcomes.
- Relevant typechecks/tests/builds/docs checks pass, final diffs and simplification are reviewed, unrelated work is intact, and no production change or publication occurred.
