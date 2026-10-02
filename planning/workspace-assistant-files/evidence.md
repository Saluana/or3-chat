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

- PR179: document/editor/sidebar/search workspace fences; final same-ID editor
  correction pending owner review. Earlier green head is superseded.
- Reliability: useAi/continue/retry/background persistence and canonical chat
  fixtures; exact reviewed draft/head pending.
- PR181: authenticated job/client-tool/workflow scope admission.
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

The browser workspace journey, review/apply/undo, Files/Trash, provider admission,
mobile/zoom/performance and cloud recovery are not yet qualified. No task box
represents proof without the command, source revision and observed artifact.
