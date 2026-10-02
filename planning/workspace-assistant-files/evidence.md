# Implementation acceptance ledger

Base: upstream `6ee4450b` (2026-10-02). Local requirements/design/tasks match
upstream byte-for-byte. Worktree `feat/workspace-assistant-files` is isolated
from the user's dirty checkout. No live-model evaluation is authorized.

## Failure ownership (recorded before production changes)

| Contract / credible regression | Primary verification owner | Distinct boundary |
|---|---|---|
| Private, deleted, superseded, tool or reasoning text appears in search | palette `sources.test.ts` | Canonical source conversion shared by palette and tools |
| Project filtering happens after limit, hiding eligible matches | palette `source-index.test.ts` | Actual Orama pagination and substring fallback |
| Workspace query changes visible palette selection | palette `coordinator.test.ts` | Shared index host's independent query path |
| Late read exposes another workspace or revoked subject | document chat tool canonical suite, real Dexie | Registry admission plus captured authority after awaits |
| Deleted result source opens a guessed item | production chat journey | Receipt revalidation and navigation |
| Preview writes content, stale Apply overwrites, duplicate Apply writes twice | production document journey | Actual document schema/review/editor/history path |
| Delayed autosave overwrites Apply, Undo overwrites later edits | document lifecycle canonical owners | Mounted editor and transactional revision fence |
| Create retry duplicates, project update drops newer/unknown entries | document tool / project persistence canonical owners | Real captured-DB transaction |
| Catalog save fails after blob save, duplicate upload renames/restores silently | storage-layer journey | Durable ownership versus shared immutable bytes |
| Trash leaks into search/mention, attachment deletion removes retained bytes | storage/sync/reference canonical owners | Central visibility and final deletion check |
| Invalid UTF-8 is claimed searchable, prefix claims full coverage | storage-layer journey | Original blob and explicit extraction coverage |
| Old writer omits new metadata/membership | provider conformance owners | Canonical incoming/existing record admission |
| Partial sync / unavailable browser executor claims save | cloud production journeys | Basic Auth + SQLite + filesystem and client bridge |
| Mobile / keyboard / zoom / theme controls fail | production chat/document journeys | Real components at 320/390 px and 200% zoom |

New isolated cases must protect these independent contracts, fail on the
pre-feature implementation for the intended reason, and introduce no test-only
production API. Inference alone is mocked in browser journeys.

## Dependencies and limits

- PR179: parent-reviewed `40b7aef695762ccb03476a48eaf17c6b46dbd8a6`.
- PR182: parent-reviewed production `a515ab956bc15fa7c2c31eb51da9efac1219e06f`,
  final three-file test followup `07b235b2042c4e660c979974d87b52c565d68dbf` also reviewed.
- PR181: parent-reviewed final `bb86066cd20a8f9a97591116f1c225672f21b836`,
  authenticated job/client-tool/workflow scope admission and delayed-store batching.
- PR180: backup stream/restore with PR179 origin capture.
- Provider packages must qualify workspace-item preservation/admission before
  cloud exposure. Installed dist is not an implementation target.
- Retrieval/result/storage bounds are explicit pagination/resource contracts.
  No new fixed per-turn context ceiling will be imposed on ordinary chat.

## Evidence status

Incremental engineering evidence (not full-plan qualification):

- Palette/private text and pre-limit filtering baselines fail in
  `/tmp/task16-palette-baseline.log`; source receipt baseline fails in
  `/tmp/task16-receipts-baseline.log`; exact ancestry baseline fails in
  `/tmp/task16-branch-baseline.log`.
- First increment: 37 tests / five canonical files pass,
  `/tmp/task16-read-branches.log`.
- Native creation missing-tool baseline, project association/schema and missing
  mutation baselines, hash-await stale read, 130-generation lineage, and live
  buffer disagreement each fail before their correction in the corresponding
  `/tmp/task16-*-baseline.log` files.
- Real Dexie creation/replay, invalid-content rejection, atomic association,
  unknown-entry retention and stale project rejection pass. Existing document
  hook and file-reference owners also pass: 32 tests / four files,
  `/tmp/task16-read-create-project-candidate.log`.
- Live buffer disagreement candidate: 11 document-tool tests pass,
  `/tmp/task16-live-disagreement-candidate.log`.
- Configured `bun run type-check` passes (Basic Auth / SQLite / fs, sync and
  storage disabled), `/tmp/task16-typecheck-increment.log`. No credentials used.
- Upstream ordinary chat screenshot:
  `output/playwright/workspace-assistant/upstream-before.jpg`.
- Real `PageShell` browser baseline now fails for missing advertised workspace
  tools; fixture UI says "Workspace tools unavailable in this fixture". See
  `baseline-test-results` / `baseline-playwright-report` under the same directory.
- Candidate based on reviewed PR179 `40b7aef6` and PR182 `a515ab95`: two production
  journeys pass (search/read source navigation, native creation and editor reload),
  `/tmp/task16-workspace-browser-candidate.log`, `increment-test-results` and
  `increment-playwright-report`. Original editor generation fence is preserved.
- Four existing browser regressions pass: blank/retro/cyberpunk responsive rich
  chat at 320/390/844/1920 px and stop/continue durable reply,
  `/tmp/task16-workspace-browser-regressions.log`, `regression-test-results` and
  `regression-playwright-report`. Transport is scripted; tools, DB, navigation and
  components execute normally.

- Proposal missing-tool, Apply missing-writer, mounted post-commit reload, cross-tab
  delayed autosave and private project-entry exposure baselines fail for their
  intended reasons in `/tmp/task16-document-proposal-baseline.log`,
  `/tmp/task16-document-apply-baseline.log`, `/tmp/task16-mounted-apply-baseline.log`,
  `/tmp/task16-cross-tab-apply-baseline.log`, `/tmp/task16-project-read-privacy-baseline.log`.
- Latest safety milestone: 49 tests / six canonical files pass,
  `/tmp/task16-proposal-milestone.log`. Real Dexie verifies no-save staging,
  concurrent duplicate Apply, checkpoint/content/receipt rollback, retry, guarded
  Undo and second-handle draft retention. Real mounted TipTap verifies captured
  synchronous acceptance before post-commit hooks; owner workspace regressions pass.
- Review-card baseline/candidate: host controls appear only for the admitted tool;
  unrelated plugin/model prose cannot claim saved state. The initial proposal UI/browser increment is qualified below; additional reviewed race corrections still require fresh qualification. Configured Basic Auth/SQLite/FS typecheck
  passes after two fixture-only Dexie PromiseExtended typing corrections; no production
  errors were reported. `/tmp/task16-assistant-safety-typecheck-fixed.log` exits 0.
  The corrected failure-injection owners pass 24 tests in two files,
  `/tmp/task16-safety-fixture-fixed.log`. Both changes preserve injected failures.

## Review corrections and bounded proposal journey

- Draft PR187 initial head `563520a4` received Core/Contracts success in run36976969195. Four subsequently confirmed source findings supersede readiness of that head.
- Search exact-phrase restriction reproduced against actual shared Orama: token-order hit reached the index but was discarded by tool revalidation. Current repair compares the indexed title/body with freshly read accessible content, retaining shared matching semantics and disclosing skipped stale coverage. `/tmp/task16-token-search-baseline.log`.
- Mounted cold-pane race reproduced both after commit and while the write transaction was held open: closing the late pane revived the old content. Real TipTap/store/Dexie owner baseline `/tmp/task16-late-pane-two-baseline.log` has two intended failures. Repair refreshes the origin buffer after lazy loading, avoids staging unchanged own buffers as edits, and enrolls newly registered panes in the active write lease. Competing same-base leases share the editor lock while the transaction preserves at-most-once/CAS semantics.
- Six actual awaited transaction-read interruption cases reproduced committed side effects despite error receipts (document/project × abort/workspace/auth revision). Legacy project reads omitted linked chats and retained duplicate/deleted/missing IDs. All seven fail before repair in `/tmp/task16-authority-membership-baseline.log`. Writes now check captured authority after awaited reads and before/after mutations; reads/search share one visible captured project-membership boundary.
- Corrected focused owners pass39 tests/three files in `/tmp/task16-review-corrections-candidate.log`; explicit visible-buffer checks pass10 mounted cases in `/tmp/task16-late-pane-buffer-candidate.log`. Final focused regressions pass51 tests/five files in `/tmp/task16-assistant-corrections-final-focused.log`. Production feature lint exits0 with five existing typed-parser warnings in `/tmp/task16-assistant-production-lint.log`. Generated compatibility ledger refreshed. Corrected configured types/current-head CI remain to run.
- One actual PageShell proposal browser journey passed15.5s: search/read/propose, Review with unchanged durable document, Apply/reload, Undo/reload, original editor navigation. `/tmp/task16-proposal-browser-first.log`; `output/playwright/workspace-assistant/proposal-test-results` and `proposal-playwright-report`, with before-Apply/after-Undo screenshots inspected. Inference is scripted. This browser pass precedes the additional reviewed race corrections.

## Remaining acceptance groups

Sections 0–1 have implementation and bounded increment evidence, with production
disablement/deletion/ambiguous-target/workspace-switch cases still to qualify.
Section 2 has creation/project and safety-critical proposal/Apply/Undo foundations;
stale Update-proposal/history UX, permission/storage/race coverage and complete
review/apply/undo/project browser journeys remain. Sections 3 (catalog, uploads,
UTF-8 extraction, Trash/reference protection and provider capability admission),
4 (Files pane/actions/accessibility), and 5 (cloud recovery, scale/performance,
documentation/contracts/builds/final gates) are unfinished.

The bounded review/apply/undo browser journey passes; broader Files/Trash, provider admission,
mobile/zoom/performance and cloud recovery are not yet qualified. No task box
represents proof without the command, source revision and observed artifact.

## Residual correction controls

- Correction head97026949 passed5047 tests/634 files and Contracts, but Core typecheck failed TS2556 in the six-case DB interruption fixture at258. The spread into an overloaded union get() was replaced by the actual single key call; timing and persistence assertions remain. Run36980987036 retained as first failure.
- A real later-source delay plus earlier-source DB/index refresh reproduced a nonmatching replacement falsely returned as a valid hit. `/tmp/task16-scored-snapshot-baseline.log`. Scored title/body provenance now travels from the index result through stateless search; index mutation during asynchronous scoring fails closed with partial source coverage. Shared token/fuzzy semantics remain.
- Two paginated project baselines accepted an old continuation after legacy thread reassociation or child deletion changed visible membership while Project stayed identical. `/tmp/task16-project-continuation-baseline.log`. Continuations now bind the read content digest separately from the Project revision used for writes.
- Residual candidate38 tests/four owners pass in `/tmp/task16-assistant-residual-candidate.log`; refreshed configured types and new-head CI still required.

- Granted configured Basic Auth/SQLite/FS typecheck on51505747 initially found only two fixture errors: a searchOnce mock omitted the new snapshots field and the interrupted DB get key needed an explicit parameter type. Both repaired without changing assertions;45 focused cases/two fixtures pass `/tmp/task16-assistant-residual-fixtures.log`. The same configured gate now exits0 in `/tmp/task16-assistant-residual-typecheck-fixtures-fixed.log`. GOMAXPROCS2/UV pool2/Node4GiB; first sandbox tsx IPC failure and first TS errors retained. No full-suite/build/browser expansion in that short slot; explicitly released after success.
