# Data-loss recovery audit — 2026-10-11

Base: `df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5` (remote `or3-cloud`, fetched October 11).
Branch: `audit/data-loss-recovery-20261011`. Fresh isolated cloud container only.

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
