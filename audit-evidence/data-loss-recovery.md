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
