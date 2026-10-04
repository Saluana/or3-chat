# Implementation acceptance ledger

## Launch review corrections (2026-10-03): verification limits

This section supersedes earlier completion claims. All 16 reviewed findings have implementation fixes; full launch qualification is still pending the cloud queued-upload journey. Further browser runs stopped at the user's request to reduce computer load. The fresh test backend was stopped; interactive user servers were preserved. No deployment or publication occurred.

| Findings | Fix and evidence |
| --- | --- |
| 1, 4, 10 | Captured local intake guard for SSR guests; hash-verified duplicate blob persistence; existing namespace validation before duplicate success. Two canonical suites / 25 passed, plus final core. |
| 3, 5, 6, 9, 11 | Combined Trash/external/AI lock; Document AI suggestions limited to supported document/chat references; remote completion mention refresh; preserved project aliases; reactive cloud Trash capability. Five canonical suites / 27 passed, plus final core. |
| 7, 8, 12, 13 | Preview/action selections separated; native documents never enter catalog-original image handling; missing project resets to all; bounded list/metadata/status observers with coalescing. Visible Chrome regression passes, including a 500-unrelated-metadata fixture with at most two query rows during a single unrelated update. The update itself accounts for one row; the original zero-row assertion was too strict. |
| 2 | Host requires matching deletion coordination; native Convex deletion and GC atomically claim hashes; reference/restoration admission honors claims; verified commits release claims and obsolete storage IDs remain invalid. Five real concurrent transaction races pass. FS physical cleanup fails closed. Runtime probes reject old Convex scaffolds. |
| 14 | Both obsolete preview-copy assertions replaced with preview-state and Download checks. Saved image, PDF, inert active content and review regression: four visible Chrome journeys pass. |
| 15 | Warm production intake/preview online before offline upload. Final harness also uses a desktop viewport consistent with its complementary-preview selector. This viewport correction has **not** been rerun. Earlier attempts stopped at a mobile-sheet selector; they do not establish offline qualification. |
| 16 | Selected presign method, upload response storage ID and provider ID used throughout. Authenticated original/catalog, replay/version/one-row, search, access and workspace-switch journey passed once each with Convex+native storage and Convex+FS. Later isolated-cache FS rerun failed at palette reopening after reload; preserve that failure. Do not claim complete cloud harness success. |

Final core: **637 suites / 5,140 passed** (loopback permission retry; the first run failed with sandbox EPERM). Configured application types pass, including final Files refinements. Convex: **24 suites / 189 passed**, standalone types/runtime build/template pack pass. FS: **7 suites / 67 passed**, standalone types/build pass, including restored original adapter factory. Static generation and plugin client boundary smoke pass. Public docs: 107 files / 95 routes / 21 typed examples pass; provider README updates followed that check. No new tests were run after the user's resource concern.

Artifacts are under `output/workspace-assistant-files/review-fixes/`: logs, four Files journey traces/screenshots, per-provider cloud attempt artifacts, and `convex-direct-receipt.json` (18 checks, including five deletion races). `current-source.json` records final source hashes. Phase baseline failures are retained. The first Files baseline failed at an inaccessible role selector while Rename was open; it does not prove that behavioral baseline. Browser harness corrections also include awaiting first-run welcome, provider-neutral replay assertions and private per-overlay Vite caches. A removed factory was caught by types and restored before provider qualification. Credentials, signing keys and interactive logs are excluded.

Filesystem disk bytes remain retained until cross-backend physical deletion coordination is available. Deploy the matched Convex scaffold/runtime to obtain native cleanup coordination; an older scaffold fails closed. Private claim rows are durable safety state, released by verified re-upload or workspace purge rather than sync-history expiry.


## Historical qualification before launch review (2026-10-03)

All 41 task boundaries are reconciled in [tasks.md](tasks.md). This qualifies the current source checkout and rebuilt sibling providers, not a published release. Starting main HEAD was `10a9931650feed24ae81b0213dd2695796903173`; final observed HEAD is `a13116e28bd1327eb7e1393b831a791f5eba0310`. The intervening user commit changes documentation/qualification ledgers rather than application, server or test source and is preserved; exact changed runtime/test source hashes and all four repository HEADs are in [current-source.json](current-source.json). Retained artifact SHA-256 values are in `output/workspace-assistant-files/evidence-manifest.json`. Earlier entries below are historical and do not override this section.

The user authorized an official local Convex sandbox and broader OR3 Chat/provider testing. Qualification used disposable loopback profiles, local synthetic accounts, locally verified RS256 direct JWTs and scripted inference. The operator's environment, installed package versions, unrelated checkout edits and live deployments were preserved. Interactive watch logs, cookie jars, local signing keys and credentials are excluded from the artifact bundle.

| Boundary | Command/profile and result | Retained evidence under output/workspace-assistant-files |
| --- | --- | --- |
| Final core | `bun run test`: 637 suites / 5127 tests passed, 43.46s on final source | `logs/workspace-files-final-source-core-candidate.log` (earlier pass retained separately) |
| Final types | `bun run type-check`, SSR Basic Auth/SQLite/filesystem configuration: exit 0 | `logs/workspace-files-concurrent-types-final.log` (earlier final-types receipt retained) |
| Documentation | `bun run check:docs`: 107 files, 95 mapped routes, 21 typed examples | `logs/workspace-files-final-docs.log` |
| Static boundary | `bun run generate:static`: build and built-in/plugin client-boundary smoke passed | `logs/workspace-files-final-static.log` |
| Phase checks | Phase 1: 49/3; phase 2: 16/3; phase 4: 43/5; final storage/outbox owners: 42/3 (tests/suites). Existing migration owner: 15 passed | `logs/workspace-files-phase1.log`, `phase2.log`, `phase4.log`, `workspace-files-final-phase-owners.log`, `workspace-files-final-migration-candidate.log` (phase filenames also begin workspace-files-) |
| Named production journeys | `bun run test:e2e:journeys --grep 'Files\|workspace\|regular text upload\|stale document proposal' --workers=1 --trace=on`: 10 passed; review/focus/disablement named selection: 7 passed | `current-browser/test-results`, `review-disablement/test-results`, corresponding browser candidate logs |
| Rebuilt Convex source | `bun run test -- --reporter=dot`: 24 suites / 186 passed; 43 canonical direct/gateway/preservation cases passed; `bun run build`, `bun scripts/build-template-pack.mjs`, `bun run type-check:standalone` passed | `logs/workspace-files-convex-expanded-suite-final.log`, `workspace-files-convex-current.log`, `workspace-files-convex-expanded-build.log`, `workspace-files-convex-expanded-pack.log`, `workspace-files-convex-types-final.log` |
| Live Convex direct, including ordinary app stores | `bun scripts/test/qualify-workspace-convex.ts <owned-sandbox-root>`: 17 live checks, real local backend and deployed templates | `cloud-receipts/convex-direct-direct-receipt.json`, `logs/workspace-files-convex-all-native-live.log` |
| Live gateway combinations | `bun scripts/test/qualify-workspace-cloud.ts <owned-profile-root>`: 9 checks each for Convex/native storage, Convex/filesystem, and Basic Auth/SQLite/filesystem | `cloud-receipts/convex-native-gateway-gateway-receipt.json`, `convex-fs-gateway-gateway-receipt.json`, `sqlite-final-gateway-receipt.json` |
| Native SQLite | Existing real SQL adapter suite: 68 passed; build and standalone types passed | `logs/workspace-files-sqlite-preservation-current.log`, `workspace-files-sqlite-build.log`, `workspace-files-sqlite-types.log` |
| Physical filesystem ownership | Existing physical owner: 27 passed, full package 7 suites / 73 passed; build and standalone types passed | `logs/workspace-files-fs-explicit-delete-candidate.log`, `workspace-files-fs-delete-final-suite.log`, `workspace-files-fs-delete-build.log`, `workspace-files-fs-delete-types.log` |
| Host compatibility deletion guard | Actual authenticated gateway refuses physical removal of catalog/Trash/retained-edge originals, including an older installed FS adapter | `cloud-receipts/sqlite-fs-gateway-retention-receipt.json`, `logs/workspace-files-fs-legacy-gateway-retention-candidate.log` |
| Actual cloud browser lifecycle | Visible Chrome: native create/project association, ambiguous sources, remote document winner/history, viewer read-only, membership loss clears old content, empty Files, queued local save, fresh SQLite search/reload, paused SQLite catalog save/recovery | `visible-chrome/convex-*.jpg`, `sqlite-fresh-client-*.jpg`, `sqlite-queued-catalog.jpg`, `sqlite-recovered-catalog.jpg`; remote-winner and viewer API logs/receipt separate |
| Whole-tool cost and loading | Actual registry `workspace_search`, captured authority, stateless search, DB/revision validation and encoding: 30 measured calls, warm p95 11.8ms < 300ms; 1000 seeded mixed items, exact 10MiB text. Files renders 50 initial rows; no workspace blob requests on chat open; Files module appears only after opening Files | `cloud-receipts/chrome-full-tool-performance.json`, `chrome-chat-loading.json`, `chrome-files-loading.json`, `visible-chrome/convex-full-tool-performance.jpg` |
| Same-host search index comparison | `OR3_WORKSPACE_FILES_BENCHMARK=true bun run command-palette:benchmarks:check`, baseline/candidate retained; engine and substring fallback within target | `search-baseline.json`, `search-candidate.json` (distinct from whole-tool measurement) |

### Failures found and corrected

- Convex viewer storage mutations were admitted by read authority. Production templates now require write authority for reserve/upload/commit/cancel/delete/GC while preserving authorized reads. Real deployed direct calls prove viewer denial and membership revocation.
- Convex schema assumed every storage ID belonged to native `_storage`; mixed filesystem storage failed. IDs are now opaque provider-owned strings. Native blob operations enforce storage-provider ownership. Both real gateway storage combinations pass.
- Files cloud state assumed deterministic outbox IDs. Real HookBridge capture/coalescing uses UUIDs, so a paused gateway incorrectly displayed Synced. The visible baseline is `convex-queued-status-baseline.jpg`; candidate `convex-queued-status-candidate.jpg` reports Saved locally · Waiting to sync. Schema 21 adds one compound entity index for only the visible posts/metadata; it preserves the scheduler indexes and queued rows. Existing migration expectations were updated from 20 to 21 without weakening preservation assertions. The final core run passes.
- Filesystem explicit deletion bypassed canonical retention. Seven added physical-owner cases failed before the fix; canonical metadata/edges now protect explicit deletion and GC. The host also rejects retained deletion before dispatch, covering older installed adapters. Missing canonical state fails closed. The initial live host check hit a stale Nitro transform during HMR; reseeded fixture bytes pass after the rebuilt route is ready, with baseline and candidate logs retained.
- Convex full-suite authorization inventory had stale source-count assertions. The actual public/internal function authorization owner now includes the client-tool functions; redundant function-count assertions were removed. Full 186-test candidate passes.
- Empty native document preview exposed serialized TipTap JSON. Valid JSON is normalized before preview; an empty document displays a friendly empty state. Actual Chrome candidate retains the queued-state and empty-document proof together.

### Final source reconciliation

The final overlay comparison found two newer production helper edits after the earlier broad run: unbounded retained-hash parsing/legacy catalog hash validation, and native document renames using the existing document update/editor lease boundary. These concurrent edits were preserved and reviewed. The affected five canonical files pass 76 cases; the configured typecheck passes. Visible Chrome on an updated disposable overlay verifies native document rename, mounted editor title/content and reload. Its 63 changed production app/server/shared modules match the final source receipt exactly; test files are excluded from that browser comparison. Artifacts: `logs/workspace-files-concurrent-owner-final.log`, `logs/workspace-files-concurrent-types-final.log`, `cloud-receipts/final-source-overlay-comparison.json`, `visible-chrome/sqlite-native-rename-reload.jpg`.

The final core rerun initially hit sandbox EPERM on its loopback HTTP test fixtures; rerunning with local binding allowed passes all 637 suites / 5127 tests in 43.46s. This is a runner-permission failure, with both logs retained. An initial invocation duplicated the compact reporter flags already present in the test script; the corrected command is simply `bun run test`. No assertions were disabled. The static smoke precedes the two database helper refinements; final types/core/browser qualify those refinements, which add no server/client dependency boundary.

### What each proof covers

The direct Convex receipt exercises workspace identity, catalog/project semantics, old-reader/writer rejection, retry idempotency, snapshots, physical retention, viewer/revocation, ordinary chats/ordered messages/native docs/preferences/notifications, background job persistence/lease fencing/completion, atomic rate limits, notifications and private host-setting CAS/isolation. Gateway receipts independently exercise the host authorization/admission, upload/commit/download, lost-response retry, new-device snapshot, denied viewer writes, membership removal and active-workspace isolation.

Browser proof verifies visible application behavior; provider/API receipts verify backend behavior. Captured-authority cancellation, awaited access changes, stale writes, autosave and unavailable client-tool execution remain owned by the existing canonical registry/server/editor/Dexie suites rather than being duplicated with paid model requests. The newly authored queued-upload automated case in the canonical cloud suite is retained for future repeatability; it was not run as an automated case in this qualification. Actual visible Chrome verifies queued catalog/native saves and gateway recovery. Named existing production journey runs retain their original source hashes; final core/types/static and actual cloud UI cover subsequent runtime repairs.

The first SQLite interruption attempt paused the entire development server before a lazy action finished loading and produced a navigation error. Resuming/reloading preserved the local document. A later file-picker attempt stalled until the session expired and correctly refused stale access; it is not a passing receipt. The final SQLite proof warms the existing catalog action, pauses the same disposable gateway, saves locally, verifies Waiting to sync, resumes the process and verifies Synced. This distinguishes cold development-asset availability from sync persistence; the cold navigation screenshot is retained as a test-environment limitation.

The workload receipt is warm whole-tool latency, not a model/network or cold-start benchmark. The seeded 1000 items are 250 each across chats, documents, projects and catalog files; normal fixture items may also exist. Loading receipts contain only observed module/request paths, with headers, cookies and query strings excluded.

### Repeatable setup and publication boundary

Build owning providers before host qualification because the application consumes `dist/`. Use `bun scripts/test/create-workspace-convex-sandbox.ts <official-cached-convex-local-backend>` from this source tree; the launcher creates a new /private/tmp sandbox, binds loopback, clears inherited deployment selectors, and deploys the rebuilt production template pack with an explicit absolute environment file. Only sandbox JWT auth differs. Keep this backend running while invoking the guarded direct qualification command.

For visible gateway checks run `bun run test:e2e:workspace-cloud --watch --journeys` for SQLite/filesystem, or add `--convex-local <owned-sandbox-root>` and optionally `--convex-storage`. The profile copies source, links rebuilt owning providers, isolates auth cookies/database/storage, strips paid model keys, and prints its loopback URL. Open that URL in Chrome. The same profile is accepted by the guarded gateway API qualification script. The production journey fixture's `?workspace=1&benchmark=workspace` button measures the actual registry tool; it is test-fixture UI, not a production endpoint.

Final simplification review retains the existing pane/sidebar registries, stateless palette engine, native tool registry, editor schema/history and local-first storage queue. No new table, parser, second search/agent loop or dependency was introduced. The one outbox compound index has the actual first-release cloud-status caller. All four repositories pass `git diff --check`.

Runtime/template/package publication, real hosted Clerk OAuth, D1, paid external model transports and live external integration delivery were not qualified or changed. Deploy updated Convex schema/templates with its runtime; publish rebuilt Convex/SQLite/filesystem packages separately through the documented workflow. An older installed package does not gain v1 support merely because its sibling source is rebuilt. The original user-interactive Convex preview and its backend were preserved; duplicate synthetic previews can be stopped after receipts are retained.


## Remaining-plan implementation (2026-10-02)

Starting checkout: `10a9931650feed24ae81b0213dd2695796903173`.
User authorized completion of the remaining plan. Existing unrelated edits are
preserved. New storage failures are owned by the real Dexie reference suite:
catalog-only retention, duplicate identity/name preservation, logical Trash
without shared-byte deletion, invalid UTF-8, prefix boundaries, interrupted
catalog persistence, and permission/workspace changes after awaits. Existing
message-edge tests do not cover catalog ownership; no test-only production API
is needed. Provider admission must qualify before exposing catalog writes in
cloud mode; gateway evidence alone cannot qualify direct Convex.

### Earlier local acceptance receipts (superseded by final qualification)

These are working-tree qualifications, not a published release. Exact changed
runtime/test hashes and each repository HEAD are in [current-source.json](current-source.json).
Local retained logs and browser artifacts are under `output/workspace-assistant-files/`.
The main host still consumes installed provider packages: sibling provider builds
qualify their source owners and are publication dependencies, not proof that the
installed cloud profile has those changes.

| Boundary | Command/profile | Result and retained receipt |
| --- | --- | --- |
| Catalog/shared bytes, native document/schema/history/sidebar, composer and host sync | `bunx vitest run app/db/__tests__/message-files-ref-count.integration.test.ts app/utils/documents/__tests__/document-chat-tools.test.ts app/components/documents/__tests__/DocumentEditorRoot.workspace.integration.test.ts app/components/documents/__tests__/DocumentHistoryPanel.workspace.integration.test.ts app/components/sidebar/__tests__/SideBar.workspace.integration.test.ts app/composables/chat/__tests__/useChatInputBridge.test.ts server/api/sync/__tests__/pull.post.test.ts server/api/sync/__tests__/push.post.test.ts --reporter=dot` | 114 passed. `logs/workspace-files-current-owners.log`. Custom-node create/proposal/Apply equals the actual Document AI candidate. |
| File metadata removed during awaited revision hash | Existing real-Dexie reference owner | Intended baseline returned saved content after metadata deletion; candidate refuses unavailable. `logs/workspace-files-metadata-race-baseline.log`, `logs/workspace-files-lifecycle-candidate.log` (59 passed across three owners). |
| Production chat/Files | `bun run test:e2e:journeys --grep 'Files\|workspace\|regular text upload\|stale document proposal' --workers=1 --trace=on` | 10 passed (1.6m): Files pagination/layout/keyboard, original draft handoff, native create/project association, search/read navigation, no-save Review, Apply/Undo/reload, stale proposal request. `current-browser/test-results`, `logs/workspace-files-browser-current.log`. |
| Review/source keyboard/mobile/zoom and disabled tools | `bun run test:e2e:journeys --grep 'keyboard focus\|disabled workspace tools' --workers=1 --trace=on` | 7 passed (1.2m), all three themes, 320/390px and 200% zoom, reduced motion, 44px controls, Enter/Escape/focus return, four persisted tool-disablement turns. `review-disablement/test-results`, `logs/workspace-files-review-disablement-candidate.log`. Representative current Files and review screenshots inspected. |
| Unavailable source and stale proposal request | `bun run test:e2e:journeys --grep 'keyboard focus\|trashed source receipt\|stale document proposal' --workers=1 --trace=on` | Unavailable-source and stale-request cases passed; three added review focus cases failed for the intended lost-trigger focus bug. The repaired matrix passes above. `review-focus-baseline/test-results`, `logs/workspace-files-review-source-matrix.log`. |
| Native SQLite canonical preservation/admission/references | `bunx vitest run src/runtime/__tests__/sqlite-sync-gateway-adapter.test.ts --reporter=dot` in sibling provider | 68 passed, real SQL writes/pull/materialized snapshot preserve catalog text/meta/original edge and unknown project memberships; old-writer omissions return 426 without version allocation. Reference pages retain catalog, trashed catalog/doc and checkpoint edges. `logs/workspace-files-sqlite-preservation-current.log`. Build and standalone typecheck also passed in the owning provider earlier. D1 is not advertised as qualified. |
| Filesystem physical deletion/GC | Existing `fs-storage.test.ts` owner in sibling provider | 19 passed against temporary physical files, including retained posts/message sentinels. `logs/workspace-files-filesystem-references.log`. No live files were touched. |
| Convex local canonical and transports | `bunx vitest run src/runtime/__tests__/convex-snapshot-contract.test.ts src/runtime/app/sync/__tests__/convex-sync-provider.test.ts src/runtime/server/sync/__tests__/convex-sync-gateway-adapter.test.ts --reporter=dot` in sibling provider | 43 passed. Runtime rebuild and standalone typecheck passed. `logs/workspace-files-convex-current.log`, `logs/workspace-files-convex-rebuild.log`, `logs/workspace-files-convex-types-current.log`. This is local template/transport evidence, not live deployment qualification. |
| Types and public docs | `bun run type-check`; `bun run check:docs` | Passed; 107 docs, 95 routes and 21 typechecked examples. `logs/workspace-files-sheet-types-slideover.log`, `logs/workspace-files-design-docs-final.log`. The Files redesign and compact variants pass; final theme configuration owner: 7 passed (`workspace-files-design-theme-final.log`). |
| Search same-host fixed workload | `OR3_WORKSPACE_FILES_BENCHMARK=true bun run command-palette:benchmarks:check` | 1000 mixed categories, exact 10MiB text, one existing source index: baseline/candidate warm p95 both 0.11ms; fallback 6.46/5.75ms; build 314.57/313.88ms; max batch 5.88/5.64ms. `search-baseline.json`, `search-candidate.json`. This measures the index engine, not whole-tool/network overhead. |
| Static build | `bun run generate:static` | Passed, including the built-in plugin/static client-boundary smoke. `logs/workspace-files-static-final.log`. This gate preceded the latest Files visual refinement; another static qualification is still outstanding. |

The final production-backed core lane passed 637 suites and 5119 tests in 51.27s
(`logs/workspace-files-core-current4.log`). This precedes the latest visual refinement;
the affected theme owner passes independently.
The provider-wide Convex run also has an unrelated pre-existing background
authorization inventory assertion expecting 17 functions where both HEAD and
the working tree contain 19; it is recorded, not silently changed to hide failure.

These were the remaining gates at the earlier local milestone. The final qualification below supersedes that status; the historical command results remain attributable to their original sources. No package/image was published and no live deployment was changed.

## Historical planning and assistant receipts


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

## Final initial-milestone qualification at exact runtime5154

Observed2026-10-02 14:07:22UTC: parent-granted single productionPageShell case
`production chat journey › workspace edits require review and preserve durable Apply Undo across reload`
PASS19.5s, worker1/retries0/scripted inference, frozen clean
`5154f48db448b35db6da0401c05a609a83c1a316` throughout. This supersedes the
historical proposal browser pass only for this named journey: real search/read/propose,
Review with unchanged IndexedDB content, Apply/reload, Undo/reload and original
editor navigation all reached their assertions. No additional model/provider call
was authorized; existing fixture scripts inference, actual components/tools/index/DB
execute normally.

Preview command:
`env OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true SSR_AUTH_ENABLED=false OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false OR3_BACKGROUND_STREAMING_ENABLED=false PW_PORT=3210 UV_THREADPOOL_SIZE=2 NODE_OPTIONS=--max-old-space-size=8192 bun run dev --host 127.0.0.1 --port 3210`

Browser command:
`env OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3210 bunx playwright test tests/e2e/production-chat-journey.spec.ts --grep 'workspace edits require review and preserve durable Apply Undo across reload' --workers=1 --retries=0 --reporter=line --trace=on`

Start observed14:06:14UTC; browser EXIT0; own preview Ctrl-C EXIT130 and both3210/25210
listener checks clear at14:07:22UTC; explicit heavy-lane release delivered to parent.
No source/test edit, correction or retry during this frozen gate. Installed HMR shares3210.
Logs `/tmp/task16-assistant-final-proposal-{preview,browser-first}.log`; durable
trace, logs and before-Apply/after-Undo screenshots at
`/Users/brendon/Documents/Codex/2026-10-01/task-16/evidence/assistant-final-proposal-browser/`.
Both screenshots inspected: existing blank-theme tokens/normal review diff and
truthful undone card retained. This is not a full theme/mobile/accessibility proof.

The preview log also records an existing editor-autocomplete request to local
`/api/__or3-e2e/chat/completions` returning404 after editor navigation; that route
is unsupported by the isolated fixture. The named durable-content/editor assertions
passed. This was not a paid/external request and is not evidence of successful
autocomplete or an error-free entire application. First log retained, no suppression
or gate weakening. Full normal autocomplete/provider coverage remains outside this case.

Exact runtime5154 Core and Contracts SUCCESS, run36983290347, independently reread;
parent initial/residual source review closed. Configured BasicAuth/SQLite/fs types
already pass. Historical pending statements above are superseded for this exact
initial milestone by these recorded results, not for the unfinished full plan.

Checklist status notes preserve every original task/Done when criterion and the
full traceability/Definition of Done. Seven fully evidenced task boundaries are
checked;14 partial and20 not-started tasks remain unchecked. Permanent Files,
extraction/uploads, Trash/shared-reference retention, provider/capability matrices,
Files UX/accessibility/scale, remaining history/cloud/static/server/docs/live-quality
acceptance are unfinished. No deployment/default merge/provider publication or
real-user destructive action occurred. Compaction ownership separately handed off
without further edits to its source/tests/plans.

### User-directed Files visual refinement

The October 2 mockups informed a single familiar file list, a clear Upload/New
document header, one action menu per row, and a contextual preview inspector in
wide panes. Narrow panes use the existing Nuxt UI bottom slide-over as a slide-up sheet with bounded, independently scrollable content and safe-area padding. Coverage appears
in preview details rather than adding technical labels to every row. Existing
projects remain the only collection model; no decorative view toggles, fake
activity tabs, selection controls, or duplicate folder hierarchy were added.

Visible verification uses Google Chrome (connected profile 6), not Brave.
Desktop measurements: buttons 36px with 13px labels, inputs 40px, rows 56px.
All six header and row column starts match; the Name label aligns with the actual
filename. Menu icons have a fixed 20px column, matching label starts and vertical
centers. The initial differing-grid-width regression was corrected, as was the
compact field icon/padding recipe. Touch and narrow layouts preserve 44px
controls and 16px input text. Final visual artifacts and measurements are retained
in `output/workspace-assistant-files/visible-chrome/`.

The earlier visible Chrome management pass preserved the exact 68 original
bytes through Rename, project association, Trash/Restore and Download. It
reproduced project-filtered Trash hiding its Restore action; the repaired same
project-filtered view shows Restore and recovers the same file. Native
Review/Apply/Undo and Ask in chat also preserved the existing draft.

The disposable cloud watch profile eventually hydrated successfully and
Google Chrome signed into its synthetic Basic Auth account. The earlier
foundation API pass covers authenticated upload/commit, canonical catalog
snapshot, legacy admission refusal, and exact original download. The expanded
new-device/role/switch matrix has not passed; live Convex also still requires
an authorized disposable deployment. These remain open checklist items.

### Mobile preview sheet (October 2)

The mobile preview uses `USlideover` with `side=bottom`; the centered preview modal is removed. In visible Chrome at 390×844, the sheet starts at y=187.81 and ends at y=844, spans all 390px, and introduces no horizontal overflow. Close, Ask in chat and Open document are 44px tall. At 390×600 the sheet is capped at 528px, with a 460px scrolling body holding 588px of content. Close and Escape restore focus to the original file button. Desktop retains the inline preview sidebar. Screenshots: `visible-chrome/files-mobile-sheet.jpg` and `visible-chrome/files-retro-sidebar-final.jpg`.

Final type check and the existing theme configuration owner passed (7 tests). The drawer package exposed an incompatible nested VueUse dependency during development; the final implementation uses the already compatible Nuxt UI slide-over and adds no dependency configuration. Temporary diagnostic logging was removed. No cloud qualification claim is added by this visual pass.
