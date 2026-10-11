# Data-loss recovery audit — 2026-10-11

Base: `df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5` (remote `or3-cloud`, fetched October 11).
Branch: `audit/data-loss-recovery-20261011`. Fresh isolated cloud container only.

**Current source checkpoint:** `c7f309347b1d01b9f1e333af2cf41b4670a3be89`.
Parent explicitly authorized fixing the remaining competing-draft and terminal-save
issues after wake-up. `3d20af87` adds local recovery versions and additive v28;
`c7f30934` retains and retries the terminal assistant snapshot without replay.
The independent agent reviewed current source read-only and found no remaining
blocking defect; this is source review, not independent test execution.

Current narrow qualification: **81 core recovery tests + 44 database integration
regressions + 10 coalescer tests pass**. Final Nuxt type checking and changed-source
lint pass. Logs: `/tmp/or3-recovery-versions-terminal-unit-final.log`,
`/tmp/or3-recovery-versions-db-integration-final.log`,
`/tmp/or3-recovery-versions-db-guard-regressions.log`,
`/tmp/or3-recovery-versions-terminal-typecheck-final.log`,
`/tmp/or3-recovery-versions-terminal-lint-final.log`.

Mounted/native Chromium draft version qualification passes:
`/tmp/or3-recovery-draft-versions-qualified-browser-v2.log`,
`test-results/recovery-draft-versions-browser/evidence.json`.
Both pages commit distinct drafts, preserve their own text through real refresh,
use fresh writer identities despite a duplicated session hint, and retain the
replaced buffer after explicit chooser selection. Concurrent set/set and a later
clear retain the other page's branch. The second page's native save updates the
first chooser while localStorage is physically full (**79 x 65,536 characters,
5,177,344 characters; next write rejected**). IDB quota remains injected, not a
physical browser-disk exhaustion claim. The initial browser setup wrongly
replayed its cloned hint on every reload; its failed log is preserved and this
harness error was corrected with a once-only clone marker. The earlier debounce
characterization rerun did not reliably reproduce the old overwrite and is not
counted as a failed product regression.

Mounted/native terminal save recovery also passes at this source:
`/tmp/or3-recovery-assistant-terminal-save-qualified-browser.log`,
`test-results/recovery-assistant-terminal-save-qualified/evidence.json`.
After **20** rejected expanded-prefix puts, the terminal snapshot remains held,
the save notice and synthetic unload protection remain, storage repair triggers
a local-only retry, and actual refresh retains the complete prefix and final
suffix under the same assistant ID. One synthetic user row and one local scripted
provider invocation; all external requests denied. Closed-handle/real-dialog qualification also passes:
`/tmp/or3-recovery-assistant-terminal-save-closed-qualified-browser.log`,
`test-results/recovery-assistant-terminal-save-closed-qualified/evidence.json`.
After **21** rejected puts, actual refresh raised one beforeunload dialog, which
was dismissed. The captured origin Dexie handle was closed, storage was repaired,
and a write-only retry reopened that exact database, acknowledged the complete
suffix, removed protection, and allowed actual refresh with no further dialog.
Provider invocations remained one; the user and assistant identities stayed fixed.

Actual `CDP Page.crash`/crash-event attachment recovery passes at this source:
`/tmp/or3-recovery-renderer-crash-attachment-versions-qualified-browser.log`,
`test-results/recovery-renderer-crash-attachment-versions-qualified/evidence.json`.
The journal protected the latest text and attachment reference while canonical
puts failed. A fresh page recovered that text, the unchanged canonical row ID,
and the exact **68 bytes** of the already committed synthetic PNG.

The first combined run at this source finished with **31 passes and one timeout**
in the oversized-draft refresh test. Its legacy fault paused `table.put` after
the new native atomic transaction had opened, then repaired only the canonical
put outside that transaction. That repair no longer establishes acknowledgment
of the whole version/state transaction; the second refresh remained protected.
The source-level diagnosis is that pausing after entry permits native IDB
auto-completion before repair. Its failed log and error
context are preserved: `/tmp/or3-recovery-versions-terminal-expanded-first-browser.log`
and `test-results/recovery-large-draft-before-atomic-entry-failure/`.
Harness-only commit `c89b7486fa1b1764bce1ead3eadf6e182de18ad1` pauses before
transaction entry, then repairs and awaits the complete atomic transaction.
The corrected case passes in **21.8 seconds**; log
`/tmp/or3-recovery-large-draft-atomic-entry-browser.log`.
A fresh combined run **passed all 32 cases in 8.6 minutes**, ending at
15:10:40 UTC, at that harness commit and unchanged application source c7f30934.
Log: `/tmp/or3-recovery-versions-terminal-expanded-final-browser.log`.
One Chromium worker, no concurrent application edits, Nuxt preparation, unit
suites or type checking. Subsequent evidence-only commits do not change the
qualified application or test sources.

The two formerly remaining source defects are implemented. No deployment, push,
merge, model/provider replay, production access or dormant cleanup activation.
`foregroundStream.ts` and `continue.ts` remain unchanged. Call-site overlap is
limited to the request controller and useAi's captured, request-scoped save-notice
callback/import. Existing canonical/tracker recovery stays with its owner.

Current durability limits: terminal retry holds an in-memory snapshot, with a
persistent notice and unload guard; it has no durable terminal journal before
acknowledgment. Accepting unload or crashing while storage stays unavailable can
lose that suffix. Uncommitted attachment bytes and oversized, unjournaled drafts
also remain subject to the visible unsaved warning. The additive v28 migration
preserves v27 rows/queues; older executable builds may not open an upgraded v28
database. Recovery keeps at most 200 live versions, then reports capacity failure
without eviction. Natural hidden/OS suspension, physical IDB exhaustion, eviction
and power loss remain unqualified. The concise portable handoff records these
limits separately from actual browser evidence.

Portable transfer qualification: the incremental Git bundle verifies against
the stated base, and applying the binary patch to a temporary base index produces
the exact final HEAD tree. Library transfer was attempted through the required
current helper but failed before file creation: hosted-app discovery HTTP 401.
A separate read-only Library app request succeeded. No saved Library IDs exist;
restore the cloud upload runtime's authentication for the supported prepared
batch. Direct mutation fallback is prohibited by the Library skill, and no
remote publication or fabricated URL was substituted.

The evidence below is historical, with each result tied to its own source. Older
'remaining/unimplemented' statements describe that checkpoint and are superseded
by the current status above.

## Earlier checkpoints

**Latest source checkpoint:** `c65df47fb91570fefa1d218a695e46d41b9f7894`
fixes four verified coalescer receipt/teardown races. It passes 27 scoped tests,
type checking, lint, actual Chromium independent-writer dialogs with mocked
writes, and the mounted native five-failure retry/refresh case. Its fresh combined
run passed **32/32 in 8.9 minutes**, started at this exact
source at 13:54 UTC and completed by 14:03:51 UTC. Log
`/tmp/or3-recovery-coalescer-races-expanded-final-browser.log`. One Chromium
worker; no concurrent application edits, Nuxt preparation, units or type checks.
Evidence-only commit `e2007862` was made during the run without application changes.
The preceding `bf9db934cd80673ce836d7f17239c109d09e6fbd` protects an unread tab manifest after storage-read failure. Its 51 scoped tests,
type checking, lint and native Chromium failure/reload probe pass. Its fresh
combined run passed **32/32 in 9.1 minutes**: log
`/tmp/or3-recovery-unavailable-layout-expanded-final-browser.log`. Source
qualification began at `bf9db934`; evidence-only commit `f5ce0144` was made during
the run without application changes. One Chromium worker, no concurrent source
edits, Nuxt preparation, type checks or unit suites.
The preceding `b7b3caf23f3685944fc8502f599f8d415ce64ca8` fixes
runtime status writes publishing the temporary tab layout before restoration.
Its two startup regressions and 49 tab-controller/persistence tests pass, as does
the same mounted Chromium one-second startup fault that failed before the fix.
**Combined browser qualification:** all **32 cases passed in 8.8 minutes** at
`ae4bc1e06db1045d132dbfc0953fa54daddb109f`, which contains that source fix and
tested evidence updates. Log: `/tmp/or3-recovery-layout-expanded-final-browser.log`.
One worker, fresh isolated contexts, all external requests denied; no source
edits or Nuxt preparation occurred during this run. This is a checkpoint while
new fault coverage continues, not the end of the overnight assignment.
An additional active failed-progress unload guard is committed as
`9ae97eaaad45fcfa922b5e5028aebc7b6c315979` and qualified by a fresh combined
run: **32/32 passed in 9.6 minutes** (started 13:04:33 UTC), log
`/tmp/or3-recovery-stream-guard-expanded-final-browser.log`. One Chromium worker;
no source changes, Nuxt preparation, type checking or unit suites ran concurrently.
21 scoped persistence/lifecycle tests and the five-failure Chromium receipt pass.
It changes only `streamWriteCoalescer.ts`; the foreground and continuation call
sites remain unchanged. The 32-case result above belongs to the preceding HEAD,
not this newer source. Type checking and changed-source lint pass. The separate
32/32 run above qualifies this newer source, with terminal-save coverage still
being investigated.
Recent qualification: 60 draft/composer unit/component tests; nine Chromium draft
recovery cases; native partial document/composer attachment transactions; exact
attachment bytes; pending upload refresh; persistent failed-file visibility;
and stale document-read recovery. These are separate per-run results, not one
combined count. The expanded 32-case invocation completed with 31 passes and one failing
last-keystroke draft reload. The post-`bfa030ab` combined rerun completed with **29
passes and 3 failures in 13.9 minutes**. It exposed two empty-composer-after-refresh
failures and is **not a passing qualification** of that earlier source. Native
diagnosis found both complete draft rows retained but replaced tab IDs in the
manifest; the runtime-only layout fix above addresses that verified boundary.
The interrupted-read retry click also timed out, although
its final screenshot shows the recovered text. Native tracing confirmed that
repair can let a pending startup restore finish and remove the toast during
Playwright actionability checks. The harness accepts that race only after exact
text recovery and removal of the failure notice. The subsequent combined run
passed all 32 cases as recorded above.
Verified remaining terminal-save failure: after 20 rejected assistant puts,
coalescer disposal removed unload protection; storage repair did not retry the
terminal response and refresh retained only its older durable prefix. Shared
finalization owners need to coordinate a write-only recovery path.
Open risk: competing browser-page drafts still share a canonical
row/journal. Preserve-both design is documented and deliberately unimplemented.
Natural hidden/OS-suspension coverage remains blocked by this browser environment.

## Coalescer teardown/concurrency follow-up (parent requested)

New source commit `c65df47fb91570fefa1d218a695e46d41b9f7894` is narrowly
qualified below and awaits combined browser qualification.
Prior committed HEAD before this change:
`85d1bac53f3f5e641b3aad660d2616dd9cb1a51f`; last application source `bf9db934`
qualified 32/32. Four new regressions fail against that coalescer: a successful
older retry removes protection for a newer dirty suffix, a queued flush returns
while a newer prepared write remains pending, a waiting callback starts after
disposal, and a newly invoked flush writes after disposal. RED with bail disabled:
`/tmp/or3-recovery-stream-guard-races-unit-red.log` (**4 failed, 4 passed**).

The committed narrow fix keeps failed-write protection while newer deltas remain,
joins the current in-flight chain repeatedly, and prevents waiting/new writes or
deltas after disposal begins. The already prepared write still drains. No shared
foreground/continuation/finalization caller changed. Final scoped qualification:
**27 tests passed** in `/tmp/or3-recovery-stream-guard-races-unit-qualified.log`,
including propagation of the newer joined failure, idle retry cancellation,
independent failed writers and repeated disposal. Type checking and lint passed:
`/tmp/or3-recovery-stream-guard-races-typecheck.log`,
`/tmp/or3-recovery-stream-guard-races-lint.log`. Chromium utility/real-dialog qualification also passed: independent failed
writers installed exactly two guards; disposing one and a late rejecting writer
left the newer dirty suffix protected by one real beforeunload dialog. Final
acknowledgement removed the last guard and actual refresh succeeded without a
second dialog. Persistence callbacks were mocked; this is production utility
plus actual browser-dialog evidence, not native IndexedDB or mounted-stream
evidence. Log `/tmp/or3-recovery-coalescer-guard-lifecycle-qualified-browser.log`,
`test-results/recovery-coalescer-guard-lifecycle-qualified/evidence.json`. The first
probe stopped before exercising guards because the lazy module was not yet loaded.
The mounted native save-failure regression also passed on this source:
five rejected puts during dismissed refresh, followed by repair, acknowledged
save, guard removal and actual refresh preserving the expanded prefix. One
unchanged assistant ID, one user row, one mocked provider invocation. Log
`/tmp/or3-recovery-assistant-persistent-guard-races-qualified-browser.log`,
`test-results/recovery-assistant-persistent-guard-races-qualified/evidence.json`.
The fresh combined qualification passed **32/32 in 8.9 minutes** at application
source `c65df47f`: `/tmp/or3-recovery-coalescer-races-expanded-final-browser.log`.
Evidence-only commit `e2007862` did not change application source during the run.
The prior 32/32 result belongs to its earlier source, as recorded separately. The terminal-save limitation remains unchanged.

### Coalescer acknowledgement contract limit

The utility receives `write: () => Promise<void>` and cannot itself inspect the
committed message snapshot. `patchMessageInDb` intentionally resolves without a
write when its transaction-time generation guard rejects a stale owner; the
persister preserves that existing void return contract. This review leaves #236
barriers and the callback API intact. Current-owner native puts were verified in
the mounted fault probe; a resolved callback is not independent proof that an
arbitrary caller committed bytes. Stale-generation disposition belongs to the
request/persistence owner. No new current-generation data-loss finding is claimed
from this source-level limitation, and no shared persistence helper was modified.

## Permanent assistant-write rejection and active progress protection

Mounted Chromium at application source checkpoint `ae4bc1e0` rejected three
successive native assistant-message puts containing a newly displayed suffix.
The browser showed the app-owned storage error; one local scripted provider
call and one durable user row were present. Natural refresh produced **no
beforeunload dialog** and recovered the acknowledged earlier assistant prefix,
while the newer displayed suffix was absent from the durable row. This is a
verified baseline limitation under persistent storage failure, distinct from
the passing transient failure + automatic retry case below. It does not imply
that an acknowledged assistant row was deleted.

Probe: `audit-evidence/assistant-persistent-save-probe.ts`.
Log: `/tmp/or3-recovery-assistant-persistent-save-browser.log`.
Native receipts: `test-results/recovery-assistant-persistent-save-failure/evidence.json`.
All external requests were denied; there was no real model call.

The narrow candidate adds a client-only beforeunload guard to a coalescer after
an actual failed progress write. Starting its retry leaves the guard armed;
acknowledgement clears it. Each independent writer owns its own guard, and
disposal prevents a late rejection from registering another writer's warning.
Browser globals remain optional for server-side use. Persistence callbacks,
generation checks, provider requests, tool calls, and row shapes are unchanged.
`foregroundStream.ts` and `continue.ts` remain untouched.

Unit RED: `/tmp/or3-recovery-stream-unload-unit-red.log`. Final scoped GREEN:
21 tests in `/tmp/or3-recovery-stream-unload-unit-final.log`, including server
globals, pending retry, independent writers and disposal ordering. Mounted
Chromium GREEN: `/tmp/or3-recovery-assistant-persistent-guard-qualified-browser.log`
and `test-results/recovery-assistant-persistent-guard-qualified/evidence.json`:
five native rejected puts while refresh is dismissed, one real beforeunload
dialog, repair → confirmed save → guard removal → actual refresh retaining the
expanded prefix, one unchanged assistant ID, one user row and one local provider
call. A prior attempt stopped at a three-failure timing predicate with only two
observed failures, before exercising refresh; it is not passing guard evidence.
The strengthened run records repeated failures during the blocked navigation.

The candidate protects active coalescers. Terminal persistence after coalescer
disposal remains a separate unqualified boundary being investigated; this guard
does not establish that finalization failures can be retried after storage heals.

## Unavailable layout read with available writes — verified boundary

At `9ae97eaa`, a native Chromium `Storage.getItem` fault rejected the first
manifest read once while `setItem` remained available. The next write replaced
the original tab ID with a placeholder. The complete original draft row remained
in IndexedDB but the mounted composer was empty. This is distinct from corrupt
JSON and preserves the existing #235 backup contract as a dependency.
RED: `/tmp/or3-recovery-layout-read-failure-browser-red.log` and
`test-results/recovery-layout-read-failure/evidence.json`.

Source commit `bf9db934cd80673ce836d7f17239c109d09e6fbd` marks the scope unread after either a throwing storage
property or unavailable native read. Scheduled writes, explicit Retry and unload
flushes cannot replace that original. A successful restore clears the barrier
and pending placeholder writes; scope switches clear only the outgoing scope's
state. Recovery uses a subsequent reload after storage becomes readable. No new
schema, backup key, UI action or provider behavior is introduced. The existing
persistent warning stays until the scope is restored. Users can still choose to
accept the browser confirmation; this protection is best effort.

Unit RED: `/tmp/or3-recovery-layout-unavailable-unit-red.log` (first new case fails
before the runner bails). Final unit qualification: 51 tab-controller/persistence
tests in `/tmp/or3-recovery-layout-unavailable-unit-qualified.log`. Credential-free
type checking and changed-source lint pass in
`/tmp/or3-recovery-layout-unavailable-typecheck.log` and
`/tmp/or3-recovery-layout-unavailable-lint.log`. Mounted Chromium GREEN: `/tmp/or3-recovery-layout-read-failure-browser-final.log`,
`test-results/recovery-layout-read-failure-final/evidence.json` and `recovered.json`.
The fault leaves the temporary composer empty (recorded observation), raises a
persistent warning, and writes no placeholder manifest. The subsequent actual
reload produces one beforeunload confirmation and recovers the exact draft text
with the original tab ID. The new combined run passed **32/32 in 9.1 minutes** at this application source
checkpoint: `/tmp/or3-recovery-unavailable-layout-expanded-final-browser.log`.
Evidence-only commit `f5ce0144` did not change application source during the run.

## Corrupt-layout dependency qualification

The mounted Chromium dependency probe repeated the merged #235 contract on the
latest application source `bf9db934`: invalid JSON is copied aside before the
fresh layout replaces it, **Download original** produces exactly the truncated
synthetic bytes, the backup remains after download, **Discard original** removes
only that backup, and the composer remains editable with a valid fresh layout.
All assertions passed, with external requests denied. No source change was
needed. Log `/tmp/or3-recovery-corrupt-layout-contract-browser.log`; receipts
`test-results/recovery-corrupt-layout-contract/evidence.json` and
`recovered-workspace.png`. This adds actual browser evidence beyond the scoped
unit backup cases and qualifies compatibility of the unavailable-read barrier.

## Mounted composer after a closed local connection

At current application source `bf9db934`, a mounted Chromium composer durably
saved its initial draft, then its production Dexie handle was explicitly closed
(`or3-db`, `isOpen: false`). A subsequent editor change reopened that same local
handle (`isOpen: true`) and was acknowledged in native IndexedDB without manual
repair or Retry. Refresh recovered the exact expanded text. No source change was
needed. This is mounted editor/native DB evidence; the earlier replacement-handle
probe still has its separate UI-bypassed classification.

The first attempt demanded a visible error and timed out; it did not read the
post-edit row and is **not evidence of a defect**. The qualified probe distinguishes
acknowledged success from visible failure and requires durable refresh recovery.
Final log `/tmp/or3-recovery-mounted-closed-db-qualified-browser.log`; native
receipts `test-results/recovery-mounted-closed-db-qualified/after-close.json` and
`evidence.json`. External requests denied. This tests an explicit local connection
close, not browser disk eviction or operating-system termination.

## Rejected draft deletion across refresh

Actual Chromium committed a synthetic draft, then native `workspace_tab_drafts`
deletes threw quota while the user cleared the mounted composer. The save warning
was visible, the original durable row remained, and a synchronous null discard
journal recorded the user's intent. After an explicitly accepted refresh, the
composer remained empty; failed journal cleanup showed **Retry restore**. Repair
plus that visible action removed the old row, and another refresh stayed empty.
The first probe incorrectly selected **Retry**, which was absent after restoration
failed; that failed assertion is not a product defect. The qualified stage receipts
record both failure notices and the correct action explicitly.

No source fix needed. Log `/tmp/or3-recovery-failed-draft-delete-qualified-browser.log`;
receipts `test-results/recovery-failed-draft-delete-qualified/before-refresh.json`,
`after-rejected-reload.json`, `evidence.json` and `rejected-reload.png`. One real
beforeunload dialog was deliberately accepted after preserving receipts. All
external requests denied. This extends the previous unit-only failed-discard
journal case through the mounted UI and native transaction boundary.

## Offline/reconnect interrupted assistant response

At the qualified application source `bf9db934`, mounted Chromium entered offline
mode (`navigator.onLine: false`) after the assistant's initial prefix was confirmed
in native IndexedDB. A deterministic TypeError interrupted the gated mocked
Response body; generation stopped and the acknowledged prefix remained in the
same assistant row. Reconnect and real refresh recovered that exact prefix, with
one user row and no duplicate assistant IDs. The pre-refresh browser fetch
instrument recorded one local scripted provider invocation. Playwright observed
zero provider HTTP requests because the journey fixture resolves the Response
inside the browser. External requests were denied throughout.

The first counter assertion expected an HTTP request and failed after successful
recovery; the corrected probe keeps local invocation and observed HTTP counts
separate. The failed counter logs are retained. Qualified log
`/tmp/or3-recovery-offline-stream-qualified-browser.log`; receipts
`test-results/recovery-offline-stream-qualified/offline.json`, `evidence.json`
and `offline-state.png`. No source change was needed. Provider interruption is
synthetic: this does **not** establish that offline mode alone disconnects an
existing real socket, nor meter in-browser provider invocations after reload.

## Abrupt Chromium renderer crash with a journaled draft

Mounted Chromium acknowledged a synthetic initial draft, then a native draft put
quota failure kept its later edit out of IndexedDB while the synchronous recovery
journal held that exact edit. The save warning was visible. CDP `Page.crash`
produced an actual page crash event, bypassing normal unload. A new page in the
same isolated browser context restored the journaled text and committed it under
the same original draft row ID. All assertions passed with one observed rejected
put and external requests denied. No source change was needed.

Probe `audit-evidence/renderer-crash-draft-probe.ts`; log
`/tmp/or3-recovery-renderer-crash-draft-browser.log`; receipts
`test-results/recovery-renderer-crash-draft/before-crash.json`, `evidence.json`
and `before-crash.png`. This establishes renderer-failure recovery **after journal
acknowledgement** for a small text draft; it does not cover pre-capture keystrokes,
a whole-browser/storage-process crash, physical disk corruption, OS power loss,
or unjournalable large buffers. The dormant generation cleanup system remains off.

## Renderer crash during partial attachment persistence

The follow-up mounted Chromium case committed a 68-byte synthetic PNG while
native draft puts were rejected. The prior durable draft still had its earlier
text and **zero attachment references**; only the acknowledged recovery journal
contained the new text and image hash. An actual `Page.crash` event bypassed unload.
A new page recovered the exact text under the original row ID, displayed the
attachment removal control, persisted its hash reference, and read back all
68 original bytes exactly. No application source change was needed.

Probe `audit-evidence/renderer-crash-attachment-probe.ts`; log
`/tmp/or3-recovery-renderer-crash-attachment-qualified-browser.log`; native
receipts `test-results/recovery-renderer-crash-attachment/before-crash.json` and
`evidence.json`. The first attempt stopped before intake because the production
composer creates its file chooser on the Add attachments action; no crash or
attachment assertion occurred in that setup failure. The qualified case uses
the actual chooser. All external requests denied. This is renderer failure after
both file-byte commit and journal acknowledgement, not recovery before either
boundary nor whole-browser/OS/storage-process failure.

## Terminal assistant-save failure — verified remaining limitation

At source HEAD `9ae97eaa`, the mounted Chromium terminal probe rejected 20
native assistant writes containing the expanded prefix. Streaming ended with
the expanded prefix and late suffix displayed and the storage notice visible.
Coalescer disposal removed its active unload guard. A synthetic cancelable
beforeunload event was not prevented; subsequent actual refresh produced no
browser dialog. After native persistence was repaired, the same assistant row
remained at the earlier durable prefix for the five-second observation window;
refresh recovered that earlier prefix. One local provider call and one user row
were present. The observation probe exits successfully when it collects receipts;
**this is a recovery failure, not a passing regression**.

Probe: `audit-evidence/assistant-terminal-save-probe.ts`.
Log: `/tmp/or3-recovery-assistant-terminal-save-browser.log`.
Receipts: `test-results/recovery-assistant-terminal-save-failure/evidence.json`,
`before-refresh.json`, and `terminal-state.png`. Provider requests are local and
external requests denied. Shared finalization/foreground/continuation handling
has not been changed for this finding; ownership coordination is pending. Read-only
tracing found `requestController.ts` retains a settled `request.finalization`
promise after persistence failure and has no write-only retry path. Any remedy
must retain the exact terminal snapshot, recheck generation ownership, preserve
metadata merge contracts, avoid replaying tools/providers/hooks, and clear its
unload protection only after acknowledged persistence or explicit discard. A
bounded per-request recovery owner is preferable to prolonging a disposed stream
coalescer. This is a proposed design, not an implemented fix.

## Layout publication before restoration — verified source fix

Two failures in the native diagnostic six-case run retained complete text,
editor JSON, and image hashes in the original `workspace_tab_drafts` row, while
startup published a new tab ID. Four diagnostic cases passed and two failed;
those failures are preserved in `/tmp/or3-recovery-startup-fault-native-browser.log`
and `test-results/recovery-startup-fault-trace/*/native-draft-trace.json`.
An additional layout-get observational run passed four cases. Added observers
can change timing, so those passes did not dismiss the earlier failures.

The bounded startup probe pauses the mounted shell for one second immediately
before its existing layout restoration. Application code is unchanged except
for this local Vite response latency. Before the fix, its native observation
sequence was **set temporary tab → get temporary tab → set temporary tab**;
the original complete draft row remained present but undisplayed. This verifies
layout publication before the saved manifest was read. Native RED:
`test-results/recovery-layout-startup/evidence.json`, log
`/tmp/or3-recovery-layout-startup-browser-red.log`.

`updateRuntime` had used the same persistence-scheduling commit as manifest
changes, even though runtime status/view state is excluded from the serialized
manifest. It now publishes reactive state without scheduling a manifest write.
An absent initial snapshot explicitly schedules the fresh initial tab after the
storage read; this preserves fresh-workspace behavior. No schema, identity,
generation cleanup, provider, or backup/recovery contract changed.

Source commit: `b7b3caf23f3685944fc8502f599f8d415ce64ca8`.
Unit RED: `/tmp/or3-recovery-layout-runtime-unit-red.log`.
Final unit GREEN: 49 tests in `/tmp/or3-recovery-layout-runtime-unit-final.log`.
Final browser GREEN: `/tmp/or3-recovery-layout-startup-browser-final.log`,
`test-results/recovery-layout-startup-final/evidence.json`; original tab ID and
the draft text survive the identical one-second fault.
Credential-free type checking passed in
`/tmp/or3-recovery-layout-runtime-typecheck.log`; changed-controller lint passed
without errors or warnings in `/tmp/or3-recovery-layout-runtime-lint.log`.
The first candidate's browser run failed because a fresh scope no longer had
an implicit runtime-event save (`before: {}`); its evidence is retained under
`recovery-layout-startup-green`. The explicit initial-save regression above
corrected that candidate before commit. That intermediate directory is not a
passing receipt despite its historical name.

## Latest assistant-row fault coverage

At application source checkpoint `bfa030ab`, Chromium completed
`audit-evidence/assistant-save-failure-probe.ts` with one native `messages.put`
quota rejection after an acknowledged partial assistant prefix. The existing
save-error toast was visible, automatic persistence retry wrote the same
assistant row, and refresh recovered its acknowledged expanded prefix with
Continue generation available. Native receipts contain one user row, one
assistant row with an unchanged ID, one injected fault and one local scripted
provider call. External requests were denied. No application source fix was
needed for this boundary. This is mounted browser + native IndexedDB evidence,
not a unit-only coalescer assertion.

Log: `/tmp/or3-recovery-assistant-save-failure-browser.log`.
Receipts: `test-results/recovery-assistant-save-failure/evidence.json` and
`assistant-save-visible.png`. This does not qualify permanent assistant save
failure, abrupt OS termination, or a live authenticated cloud provider.

## Scope and safety

Synthetic local workspaces/accounts/blobs only. No real credentials, production,
paid inference, deployment, release, merge or remote publication. Browser contexts
deny external requests; inference is mocked. Resource use: one development server,
one Chromium worker. No dormant generation cleanup activation.

Reviewed dependency state: #234 accounting, #235 backup/recovery, #236 generation
barriers, #237 approval execution repairs, #238 upload/restore contracts are all
merged in this base. Changes below must preserve them.

## Core-entry evidence

Persistence and mounted editor lifecycle are host-owned. Configuration, themes,
plugins and providers cannot safely repair a host cache losing staged edits.
Existing contract: failed local saves retain changes, report failure and prevent
navigation; only confirmed writes acknowledge durability. Consumers reviewed:
document editor, pane document selection, workspace document tools.

## Failure model (before implementation)

- Release after quota/transaction failure clears the only pending buffer.
- A storage read arriving after edits or an in-flight flush replaces its baseline,
  allowing stale content to overwrite a concurrent writer on retry.
- Refresh within the capture/save debounce loses an editor buffer.
- Quota failures must remain visible; retry must preserve the same staged edit.
- Two browser tabs must refuse stale writes rather than silently overwrite.
- Interrupted attachment transactions must roll back bytes, metadata and queue.
- Offline/reconnect must preserve local edits and attachments without inference.
- Streaming refresh must retain acknowledged partial output and user messages;
  unit-only stream coalescing evidence does not prove browser recovery.

## Results

- Initial `useDocumentsStore.test.ts`: 8 tests passed, unit evidence only.
- Bun was absent from PATH. Installed Bun 1.4.3 in `/workspace/.tools`.
- Chromium installed in `/workspace/.tools/playwright`; every recovery context
  is fresh and has off-host requests denied.

Further reproductions, exact commands and limitations are appended as work proceeds.

## Verified fixes and local commits

`115df23afffccb1e4b272bd1e49c9968eb46aeaf` — document recovery:

- Reproduced a quota failure followed by `releaseDocument`: record and pending
  title/body were cleared. Release now retains unsaved/in-flight state.
- Reproduced a read replacing the baseline of a dirty document, and an older
  read replacing a committed save. Reads now preserve the baseline and reject
  completions superseded by editing/saving.
- Chromium reproduced the missing refresh guard and persistent retry control.
  The editor now captures on beforeunload/visibility change, asks the browser
  to protect unsaved edits, and keeps a failure banner with explicit retry.

`268d51db226eb23f445e2a8b6fddead520493ab4` — draft recovery (verified red):

- An older save removed a different newer journal entry when timestamps tied.
  Journal acknowledgement now compares the saved snapshot on ties; recovery
  also accepts unacknowledged equal-timestamp journal entries.
- An oversized draft was treated as an empty/discarded draft, removed the last
  durable copy, and reported success. Oversize is now a failed save, retaining
  both the live buffer and prior durable copy.

`bee032a3440c724473a6f9abbf2776eaeebc16a2` — narrow shared-shell/composer changes:

- A layout write can fail separately from draft IndexedDB writes. Chromium
  reproduced its warning expiring while the failure remained unresolved.
  The warning now stays visible with Retry.
- Chromium reproduced refresh proceeding despite a failed layout or draft save.
  Before unload, the shell synchronously retries a failed layout and requests
  browser confirmation while layout or draft save failure remains unresolved.
- Composer warning describes the latest unsaved changes and existing size cap.
  This is separately committed for composer integration review. No provider or
  tool-call source changes are included.

## Coverage checkpoints

These are per-run counts, **not summed unique test counts**.

| Evidence | Result | Boundary |
| --- | --- | --- |
| `useDocumentsStore` + mounted workspace editor suites | 26 passed | Unit/component; real TipTap + fake IndexedDB integration |
| Message-file reference integration, assistant persistence, foreground stream, draft suites | 59 passed before new draft cases | Unit/fake IndexedDB; provider boundary mocked |
| Atomic sync capture, snapshot recovery, conflict resolution, document reference suites | 32 passed | Unit/fake IndexedDB; no live sync service |
| Updated draft + production composer component suites | 41 passed | Includes both new draft regression cases |
| Final document/draft/composer/editor source checkpoint | 68 passed in four suites | Includes a pending save versus same-millisecond discard race; draft-only rerun after mock cleanup: 18 passed |
| Tab/host close races, transfer queue + ownership/crash recovery, outbox failures | 106 passed | Unit/fake IndexedDB; transport mocked |
| Production document recovery browser cases | 5 passed | Refresh, quota/retry, transaction abort/retry, offline/reconnect, two tabs |
| Attachment transaction browser cases | 2 passed | Actual Chromium IndexedDB abort/quota injection, rollback, retry and reload |
| Offline file import + original-byte download | Passed | Chromium; actual context offline/reconnect and byte equality |
| Draft + attachment reload, foreground refresh, second-tab owner crash recovery | 3 passed | Chromium; scripted local inference only |
| Full localStorage with working IndexedDB | Passed | Real browser quota reached with 5,177,344 synthetic characters; layout receipt checked before fault |
| Full localStorage + rejected IndexedDB then retry | Passed in first expanded chat run | Real localStorage quota + synthetic IndexedDB quota |
| Oversize through actual composer UI | Passed | 260,000-character live buffer; serialized cap exceeded, prior copy kept, reduction/reload recovered |
| Combined bounded browser lane | 15 passed; remaining case passed focused rerun | All 16 cases ran. The owner-crash case's five-second final render wait was raised to 30 seconds; focused rerun passed in 1.2 minutes (`/tmp/or3-recovery-owner-final.log`) |
| User-turn save faults | 2 passed | Actual Chromium quota rejection and transaction abort; retained composer, zero provider calls before acceptance, retry/reload with one user turn (`/tmp/or3-recovery-user-save-final.log`) |
| User-turn save classification + Stop/detach regressions | 120 passed, one existing skipped | Unit/fake IndexedDB and scripted providers; two suites (`/tmp/or3-recovery-user-abort-final-unit.log`) |
| Overlapping draft flush failures + durable discard | 44 passed | Draft/composer suites, unit/component evidence; one tab's successful flush cannot erase another unresolved failure (`/tmp/or3-recovery-overlapping-drafts-final.log`) |
| Retained drafts after database handle replacement | 45 passed | Source/component cases; old destination retained after another workspace becomes active (`/tmp/or3-recovery-replaced-handle-green.log`) |
| Database handle replacement browser probe | Passed | Actual Chromium IndexedDB + production composable; UI bypassed. Closed handle stayed closed, replacement saved the original/late buffer, other workspace had zero rows (`/tmp/or3-recovery-handle-replacement-browser.log`) |

Source failure evidence: `/tmp/or3-recovery-unit-red.log`,
`/tmp/or3-recovery-read-red.log`, `/tmp/or3-recovery-stale-read-red.log`,
`/tmp/or3-recovery-journal-red.log`, `/tmp/or3-recovery-oversized-red.log`,
`/tmp/or3-recovery-browser-red.log`, `/tmp/or3-recovery-new-faults-real-clock.log`,
`/tmp/or3-recovery-layout-guard-red.log`, `/tmp/or3-recovery-draft-refresh-red.log`.

`c0807c44f77b465bd64b661bf3253452beb9d38c` — isolated user-turn save fix:

Additional verified user-turn failure: a database `AbortError` returned
`status: aborted` without a request cancellation and no visible failure notice.
The source regression failed before changes (`/tmp/or3-recovery-user-abort-red.log`)
and a real Chromium transaction abort reproduced the empty notification list
(`test-results/recovery-user-turn-qualified`). The outer catch now checks actual
request cancellation/signal state. Unsolicited aborts at the user-row write are
wrapped with app-owned `ERR_DB_WRITE_FAILED` guidance, preserving error-safety
rules and distinguishing them from Stop. The narrow `useAi.ts` change was
reported before implementation and has its own integration commit.
No tool execution/ledger source was edited.
Type-check and source ESLint also passed after this fix
(`/tmp/or3-recovery-admission-typecheck.log`,
`/tmp/or3-recovery-admission-final-eslint.log`).

`d8115fdd` — overlapping draft saves:

- Reproduced one successful flush clearing `saveFailed` while another tab's
  failed flush still had an unsaved buffer (`/tmp/or3-recovery-overlapping-drafts-red.log`).
- Failures are now acknowledged by workspace/account/tab key. Success or a
  durable discard clears only that key, preserving unrelated failures and the
  existing bounded retry budget.
- Composer test fixtures now settle their draft discards before deleting
  synthetic workspace databases. Their previous cleanup stranded writes at
  closed handles, which the old global warning reset concealed.
- 44 source/component cases passed; browser quota/oversize warning, retry and
  refresh cases passed after the change (`/tmp/or3-recovery-failure-status-browser.log`).
  Type-check passed (`/tmp/or3-recovery-overlap-typecheck.log`); source ESLint
  had zero errors and four existing warnings (`/tmp/or3-recovery-overlap-eslint.log`).

`d14fa4c5` — retained drafts after handle replacement:

- Reproduced a visible pending draft whose retries kept using an LRU-closed
  original handle after the workspace had loaded a replacement. The regression
  failed with `DatabaseClosedError` (`/tmp/or3-recovery-replaced-handle-red.log`).
- A retry may use an already-restored, open handle for the same scope key and
  database name. It does not reopen the old handle or fall back to the active
  workspace. Both the original retry and a late callback retain their origin.
- 45 source/component cases, type-check and source ESLint passed. Browser
  evidence uses `audit-evidence/handle-replacement-probe.ts`, which imports the
  production modules already loaded by the isolated page and exercises real
  Chromium IndexedDB. This proves the persistence boundary, **not the complete
  workspace-switch UI flow**. Its first URL-discovery attempt ended cleanly;
  observing actual script requests corrected the probe, which then passed.

Browser artifacts are in `test-results/recovery-documents`,
`test-results/recovery-stream`, `test-results/recovery-chat-storage`, and
`test-results/recovery-new-faults-real-clock`. They contain synthetic content only.

## Reproduction commands

Cloud-container tool setup (already installed):

```sh
export PATH="/workspace/.tools/bun-linux-x64:$PATH"
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.tools/playwright
```

The new bounded browser lane is `bun run test:e2e:recovery`. It turns off auth,
sync, cloud storage and background jobs, enables the existing production journey
harness, and selects 18 named recovery cases with one worker (manifest:
`/tmp/or3-recovery-browser-manifest.log`). The test contexts
deny off-host requests. To use the current isolated dev server, prefix
`PW_SKIP_WEB_SERVER=true`. Port: 3127.

Focused source validation commands:

```sh
bun x vitest run app/composables/documents/__tests__/useDocumentsStore.test.ts app/components/documents/__tests__/DocumentEditorRoot.workspace.integration.test.ts --reporter=dot --silent=passed-only
bun x vitest run app/composables/core/__tests__/useWorkspaceTabDrafts.test.ts app/components/chat/__tests__/ChatInputDropper.test.ts --reporter=dot --silent=passed-only
bun x vitest run app/core/sync/__tests__/atomic-capture.integration.test.ts app/core/sync/__tests__/snapshot-recovery.integration.test.ts app/core/sync/__tests__/conflict-resolver.test.ts app/db/__tests__/documents-references.integration.test.ts --reporter=dot --silent=passed-only
bun x vitest run app/composables/core/__tests__/useWorkspaceTabs.test.ts app/composables/core/__tests__/useWorkspaceTabHost.test.ts app/core/storage/__tests__/transfer-queue.test.ts app/core/storage/__tests__/transfer-lease-claim.test.ts app/core/sync/__tests__/outbox-manager.test.ts --reporter=dot --silent=passed-only
OR3_AUTH_PROVIDER=basic-auth OR3_SYNC_PROVIDER=sqlite OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false OR3_BACKGROUND_STREAMING_ENABLED=false timeout 240 bun run type-check
```

Final type-check passed with local provider selection and no credentials
(`/tmp/or3-recovery-qualified-typecheck.log`). An earlier qualification caught a
test double returning a native Promise where Dexie expects PromiseExtended;
the intentionally delayed test double was typed explicitly and rechecked.
The ordinary
command forces auth on and its default Clerk/Convex config rejected missing
credentials; disabling auth in the caller does not override that script. This
was resolved with local provider selection, without changing source config.
Source TypeScript ESLint passed with zero errors and four existing warnings
(`/tmp/or3-recovery-eslint-source.log`); `git diff --check` passed. The repository
lint configuration excludes Vue and E2E files. Forcing those files into lint
does not provide a Vue parser and reports E2E files outside configured projects
(`/tmp/or3-recovery-eslint-full.log`), so this is not claimed as full lint
coverage. Vue source was checked by the successful type-check and browser tests.

## Limitations and remaining checks

- **Verified remaining draft conflict risk:** two browser tabs restored from the
  same layout share an app tab ID and therefore the same draft row and journal
  key. The isolated Chromium probe kept both live buffers visible, then a
  refresh of the first browser tab restored the competing buffer without a
  failure notice. Reproducer: `PLAYWRIGHT_BROWSERS_PATH=/workspace/.tools/playwright
  timeout 120 bun run audit-evidence/two-tab-draft-probe.ts`; evidence:
  `test-results/recovery-two-tab-drafts/evidence.json` and
  `/tmp/or3-recovery-two-tab-drafts.log`. An IDB receipt is a point in time:
  another browser can overwrite it before the next inspection. Document
  conflicts are guarded; composer drafts currently do not retain independent
  competing versions. This was reported promptly. Resolving it safely requires
  a defined draft ownership/conflict policy and recovery UI, so it is not hidden
  inside the narrow lifecycle fixes or treated as passing coverage.

- A Chromium lifecycle protocol probe (`audit-evidence/browser-lifecycle-probe.ts`)
  issued frozen/active commands and recovered the document after reload, but
  observed no visibility/freeze/resume events in this headless environment.
  A headed cloud-only attempt used Xorg's dummy display, a temporary window
  manager, disabled Playwright focus emulation/backgrounding overrides, and
  requested window minimization. The document still reported `visible`.
  Exact blocker: this environment did not produce the required hidden state,
  so no hidden/freeze handler coverage is claimed. It **does not establish
  natural hidden-tab or OS-suspension coverage**. Evidence:
  `test-results/recovery-browser-lifecycle/evidence.json` (headless) and
  `/tmp/or3-recovery-headed-lifecycle.log` (headed). Virtual display processes
  were stopped afterward; no system config or user home files were edited.
- Browser quota injection for IndexedDB is deterministic API rejection, not a
  real full-disk experiment. Actual quota filling is limited to localStorage.
- Browser tests exercise local durability, not a live authenticated cloud
  reconnect. Sync recovery has mocked/fake-IndexedDB evidence separately.
- Force-killing a browser, accepting an unsaved-change confirmation, browsers
  suppressing confirmations, disk corruption/eviction and OS power loss remain
  outside the established durability guarantee.
- A saved draft requires the correct tab layout to restore it into view.
  Draft-table persistence alone does not acknowledge layout durability.
- A Playwright virtual-clock toast test stalled and was stopped. Its replacement
  crosses the actual toast-expiry interval with a bounded six-second wait and
  reproduced the disappearing warning. This is a harness limitation, not a
  product defect.
- Some first browser checks used five-second render waits and saw loading pages
  after reload. Bounded waits were enlarged; document and streaming reruns pass.
  The first combined qualification still had one five-second post-reload
  count assertion in the owner-crash case: 15 passed, one failed. That exact
  wait is corrected; the focused rerun passed. This is 15 passing cases plus
  one successful focused rerun, not a claim of a single 16/16 passing invocation.
- No remote publication, PR creation, merging, deployment or generation cleanup
  activation occurred. Shared ownership was reported before planned PageShell
  changes; gallery/viewer/image-cache sources were untouched.

## Interrupted draft hydration (additional verified finding)

A rejected IndexedDB draft read was swallowed as an absent draft. Closing the
untouched empty composer then captured a discard and removed the saved row.
Both core and mounted composer regressions reproduced this before the fix:
`/tmp/or3-recovery-hydration-red.log` and
`/tmp/or3-recovery-hydration-composer-red.log`.

Reads now reject, the empty failed restore cannot capture a discard, and a
persistent scoped **Retry restore** action retries the read. Genuine edits still
follow the existing typed-while-loading contract. Unit/component evidence:
47 tests passed in `/tmp/or3-recovery-hydration-final-unit.log`.
Actual Chromium evidence: one test passed in 36.4 seconds, retaining the original
row across two reloads during a deterministic IndexedDB index-read abort, then
restoring the same text through the visible retry button. External requests were
denied. Log `/tmp/or3-recovery-hydration-browser.log`; artifact directory
`test-results/recovery-draft-read`. This tests local persistence, not cloud sync.

## Proposed competing-draft conflict design (not implemented)

When two browser pages restore the same app-tab ID, the canonical row and journal
currently share ownership. Preserve both versions before changing this behavior:
keep the existing canonical contract and introduce bounded local recovery versions
keyed by workspace/account/app-tab/editor session. Compare the exact baseline
snapshot and timestamp atomically, preserve both conflicting buffers durably, and
restore the page's own version with a visible conflict choice. Protect attachment
references in unresolved versions and keep these versions out of sync. Capacity
limits must visibly reject additional writes rather than silently deleting an
unresolved version. This requires coordinated schema and recovery UI work; no
winner was selected and no competing user text was discarded by this audit.

## Delayed document image delivery (parent-assigned follow-up)

`DocumentImageNode.vue` delivered a pending image after unmount or a workspace /
account switch, and an older read cleared a newer request's loading state. Four
unit regressions failed against the original source, with bail disabled:
`/tmp/or3-recovery-document-image-red.log`.
The node now reads against its captured DB and fences delivery by mounted scope,
workspace generation, account and request revision. Scope invalidation revokes
existing URLs; failures use the existing unavailable placeholder.

25 editor/unit integration cases passed in
`/tmp/or3-recovery-document-image-final-unit.log`, including hash ABA,
account invalidation, URL cleanup and rejected reads. Two actual mounted-editor
Chromium cases passed in 10.1 seconds: deferred local reads delivered after node
removal and a workspace switch created zero URLs. This is a deterministic local
read fixture, not an authenticated cross-account browser qualification. Log:
`/tmp/or3-recovery-document-image-browser.log`; artifacts:
`test-results/recovery-document-image`. Shared gallery/viewer/global thumbnail
cache files remain untouched.

Interrupted draft hydration source commit:
`a566fa05` (47 unit/component tests, one Chromium test, local type-check and lint
passed; `/tmp/or3-recovery-hydration-typecheck.log`,
`/tmp/or3-recovery-hydration-lint.log`).

Image follow-up type-check passed with basic-auth/sqlite local configuration:
`/tmp/or3-recovery-document-image-typecheck.log`.

## Interrupted attachment restoration (additional verified finding)

A rejected local blob read was treated as an absent file: the retryable reference
was replaced by a missing-file notice and a later composer capture dropped the
reference. The core regression failed before implementation:
`/tmp/or3-recovery-attachment-read-red.log`.

Attachment restore now settles every read, retains the original references when
any read rejects, releases previews from partial success and propagates a retryable
restore failure. Actual missing bytes still use the existing missing-file notice.
48 draft/composer tests passed (`/tmp/or3-recovery-attachment-read-unit.log`).
Chromium passed the tightened layout-acknowledged fixture in 26.1 seconds:
synthetic file upload, confirmed local read fault, two failed reloads retaining
references, visible retry, and a final successful reload with text and preview.
External requests denied. Log `/tmp/or3-recovery-attachment-read-browser-final.log`;
JSON receipt `test-results/recovery-attachment-read/*/interrupted-attachment-read.json`.
The first browser attempt did not reach its expected warning; fault-hit and layout
receipt checks were added before qualification. No passing result is claimed for
that initial attempt. Type-check passed after correcting a test-only Dexie overload
cast; source lint has zero errors and four existing warnings.

Document image ownership source commit: `7c7af957`.

## Document image intake ownership and visible failure

The original editor let an upload paused before commit store metadata/bytes after
unmount, without any document reference. A quota rejection was also an unhandled
promise without a visible failure state. Both original-source mounted regressions
failed, with one expected unhandled synthetic quota error:
`/tmp/or3-recovery-image-intake-complete-red.log`.

The editor consumer now supplies the existing file API's ownership callback,
fences insertion by editor/document/database/generation/account, and reports
storage rejection through a persistent image-intake banner. No shared file API,
thumbnail cache, reference-accounting or cleanup code changed.
27 editor tests passed (`/tmp/or3-recovery-image-intake-final-unit.log`). The
integration fixture mounts real EditorContent/NodeViewWrapper and waits for
editing availability; the former shallow wrappers caused an artificial node-view
error on retry. Actual browser evidence is independent of that fixture:
- Chromium hashing-gate/editor-destruction case passed: zero metadata/blob rows.
- Chromium quota → reselect file → reload case passed in 14.3 seconds:
  one metadata row, one blob, a document hash reference and visible restored image.
Logs `/tmp/or3-recovery-image-intake-browser.log` (first case passed; second
initially failed an ambiguous fixture selector) and
`/tmp/or3-recovery-image-intake-quota-browser.log` (focused retry case passed).
JSON receipts are under `test-results/recovery-image-intake` and
`test-results/recovery-image-intake-quota`. Type-check passed:
`/tmp/or3-recovery-image-intake-typecheck.log`.

This establishes pre-commit cancellation and atomic local quota rollback. It does
not promise that bytes already committed before teardown are deleted; post-commit
file recovery/accounting remains governed by the existing #234/#238 contracts.

Attachment restoration source commit: `f401bd4b47a9821881df7ecaa1fecfcb42fc8c37`.

## Same-tab save receipt ordering

Reproduced an older successful same-tab write clearing the warning raised by a
newer rejected edit (`/tmp/or3-recovery-same-tab-ack-red.log`). Each write now
returns its actual persisted snapshot; success acknowledges failure only when
that receipt matches the current buffer. Immediate discard consumes the same
receipt and retains its tombstone/retry after rejected deletion.
50 draft/composer tests passed (`/tmp/or3-recovery-same-tab-ack-final-unit.log`).
Type-check and lint passed; lint retains four existing warnings:
`/tmp/or3-recovery-same-tab-ack-final-typecheck.log`,
`/tmp/or3-recovery-same-tab-ack-final-lint.log`.

`audit-evidence/same-tab-save-ack-probe.ts` independently passed in Chromium:
a native older IndexedDB write had its Dexie receipt deferred while a newer
132,000-character buffer (larger than the journal cap) failed to save. Its warning
and synthetic cancelable beforeunload protection remained until retry confirmed
the latest row, then cleared. This is actual IndexedDB and the production
composable/shell handler, with composer UI bypassed and a deterministic callback
and quota fixture; it does not claim a natural browser unload dialog.
`/tmp/or3-recovery-same-tab-ack-final-browser.log` and
`test-results/recovery-same-tab-ack/evidence.json` contain the receipt.

Image intake source commit: `b691314d`.

## Empty editor transactions during failed restoration

An empty TipTap update advanced the send/composer revision even though no user
text had changed. After a failed read this allowed unload/unmount to delete the
unread row; during retry it made the loaded saved buffer look like a competing
edit and left the editor empty. Both mounted regressions failed on the previous
source (`/tmp/or3-recovery-empty-restore-capture-red.log`,
`/tmp/or3-recovery-empty-retry-red.log`).

Restoration now tracks meaningful text/attachment/block edits separately from
the existing send-clear revision. Empty bookkeeping does not compete with saved
content, while typing and then clearing still counts as a user edit. An unread
copy stays protected until a real edit or successful restoration.
The full candidate passed 56 draft/composer tests and all nine Chromium draft
recovery cases, including failed read/retry and attachment read/retry:
`/tmp/or3-recovery-unload-edits-final-unit.log`,
`/tmp/or3-recovery-unload-edits-final-browser.log` (3.1 minutes, one worker).
That browser run also includes the pending-save unload guard committed separately.
Earlier nine-case qualification attempts each passed eight cases and exposed one
restore failure; they are not reported as fully passing suites.

Same-tab receipt source commit: `53ccc64f`.

Final candidate credential-free type-check passed:
`/tmp/or3-recovery-unload-edits-final-typecheck.log`. Core source ESLint has zero
errors and the same four existing warnings:
`/tmp/or3-recovery-unload-edits-final-lint.log`.

## Pending saves larger than the synchronous unload journal

Reproduced natural Chromium refresh losing a valid 129,000-character draft
while its Dexie write was held before the native transaction. The content fits
the persisted draft cap but exceeds the synchronous journal cap, so no failed
save warning had yet appeared. Original-source browser failure:
`/tmp/or3-recovery-pending-large-browser-red.log`.

Local exact-content receipts and pending write tracking now determine whether
draft bytes are protected by IndexedDB or the synchronous journal. Uncommitted
attachment files, oversized buffers and unavailable journals require unsaved
confirmation. Unchanged confirmed content does not prompt merely because a new
capture timestamp was assigned. Receipt state is scoped by account/workspace/tab;
pruning or expiry invalidates its known protection. No schema, sync or cleanup
contract changed. The composer captures in beforeunload's capture phase before
the shell's bubbling durability guard, and removes that listener on teardown.
The shell consumes this check in a separate one-line integration commit.

Four core receipt/journal/attachment tests and one mounted event-order test were
added. The final 56-test draft/composer suite and nine-case Chromium recovery
lane passed; the large-draft case independently passed in 25.1 seconds before
final qualification. Chromium dismissed one natural beforeunload dialog, retained
the live buffer, repaired the held write, and reloaded the saved buffer without a
second dialog. JSON receipts:
`test-results/recovery-unload-edits-final/*/interrupted-large-draft.json` and
`pending-large-unload-state.json`; log
`/tmp/or3-recovery-unload-edits-final-browser.log`.
The deterministic fault is deferred local Dexie put before a native transaction,
not physical IndexedDB quota exhaustion or OS power loss. Browser confirmation
remains best effort; accepting or suppressing it can still abandon pending bytes.

Empty-transaction restoration source commit: `8dd1de97`.

## Partial document attachment boundaries

Two additional actual Chromium cases passed with off-host requests denied:
- A two-image batch committed its first image, then rejected the second blob
  write with synthetic quota. The first image and its document reference
  survived reload; explicitly selecting the rejected second file restored both
  images. The tightened receipt verifies every stored image is referenced by a
  document, not merely that some reference exists. Final case passed in 12.3
  seconds (`/tmp/or3-recovery-partial-image-batch-final-browser.log`), receipt
  `test-results/recovery-partial-image-batch-final/*/partial-image-batch.json`.
- File metadata/bytes committed successfully while the following document save
  was rejected. The image stayed visible with a persistent document-save retry,
  natural refresh confirmation retained the live buffer, and retry made the
  document hash reference durable. Final reload restored the preview with one
  metadata/blob row and no additional dialog. Passed in 29.6 seconds:
  `/tmp/or3-recovery-image-reference-retry-browser.log`, receipt
  `test-results/recovery-image-reference-retry/*/image-document-reference-retry.json`.

These cover distinct transactions and retained live state. They do not guarantee
recovery of an unreferenced blob after accepting the warning or killing the
browser; the existing #234/#238 orphan/reference contracts remain unchanged.
Pending-save source commits: `9914dcaa` (core/composer), `9ecd832c` (shell guard).

## Delayed composer attachment completion

After the pending attachment's text-only draft had flushed, upload completion
mutated a raw intake object. Vue's deep composer watcher did not see its ready/hash
transition, leaving the saved draft without the file reference. Both Chromium
and a mounted composer regression failed against the pre-fix source:
`/tmp/or3-recovery-pending-image-unload-browser.log`,
`/tmp/or3-recovery-delayed-attachment-unit-red.log`.

The intake creates one reactive attachment object shared by persistence, emitted
callbacks and the composer array. Existing ownership, cancellation, authorization,
file APIs and schema contracts are unchanged. The complete draft/composer suite
passed 57 tests (`/tmp/or3-recovery-delayed-attachment-final-unit.log`), including
current scope/cancellation and send regressions. Source lint passed with no
output/errors; credential-free type-check passed:
`/tmp/or3-recovery-delayed-attachment-final-lint.log`,
`/tmp/or3-recovery-delayed-attachment-final-typecheck.log`.

Actual Chromium qualification passed in 23.2 seconds with no concurrent generated
checks: a synthetic WebCrypto digest gate held the upload, natural refresh raised
a beforeunload confirmation, dismissing it retained text and preview, completion
saved the reference, then reload restored both without another dialog. Native
row/layout receipts before and after reload are under
`test-results/recovery-pending-image-unload-qualified/*/pending-image-reload-state.json`;
final receipt `pending-image-unload.json`; log
`/tmp/or3-recovery-pending-image-unload-qualified-browser.log`.

The first post-fix browser attempt confirmed the saved reference but failed the
reload text check while type-check/unit qualification ran concurrently; it is not
a passing result and its exact cause is not established. A diagnostic harness
syntax error was corrected before the independent final run. Future browser
qualification excludes concurrent Nuxt preparation/type-check to avoid possible
generated-file/HMR interference. Partial image transaction tests were committed
separately in `a54b68de`.

The final two-case attachment lane passed in 31.2 seconds (one Chromium worker):
hashing-gate refresh recovery plus first blob-write quota rejection → visible
Retry → persisted reference without another editor edit → reload with text and
preview. Log `/tmp/or3-recovery-attachment-completion-retry-browser.log`; receipts
under `test-results/recovery-attachment-completion-retry`. The later diagnostic
type-check passed (`/tmp/or3-recovery-delayed-attachment-qualified-typecheck.log`).

## Current completion checkpoint

### Architecture
Host browser persistence and mounted document/composer consumers; trusted core
changed where existing persistence contracts required it. Providers, tool
execution and broad integration were not taken over. File/accounting/restore
contracts from merged #234–#238 remain in force.

### Changes
Verified fixes retain document edits after failures, fence stale reads, keep
unread draft/file references retryable, acknowledge exact save receipts, protect
unjournaled pending bytes during unload and capture late attachment completion.
Shared PageShell and unsolicited user-row abort classification changes have
separate commits for integration review.

### Permissions
Only fresh cloud-container filesystem, synthetic local instances and local
127.0.0.1 browser requests used for recovery testing. Repository/package/browser
downloads established the isolated environment. Production/server access, real
credentials, paid inference, external scans, communication, deployment, release,
merging and remote publication: None. Dormant cleanup activation: None.

### Validation
Counts above are per-run evidence, not summed unique tests. Latest core/composer
checkpoint: 57 unit/component tests; nine Chromium draft recovery cases; two
additional document attachment boundaries; two Chromium attachment completion /
retry cases. Credential-free type checks and scoped source lint passed; existing
core warnings remain recorded. Every native browser fault uses isolated contexts,
synthetic data and one worker, with paid/provider requests denied.
Reproduce using the bounded `test:e2e:recovery` package script. Individual browser
commands set `OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true
PW_PORT=3127` and use the isolated configured local server. Unit commands use
`bunx vitest run` for the cited suites. This is an ongoing overnight checkpoint,
not a claim that every browser case passed in one combined invocation.

### Artifact or installation
Local branch `audit/data-loss-recovery-20261011`. Portable bundle, binary patch
and synthetic evidence archive are refreshed at `/workspace/` for parent review;
the archive checkpoint records its exact source HEAD and base. Nothing installed
in production, pushed, published, activated or merged.

### Rollback
Discard the isolated branch, or revert its source commits in reverse dependency
order during integration. No database schema migration or cleanup activation
was introduced. Do not delete user drafts/files as part of rollback.

### Remaining risks
Competing browser-page drafts still share one canonical row/journal and can
silently replace each other. A preserve-both design is documented but remains
open for coordinated implementation. Natural hidden/OS suspension could not be
established in this environment. Physical IndexedDB quota exhaustion, forced
browser termination, suppressed/accepted confirmation, eviction and disk
corruption remain untested. Cloud reconnect evidence is mocked/local, without
live authenticated sync. Detailed distinctions and blockers appear above.

## Attachment failure visibility after toast expiry

Chromium reproduced an unresolved attachment quota rejection with a visible
preview but no error notice and no Retry button after the real eight-second
error-toast interval. Its saved reference count was zero:
`/tmp/or3-recovery-attachment-warning-browser-red.log`,
`test-results/recovery-attachment-warning-red/*/persistent-attachment-failure.json`.

The composer now keeps an alert naming failed attachments until they are
removed or their status leaves error. It offers the existing remove/reselect
recovery path; the existing toast Retry and shared error reporting stay intact.
No raw error details are rendered. The 58-test draft/composer suite passed
(`/tmp/or3-recovery-attachment-warning-final-unit.log`), credential-free type
check passed (`/tmp/or3-recovery-attachment-warning-final-typecheck.log`).
Chromium passed in 26.9 seconds: native quota rejection, nine-second real expiry,
no transient Retry remaining, persistent filename notice, remove → reselect
after repaired storage → durable reference → reload with text and image.
`/tmp/or3-recovery-attachment-warning-final-browser.log`; receipt
`test-results/recovery-attachment-warning-final/*/persistent-attachment-failure.json`.

Delayed completion source commit: `c0d56ef8f73016e88aa3721da267eb8ae38d6cf7`.
Final type-check for that preceding source checkpoint also passed in
`/tmp/or3-recovery-attachment-checkpoint-typecheck.log`.

## Delayed document read through the mounted browser editor

The production document store was invoked against its real Chromium IndexedDB
handle while a native read receipt containing the initial content was deferred.
The receipt remained unsettled before and after the newer editor buffer committed
(proved explicitly, so a fixture poll cannot stand in for the held store read).
Releasing it kept the newer cached record and editor content; a subsequent edit
saved without a stale-baseline conflict and survived reload. The tightened case
passed in 9.5 seconds (`/tmp/or3-recovery-late-document-read-qualified-browser.log`);
JSON `test-results/recovery-late-document-read-qualified/*/late-document-read.json`
contains the stale captured content and newer accepted record. An initial case
also passed in 10.3 seconds before the held-store proof was strengthened.

This is mounted Chromium/editor + production store evidence using a deterministic
callback delay around an actual local IndexedDB read. It extends the unit-only
late-read regressions of `115df23a`; no further source change was needed.
Persistent attachment visibility source commit: `b382349b`.

## Partial composer attachment batch and exact-byte recovery

Actual Chromium committed the first selected image, then rejected the second
file's blob transaction with synthetic quota. The persistent notice named only
the failed file, while the draft retained the first durable reference. Existing
Retry completed the second upload without another editor edit. Both stored blobs
matched the selected byte arrays exactly (68 and 98 bytes), both references
remained after reload, and the failed-file notice cleared. Passed in 11.2 seconds:
`/tmp/or3-recovery-partial-composer-batch-browser.log`;
`test-results/recovery-partial-composer-batch/*/partial-composer-batch.json`.
No new source change was needed. The preceding stale-document-read source/test
checkpoint passed credential-free type-check in
`/tmp/or3-recovery-late-document-read-typecheck.log`.

The bounded recovery selector currently lists 32 cases in three files:
`/tmp/or3-recovery-expanded-list.log`. These listed cases are not yet a claim of
a fully passing combined invocation; its result will be recorded separately.
Stale-read browser regression commit: `f06e6da0`.

## Expanded combined qualification and startup capture diagnosis

At source HEAD `147de1f1d0991a989b39f091b5f755eae27bd1c8`, the exact bounded
`bun run test:e2e:recovery` invocation completed with **31 passed, one failed**
in 9.3 minutes. The failing case was the unsent draft/attachment journey's
second, last-keystroke reload: the composer was empty. No app edits, unit suite
or Nuxt preparation/type-check ran concurrently. Log
`/tmp/or3-recovery-expanded-final-browser.log`; screenshot and error context
under `test-results/data-loss-recovery`. This result supersedes any assumption
that the earlier intermittent empty reload was solely generated-file interference.

A deterministic mounted regression separately reproduced capturing an empty
composer before editor initialization had started restoration, which deleted
the unread row (`/tmp/or3-recovery-before-initialize-unit-red.log`). A fresh-load
Chromium hook-delay probe also showed text could restore through tab props before
editor construction, then capture removed its editor JSON. The strengthened
JSON assertion failed on old source:
`/tmp/or3-recovery-before-initialize-json-browser-red.log`.
The hook delay is registered through an instrumented local Vite useHooks response;
composer and database code are unchanged. The initial tab-switch probe did not
reach initialization because the composer stayed mounted and is not qualification.
The first fresh-load text-only probe passed but exposed JSON loss; it is not
reported as a full snapshot-retention pass.

The candidate skips an untouched empty capture while no editor exists and uses
a matching scoped saved editor JSON until construction. Genuine early attachment
selections remain capturable. A broader initial absent-editor guard failed an
existing intake test and was narrowed before qualification. Current candidate:
60 draft/composer tests passed (`/tmp/or3-recovery-before-initialize-retain-intake-unit.log`);
credential-free type-check passed (`/tmp/or3-recovery-before-initialize-final-typecheck.log`).
Browser startup and the original last-keystroke race are still being qualified;
no source fix for that combined failure is claimed yet.

Startup capture qualification passed:
- 60 draft/composer unit/component tests, including early selected-file intake
  and both startup cases.
- Credential-free type-check passed.
- The strengthened Chromium hook-delay probe retained exact editor JSON as well
  as text, then recovered through a real refresh while initialization was paused:
  `/tmp/or3-recovery-before-initialize-final-browser.log`,
  `test-results/recovery-editor-initialization/evidence.json`.
- The original last-keystroke/attachment/workspace journey passed three bounded
  focused invocations in 53.8 seconds with native put/delete, journal/layout and
  final row receipts: `/tmp/or3-recovery-last-keystroke-qualified-browser.log`;
  `test-results/recovery-last-keystroke-qualified/*/last-keystroke-reload-receipt.json`.

These three runs are targeted regression qualification after a verified startup
fix, not a guarantee that every intermittent reload cause has been exhausted.
The earlier 31/32 combined invocation remains recorded as failed. No fully passing
32/32 post-fix combined invocation is claimed until it completes.

Startup snapshot source fix committed as
`bfa030ab65474aa4074b50fec6a88e163463cd1f`. At that earlier checkpoint, source/tests were committed and the assistant-save
probe had not yet run. Later transient, active persistent and terminal findings
are recorded above. Portable artifacts now include the newer exact checkpoint,
with prior failed combined runs and subsequent targeted results distinguished.
