# Tasks

Historical implementation qualification (2026-10-03) covered all 41 plan tasks. The subsequent 16-issue launch review is reopened for correction and fresh qualification below. This is a working-tree qualification, not a published release. Exact repository HEADs and changed source hashes are in [current-source.json](current-source.json); phase results, baseline failures, browser/API boundaries, artifacts and limits are in [evidence.md](evidence.md). Provider package publication and deployment remain separate tasks under the release policy.

The prior production-backed core pass contained 637 suites / 5127 tests. Configured types, public docs, static-build smoke, provider suites, live local Convex direct/gateway checks, and disposable Basic Auth/SQLite/filesystem checks passed. Browser proof uses visible Chrome. Existing unrelated changes were preserved. Historical receipts retain their original source revisions; final qualification below supersedes the earlier partial-status audit.

Read [requirements.md](requirements.md) and [design.md](design.md) first. Component IDs below refer to the design. Estimates are intended task sizes, not delivery guarantees; split a task if its implementation exceeds four hours. Preserve unrelated work already in the checkout.

Work in three increments: sections 0–1 deliver find/read; section 2 adds document/project changes; sections 3–5 deliver Files and qualify the complete feature. File catalog work is not a prerequisite for the first two increments. All test-authoring steps apply during implementation, not this planning task.

## 0. Establish verification before implementation

- [x] 0.1 Reconfirm the inspected owners and write the failure/verification matrix (1–2h)
      Components: C1–C11.
      Requirements: R3, R5, R7, R9, R12, R13.
      Done when: the implementer records current source versions, existing test owners, and credible failures for stale reads/writes, duplicate execution, workspace switching, access revocation, shared blob deletion, malformed files, interrupted sync, and old-writer omission. Any changes since the plan are resolved explicitly; the planning handoff is confirmed to contain no application/test changes.
      Status: Complete — upstream6ee4450b plan comparison, reviewed integration8833585 and canonical failure/owner matrix are recorded in evidence.md. The initial planning documents were unchanged before authorized implementation; no main-checkout edits.

- [x] 0.2 Extend the existing journey setup for workspace read/search acceptance (2–3h)
      Components: C2, C3, C9, C11.
      Requirements: R1, R2, R3, R10, R13.
      Done when: synthetic chats/documents/projects and a scripted model transport exercise real production chat/tool paths; expected failure cases exist before implementation. The setup can retain traces, screenshots, source IDs, and content markers without introducing a test-only production API.
      Status: Complete — Scripted inference exercises real PageShell tools, Dexie, source receipts and native project association/reload. Ambiguous and unavailable sources, disablement, permission and scope failures are covered by their existing journey/canonical owners; artifacts are retained.

  - [x] scripted transport and synthetic chat/document exercise production PageShell, registry and DB with retained before/after artifacts.
  - [x] Synthetic project setup/reload, ambiguous/unavailable sources and expected-failure owners are qualified; see the final evidence matrix.

## 1. Increment one: find and read existing work

- [x] 1.1 Implement captured workspace access for the read path (2–3h)
      Component: C1.
      Requirements: R3.AC1, R3.AC4, R3.AC5, R12.AC1, R12.AC5.
      Done when: operations bind to the initiating database/subject/generation, deny unavailable access, and discard results after cancellation or workspace change. Delayed reads cannot leak content to the new workspace.
      Status: Complete — captured DB/subject/workspace generation and post-await authority checks reject stale reads; actual Dexie/hash-await and workspace-boundary regressions, configured types and exact5154 Core/Contracts pass. See evidence.md.

- [x] 1.2 Make core chat search use visible, permitted conversation text (2–4h)
      Components: C2, C3.
      Requirements: R2.AC1, R2.AC5, R3.AC2.
      Done when: canonical search coverage proves branch ordering, exclusion of retry-superseded text/reasoning/raw tool output, and omission of internal/private records without changing legitimate document or chat search behavior.
      Status: Complete — canonical palette owners prove current conversational ordering, retry/reasoning/raw-tool/private exclusions and130-generation reference ancestry, preserving existing document/project search. See evidence.md and sources.test.ts.

- [x] 1.3 Expose bounded search independently of palette UI state (2–4h)
      Component: C2.
      Requirements: R2, R11.AC1, R11.AC2, R11.AC4.
      Done when: a one-shot query reuses the existing index host, admits only the four core source kinds when available, filters project membership before limiting, preserves fallback/partial-source status, and leaves an open palette's query and selection untouched.
      Status: Complete — the existing stateless index host now admits chat/document/project/file sources, preserves palette state and pre-limit project filtering, and discloses prefix/filename coverage. Actual file index/tool/project tests pass; see current evidence.


- [x] 1.4 Add bounded core item reads and source references (2–4h)
      Component: C3.
      Requirements: R3, R12.AC1.
      Done when: chat/document/project reads return bounded pages with revision/source information, flush or reject conflicting live document buffers, and revalidate the exact identified item. No read depends on a model-supplied workspace, URL, or database query.
      Status: Complete — actual DB reads page explicit chat/document/project identities, attach source/revision/content-digest continuations, reject conflicting live buffers and stale source/project membership; residual38 cases and current-head proposal journey pass. See evidence.md.

- [x] 1.5 Register the two read tools through the existing registry (1–3h)
      Component: C10.
      Requirements: R1.AC1, R1.AC3, R2.AC2, R3.AC5, R11.AC1, R12.AC3.
      Done when: `workspace_search` and `workspace_read` work in normal chat with current schema validation, tool enablement, runtime admission, cancellation, output bounds, and client-bridge failure behavior. No additional model call occurs during search.
      Status: Complete — Both bounded read tools run through the existing schema-validated registry and normal scripted chat loop. Phase-one owners cover admission/cancellation and unavailable client execution; actual Chrome verifies ambiguous identities. Search makes no extra model call.

  - [x] both client tools execute through the existing validated registry and the real scripted PageShell tool loop; search invokes no extra inference.
  - [x] Model/tool disablement journeys and existing runtime/client-tool unavailable-execution owners pass, with separate live provider qualification.

- [x] 1.6 Render compact, verifiable source receipts (2–3h)
      Component: C9.
      Requirements: R1.AC2, R1.AC4, R3.AC3, R10.AC3, R10.AC6.
      Done when: source chips open the actual item through existing navigation, show unavailable items accurately, disclose partial coverage, and preserve composer focus/drafts. The normal view shows concise progress; raw arguments stay in expanded details.
      Status: Complete — Host source receipts navigate the original item, disclose coverage and reject unavailable sources. Named unavailable-source, draft/no-send and review keyboard/focus journeys pass; actual Chrome ambiguity receipts identify both native sources.

  - [x] concise activity and host-owned source chips use existing navigation; current proposal journey opens the original editor.
  - [x] Unavailable source, disclosed coverage, draft/no-send and keyboard/focus journey artifacts are retained.

- [x] 1.7 Qualify the first increment (1–2h)
      Component: C11.
      Requirements: R1, R2, R3, R10, R12, R13.
      Done when: the relevant production chat and command-palette journeys pass with repeatable artifacts, including ambiguous targets, a deleted result, model/tool disablement, and a workspace switch during retrieval. Remaining failures are fixed or identified as unrelated baseline failures with evidence.
      Status: Complete — Phase-one owners pass 49 cases; named production chat journeys qualify source navigation, unavailable/stale targets and model/tool disablement. Captured-Dexie scope-change races are owned by the canonical boundary, with live gateway old-scope rejection retained separately.

  - [x] earlier search/read navigation plus exact5154 proposal tool loop pass with artifacts.
  - [x] Ambiguous/unavailable targets and disablement pass real journeys; canonical captured-authority races plus live gateway isolation prove workspace boundaries.

## 2. Increment two: create documents and make controlled changes

- [x] 2.1 Author document/project failure coverage before changing those owners (2–3h)
      Components: C4, C5, C11.
      Requirements: R4, R5, R6, R12, R13.AC1.
      Done when: the existing production document journey and canonical lifecycle owners cover no-save preview, stale Apply, duplicate execution, delayed autosave, guarded Undo, project-entry preservation, storage failure, and permission loss. Each boundary has one primary test owner.
      Status: Complete — Failure baselines precede changes in the actual Dexie/TipTap/project owners. Transaction rollback, stale/duplicate Apply, delayed autosave, guarded Undo and permission changes pass; disposable provider runs separately prove viewer write denial and revocation.

  - [x] primary actual Dexie/TipTap owners cover no-save preview, stale/concurrent Apply, delayed autosave, guarded Undo, project preservation, rollback and awaited permission changes with intended baselines.
  - [x] Production document lifecycle owners and provider rollback/reference/permission checks pass; their separate boundaries are recorded.

- [x] 2.2 Share actual document schema and proposal preparation (2–4h)
      Component: C4.
      Requirements: R4.AC1, R5.AC1, R5.AC3, R11.AC1, R11.AC2.
      Done when: the current editor/Document AI and chat can use the same lazy-loaded content schema, frozen block references, operation validation, and diff preparation, including enabled custom nodes. There is no hidden live editor or second AI loop.
      Status: Complete — the registered custom node round-trips through the real editor and chat schema, and native chat proposal/Apply content equals the actual Document AI frozen-snapshot candidate. Removing the extension rejects its content. The canonical actual-editor/Dexie owner passes.


- [x] 2.3 Add captured-database revision and write support where needed (2–4h)
      Components: C1, C4.
      Requirements: R5.AC2, R5.AC3, R12.AC1, R12.AC5.
      Done when: history encoding/persistence cannot switch databases after awaits, stale revisions are rejected inside the write boundary, and a failed write leaves the original document intact. Changes are restricted to helpers used by this path.
      Status: Complete — captured-origin revision persistence, in-transaction CAS/authority, checkpoint/content/receipt rollback and concurrent/second-handle recovery are exercised by actual Dexie/TipTap owners. See evidence.md; reviewed5154 Core/Contracts and configured types pass.

- [x] 2.4 Implement idempotent document creation and its saved receipt (2–3h)
      Components: C4, C9.
      Requirements: R4, R6.AC2.
      Done when: a requested native document and optional project association commit together; repeated delivery of one execution returns the same document, and validation/quota failures never produce a false success.
      Status: Complete — actual registry/Dexie creation is host-execution idempotent, validates native content and commits optional project association atomically; replay, invalid content, stale project, interruption and truthful saved-source cases pass. See evidence.md.

- [x] 2.5 Stage document edit proposals from host read receipts (2–4h)
      Component: C4.
      Requirements: R5.AC1, R5.AC3, R5.AC5.
      Done when: valid operations against the exposed block references produce a bounded pending envelope in the originating message, invalid/unread/stale references are rejected, and reload can reconstruct or invalidate the proposal without storing another complete document snapshot.
      Status: Complete — host read manifests/block refs stage only durable proposal operations; unread/invalid/stale references fail. Real PageShell Review leaves stored content unchanged and proposal/receipt recovery survives reload at5154. See evidence.md.

- [x] 2.6 Connect Apply and Undo to history and live editor sessions (2–4h)
      Components: C4, C9.
      Requirements: R5.AC2, R5.AC3, R5.AC4, R5.AC5, R12.AC5.
      Done when: one Apply records the checkpoint, persists the content and host-owned receipt, and updates mounted editors without an old autosave overwriting it. Duplicate Apply in the same local database does not write again; Undo preserves later user edits by offering history when appropriate. Remote sync winners invalidate obsolete controls without claiming distributed exactly-once behavior.
      Status: Complete — Actual editor/history owners and production Review/Apply/Undo/reload pass. A live Convex remote winner invalidates obsolete Undo and offers history; the original editor displays the winning marker. This makes no distributed exactly-once claim.

  - [x] atomic checkpoint/content/receipt, duplicate Apply, actual mounted/late panes, second-handle draft protection and guarded Undo pass; exact5154 PageShell Apply/Undo reload passes.
  - [x] Actual local Convex remote winner produces history instead of obsolete Undo; original editor navigation shows the winner.

- [x] 2.7 Add scoped, revision-aware project operations (2–4h)
      Component: C5.
      Requirements: R6, R12.AC1.
      Done when: create/rename/description/add/remove operations preserve unknown entries and refuse to overwrite newer observed revisions, validate referenced items, and never delete an item's content when removing an association. Existing thread membership conventions remain consistent.
      Status: Complete — All five revision-aware project operations use the existing registry and captured Dexie transaction, preserving unknown memberships and underlying item content. Canonical operation cases plus native project/association/reload journeys and cloud membership preservation pass.

  - [x] scoped create/rename/description/add/remove and revision-aware preserved unknown/legacy membership are implemented; real DB association/removal/stale revision and current visible-member tests pass.
  - [x] Canonical project operations, native association/reload and cloud payload preservation qualify their distinct boundaries.

- [x] 2.8 Register write tools and present one review card (2–4h)
      Components: C9, C10.
      Requirements: R1, R4, R5, R6, R10.AC3, R10.AC6.
      Done when: the remaining three tools work through the existing registry; saved documents/projects have accurate links; document edits show Review/Apply changes/Discard with the existing diff UI and no extra confirmation per block or focus stealing.
      Status: Complete — All five native tools use the existing registry and one host-owned review card. Saved document/project navigation, no-save Review, Apply/Discard/Undo, focus return and model/tool disablement pass; viewer writes are denied at the provider boundary.

  - [x] five native tools and one host Review/Apply/Discard/Undo card are installed; native create/source and exact5154 review journey pass.
  - [x] Saved-project navigation, focus return and disablement journeys pass; live viewer writes are denied.

- [x] 2.9 Qualify the second increment (1–3h)
      Component: C11.
      Requirements: R4, R5, R6, R10, R12, R13.
      Done when: real create/review/apply/undo/project journeys and relevant lifecycle boundary cases pass, artifacts survive reload, and model prose cannot incorrectly mark a pending change as saved.
      Status: Complete — Real create/project association, Review without saving, Apply/Undo and reload journeys pass. Mounted lifecycle and authorization owners pass; live Convex remote-winner/history behavior is retained. Pending controls are derived from host receipts rather than model prose.

  - [x] exact5154 real search/read/propose, Review no-save, Apply/reload, Undo/reload and original editor pass; earlier native-create journey and host/model-prose guard pass.
  - [x] Create/project/reload journeys, mounted lifecycle owners and live cloud authorization/remote-winner checks are qualified.

## 3. Increment three: file ownership and content foundations

- [x] 3.1 Author catalog/Trash/provider boundary cases before implementation (2–3h)
      Components: C6, C7, C11.
      Requirements: R7, R8, R9, R12.AC4, R13.AC1.
      Done when: the canonical storage fixture and relevant adapter owners specify catalog-only retention, trashed references, shared attachments, same-hash imports, prefix coverage, old-reader rejection, old-writer omission, and interrupted import. Expected failures precede production changes.
      Status: Complete — Canonical catalog/Trash/extraction/cancellation failures and old-reader/writer omission baselines precede their fixes. Additional physical filesystem deletion and actual paused-gateway queued-status baselines are retained with passing candidates.

- [x] 3.2 Implement catalog posts and namespaced item metadata (2–4h)
      Component: C6.
      Requirements: R7.AC1, R7.AC2, R7.AC3, R8.AC1, R9.AC1, R9.AC2, R11.AC1.
      Done when: `or3:file` posts use existing storage fields, deterministic hash-based identity, a user-controlled title, and a single original file reference. Native docs default to visible without metadata; metadata updates preserve unrelated keys and no new table is introduced.
      Status: Complete — deterministic existing-table catalog ownership, independent titles, single original hashes, preserved native metadata and unsupported-state refusal pass the canonical real-Dexie owner.

- [x] 3.3 Support file associations and shared visibility rules (2–3h)
      Components: C5, C6.
      Requirements: R6.AC2, R6.AC3, R6.AC4, R9.AC1.
      Done when: file entries round-trip in projects and every applicable Files/document/sidebar/mention/search projection uses the same logical-Trash rule. Internal catalog records never appear as prompts or editable generic posts.
      Status: Complete — canonical file memberships preserve unknown fields; the shared visibility rule is used by Files, documents, sidebar, mentions, palette and workspace tools. Real-Dexie projection cases reproduce metadata-deletion leaks and pass after repair; catalog rows remain internal to generic post views.

- [x] 3.4 Add narrowly scoped capability admission at host boundaries (2–4h)
      Components: C1, C6.
      Requirements: R12.AC4.
      Done when: current sync request/snapshot boundaries carry the workspace-item capability and reject incompatible reads/writes before applying them, including an old writer omitting metadata/file memberships present in the canonical record. There is no alternate legacy representation.
      Status: Complete — Host pull/push/snapshot admission and canonical SQLite/Convex v1 guards reject incompatible reads and omitted metadata/memberships before mutation. Live local Convex direct and gateway paths independently qualify admission; supported sessions can expose cloud Files.

- [x] 3.5 Qualify SQLite/filesystem preservation and reference behavior (2–4h)
      Components: C6, C11.
      Requirements: R7.AC2, R9.AC2, R9.AC4, R12.AC4.
      Done when: real supported adapters preserve catalog/meta/project payloads and retain blobs referenced by active or logically trashed catalog/doc rows. Changed provider code, if required, is limited to the owning admission/reference boundary and is identified as a publication dependency.
      Status: Complete — Native SQLite passes 68 real-SQL preservation/admission/reference cases. Rebuilt filesystem passes 27 physical-file owner cases and its full 73-test suite; live host deletion retains originals across catalog/Trash/reference states. Provider build/type receipts and publication dependencies are recorded. D1 is outside this qualification.

- [x] 3.6 Qualify Convex gateway and direct-provider admission (2–4h)
      Components: C6, C11.
      Requirements: R9.AC2, R9.AC4, R12.AC4.
      Done when: Convex schema/serialization/reference behavior and both supported access paths preserve the new semantics and reject old-writer omission. Required template/package deployment updates are documented; a gateway-only proof is not claimed as direct-provider coverage.
      Status: Complete — An official disposable local Convex deployment separately qualifies authenticated direct JWT calls (17 live checks), Basic Auth gateway with native storage and filesystem storage (9 checks each), and 43 canonical transport/preservation cases. The full provider suite passes 186 tests; schema/template/runtime build and typechecks pass. Updated packages/templates must be deployed together.

- [x] 3.7 Implement idempotent upload-to-catalog intake (2–4h)
      Component: C6.
      Requirements: R7.AC1, R7.AC2, R7.AC3, R7.AC4, R12.AC2.
      Done when: accepted uploads use existing file persistence/transfer, save a catalog entry before local success, reuse duplicates without renaming, restore a duplicate trashed entry visibly, and report local versus cloud state accurately. Failed/cancelled imports never remove shared bytes.
      Status: Complete — Idempotent intake, duplicate naming/restoration, batch/retry and cancellation owners pass. Actual Chrome reproduced falsely Synced queued rows, then verified Saved locally · Waiting to sync after the bounded entity-index repair; SQLite catalog edits transition to Synced after gateway recovery. Original bytes remain retained.

- [x] 3.8 Add bounded UTF-8 text extraction and continuation reads (2–3h)
      Components: C3, C7.
      Requirements: R8.AC1, R8.AC2, R8.AC3, R8.AC5, R11.AC1, R11.AC2.
      Done when: supported text gets an accurately labeled 64 KiB excerpt, invalid/binary encodings remain stored-only, continuation reads are bounded, and original/downloaded bytes remain identical. No parser dependency, remote extraction, or model call is introduced.
      Status: Complete — strict bounded UTF-8 extraction, incomplete-code-point handling, invalid stored-only text, bounded continuation through the unindexed remainder and exact downloaded-byte browser proof pass without parser/model dependencies.

- [x] 3.9 Integrate regular chat uploads with the catalog (2–4h)
      Components: C6, C10.
      Requirements: R7.AC1, R7.AC2, R8.AC4, R8.AC5.
      Done when: new regular uploads have a reusable Files entry, supported text becomes a file reference, current image/PDF transport still works, and upload limits/policies remain consistent at browser and server boundaries. Draft cancellation and duplicate intake have explicit outcomes.
      Status: Complete — Regular text uploads use the native catalog/reference path. Named production journeys verify removable native image/PDF handoff, draft preservation and no auto-send; existing compatible-model/policy transport is preserved and canonical cancellation/permission owners pass. No paid model-network qualification is claimed.

- [x] 3.10 Implement explicit Add existing uploads (1–3h)
      Component: C6.
      Requirements: R7.AC5, R8.AC3, R11.AC2.
      Done when: existing live metadata is paged through the same catalog operation, repeated imports create no duplicates or accidental restorations/renames, partial progress is visible, and no existing blobs are downloaded or copied merely to populate Files. Supported unindexed text exposes an explicit, write-gated Enable text search action using the same bounded importer.
      Status: Complete — existing live metadata uses bounded idempotent catalog operations without blob reads or implicit restores/renames, reports progress, and exposes explicit write-gated text enablement. The real-Dexie owner verifies metadata-only import and explicit extraction.

- [x] 3.11 Implement logical Trash, Restore, and catalog removal (2–4h)
      Component: C6.
      Requirements: R9.AC1, R9.AC2, R9.AC3, R9.AC5.
      Done when: recoverable items retain their live rows/references and project associations; permanent item removal releases catalog ownership without deleting shared bytes or silently purging unrelated revisions. Existing open document editors become read-only while trashed.
      Status: Complete — logical Trash/Restore retains identity, references and associations; catalog/native removal tombstones ownership while retaining shared bytes and checkpoints. Actual mounted editors become read-only; canonical storage/sidebar/editor owners pass.

- [x] 3.12 Guard existing shared-byte deletion entry points (2–4h)
      Components: C6, C11.
      Requirements: R9.AC4, R12.AC1.
      Done when: image gallery, local deletion helpers, and supported server deletion/GC paths cannot remove blobs referenced by retained catalog/docs/messages/revisions, including references added during a deletion attempt. Use canonical references rather than trusting `ref_count`.
      Status: Complete — Local deletion rechecks canonical retained edges after hooks inside transactions. Host deletion requires canonical metadata/reference pages even with older storage packages; rebuilt filesystem and native Convex physical deletion/GC retain referenced originals. Permission and missing-canonical failures fail closed.

- [x] 3.13 Add the Files search source and file reads (2–4h)
      Components: C2, C3, C6.
      Requirements: R2, R3, R8, R11.AC4.
      Done when: catalog names/excerpts are searchable through the existing palette and workspace tools, project/Trash filters are correct, read receipts use catalog identity, and unsupported formats return honest capability metadata instead of invented text.
      Status: Complete — actual palette/index and workspace tools search names/excerpts with project/Trash filters and catalog identities, disclose prefix/filename-only coverage and return bounded continuation reads. Catalog original metadata availability is validated.

## 4. Files interface and interaction polish

- [x] 4.1 Register the Files pane and navigation through existing registries (1–3h)
      Component: C8.
      Requirements: R10.AC1, R11.AC1, R11.AC2.
      Done when: Files opens in existing workspace tabs, respects profiles/pane limits, restores normal tab state, and loads lazily. It does not force a split, disrupt a streaming chat, or repurpose the plugin Library.
      Status: Complete — Files uses the existing lazy pane/sidebar registries and ordinary host tab admission, preserving profiles and pane limits. Production PageShell opens Files without repurposing the sidebar or blank draft; the management journey reload restores its Files tab.

- [x] 4.2 Implement the unified list, filters, and pagination (2–4h)
      Component: C8.
      Requirements: R6.AC2, R10.AC1, R10.AC2, R10.AC5, R11.AC3.
      Done when: native docs/uploads show readable type/name/status, recently modified order, existing project/type filters, at most 50 initial rows, and correct empty/loading/no-match/read-only states.
      Status: Complete — Real PageShell filters, recent ordering and 50-row pagination pass. Actual Chrome qualifies cloud empty/read-only states, revocation clearing and paused-gateway local status; the 1000-item workload renders 50 initial rows and exposes Load more.

- [x] 4.3 Connect previews, downloads, and Ask in chat (2–4h)
      Components: C3, C8, C9.
      Requirements: R3.AC3, R8.AC2, R8.AC3, R8.AC4, R8.AC5, R10.AC2.
      Done when: filename/Enter opens the actual editor or preview, plain text and active-content handling remain safe, unsupported files download, and Ask in chat inserts a removable existing-style reference/attachment without auto-sending. PDF/image handoff uses the compatible-model path, and returning preserves the original chat draft/focus.
      Status: Complete — Desktop inspector/mobile slide-up sheet, keyboard/focus return, inert preview and exact original download pass. Native document navigation and removable text/image/PDF chat handoff preserve drafts without sending. Canonical post-await guards and actual viewer revocation clear inaccessible previews.

- [x] 4.4 Connect upload/retry and file-management actions (2–4h)
      Component: C8.
      Requirements: R6.AC4, R7.AC3, R7.AC4, R7.AC5, R9, R10.AC2, R10.AC5.
      Done when: upload batches have per-item outcomes, existing imports are explicit, and Rename/Add to project/Remove from project/Trash/Restore/catalog removal use the shared operations with clear success/failure states and no required dragging or hover-only controls.
      Status: Complete — per-item upload/retry, Rename, project add/remove, Trash/Restore and confirmed entry removal pass production browser journeys. The intended retry baseline lost another failed row; the repaired journey retains it and successful items. Existing metadata import and explicit text enablement pass the canonical storage owner.

- [x] 4.5 Complete keyboard, mobile, theme, and reduced-motion behavior (2–4h)
      Components: C8, C9.
      Requirements: R1.AC2, R10.
      Done when: Files, source receipts, and document review pass the specified keyboard/320 px/390 px/200%-zoom journeys, overlays restore focus, touch targets meet 44 px, and existing themes/reduced motion work without new styling systems.
      Status: Complete — Files, source receipts and review pass all three themes at 320/390px and 200% zoom with reduced motion, 44px controls, Enter/Escape and focus return. The added matrix reproduced and repaired the asynchronous Review trigger-focus bug. Screenshots/traces are retained and representative layouts inspected.


## 5. Complete qualification and documentation

- [x] 5.1 Exercise lifecycle and authorization with the real supported cloud profile (2–4h)
      Component: C11.
      Requirements: R3.AC4, R5.AC5, R7.AC1, R9, R12, R13.AC2.
      Done when: a disposable Basic Auth + SQLite + filesystem run proves reload, interrupted sync, new-device metadata/text search, denied writes, membership loss, workspace-switch cancellation, and client-tool unavailable states. Provider-side deletion/admission evidence is retained separately from browser evidence.
      Status: Complete — Disposable Basic Auth/native SQLite/rebuilt filesystem gateway checks pass for upload, lost-response replay, snapshot, original bytes, legacy admission, viewer write denial, revocation and active-workspace isolation. A fresh Chrome client searches synced text and reloads; warmed catalog edits queue during an actual gateway pause and become Synced after recovery. Existing captured-authority/client-tool owners qualify cancellation/unavailable execution; live Convex browser/provider evidence is separate.

- [x] 5.2 Measure the bounded workload and inspect loading costs (2–3h)
      Components: C2, C7, C8, C11.
      Requirements: R11.AC2, R11.AC3, R11.AC5.
      Done when: the recorded same-host baseline/candidate report shows the R11 dataset/search target, bounded initial rendering, lazy heavy modules, and no workspace-wide blob fetch on chat open. A failing target has measured cause and a scoped correction rather than speculative infrastructure.
      Status: Complete — Same-host index baseline/candidate pass for 1000 mixed items and 10MiB text. Actual registry workspace_search performs 30 measured calls at p95 11.8ms, below 300ms; the Chrome receipt shows 50 initial Files rows, Files module loaded only on opening Files, and no workspace blob fetch on chat open.

- [x] 5.3 Document user behavior and extension/provider contracts (2–3h)
      Component: C11.
      Requirements: R1.AC3, R8, R9, R11.AC4, R12.AC3, R12.AC4, R13.AC3.
      Done when: public documentation and `docmap.json` explain the five tools, Files UX, text coverage, source/permission scope, review/Undo, Trash/reference semantics, and browser-runtime limits. Update existing tool/document/storage/search/project pages and affected provider READMEs; add only necessary new guide/reference pages.
      Status: Complete — existing public tool/file/document/project/search/cloud guides, docmap and owning provider READMEs describe behavior, coverage, scopes, history, retention, browser limits and v1 publication dependencies. Final configured types and documentation checks pass (107 files, 95 routes, 21 examples).

- [x] 5.4 Perform the simplification and final-diff review (1–2h)
      Component: C11.
      Requirements: R11.AC1, R11.AC4, R11.AC5, R13.
      Done when: every new table/index/registry/hook/config option/dependency has been removed or justified by an actual first-release caller, one owner exists for each behavior, and the final scoped diff leaves unrelated user work untouched. No dormant parser framework or second agent/search engine remains.
      Status: Complete — Final scoped review uses existing pane/sidebar/search/tool/editor/storage owners without new local tables, dependencies, parser or agent engine. Launch review requires one private Convex deletion-claim table for transactional original-byte safety. The sole new compound outbox index has the visible-row cloud-status caller and preserves queued rows/scheduler indexes; existing migration cases pass. All four repository diffs pass whitespace checks; unrelated changes remain intact.

  - [x] parent independently closed initial/residual assistant source review; uses existing search/tools/storage/editor mechanisms without a second agent/search engine or new dependency.
  - [x] Final Files review justifies the bounded outbox index and reuses existing extension owners; all four repository diff checks pass.

- [x] 5.5 Run one proportionate final verification pass and retain the receipt (2–4h)
      Component: C11.
      Requirements: R1–R13.
      Done when: applicable named E2E lanes, canonical security/storage/sync/document suites, typechecks, docs checks, search performance check, and static-build smoke pass; introduced failures are fixed; unrelated failures are evidenced. The repeatable artifact receipt records source commit, command/profile, fixture IDs, screenshots/traces, and file checksums. Any publication/deployment remains a separate authorized task following release policy.
      Status: Complete — Final core passes 637 suites/5127 tests; configured types, 107-doc/95-route/21-example checks and static client-boundary smoke pass. Named production journey artifacts, phase owners, provider build/type/suite and live sandbox receipts are retained with source/artifact checksums. The newly authored automated queued-upload case is retained for repeatability; this run uses visible Chrome queued-save proof and does not claim that new automated case ran. Publication/deployment remain separate.

  - [x] exact5154 Core/Contracts/configured types and the one named production proposal lane pass; focused actual-owner baselines and artifacts retained.
  - [x] Final core/types/docs/static, named journeys, provider source/build/type and live sandbox receipts are retained; execution limits remain explicit in evidence.md.

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

For the implementation:

- Every applicable acceptance criterion is demonstrated and the traceability matrix has no gaps.
- Users can find prior work, create/edit a native document, associate it with a project, and reuse a saved file through ordinary chat and visible controls.
- Search scope and file-content coverage are explicit; proposals, local saves, cloud sync, and failures are described truthfully.
- Workspace/permission changes, stale edits, replays, and shared-file deletion cannot redirect or destroy unrelated work.
- Desktop/mobile/keyboard journeys have repeatable artifacts from production components.
- Relevant named verification commands and typechecks are green; no introduced failure is silently waived.
- Public docs and affected provider READMEs match the shipped behavior and published provider support is qualified before cloud rollout.
- The scoped final diff is inspected and the simplification pass is complete.

Historical planning handoff: the original three documents were complete and application/tests were untouched at that point. The user subsequently authorized implementation; current working-tree changes and verification are recorded above and in evidence.md.

## Launch review corrections (2026-10-03)

All sixteen findings have implementation changes. Core, affected Files journeys, types, docs, static build and provider checks pass. Full cloud offline-upload qualification remains pending: the user requested reduced browser load, so further Playwright runs were stopped. Historical receipts above do not qualify these corrections.

- [x] Intake: preserve SSR guest attachment scope, recover duplicate local bytes, reject unsupported catalog metadata (1, 4, 10).
- [x] Editor/search/sidebar: unified readonly locking, supported Document AI mentions, remote mention refresh, project aliases, cloud Trash capability (3, 5, 6, 9, 11).
- [x] Files: separate preview/action targets, native image documents, missing project recovery, bounded observation (7, 8, 12, 13).
- [x] Storage: coordinated Convex deletion claims and fail-closed uncoordinated cleanup (2).
- [x] E2E: current preview state, warm queued upload implementation, selected storage provider protocol (14, 15, 16).
- [x] Retain current source hashes and repeatable review artifacts.
- [ ] Finish cloud queued-upload qualification in one sequential Chrome run after the corrected desktop viewport; no further run was started after the user requested reduced load.
