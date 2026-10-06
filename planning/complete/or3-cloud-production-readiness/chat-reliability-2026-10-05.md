# Basic chat reliability — local qualification, 2026-10-05

Tested the running `http://localhost:3000` in Google Chrome using two newly
registered disposable accounts, real OpenRouter inference, and distinct
synthetic conversations and text attachments. The local instance used the
Basic Auth, SQLite and filesystem provider stack. Restored the original account
after checking both test accounts. This is local evidence against the working
tree, not qualification of an immutable production release candidate.

## Live browser evidence

| Journey | Observed result |
| --- | --- |
| Fresh registration and model choice | Both accounts started with empty history and no favorites; Settings → Current model opened the catalog and selected GPT-4o Mini. |
| Stream, reload, continue | First answers and follow-ups persisted; account B recalled `CF-508` after an immediate reload. |
| Attach and read | Each account saved a distinct reusable text file. Workspace lookup returned `FILE-AO-942` / Thursday for A and `FILE-CF-865` / Monday for B. |
| Model switch after tools | GPT-4o Mini → GPT-4.1 Mini continued saved history successfully after fixing completed and failed tool-result replay. |
| Rapid branch | Double-clicking Branch conversation opened one saved child, retained the original tab, and restored the selected child after reload in both accounts. |
| Compaction | A long synthetic history produced a saved compacted child with 10 captured messages and 5 landmarks. The first invalid summary was rejected; explicit retry succeeded. Original history remained available. |
| Continue after compaction | A recalled `AO-731`, `FILE-AO-942` and Thursday from the saved compacted history after sign-out/sign-in and reload. |
| Immediate mobile reload | Reloaded directly after Send in the compacted child. The saved answer was visible at the next check, 7.3 seconds after Send, with no lingering loading state. This is an observation bound, not a latency benchmark. |
| Account isolation | A→B→A sign-in transitions restored the correct conversation tabs. Searches for the other account's title returned no matches. Files listed only the current account's attachment. |
| Narrow layout | At 390×844, document and body widths were both 390 px; controls and the continued answer remained usable. |

Only synthetic test content was sent to inference. The separately authorized
tiny provider diagnostic returned HTTP 200; it helped rule out built-in tool
schemas as the source of the initial 400. No credentials are included here.

## Repaired causes

- Provider history previously forwarded `tool_calls: []` and assistant-only
  fields on other roles. The builder now emits nonempty assistant calls only.
- Older/background turns could save tool results on the assistant instead of
  durable tool rows. Canonical provider projection now replays those results
  once without changing the saved transcript. Normalization also recognizes
  validated nested tool-result transcripts used for failed client tools.
- A background tool claim could refresh server cookies while browser session
  metadata still carried an expired timestamp. Dispatch now refreshes that
  cache before authorization capture and rechecks the originating identity.
- Duplicate terminal delivery could report the same error twice. Finalization
  now reports it once. Empty failed assistant turns remain visible and
  retryable after reload; provider errors render as plain user-facing text.
- Reload between durable admission and job-ID delivery could leave an empty
  pending reply until the foreground lease elapsed. Reconciliation checks
  background admission promptly and restores the authoritative saved terminal
  row or attaches the admitted job, guarded by workspace/thread ownership.
- Branch navigation used the blank-chat promotion event. It now opens the
  related saved thread through workspace resource navigation with source scope.
- Fresh accounts had an empty favorite-model selector. They can open the
  catalog directly. Literal model names and IDs take precedence over broad
  description matches that previously buried the requested model.
- Bottom-right notifications covered Send after selecting a model. The Nuxt
  UI toaster now uses the top-right position. Empty sidebar searches say
  “No matches found” instead of implying that saved activity disappeared.

## Repeatable checks

Run the named offline browser harness; it scripts model transport and uses
production chat, persistence, navigation and compaction code. It now has an
isolated `.nuxt-e2e-journeys` directory to avoid overwriting a running dev
server's generated configuration.

```sh
OR3_LOCAL_PROVIDERS=false bun run test:e2e:journeys --grep 'production chat journey|PageShell compaction summary|PageShell compaction families|compaction lossy confirmation|regular text upload' --workers=1
```

25 cases passed. After the additional nested-result, auth-cache and notification
fixes, the affected selection/send, upload, branch, stream/reload, three-theme
responsive and failed-response/retry cases were rerun: 9 passed.

```sh
OR3_LOCAL_PROVIDERS=false bun run test:e2e:journeys --grep 'model name and identifier searches|rapid branching|surfaces journey:error|streams a response|responsive messages|regular text upload' --workers=1
bunx vitest run app/components/chat/__tests__/ChatContainer.test.ts app/components/chat/__tests__/ChatSettingsPopover.test.ts app/composables/chat/__tests__/useAi.backgroundDetach.test.ts app/composables/chat/__tests__/backgroundJobs.reattach-notify.test.ts app/core/auth/__tests__/openrouter-build-tool.test.ts app/utils/chat/__tests__/transcript.test.ts app/utils/chat/__tests__/transcript-repository.test.ts app/utils/chat/__tests__/messages.test.ts app/utils/chat/useAi-internal/__tests__/messageBuild.test.ts app/utils/chat/useAi-internal/__tests__/turnWriteback.test.ts --reporter=dot --silent=passed-only
OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true OR3_LOCAL_PROVIDERS=false bun run type-check
```

Final targeted regressions: 10 files, 147 passing tests. SSR type check passed.
Changed TypeScript ESLint checks had no errors and two existing unnecessary
conditional warnings in `useAi.ts`. `git diff --check` passed. New behavioral
regressions were demonstrated failing before their respective fixes.

Screenshots and the preserved 25-case harness attachments are under
`output/playwright/chat-reliability-2026-10-05/` (ignored local artifacts):
`final-mobile-reload.jpg`, `mobile-compaction.jpg`, `attachment-read.jpg`,
`account-b-branch-reload.jpg`, and `regression-proof/`. The final rerun's
attachments are preserved in `final-regression-proof/`.

## Qualification limits and side effects

- Production auth, deployment, cross-device sync, browser engines other than
  Chromium, sustained load, and an immutable clean release candidate were not
  qualified by this pass. Existing production-readiness tasks remain open.
- The dev harness still reports ResizeObserver loop notifications and an
  existing Vue injection warning during upload. Passing journeys do not imply
  a clean browser console. Injected provider-error cases deliberately log errors.
- Live compaction can reject an invalid model-generated summary and require
  retry; it preserved history during the observed rejection.
- Synthetic test accounts and their data remain for inspection. No account,
  conversation, or attachment was purged. No commit, deployment, version bump,
  or stable-release ceremony was performed.
- The original account was restored. Existing logout behavior clears its
  personal OpenRouter key; its sidebar now shows the configured instance key.
- An unrelated dev process was observed on port 3114. It was not stopped or
  modified by this pass; browser regression generation was isolated instead.

## Code-only review follow-up

The subsequent review found and repaired six additional causes:

- Model search could return no results when optional index creation failed,
  or let an older asynchronous response overwrite a cleared query. Catalogs
  now own their search lifetime, publish completed indexes, invalidate stale
  work and retain capped substring results when indexing is unavailable.
- A held `before_send` hook could submit into a different tab/workspace or
  send text edited after the click. Submission now checks its original owner
  after the hook and uses the captured draft and settings. Later unsent edits
  remain in the composer.
- Copying a reference branch copied only its physically owned rows, losing
  inherited history. Copies now use the visible history projection and remap
  turn and assistant ownership, including nested tool transcripts. Deleted
  rows stay excluded; in-flight copies are rejected transactionally.
- Reused provider tool-call IDs could pair results from another assistant or
  branch, and suppress the correct embedded result. Reconciliation and replay
  now identify results by thread, parent assistant and call ID together.
- Invalid catalog pricing, including the live `-1` sentinel, appeared as a
  negative price or qualified as free. Unknown prices now display `—`, do not
  qualify as free/cost-effective, and sort after known prices.
- The rendered reply became settled at the first streamed content, enabling
  Branch and finalized Markdown parsing while generation continued. Its
  active stream now controls pending status until completion or Stop; Branch
  is disabled for pending rows and while branch creation is in progress.

Meaningful new regressions were written and demonstrated failing before the
corresponding source fixes. They extend existing owner suites. The streaming
regression was also reproduced in the production UI harness after a partial
delta; its final repair keeps Branch disabled until Stop finalizes the row.

The final named Chromium harness passed all 22 selected cases, including
partial-stream Stop, immediate reload, second-tab recovery, tool replay,
retryable errors, model selection, branch navigation, responsive themes and
compaction reload:

```sh
OR3_LOCAL_PROVIDERS=false bun run test:e2e:journeys --grep 'production chat journey|PageShell compaction summary reload'
```

The six directly affected component, search, Dexie, transcript and catalog
suites passed 104 checks. Four adjacent admission/compaction/repository suites
passed another 53 checks with one existing skip. Final SSR type checking,
changed-file ESLint and `git diff --check` passed.

```sh
bunx vitest run app/components/chat/__tests__/ChatContainer.test.ts app/components/chat/__tests__/ChatInputDropper.test.ts app/core/search/__tests__/orama.test.ts app/db/__tests__/compaction-fork-lineage.integration.test.ts app/utils/chat/__tests__/transcript.test.ts app/utils/__tests__/modelCatalog.test.ts --reporter=dot --silent=passed-only
bunx vitest run app/utils/chat/__tests__/history.compaction.integration.test.ts app/composables/chat/__tests__/useAi.context-admission.integration.test.ts app/utils/chat/useAi-internal/__tests__/continue-compaction.integration.test.ts app/utils/chat/__tests__/transcript-repository.test.ts --reporter=dot --silent=passed-only
OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true OR3_LOCAL_PROVIDERS=false bun run type-check
```

Live Chrome at `localhost:3000` also verified GPT-4.1 Mini selection, a saved
synthetic code, text upload, copied history, GPT-4o-mini switching, real
workspace search/read receipts, another copy and reload, and successful
continuation from the saved tool-containing conversation. Both
`REVIEW-AMBER-731` and `REVIEW-FILE-CEDAR-852` survived. Search reopened the
original two-message conversation without the later branch follow-ups.
At 390×844, body and document widths remained 390 px. An additional live
80-line response completed and Branch became available again; a subsequent
send showed Branch disabled during generation and recovered afterward.
The harness supplies the repeatable partial-delta/Stop assertion.

Proof is preserved under
`output/playwright/chat-reliability-2026-10-05/code-review/`:
`mobile-tool-branch-reload.png`, `regression-proof/test-results/`,
`regression-proof/playwright-report/index.html`, and the successful SSR
type-check log/status. The mobile screenshot shows continuation after copying
and reloading the saved conversation.

This follow-up used the already signed-in account and configured instance
key. It did not repeat fresh registration or change auth code. One Chrome
automation connection stalled and was recovered with a fresh test browser
tab. Existing development ResizeObserver warnings still appeared in the
harness; the deliberately injected provider errors also log as expected.
The original selected chat and desktop viewport were restored, and the four
test workspace tabs were closed. One synthetic root, three intentionally
created branches and one synthetic uploaded document remain for inspection.
No commit, deployment or production qualification was performed.
