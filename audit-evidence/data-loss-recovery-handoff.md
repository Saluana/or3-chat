# Data-loss recovery handoff — 2026-10-11

Repository: Saluana/or3-chat. Branch: `audit/data-loss-recovery-20261011`.
Base: `df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5`.
Qualified application source: `c7f309347b1d01b9f1e333af2cf41b4670a3be89`.
The accompanying manifest records the final evidence commit and artifact hashes.

Implemented verified interrupted-save, refresh, attachment, draft restoration,
document recovery, and failed-stream persistence fixes. The latest two source
commits are `3d20af87` (atomic competing-draft versions and additive Dexie v28)
and `c7f30934` (owned terminal assistant write-only retry and persistent notice).
Earlier fixes and their exact RED/green checkpoints are in
`audit-evidence/data-loss-recovery.md`; historical failures remain in the archive
and must not be read as passing current qualifications.

Draft recovery scopes versions to the physical workspace database, account, app
tab and fresh writer identity. Atomic transactions retain competing alternatives,
legacy rows and attachment references; exact-version removal retains a sequence
floor against stale retries. A minimal chooser restores a selected version while
retaining the current buffer. It caps live versions at 200 with visible failure,
without automatic eviction. Immutable journal keys avoid cross-tab replacement;
BroadcastChannel keeps recovery choices current even when localStorage is full.
v27 data and queues are preserved by the additive migration. Old executable
builds may not open a database upgraded to v28; this is not a schema downgrade.

Terminal recovery holds the final snapshot, attempts five bounded retries, and
retains manual/lifecycle retry and unload protection after exhaustion. It reopens
only the captured database and checks generation ownership on every transaction.
Retry performs no provider or tool replay; completion effects occur once after
acknowledgment. Canonical/tracker owners retain their existing recovery paths.
`foregroundStream.ts` and `continue.ts` are unchanged.

Current qualification:

- 81 core recovery tests, 44 database integration tests and 10 coalescer tests
  pass. Nuxt type checking, changed-source lint and whitespace checks pass.
- Combined browser qualification: **32/32 pass in 8.6 minutes**, ending at
  15:10:40 UTC at harness checkpoint `c89b7486`, with unchanged application c7f30934.
  One Chromium worker; frozen application source; isolated synthetic contexts;
  external traffic denied. Log: `or3-recovery-versions-terminal-expanded-final-browser.log`.
- The first current-source combined run had 31 passes and one oversized-draft
  timeout. Its old fault paused a put inside the new atomic transaction, then
  repaired only canonical data. Harness-only `c89b7486` moves the pause before
  transaction entry and awaits the complete write; the narrow case passes in
  21.8 seconds. The original failed log/context are retained.
- Native two-page draft probe passes: duplicated session hint gets separate writer
  identities; divergent commits survive each real refresh; explicit selection
  retains the replaced buffer; concurrent set/set and clear preserve alternatives.
  Physically filled localStorage rejected the next write after 5,177,344 characters;
  the other page's native commit still updated the mounted chooser.
- Terminal probes pass after 20/21 injected failed native puts. The second probe
  dismissed an actual beforeunload refresh dialog, closed the captured Dexie
  handle, repaired storage, and retained the full final suffix through refresh
  after write-only retry. One local scripted provider invocation, one user row,
  unchanged assistant ID. No further dialog after acknowledgment.
- Actual renderer crash (`CDP Page.crash` plus crash event) recovers the newest
  journaled text and exact 68 committed attachment bytes in a fresh page.
- Independent read-only source review found no remaining blocking source defect;
  it was not independent test execution.

Reproduction uses Bun 1.4.3 and Chromium. Start the local journey harness on port
3127 with auth, cloud sync/storage and background streaming disabled as in the
package `test:e2e:recovery` script, then run:

```sh
PW_SKIP_WEB_SERVER=true bun run test:e2e:recovery
bunx vitest run --project=core-app app/composables/core/__tests__/useWorkspaceTabDrafts.test.ts app/utils/chat/useAi-internal/__tests__/continue-retry.test.ts app/utils/chat/useAi-internal/__tests__/foregroundStream.test.ts app/db/__tests__/files-restore.test.ts
bunx vitest run --project=app-integration app/db/__tests__/derived-indexes.integration.test.ts app/db/__tests__/message-files-ref-count.integration.test.ts
bunx vitest run --project=core-app app/utils/chat/useAi-internal/__tests__/streamWriteCoalescer.recovery.test.ts
bun audit-evidence/draft-versions-browser-probe.ts
OR3_EXPECT_TERMINAL_SAVE_RECOVERY=true OR3_TERMINAL_CLOSE_ORIGIN=true bun audit-evidence/assistant-terminal-save-probe.ts
bun audit-evidence/renderer-crash-attachment-probe.ts
```

The text-only archive includes executable probes, reports, native JSON receipts
and qualification logs. It excludes screenshots and browser trace binaries.
The Git bundle requires the stated base commit; the binary patch applies at that
base. Verify SHA-256 against the manifest before applying either.

Remaining limits: permanent storage failure leaves the terminal suffix in memory
with a warning, without a durable terminal journal. Accepted unload or a browser
crash before acknowledgment can lose that suffix. Pending attachment bytes not
yet committed cannot survive a crash. Oversized drafts above the journal limit
remain visibly unsaved in memory. Natural hidden/OS-freeze lifecycle, physical
IndexedDB disk exhaustion, browser eviction and OS power loss were not qualified.
IDB quota/abort failures are deterministic injections; localStorage quota and
renderer crashes are actual browser evidence. No full-repository release or
combined sibling-lane qualification is claimed.

Previously reviewed #234–#238 are merged in the exact base and preserved.
Dormant generation cleanup remains inactive. No production access, credentials,
paid/model requests, external scans, push, merge, deployment or package release.
Library saves are the explicitly requested private transfer of these artifacts.

Transfer blocker: the required current Library upload helper failed before any
file writes during hosted-app discovery with HTTP 401. A read-only Library app
request succeeded, so this is the cloud upload runtime's authentication path,
not evidence that the user's Library is disconnected. No Library files or IDs
were created. The skill prohibits switching a started prepared write to direct
actions. The supported transfer is to restore that runtime's authentication and
run the same ordered prepared-upload batch over the five verified local files.
No remote Git publication or invented download URL was used as a substitute.
