# Tasks

This is an unexecuted implementation checklist. Only planning documents have been created. Source changes, test execution, installation, and deployment require a subsequent implementation request.

Read [requirements.md](requirements.md) and [design.md](design.md) first. Component IDs below refer to the design. Estimates are intended task sizes, not delivery guarantees; split a task if its implementation exceeds four hours. Preserve unrelated work already in the checkout.

Work in three increments: sections 0–1 deliver find/read; section 2 adds document/project changes; sections 3–5 deliver Files and qualify the complete feature. File catalog work is not a prerequisite for the first two increments. All test-authoring steps apply during implementation, not this planning task.

## 0. Establish verification before implementation

- [ ] 0.1 Reconfirm the inspected owners and write the failure/verification matrix (1–2h)
      Components: C1–C11.
      Requirements: R3, R5, R7, R9, R12, R13.
      Done when: the implementer records current source versions, existing test owners, and credible failures for stale reads/writes, duplicate execution, workspace switching, access revocation, shared blob deletion, malformed files, interrupted sync, and old-writer omission. Any changes since the plan are resolved explicitly; the planning handoff is confirmed to contain no application/test changes.

- [ ] 0.2 Extend the existing journey setup for workspace read/search acceptance (2–3h)
      Components: C2, C3, C9, C11.
      Requirements: R1, R2, R3, R10, R13.
      Done when: synthetic chats/documents/projects and a scripted model transport exercise real production chat/tool paths; expected failure cases exist before implementation. The setup can retain traces, screenshots, source IDs, and content markers without introducing a test-only production API.

## 1. Increment one: find and read existing work

- [ ] 1.1 Implement captured workspace access for the read path (2–3h)
      Component: C1.
      Requirements: R3.AC1, R3.AC4, R3.AC5, R12.AC1, R12.AC5.
      Done when: operations bind to the initiating database/subject/generation, deny unavailable access, and discard results after cancellation or workspace change. Delayed reads cannot leak content to the new workspace.

- [ ] 1.2 Make core chat search use visible, permitted conversation text (2–4h)
      Components: C2, C3.
      Requirements: R2.AC1, R2.AC5, R3.AC2.
      Done when: canonical search coverage proves branch ordering, exclusion of retry-superseded text/reasoning/raw tool output, and omission of internal/private records without changing legitimate document or chat search behavior.

- [ ] 1.3 Expose bounded search independently of palette UI state (2–4h)
      Component: C2.
      Requirements: R2, R11.AC1, R11.AC2, R11.AC4.
      Done when: a one-shot query reuses the existing index host, admits only the four core source kinds when available, filters project membership before limiting, preserves fallback/partial-source status, and leaves an open palette's query and selection untouched.

- [ ] 1.4 Add bounded core item reads and source references (2–4h)
      Component: C3.
      Requirements: R3, R12.AC1.
      Done when: chat/document/project reads return bounded pages with revision/source information, flush or reject conflicting live document buffers, and revalidate the exact identified item. No read depends on a model-supplied workspace, URL, or database query.

- [ ] 1.5 Register the two read tools through the existing registry (1–3h)
      Component: C10.
      Requirements: R1.AC1, R1.AC3, R2.AC2, R3.AC5, R11.AC1, R12.AC3.
      Done when: `workspace_search` and `workspace_read` work in normal chat with current schema validation, tool enablement, runtime admission, cancellation, output bounds, and client-bridge failure behavior. No additional model call occurs during search.

- [ ] 1.6 Render compact, verifiable source receipts (2–3h)
      Component: C9.
      Requirements: R1.AC2, R1.AC4, R3.AC3, R10.AC3, R10.AC6.
      Done when: source chips open the actual item through existing navigation, show unavailable items accurately, disclose partial coverage, and preserve composer focus/drafts. The normal view shows concise progress; raw arguments stay in expanded details.

- [ ] 1.7 Qualify the first increment (1–2h)
      Component: C11.
      Requirements: R1, R2, R3, R10, R12, R13.
      Done when: the relevant production chat and command-palette journeys pass with repeatable artifacts, including ambiguous targets, a deleted result, model/tool disablement, and a workspace switch during retrieval. Remaining failures are fixed or identified as unrelated baseline failures with evidence.

## 2. Increment two: create documents and make controlled changes

- [ ] 2.1 Author document/project failure coverage before changing those owners (2–3h)
      Components: C4, C5, C11.
      Requirements: R4, R5, R6, R12, R13.AC1.
      Done when: the existing production document journey and canonical lifecycle owners cover no-save preview, stale Apply, duplicate execution, delayed autosave, guarded Undo, project-entry preservation, storage failure, and permission loss. Each boundary has one primary test owner.

- [ ] 2.2 Share actual document schema and proposal preparation (2–4h)
      Component: C4.
      Requirements: R4.AC1, R5.AC1, R5.AC3, R11.AC1, R11.AC2.
      Done when: the current editor/Document AI and chat can use the same lazy-loaded content schema, frozen block references, operation validation, and diff preparation, including enabled custom nodes. There is no hidden live editor or second AI loop.

- [ ] 2.3 Add captured-database revision and write support where needed (2–4h)
      Components: C1, C4.
      Requirements: R5.AC2, R5.AC3, R12.AC1, R12.AC5.
      Done when: history encoding/persistence cannot switch databases after awaits, stale revisions are rejected inside the write boundary, and a failed write leaves the original document intact. Changes are restricted to helpers used by this path.

- [ ] 2.4 Implement idempotent document creation and its saved receipt (2–3h)
      Components: C4, C9.
      Requirements: R4, R6.AC2.
      Done when: a requested native document and optional project association commit together; repeated delivery of one execution returns the same document, and validation/quota failures never produce a false success.

- [ ] 2.5 Stage document edit proposals from host read receipts (2–4h)
      Component: C4.
      Requirements: R5.AC1, R5.AC3, R5.AC5.
      Done when: valid operations against the exposed block references produce a bounded pending envelope in the originating message, invalid/unread/stale references are rejected, and reload can reconstruct or invalidate the proposal without storing another complete document snapshot.

- [ ] 2.6 Connect Apply and Undo to history and live editor sessions (2–4h)
      Components: C4, C9.
      Requirements: R5.AC2, R5.AC3, R5.AC4, R5.AC5, R12.AC5.
      Done when: one Apply records the checkpoint, persists the content and host-owned receipt, and updates mounted editors without an old autosave overwriting it. Duplicate Apply in the same local database does not write again; Undo preserves later user edits by offering history when appropriate. Remote sync winners invalidate obsolete controls without claiming distributed exactly-once behavior.

- [ ] 2.7 Add scoped, revision-aware project operations (2–4h)
      Component: C5.
      Requirements: R6, R12.AC1.
      Done when: create/rename/description/add/remove operations preserve unknown entries and refuse to overwrite newer observed revisions, validate referenced items, and never delete an item's content when removing an association. Existing thread membership conventions remain consistent.

- [ ] 2.8 Register write tools and present one review card (2–4h)
      Components: C9, C10.
      Requirements: R1, R4, R5, R6, R10.AC3, R10.AC6.
      Done when: the remaining three tools work through the existing registry; saved documents/projects have accurate links; document edits show Review/Apply changes/Discard with the existing diff UI and no extra confirmation per block or focus stealing.

- [ ] 2.9 Qualify the second increment (1–3h)
      Component: C11.
      Requirements: R4, R5, R6, R10, R12, R13.
      Done when: real create/review/apply/undo/project journeys and relevant lifecycle boundary cases pass, artifacts survive reload, and model prose cannot incorrectly mark a pending change as saved.

## 3. Increment three: file ownership and content foundations

- [ ] 3.1 Author catalog/Trash/provider boundary cases before implementation (2–3h)
      Components: C6, C7, C11.
      Requirements: R7, R8, R9, R12.AC4, R13.AC1.
      Done when: the canonical storage fixture and relevant adapter owners specify catalog-only retention, trashed references, shared attachments, same-hash imports, prefix coverage, old-reader rejection, old-writer omission, and interrupted import. Expected failures precede production changes.

- [ ] 3.2 Implement catalog posts and namespaced item metadata (2–4h)
      Component: C6.
      Requirements: R7.AC1, R7.AC2, R7.AC3, R8.AC1, R9.AC1, R9.AC2, R11.AC1.
      Done when: `or3:file` posts use existing storage fields, deterministic hash-based identity, a user-controlled title, and a single original file reference. Native docs default to visible without metadata; metadata updates preserve unrelated keys and no new table is introduced.

- [ ] 3.3 Support file associations and shared visibility rules (2–3h)
      Components: C5, C6.
      Requirements: R6.AC2, R6.AC3, R6.AC4, R9.AC1.
      Done when: file entries round-trip in projects and every applicable Files/document/sidebar/mention/search projection uses the same logical-Trash rule. Internal catalog records never appear as prompts or editable generic posts.

- [ ] 3.4 Add narrowly scoped capability admission at host boundaries (2–4h)
      Components: C1, C6.
      Requirements: R12.AC4.
      Done when: current sync request/snapshot boundaries carry the workspace-item capability and reject incompatible reads/writes before applying them, including an old writer omitting metadata/file memberships present in the canonical record. There is no alternate legacy representation.

- [ ] 3.5 Qualify SQLite/filesystem preservation and reference behavior (2–4h)
      Components: C6, C11.
      Requirements: R7.AC2, R9.AC2, R9.AC4, R12.AC4.
      Done when: real supported adapters preserve catalog/meta/project payloads and retain blobs referenced by active or logically trashed catalog/doc rows. Changed provider code, if required, is limited to the owning admission/reference boundary and is identified as a publication dependency.

- [ ] 3.6 Qualify Convex gateway and direct-provider admission (2–4h)
      Components: C6, C11.
      Requirements: R9.AC2, R9.AC4, R12.AC4.
      Done when: Convex schema/serialization/reference behavior and both supported access paths preserve the new semantics and reject old-writer omission. Required template/package deployment updates are documented; a gateway-only proof is not claimed as direct-provider coverage.

- [ ] 3.7 Implement idempotent upload-to-catalog intake (2–4h)
      Component: C6.
      Requirements: R7.AC1, R7.AC2, R7.AC3, R7.AC4, R12.AC2.
      Done when: accepted uploads use existing file persistence/transfer, save a catalog entry before local success, reuse duplicates without renaming, restore a duplicate trashed entry visibly, and report local versus cloud state accurately. Failed/cancelled imports never remove shared bytes.

- [ ] 3.8 Add bounded UTF-8 text extraction and continuation reads (2–3h)
      Components: C3, C7.
      Requirements: R8.AC1, R8.AC2, R8.AC3, R8.AC5, R11.AC1, R11.AC2.
      Done when: supported text gets an accurately labeled 64 KiB excerpt, invalid/binary encodings remain stored-only, continuation reads are bounded, and original/downloaded bytes remain identical. No parser dependency, remote extraction, or model call is introduced.

- [ ] 3.9 Integrate regular chat uploads with the catalog (2–4h)
      Components: C6, C10.
      Requirements: R7.AC1, R7.AC2, R8.AC4, R8.AC5.
      Done when: new regular uploads have a reusable Files entry, supported text becomes a file reference, current image/PDF transport still works, and upload limits/policies remain consistent at browser and server boundaries. Draft cancellation and duplicate intake have explicit outcomes.

- [ ] 3.10 Implement explicit Add existing uploads (1–3h)
      Component: C6.
      Requirements: R7.AC5, R8.AC3, R11.AC2.
      Done when: existing live metadata is paged through the same catalog operation, repeated imports create no duplicates or accidental restorations/renames, partial progress is visible, and no existing blobs are downloaded or copied merely to populate Files. Supported unindexed text exposes an explicit, write-gated Enable text search action using the same bounded importer.

- [ ] 3.11 Implement logical Trash, Restore, and catalog removal (2–4h)
      Component: C6.
      Requirements: R9.AC1, R9.AC2, R9.AC3, R9.AC5.
      Done when: recoverable items retain their live rows/references and project associations; permanent item removal releases catalog ownership without deleting shared bytes or silently purging unrelated revisions. Existing open document editors become read-only while trashed.

- [ ] 3.12 Guard existing shared-byte deletion entry points (2–4h)
      Components: C6, C11.
      Requirements: R9.AC4, R12.AC1.
      Done when: image gallery, local deletion helpers, and supported server deletion/GC paths cannot remove blobs referenced by retained catalog/docs/messages/revisions, including references added during a deletion attempt. Use canonical references rather than trusting `ref_count`.

- [ ] 3.13 Add the Files search source and file reads (2–4h)
      Components: C2, C3, C6.
      Requirements: R2, R3, R8, R11.AC4.
      Done when: catalog names/excerpts are searchable through the existing palette and workspace tools, project/Trash filters are correct, read receipts use catalog identity, and unsupported formats return honest capability metadata instead of invented text.

## 4. Files interface and interaction polish

- [ ] 4.1 Register the Files pane and navigation through existing registries (1–3h)
      Component: C8.
      Requirements: R10.AC1, R11.AC1, R11.AC2.
      Done when: Files opens in existing workspace tabs, respects profiles/pane limits, restores normal tab state, and loads lazily. It does not force a split, disrupt a streaming chat, or repurpose the plugin Library.

- [ ] 4.2 Implement the unified list, filters, and pagination (2–4h)
      Component: C8.
      Requirements: R6.AC2, R10.AC1, R10.AC2, R10.AC5, R11.AC3.
      Done when: native docs/uploads show readable type/name/status, recently modified order, existing project/type filters, at most 50 initial rows, and correct empty/loading/no-match/read-only states.

- [ ] 4.3 Connect previews, downloads, and Ask in chat (2–4h)
      Components: C3, C8, C9.
      Requirements: R3.AC3, R8.AC2, R8.AC3, R8.AC4, R8.AC5, R10.AC2.
      Done when: filename/Enter opens the actual editor or preview, plain text and active-content handling remain safe, unsupported files download, and Ask in chat inserts a removable existing-style reference/attachment without auto-sending. PDF/image handoff uses the compatible-model path, and returning preserves the original chat draft/focus.

- [ ] 4.4 Connect upload/retry and file-management actions (2–4h)
      Component: C8.
      Requirements: R6.AC4, R7.AC3, R7.AC4, R7.AC5, R9, R10.AC2, R10.AC5.
      Done when: upload batches have per-item outcomes, existing imports are explicit, and Rename/Add to project/Remove from project/Trash/Restore/catalog removal use the shared operations with clear success/failure states and no required dragging or hover-only controls.

- [ ] 4.5 Complete keyboard, mobile, theme, and reduced-motion behavior (2–4h)
      Components: C8, C9.
      Requirements: R1.AC2, R10.
      Done when: Files, source receipts, and document review pass the specified keyboard/320 px/390 px/200%-zoom journeys, overlays restore focus, touch targets meet 44 px, and existing themes/reduced motion work without new styling systems.

## 5. Complete qualification and documentation

- [ ] 5.1 Exercise lifecycle and authorization with the real supported cloud profile (2–4h)
      Component: C11.
      Requirements: R3.AC4, R5.AC5, R7.AC1, R9, R12, R13.AC2.
      Done when: a disposable Basic Auth + SQLite + filesystem run proves reload, interrupted sync, new-device metadata/text search, denied writes, membership loss, workspace-switch cancellation, and client-tool unavailable states. Provider-side deletion/admission evidence is retained separately from browser evidence.

- [ ] 5.2 Measure the bounded workload and inspect loading costs (2–3h)
      Components: C2, C7, C8, C11.
      Requirements: R11.AC2, R11.AC3, R11.AC5.
      Done when: the recorded same-host baseline/candidate report shows the R11 dataset/search target, bounded initial rendering, lazy heavy modules, and no workspace-wide blob fetch on chat open. A failing target has measured cause and a scoped correction rather than speculative infrastructure.

- [ ] 5.3 Document user behavior and extension/provider contracts (2–3h)
      Component: C11.
      Requirements: R1.AC3, R8, R9, R11.AC4, R12.AC3, R12.AC4, R13.AC3.
      Done when: public documentation and `docmap.json` explain the five tools, Files UX, text coverage, source/permission scope, review/Undo, Trash/reference semantics, and browser-runtime limits. Update existing tool/document/storage/search/project pages and affected provider READMEs; add only necessary new guide/reference pages.

- [ ] 5.4 Perform the simplification and final-diff review (1–2h)
      Component: C11.
      Requirements: R11.AC1, R11.AC4, R11.AC5, R13.
      Done when: every new table/index/registry/hook/config option/dependency has been removed or justified by an actual first-release caller, one owner exists for each behavior, and the final scoped diff leaves unrelated user work untouched. No dormant parser framework or second agent/search engine remains.

- [ ] 5.5 Run one proportionate final verification pass and retain the receipt (2–4h)
      Component: C11.
      Requirements: R1–R13.
      Done when: applicable named E2E lanes, canonical security/storage/sync/document suites, typechecks, docs checks, search performance check, and static-build smoke pass; introduced failures are fixed; unrelated failures are evidenced. The repeatable artifact receipt records source commit, command/profile, fixture IDs, screenshots/traces, and file checksums. Any publication/deployment remains a separate authorized task following release policy.

## Traceability Matrix

| Requirement | Design components | Tasks |
|---|---|---|
| R1 Ordinary chat | C1, C9, C10 | 0.2, 1.5–1.7, 2.8, 4.5, 5.3, 5.5 |
| R2 Search | C2, C3 | 0.2, 1.2–1.3, 1.5, 1.7, 3.13, 5.5 |
| R3 Scoped reads | C1, C2, C3, C9, C10 | 0.1–0.2, 1.1–1.2, 1.4–1.7, 3.13, 4.3, 5.1, 5.5 |
| R4 Creation | C4, C9, C10 | 2.1–2.2, 2.4, 2.8–2.9, 5.5 |
| R5 Edits/history | C4, C9, C10 | 0.1, 2.1–2.3, 2.5–2.6, 2.8–2.9, 5.1, 5.5 |
| R6 Projects | C5, C9, C10 | 2.1, 2.4, 2.7–2.9, 3.3, 4.2, 4.4, 5.5 |
| R7 Permanent files | C6, C7, C8 | 0.1, 3.1–3.2, 3.5, 3.7, 3.9–3.10, 4.4, 5.1, 5.5 |
| R8 File capabilities | C3, C6, C7, C8 | 3.1–3.2, 3.8–3.10, 3.13, 4.3, 5.3, 5.5 |
| R9 Trash/retention | C4, C6, C8 | 0.1, 3.1–3.3, 3.5–3.6, 3.11–3.12, 4.4, 5.1, 5.3, 5.5 |
| R10 Polished UX | C8, C9, C11 | 0.2, 1.6–1.7, 2.8–2.9, 4.1–4.5, 5.5 |
| R11 Lightweight extensions | C2, C7, C10, C11 | 1.3, 1.5, 2.2, 3.2, 3.8, 3.10, 3.13, 4.1–4.2, 5.2–5.5 |
| R12 Lifecycle/cloud | C1, C3, C5, C6, C10 | 0.1, 1.1, 1.4–1.5, 1.7, 2.1, 2.3, 2.6–2.7, 2.9, 3.1, 3.4–3.7, 3.12, 5.1, 5.3, 5.5 |
| R13 Evidence/docs | C11 | 0.1–0.2, 1.7, 2.1, 2.9, 3.1, 5.1, 5.3–5.5 |

## Definition of Done

For the future implementation:

- Every applicable acceptance criterion is demonstrated and the traceability matrix has no gaps.
- Users can find prior work, create/edit a native document, associate it with a project, and reuse a saved file through ordinary chat and visible controls.
- Search scope and file-content coverage are explicit; proposals, local saves, cloud sync, and failures are described truthfully.
- Workspace/permission changes, stale edits, replays, and shared-file deletion cannot redirect or destroy unrelated work.
- Desktop/mobile/keyboard journeys have repeatable artifacts from production components.
- Relevant named verification commands and typechecks are green; no introduced failure is silently waived.
- Public docs and affected provider READMEs match the shipped behavior and published provider support is qualified before cloud rollout.
- The scoped final diff is inspected and the simplification pass is complete.

For this planning handoff: the three documents are complete, their mappings have been reviewed, application/tests remain untouched by this task, and no tests have been executed.
