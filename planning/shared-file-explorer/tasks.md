# Tasks

Implement in dependency order. Each checkbox is intended to fit approximately 1–4 hours; split a task further if its discovered scope exceeds that bound. Estimates describe task size, not a delivery commitment. Do not publish packages, change production, or disturb unrelated worktrees as part of these tasks.

## 1. Establish contracts and verification before implementation

- [ ] 1.1 Record the host and both provider source SHAs, relevant dirty paths, and baseline commands/artifact locations (1h).
      Design: C10.
      Requirements: R13.AC2, R13.AC3.
      Done when: a local qualification receipt identifies the exact checkouts/profiles and distinguishes existing failures; no unrelated file is modified.

- [ ] 1.2 Enumerate failure fixtures and expected outcomes before writing isolated tests or production logic (2h).
      Design: C1, C2, C3, C9, C10.
      Requirements: R1.AC3, R1.AC4, R5.AC3, R5.AC4, R6.AC5, R8.AC2, R8.AC3, R9.AC1, R9.AC2, R9.AC3, R9.AC5, R12.AC3.
      Done when: fixtures cover malformed/unknown records, duplicates, cycles, missing parents, selected ancestors, stale edits, abort/quota, revocation, and old-client read/write bypass; the test-audit skill has been read for test authoring.

- [ ] 1.3 Author the necessary contract/projection regression cases before implementing C1/C3 (3h).
      Design: C1, C3, C10.
      Requirements: R1.AC3, R1.AC4, R7.AC2, R8.AC3, R8.AC5, R9.AC5.
      Done when: fixed input/output fixtures specify stable identity, cycle-edge choice, missing-parent recovery, non-writing reads, unknown versions, and root defaults without copying the implementation algorithm.

- [ ] 1.4 Author failing transaction-boundary integration cases before implementing C2 (4h).
      Design: C2, C10.
      Requirements: R5.AC3, R5.AC4, R5.AC6, R6.AC1, R6.AC3, R7.AC1, R9.AC1, R9.AC2, R12.AC3.
      Done when: existing database suites contain real-helper expectations for atomic local moves/removal, outbox rollback, stale undo, content retention, and access changes; failures are attributable to the missing feature.

- [ ] 1.5 Author host/SQLite admission cases before their capability implementation (4h).
      Design: C1, C9, C10.
      Requirements: R9.AC3, R9.AC4, R9.AC5.
      Done when: cases cover incoming/stored rows, type substitution, deletes/bare tombstones, malformed payloads, viewer writes, read cursor refusal, and unchanged legacy capabilities.

- [ ] 1.6 Author equivalent Convex template/direct/gateway contract cases before implementation (4h).
      Design: C9, C10.
      Requirements: R8.AC2, R9.AC3, R9.AC4, R9.AC5.
      Done when: existing provider suites specify the same boundaries, including new package with old backend templates; fixture contracts are aligned with the host.

- [ ] 1.7 Qualify the proposed UTree/drag integration in a disposable local fixture (4h).
      Design: C5, C6, C10.
      Requirements: R5.AC2, R5.AC3, R5.AC5, R11.AC1, R11.AC2, R12.AC1.
      Done when: a retained browser trace demonstrates empty/collapsed/root drops, selected ancestors, hover expansion, nested auto-scroll, virtual row disposal, external files, and keyboard focus. Record exact compatible dependency versions; if the gate fails, revise C6 before continuing rather than adding a second engine.

## 2. Define organization records and visibility

- [ ] 2.1 Implement the versioned folder/placement schemas and deterministic identity helpers (3h).
      Design: C1.
      Requirements: R1.AC2, R1.AC3, R1.AC4, R7.AC1, R8.AC5, R9.AC5.
      Done when: names, scope keys, kind restrictions, immutable identity, 8 KiB bound, and empty ownership fields satisfy the prewritten contract cases; no new table or index is added.

- [ ] 2.2 Register internal record visibility and block ordinary editing/search/tool exposure (3h).
      Design: C1, C7, C8.
      Requirements: R4.AC2, R7.AC2, R9.AC5.
      Done when: both post types stay out of ordinary document/prompt lists, generic content tools, and extension content rows, while raw workspace backup retains them.

- [ ] 2.3 Implement deterministic hierarchy projection and scope-local record reads (4h).
      Design: C2, C3.
      Requirements: R1.AC1, R7.AC2, R7.AC3, R7.AC4, R8.AC3, R8.AC5, R12.AC2.
      Done when: flat items appear at root, valid parents resolve, chat families remain grouped, cycles/missing parents recover identically regardless of row order, and projection performs no writes or blob fetches.

## 3. Implement transactional organization operations

- [ ] 3.1 Implement create/rename folder with captured scope and revision checks (3h).
      Design: C1, C2.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R1.AC4, R9.AC1, R9.AC2, R12.AC3.
      Done when: create/rename pass contract/transaction cases and preserve unknown supported-version fields; failures retain the prior committed state.

- [ ] 3.2 Implement fresh destination/membership validation and selection normalization (3h).
      Design: C2, C3.
      Requirements: R5.AC3, R5.AC4, R7.AC2, R7.AC3, R9.AC2.
      Done when: invalid scope/descendant/leaf destinations refuse and selected descendants are processed once under their selected ancestor, using fresh canonical content eligibility.

- [ ] 3.3 Implement batch reparenting with atomic outbox capture (4h).
      Design: C2.
      Requirements: R1.AC2, R5.AC4, R7.AC1, R8.AC1, R12.AC3.
      Done when: folder and item moves commit all local rows/outbox effects or none, root moves retain placement history, and owners/source modes/hashes/ref-counts are unchanged.

- [ ] 3.4 Implement safe folder removal with child promotion (3h).
      Design: C2, C3.
      Requirements: R6.AC1, R6.AC3, R8.AC3.
      Done when: direct child folders and visible/trashed placements promote atomically with the folder tombstone, file bytes remain unchanged, and late remote children remain reachable.

- [ ] 3.5 Implement guarded inverse operations for last move/rename (3h).
      Design: C2, C4.
      Requirements: R5.AC6, R9.AC2, R12.AC3.
      Done when: a receipt can undo one operation through the same helpers, and changed membership/revisions/destinations refuse the inverse without partial changes.

- [ ] 3.6 Integrate metadata retirement with project detach/delete and content restore (4h).
      Design: C2, C7, C8.
      Requirements: R6.AC2, R6.AC3, R6.AC4, R7.AC1, R7.AC2.
      Done when: existing lifecycle paths hide/retire ineligible placements, project deletion retains content, re-association starts at root, and Trash restore uses a valid saved folder or root.

## 4. Integrate sync and provider capability admission

- [ ] 4.1 Add the host explorer capability contract and session availability (3h).
      Design: C9.
      Requirements: R9.AC3, R9.AC4, R9.AC5.
      Done when: shared request types/schemas and authenticated session expose the independent capability without changing existing Files/file-kind admission or accepting unsupported organization writes.

- [ ] 4.2 Wire gateway requests and host push/pull/snapshot checks (4h).
      Design: C9.
      Requirements: R8.AC1, R8.AC4, R9.AC3, R9.AC5.
      Done when: all request paths send the capability, unsupported reads stop before page/cursor admission, incoming organization rows validate, and backup export/restore carries the same capability.

- [ ] 4.3 Implement native SQLite canonical validation (4h).
      Design: C1, C9.
      Requirements: R8.AC2, R9.AC1, R9.AC3, R9.AC4, R9.AC5.
      Done when: stored/incoming row and tombstone checks run in the canonical mutation transaction, atomic rejection leaves versions/data unchanged, and D1 does not advertise or accept explorer mutations.

- [ ] 4.4 Implement Convex template mutation/read admission (4h).
      Design: C1, C9.
      Requirements: R8.AC2, R9.AC1, R9.AC3, R9.AC5.
      Done when: push, pull, watch, and snapshot enforce equivalent typed/authorization/version boundaries, including deleted records, without changing LWW/idempotency/cursor contracts.

- [ ] 4.5 Wire Convex gateway/direct transport and backend readiness (3h).
      Design: C9.
      Requirements: R9.AC3, R9.AC4.
      Done when: direct and gateway requests carry the contract and an old deployed template cannot produce a false capability advertisement; regenerate contract/template artifacts through the package's existing build process.

- [ ] 4.6 Run affected host/provider contract suites and resolve feature-caused failures (3h).
      Design: C9, C10.
      Requirements: R8.AC2, R9.AC1, R9.AC3, R9.AC4, R9.AC5, R13.AC3.
      Done when: prewritten admission cases pass in both providers and host; test output identifies exact versions/SHAs without releasing packages.

## 5. Build the shared explorer interaction

- [ ] 5.1 Implement controlled navigation, selection, sort, and device preferences (4h).
      Design: C3, C4.
      Requirements: R4.AC1, R4.AC3, R5.AC1, R10.AC4, R11.AC1.
      Done when: state is scoped by account/workspace/surface, click/Ctrl-or-Cmd/Shift selection uses visible rows, expansion/sort survives reload outside content sync, and switching scope clears pending actions/undo.

- [ ] 5.2 Implement the shared UTree wrapper and row actions (4h).
      Design: C4, C5.
      Requirements: R1.AC1, R4.AC1, R4.AC2, R11.AC1, R11.AC2, R11.AC3, R12.AC1.
      Done when: stable keys, empty folders, controlled expansion, virtual rows, folder/content activation, focus restoration, and per-surface existing actions work without duplicate mutation handlers.

- [ ] 5.3 Implement inline rename, safe removal confirmation, and Move to… (4h).
      Design: C2, C4, C5.
      Requirements: R1.AC3, R5.AC5, R5.AC6, R6.AC1, R11.AC2, R11.AC3, R12.AC3.
      Done when: Enter/Escape and focus behavior are verified, Move uses the same validated operation as dragging, removal names child promotion, and conflict/error text retains recoverable input.

- [ ] 5.4 Integrate the qualified drag adapter and auto-scroll (4h).
      Design: C4, C5, C6.
      Requirements: R3.AC3, R5.AC2, R5.AC3, R5.AC4, R5.AC5, R11.AC3, R11.AC5.
      Done when: only qualified dependencies are added, the prototype behavior runs against real IDs/operations, external files reach intake, and invalid/cancelled drops produce no writes.

- [ ] 5.5 Finish owned cleanup, reduced motion, and accessible feedback (3h).
      Design: C4, C5, C6.
      Requirements: R4.AC3, R11.AC1, R11.AC2, R11.AC3, R11.AC5, R12.AC4.
      Done when: unmount/scope change disposes observations/timers/drag targets, live announcements cover outcomes, touch menus require no hover, and local save/cloud pending/error states are distinct.

## 6. Connect Projects and Files

- [ ] 6.1 Host Explorer/Recent activity in the active project page (4h).
      Design: C7, C4, C5.
      Requirements: R2.AC1, R2.AC2, R7.AC2, R7.AC3, R7.AC4.
      Done when: Project Home shows real eligible mixed contents and opens the existing panes; brief, Knowledge, Memory, Settings, and activity remain usable.

- [ ] 6.2 Place newly created/associated project items and preserve actions (3h).
      Design: C2, C7.
      Requirements: R2.AC3, R4.AC2, R6.AC5, R7.AC1.
      Done when: new chats/documents and Add to project use the selected folder, existing Knowledge/membership APIs retain ownership, and partial creation/placement outcomes explicitly reveal saved content.

- [ ] 6.3 Use the shared tree in project shortcuts (3h).
      Design: C7, C5.
      Requirements: R2.AC4, R4.AC1, R4.AC2, R4.AC3.
      Done when: shortcut and page show the same hierarchy, existing lazy loading/profile gates apply, and obsolete tree code is removed only if proven unreferenced.

- [ ] 6.4 Add Files folder navigation, breadcrumbs, and child listing (4h).
      Design: C8, C3, C4, C5.
      Requirements: R3.AC1, R3.AC2, R4.AC1, R7.AC4, R10.AC4.
      Done when: folder selection, breadcrumbs, filters, root/unfiled listing, preview/download, and existing actions work together without duplicating folder operations.

- [ ] 6.5 Integrate upload destinations, deduplication feedback, and Trash locations (4h).
      Design: C8, C2, C6.
      Requirements: R3.AC3, R3.AC4, R6.AC3, R6.AC5, R9.AC2.
      Done when: button/drop uploads capture the destination, reused records keep their location, directories reject clearly, partial failures report actual outcomes, and restored content remains reachable.

- [ ] 6.6 Connect scope search, path invalidation, and reveal (4h).
      Design: C3, C4, C7, C8.
      Requirements: R10.AC1, R10.AC2, R10.AC3, R12.AC2.
      Done when: existing bounded search finds descendant contents, folder-name search uses loaded metadata, moves/renames update paths without count changes, and Files `recordId` resolves/focuses/previews the current location.

- [ ] 6.7 Complete narrow-layout, theme, and profile integration (3h).
      Design: C5, C7, C8.
      Requirements: R2.AC4, R4.AC3, R11.AC4, R11.AC5.
      Done when: 320/768/1440 layouts, light/dark themes, mobile folder navigation, Move to…, reduced motion, and profile restrictions are usable through real surfaces.

## 7. Qualify behavior and retain browser artifacts

- [ ] 7.1 Complete the project organization browser journey (4h).
      Design: C7, C10.
      Requirements: R1.AC1, R1.AC2, R1.AC4, R2.AC1, R2.AC2, R2.AC3, R2.AC4, R6.AC2, R6.AC4, R7.AC1, R7.AC3, R13.AC2.
      Done when: the existing project harness covers nested mixed contents, shortcuts, independent placements, family grouping, detach/delete, and unchanged AI context; screenshots/trace/JSON receipt are attached.

- [ ] 7.2 Complete the Files organization and data-retention browser journey (4h).
      Design: C8, C10.
      Requirements: R3.AC1, R3.AC2, R3.AC3, R3.AC4, R4.AC2, R6.AC1, R6.AC3, R6.AC5, R7.AC1, R7.AC4, R10.AC1, R10.AC2, R10.AC3, R13.AC2.
      Done when: the storage harness verifies upload/reuse, move, search/reveal, safe folder removal, Trash/restore, retained plugin policies, and original-byte hashes with repeatable artifacts.

- [ ] 7.3 Run pointer/keyboard/touch/responsive interaction qualification (4h).
      Design: C5, C6, C10.
      Requirements: R5.AC1, R5.AC2, R5.AC3, R5.AC4, R5.AC5, R5.AC6, R10.AC4, R11.AC1, R11.AC2, R11.AC3, R11.AC4, R11.AC5, R13.AC2.
      Done when: Chromium/WebKit drag cases and keyboard/touch Move cases pass, with focus/announcement checks, screenshots at all stated widths, and successful-run traces.

- [ ] 7.4 Run local fault, permission, and workspace-switch browser cases (3h).
      Design: C2, C4, C10.
      Requirements: R4.AC3, R5.AC6, R8.AC1, R9.AC1, R9.AC2, R12.AC3, R12.AC4, R13.AC2.
      Done when: quota/abort/stale revisions and mid-operation account/role changes retain safe state, do not leak writes, and produce explicit recovery outcomes in the receipt.

- [ ] 7.5 Qualify SQLite cloud convergence, new-device recovery, and backup (4h).
      Design: C3, C9, C10.
      Requirements: R8.AC1, R8.AC2, R8.AC3, R8.AC4, R8.AC5, R9.AC3, R9.AC4, R13.AC2.
      Done when: two isolated devices on the fixed disposable cloud profile converge after opposite offline folder moves and deletion races; a new snapshot device and separate restored workspace preserve IDs/content hashes; old-client refusal is verified.

- [ ] 7.6 Qualify Convex direct/gateway convergence and stale-template behavior (4h).
      Design: C9, C10.
      Requirements: R8.AC2, R8.AC3, R8.AC4, R9.AC3, R9.AC4, R9.AC5, R13.AC2.
      Done when: disposable templates prove the same graph/cursor/content outcomes for both transports, incompatible readers/writers are refused, and a stale backend disables organization before mutation.

- [ ] 7.7 Run the populated-workspace explorer performance fixture (4h).
      Design: C3, C5, C6, C10.
      Requirements: R12.AC1, R12.AC2, R13.AC2.
      Done when: recorded production-build measurements meet p95 200 ms/<150 mounted rows at the stated scale, no incidental blob requests occur, and any regression has same-host base/candidate evidence and a resolved cause.

## 8. Documentation and final verification

- [ ] 8.1 Update public user/developer guides and docmap entries (3h).
      Design: C10.
      Requirements: R13.AC1.
      Done when: `public/_documentation/start/projects.md`, database Files/projects guidance, sync capability guidance, and affected theme/extension guidance explain folders, independent placement, recovery, and the retained public action contracts; `docmap.json` and docs checks agree.

- [ ] 8.2 Document provider compatibility and rollout order (2h).
      Design: C9, C10.
      Requirements: R9.AC3, R9.AC4, R13.AC1.
      Done when: SQLite and Convex READMEs describe the explorer contract, installed backend-template requirement, qualified transports, D1 exclusion, and provider-before-host publication dependency; no release/deployment is performed.

- [ ] 8.3 Complete the proportionate final host/provider validation pass (4h).
      Design: C10.
      Requirements: R13.AC2, R13.AC3.
      Done when: design-listed relevant suites, typechecks, static/cloud builds, dependency checks, and disposable browser/cloud journeys are green; missing environment prerequisites or pre-existing failures are explicitly recorded rather than waived or hidden.

- [ ] 8.4 Simplify, inspect the final diffs, and finalize the receipt (2h).
      Design: C1–C10.
      Requirements: R4.AC1, R7.AC1, R13.AC1, R13.AC2, R13.AC3.
      Done when: no duplicate tree mutation path, unused prototype, generic adapter framework, speculative index/service, or accidental ownership/file edge remains; explicit changed paths and repeatable artifacts are linked and every acceptance criterion has evidence.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 Nested folders | C1, C2, C3, C5 | 1.2–1.3, 2.1, 2.3, 3.1, 3.3, 5.2–5.3, 7.1 |
| R2 Project explorer | C7, C4, C5 | 6.1–6.3, 6.7, 7.1 |
| R3 Files browser | C8, C6 | 5.4, 6.4–6.5, 7.2 |
| R4 Shared behavior | C4, C5, C7, C8 | 2.2, 5.1–5.2, 5.5, 6.2–6.4, 6.7, 7.2, 7.4, 8.4 |
| R5 Selection/moves | C2, C4, C5, C6 | 1.2, 1.4, 1.7, 3.2–3.3, 3.5, 5.1, 5.3–5.4, 7.3–7.4 |
| R6 Lifecycle safety | C2, C7, C8 | 1.2, 1.4, 3.4, 3.6, 5.3, 6.2, 6.5, 7.1–7.2 |
| R7 Identity/authority | C1, C2, C3, C7, C8 | 1.3–1.4, 2.1–2.3, 3.2–3.3, 3.6, 6.1–6.2, 6.4, 7.1–7.2, 8.4 |
| R8 Persistence/recovery | C1, C2, C3, C9 | 1.2–1.3, 1.6, 2.1, 2.3, 3.3–3.4, 4.2–4.4, 4.6, 7.4–7.6 |
| R9 Auth/version | C1, C2, C9 | 1.2–1.6, 2.1–2.2, 3.1–3.2, 3.5, 4.1–4.6, 6.5, 7.4–7.6, 8.2 |
| R10 Search/navigation | C3, C4, C5, C7, C8 | 5.1, 6.4, 6.6, 7.2–7.3 |
| R11 Accessible UI | C4, C5, C6, C8 | 1.7, 5.1–5.5, 6.7, 7.3 |
| R12 Scale/errors | C2, C3, C4, C5, C6 | 1.2, 1.4, 1.7, 2.3, 3.1, 3.3, 3.5, 5.2–5.3, 5.5, 6.6, 7.4, 7.7 |
| R13 Evidence/docs | C10, C9 | 1.1, 4.6, 7.1–7.7, 8.1–8.4 |

## Definition of Done

- All R1–R13 acceptance criteria have passing evidence, and the requirement/component/task matrix has no gaps.
- Both real surfaces use shared folder/move operations and preserve existing content, membership, plugin, theme, and profile behavior.
- Local-only and qualified SQLite/Convex configurations work; unsupported provider/backend versions fail closed for organization.
- Data safety, concurrency, old-client admission, backup/restore, keyboard/mobile behavior, and stated performance bounds pass their appropriate checks.
- Host/provider typechecks, affected tests, required dependency builds, and documentation checks are green; unrelated pre-existing failures are separately evidenced.
- Playwright traces/screenshots and JSON receipts are repeatable and reference exact source SHAs/profiles/fixture seeds.
- Final diff and simplification review are complete; only intended files changed, no production data changed, and no package/tag/image was published.
