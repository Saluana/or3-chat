# AI router compatibility baseline

This is a qualification record, not a claim that the baseline or candidate has passed. Paths are relative to the repository. Test results and missing evidence are recorded below as phases finish.

**Artifact correction:** Playwright cleared the original `test-results/ai-router/` baseline and phase logs during an unrestricted run. Historical references to those paths below describe observations, not retained artifacts. Recreated comparisons and their current logs are under the ignored `output/ai-router-qualification/` directory; see `receipt.md` for the retained evidence and gaps.

## Source and environment

- Source: branch `or3-cloud`, commit `8febb4aa84c384c97e9455eaddf554c22139face` (`[Fix] Route image-output models to foreground streaming`). The source checkout had no tracked or untracked changes when the worktree was created. The saved `online` to provider-web-search migration was already in that commit; it is baseline behavior, not part of this refactor.
- Candidate worktree: `or3-chat-ai-router`, branch `codex/ai-router-modularity`, initially at that same commit. No personal `.env`, workspace database, or shared `node_modules` was copied into it.
- Lock: `bun.lock` SHA-256 `fb181d40361362f73ca8746608a1571cf6d274fe79386e405e872d9b730a4a19`; Bun 1.3.14; Node v24.22.1. A frozen install completed in the worktree with `TMPDIR=/private/tmp` and `--cache-dir=/private/tmp/or3-ai-router-bun-cache`. The default cache was not writable in the sandbox.
- Tests must use disposable fixture credentials and databases and scripted upstream traffic. The inherited environment has an `AI_GATEWAY_API_KEY` variable; qualification commands must remove it, and never print its value. No live inference is authorized or required.
- Reproduce from the source commit in a fresh worktree with its own frozen install and the explicit profiles in the qualification commands. Do not copy ignored developer state or use an existing server.

## Inference and compatibility inventory

The owner column names today's authoritative behavior; the boundary column is the planned destination, not proof of migration. Test owners are existing suites unless marked as a gap.

| Path | Existing owner and contract | Planned boundary | Primary test owner |
| --- | --- | --- | --- |
| Native send, Retry, Continue | `useAi.ts`, `foregroundStream.ts`, `retry.ts`, `continue.ts`, `openrouterStream.ts`; admitted chat, streamed events, tools, usage and canonical writes | Neutral operation over existing request/persistence owners | `production-chat-journey.spec.ts`, `continue-retry.test.ts`, `foregroundStream.test.ts`, `openrouterStream.test.ts` |
| Background admission, status, poll, abort, tool handoff | `openrouterStream.ts` and `backgroundJobs.ts`; host job protocol, idempotency and uncertain outcomes | Host job transport; provider stream separately | `openrouterStream.test.ts`, `chat-tools-cloud.spec.ts`, `backgroundJobs.reattach-notify.test.ts` |
| Server stream and job execution | `server/api/openrouter/stream.post.ts`, `server/utils/background-jobs/stream-handler.ts`; authorized raw SSE, worker tool loop and terminal persistence | Server composition plus provider adapter, keeping route/job owners | `stream.post.test.ts`, `stream-handler.tools.test.ts`, `chat-tools-cloud.spec.ts` |
| Catalog and metadata, including server admission/delegation/title validation | `models-service.ts`, `useModelStore.ts`, `shared/openrouter/sdk-v1-compat.ts`, server `context-admission.ts`, `delegation-prepare.ts`, `admin/title-model.post.ts`; pagination, cache provenance and trusted limits | Adapter catalog mapping; retain current cache and trusted server admission | `sdk-v1-compat.test.ts`, `modelCatalog.test.ts`, `model-context-readiness.test.ts`, `stream.post.test.ts`; cache provenance gaps in phase 2 |
| Document AI and autocomplete | `documentAiAgentLoop.ts`, `EditorAutocomplete/TiptapExtension.ts`; stream, cancellation, editor scope and offline/review behavior | Shared inference; retain editor and workspace ownership | `documentAiAgentLoop.test.ts`, `TiptapExtension.test.ts`, `production-document-journey.spec.ts` |
| Help and compaction | `HelpChat.vue`, `compaction/summary.ts`; current prompts, history, parsing and non-chat semantics | Shared stream; retain operation-specific lifecycle | `summary.integration.test.ts`, `useThreadCompaction.integration.test.ts`, `production-chat-journey.spec.ts`; HelpChat request capture is a gap |
| Automatic titles | `app/utils/titles/generate.ts`, `server/utils/titles/generate.ts`; host route, 48-token request, deadline, fallback and write guards | Shared completion, server-owned credential and unchanged fallback | `server/utils/titles/__tests__/routes.test.ts`, `shared/titles/__tests__/title.test.ts` |
| Governed plugin completion | `server/utils/plugins/ai/{plugin-invocation,openrouter-client}.ts`; permissions, reservations, response bounds, mandatory usage and cost accounting | Existing `PluginAiProvider` port delegates to shared inference | `plugin-invocation.test.ts`, `isolation-capability.post.test.ts` |
| Trusted SDK and installed workflows | `trusted-runtime-services.ts`, `background-jobs/plugin-server-services.ts`; real OpenRouter SDK shape and guarded origin | Explicit OpenRouter-specific compatibility facade; installed workflow package retains its `ModelGateway` | `trusted-host-context.test.ts`, `plugin-server-bridge.test.ts`, `test:plugin-compatibility`; installed workflow journey |
| Project memory classification | `shared/projects/memory-classification.ts`, `api/openrouter/classify-memory.post.ts`; OpenRouter Decisions, origin gate, deadline, validation and unclassified fallback | Optional classifier operation backed by adapter; not chat completion | `stream.post.test.ts` memory admission, project memory suites |
| Automatic project memory | `shared/projects/automatic-memory.ts`; fixed Decisions gate and conditional chat completion, origin gate and idempotent batching | Explicit adapter operations without changing gate, prompts or batch identity | `stream.post.test.ts` automatic-memory cases; request semantics to characterize in phase 2 |
| Credentials, OAuth and connection setup | `useUserApiKey.ts`, `server/secrets/openrouter.ts`, `openrouter-auth.ts`, connection provider; vault, precedence and origin rules | Host-owned authorization; OAuth/connection UI remain OpenRouter-specific | `openrouter.test.ts`, `cloud-credentials.test.ts`, `openrouter-connection.spec.ts` |

The workflow SDK shape, OAuth, model cache key, public OpenRouter routes and saved preference values are intentional compatibility boundaries, not evidence that other routers are implemented.

## Behavior and failure-mode matrix

These scenario IDs identify the evidence to compare. Existing owners listed here have not yet been run in this worktree; phase 2 must add coverage for any missing wire or lifecycle assertion.

| ID | Invariant and current owner | Primary evidence owner / known gap |
| --- | --- | --- |
| B01 | Model identity, favorite/default selection, aliases and `:free` identity remain distinct from `:online`, `:nitro`, `:floor` routing. Off leaves a suffix intact. | `model-variants.test.ts`, `useChatModelSelection.test.ts`; wire/ambiguous `:thinking` gaps |
| B02 | Saved `online` takes current precedence and becomes one `openrouter:web_search` tool; local tools remain separate. | `openrouterStream.test.ts`, `stream.post.test.ts`; follow-up and admission/measurement parity gaps |
| B03 | Reasoning effort restores when switching models; legacy thinking and missing metadata keep their current behavior. | `reasoning-selection.test.ts`, `useChatModelSelection.test.ts`; model-changing hook gap |
| B04 | Before admission, outgoing/model/input/prepare filters execute in order; context or ownership rejection leaves the draft and avoids durable turn writes. | `useAi.context-admission.integration.test.ts`, `production-chat-journey.spec.ts`; hook-order capture gap |
| B05 | After accepted user persistence, composer acknowledgement and assistant creation precede the send-before action and legacy before-send filter; delegation commit acknowledgement remains after these. | `useAi.ts`, `production-chat-journey.spec.ts`; explicit hook/write ordering gap |
| B06 | Foreground SSE, tools, media, reasoning and usage preserve order and terminal persistence; abort and pre-/midstream failure never fabricate success. | `parseOpenRouterSSE.test.ts`, `foregroundStream.test.ts`, `openrouterStream.test.ts`, `chat-tools.spec.ts` |
| B07 | Edit/Retry/Continue and checkpoint recovery retain revision ownership, no duplicate turn, and originating workspace/account. | `continue-retry.test.ts`, `production-chat-journey.spec.ts`; cross-boundary gaps to identify |
| B08 | Background admission uncertainty reuses its identity, never silently falls back to foreground; polling, reattachment, client-tool claims and completion keep durable ownership. | `openrouterStream.test.ts`, `chat-tools-cloud.spec.ts`; SQLite restart profiles are separate |
| B09 | Static/direct mode may use the captured personal key; SSR without a browser key requires the host route. Cloud resolves account/instance credentials server-side, requires origin/workspace permission and never returns secrets. | `openrouter.test.ts`, `cloud-credentials.test.ts`, `stream.post.test.ts`, `openrouter-connection.spec.ts` |
| B10 | Server rechecks trusted capacity and authorized input, keeps route/status/marker and body limits, cancels disconnected upstream; 402 affordability and 429 retries stay operation-specific. | `stream.post.test.ts`, `openrouterStream.test.ts` |
| B11 | Governed plugins retain grants, trusted prices, ceilings, reservations and mandatory measurable usage; trusted SDK and installed workflows retain their actual contracts. | `plugin-invocation.test.ts`, `plugin-server-bridge.test.ts`, `test:plugin-compatibility` |
| B12 | Secondary consumers preserve prompts, model IDs, output bounds, deadlines, fallback and operation-specific writes; Decisions is not treated as chat. | title, document, compaction and memory owners above; exact request-capture gaps in phase 2 |

Source-based hypotheses remain unconfirmed until phase 2 reproduces or dismisses them: model-filter/reasoning mismatch, selection normalization drift, unknown-tool policy, lifecycle ownership coupling, and late search transformation versus admission/usage.

## Phase 1 results

All results below use the source commit above and the candidate worktree's own frozen install. The worktree was dirty only with this planning record and task checkboxes when these runs began. Fixture requests and credentials were synthetic. Logs and browser artifacts were moved from `.qualification/ai-router/baseline` to `test-results/ai-router/baseline`; report fields that embed their original paths predate that relocation.

| Check | Result and evidence |
| --- | --- |
| Focused core/model/request/credential/security tests, `--bail=0`, loopback enabled | **831 passed, 50 failed, 1 skipped**, 29 files. All 50 failures are in `useAi.backgroundDetach.test.ts`; an actual failed result reports `targetDb.isOpen is not a function`, indicating an incomplete fake database before the intended send assertions. `core-loopback.log` has the full list. The default sandbox additionally blocked loopback authorization tests; those passed with loopback enabled. |
| Plugin compatibility | **148 passed**, 28 files; `plugin-compatibility.log`. |
| Foreground tool browser suite and receipt canary | **26 passed**; `test-results/chat-tools/receipt.json` and screenshots, `chat-tools.log`. The receipt correctly records the planning-only dirty worktree. |
| OpenRouter connection browser profile | **4 passed**, including light/dark failures and successful exchange; `connection.json`, `connection-browser`. A prior combined run's three callback failures used the wrong journey profile, which rewrites the upstream base URL; those failures are profile errors, not connection regressions. |
| Selected production chat/document journeys | **16 passed, 5 failed**; three failures are the callback profile mismatch above. The context-meter tool increment and chat deletion after a failed stream also failed. `journeys.json`, `journeys-browser`, `journeys-isolated.log`. |
| Context browser lane | **7 passed, 2 failed**; the same meter case and history/family tool execution (`get_message` was disabled). `context/playwright-report.json`, `context/browser`, `context.log`. The fixtures appear to predate per-chat tool preferences; verify rather than assume this is solely a fixture problem. |
| Authenticated Cloud tools, SQLite jobs | **6 passed, 3 failed, 9 skipped**. Both browser journal reconnect cases and delayed registration did not execute the expected tool; the test page registers a tool but does not enable the thread's current tool preference. The nine delegation/restart cases require separate explicit draft/restart profiles. `test-results/ai-router/baseline/cloud-run/results.json`, `test-results/ai-router/baseline/cloud-run/browser`, `chat-tools-cloud-escalated.log`. |

The first local-journey launch was interrupted before tests because the dev launcher began building sibling provider packages. Those generated build outputs may have been refreshed in sibling directories; their tracked source status remained unchanged. All subsequent browser commands explicitly set `OR3_LOCAL_PROVIDERS=false` and `OR3_USE_LOCAL_PACKAGES=false`.

Gate A is **not passing**. The test-fixture hypotheses and unexplained deletion failure remain open, and the skipped Cloud profiles are not evidence of success. Phase 2 must repair or characterize the relevant fixtures and retain the original results before production extraction.
