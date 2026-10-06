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
