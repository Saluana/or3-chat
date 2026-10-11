# Recovery fixture CI repair — 2026-10-11

Starting head: `3063314f1c0f1455ca94fa8d8b04dde36b124d2e`.
Frozen base: `df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5`.
PR: https://github.com/Saluana/or3-chat/pull/241.

Run `38152614780` passed the complete Contracts job (`114508989009`),
changed-source lint and application typechecking. Core job `114508989216`
then failed the quiet foreground generation assertion at line 1671 of
`useAi.backgroundDetach.test.ts`: durable `pending` became false.

The unchanged canonical file passes alone at both the starting head and the
frozen base (41 tests each). The new terminal-save retry changes the lifetime
of an earlier failed-save fixture: it retains its original snapshot after the
test returns. This test suite mocked every request and generation ID as
`id-test` and reused the same assistant row ID. Thus an older retry could
mistake a newer fixture for its own generation. A temporary diagnostic retained
the native timer before enabling fake timers, waited 1.5 seconds after the live
viewer attached, and reproduced the exact hosted `pending` assertion failure.
Changing only the ID mock to unique monotonically increasing synthetic IDs
made the same delayed diagnostic pass all 41 tests. The diagnostic timer was
removed before committing. Production ID generation and lease logic are unchanged.

The canonical quiet-generation case now deterministically creates an older
failed terminal save, starts a distinct newer generation using the same
assistant row ID, and advances 35 seconds across the retry and heartbeat timers.
It retains the original durable/UI pending and error assertions, checks distinct
generation IDs and verifies there is no additional provider-loop execution.
The busy-admission test matches the exact synchronously admitted request ID.
The first two fixture repairs were committed separately as
`d1d2d4e4af610f6da2dbd82d92177130adb701c7`.

Local full-core execution also exposed `ChatInputDropper.test.ts:804`, the
retry-restore case. This failure reproduces in that single case. Its mock
releases the first IndexedDB read, but the new draft-version hydration performs
additional real IndexedDB reads before applying saved text. `flushPromises()`
does not wait for those reads. The test now waits for the same expected editor
text before checking the unchanged durable draft assertion. It passes without
changing the component or storage code; closing the database during premature
test teardown was the source of the secondary DatabaseClosedError warning.

Parent-reported Mac verification also identified the interrupted-read fixture
in `useWorkspaceTabDrafts.test.ts:251`: its assertion selected `toArray()[0]`,
so a valid draft belonging to another tab could sort before the intended row.
Adding an unrelated existing draft with an earlier primary key reproduces that
same failure in the single case. The assertion now reads the interrupted tab's
exact account/tab key, retains the retry-load text assertion, and additionally
verifies the unrelated draft remains unchanged. The unrelated fixture stays
in the regression test. No cleanup policy or production selection logic changed.

Run `38153761311` at `38a93f10d569c910402e6bae51d8c9e02ba06b7d` again passed
Contracts, lint and application typechecking, then exposed another manifestation
of the orphan fixture surviving teardown. The rollback case at line 135 expected
exactly `['durable A']`, but also found `independent old journal`. On hydration,
the legacy-journal case schedules a debounced import receipt. `vi.resetModules()`
does not dispose that older simulated page, and the original teardown removed
journals/rows without cancelling its debounce. The old page can therefore
repopulate the newly cleared tables. Delaying the original teardown by 350 ms
reproduces that exact rollback assertion deterministically. Tracking the page
instances and clearing/flushing each before durable fixture reset makes the same
diagnostic pass. The temporary delay was removed before committing
`3a233fc1c53d32b068fe93f78d2bd260587ab699`.

The rollback assertions remain exactly `['durable A']` before retry and
`['durable A', 'retry B']` afterward. Legacy-journal retention assertions remain
unchanged within their own case. Quiescing simulated pages at test boundaries
does not change product cleanup, recovery retention, active-tab concurrency or
transactions. This completes fixture isolation rather than discarding a valid
recovery alternative to make a product assertion pass.

Receipts (synthetic fixtures, cloud container only):

- Starting-head canonical file: 41 pass,
  `/tmp/or3-recovery-ci-background-detach-current.log`.
- Frozen-base canonical file: 41 pass,
  `/tmp/or3-recovery-ci-background-detach-base.log`.
- Delayed old retry: exact pending failure,
  `/tmp/or3-recovery-ci-old-retry-collision-red.log`; unique-ID diagnostic:
  41 pass, `/tmp/or3-recovery-ci-old-retry-collision-green.log`.
- Retry-restore single-case red/green:
  `/tmp/or3-recovery-ci-retry-restore-current.log` and
  `/tmp/or3-recovery-ci-retry-restore-green.log`.
- Both final canonical suites: 72 pass,
  `/tmp/or3-recovery-ci-two-canonical-suites-green.log`.
- Interrupted-read deterministic red:
  `/tmp/or3-recovery-ci-interrupted-read-red.log`.
- All three affected canonical suites: 112 pass,
  `/tmp/or3-recovery-ci-three-canonical-suites-green.log`. A final run after
  narrowing the admitted-state TypeScript access is recorded in
  `/tmp/or3-recovery-ci-three-canonical-suites-final.log`.
- Orphan teardown deterministic red/green with the same 350 ms diagnostic:
  `/tmp/or3-recovery-ci-orphan-teardown-red.log` and
  `/tmp/or3-recovery-ci-orphan-teardown-green.log`.
- Final quiescent fixtures without the diagnostic delay: 112 pass / 3 files,
  `/tmp/or3-recovery-ci-three-canonical-suites-quiescent.log` (8.70 seconds).
- Exact changed-source CI lint: pass,
  `/tmp/or3-recovery-ci-complete-changed-source-lint-second.log`.
  The final quiescent-fixture branch command also passes:
  `/tmp/or3-recovery-ci-changed-source-lint-quiescent.log`.
- Ledger and both snapshot checks: pass,
  `/tmp/or3-recovery-ci-compatibility-second.log`; no regenerated changes.

The initial full local core run exposed the retry-restore failure (696 pass,
46 skipped before bail), `/tmp/or3-recovery-ci-full-current.log`.
The next full local run was stopped when the third Mac finding required another
fixture change; it is not a complete or exact-final-tree qualification.
Complete final-tree qualification remains pending; its hosted receipt is
recorded on the PR, including any independently owned full-core blocker.

A bounded full core run at `38a93f10` passed 4,105 tests / 427 files before
bailing at an environment-dependent isolation test
`server/api/plugins/__tests__/isolation-capability.post.test.ts:547`,
"refuses ai.complete without a host provider credential". Its mocked handler
resolved `{ ok: true, result: { text: 'ok' } }` instead of rejecting with 503.
The same case initially failed alone in the separate frozen-base worktree at
`df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5`, under the same inherited process
environment. The initial baseline-blocker classification was incorrect:
the endpoint intentionally falls back to `process.env.OPENROUTER_API_KEY`,
while the test only empties its mocked runtime configuration. Removing that
variable from the test process makes the original 503-denial assertion pass
alone on both the recovery branch and frozen base. No variable value was read
or printed. No isolation source, auth behavior or denial assertion was changed;
no new work is assigned to the isolation owner for this local result.
Receipts: `/tmp/or3-recovery-ci-full-final-head.log` and
`/tmp/or3-recovery-ci-isolation-credential-base.log`. Both use synthetic/mocked
providers; no model request was made. This is not a complete full-core pass.
Clean comparison command (in each worktree):

```sh
env -u OPENROUTER_API_KEY PATH=/workspace/.tools/bun-linux-x64:$PATH \
  timeout 90 bunx vitest run --project=core-node \
  server/api/plugins/__tests__/isolation-capability.post.test.ts \
  -t 'refuses ai.complete without a host provider credential' \
  --reporter=dot --silent=passed-only
```

Clean receipts: `/tmp/or3-recovery-ci-isolation-credential-clean-current.log`
and `/tmp/or3-recovery-ci-isolation-credential-clean-base.log` (1 pass each).
Further full local qualification must unset the provider fallback variable;
the hosted final-head run remains the complete CI receipt.

This follow-up changes three canonical test fixtures only. Browser qualification
remains tied to the prior application checkpoint; no new browser execution,
Mac execution, sibling integration, deployment or merge is claimed here.
The next hosted receipt is recorded on PR #241 after completion.
