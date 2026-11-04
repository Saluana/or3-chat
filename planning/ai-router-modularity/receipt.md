# AI router compatibility receipt

Final handoff for the router boundary: OpenRouter by default, plus a direct OpenAI router as its second-router proof. Not a release: no tag, publish, deployment or production-data change occurred. Evidence paths are under the ignored `output/ai-router-qualification/` directory unless stated.

## Identities

| Item | Value |
| --- | --- |
| Base | `or3-cloud` @ `8febb4aa84c384c97e9455eaddf554c22139face`, independently installed at `/private/tmp/or3-ai-router-baseline-8febb4aa` |
| Candidate | worktree `or3-chat-ai-router`, branch `codex/ai-router-modularity`, same commit plus uncommitted changes; `git diff HEAD` SHA-256 `c0a3d60f…a5597` and 48 untracked files when the final suites began (`final/profile.txt`; later receipt/task edits only) |
| Runtime | Node 24.22.1, Bun 1.3.14, `bun.lock` SHA-256 `fb181d40…4a19` |
| Profile | `tests.yml` Basic Auth + SQLite + filesystem env; no `.env`; `AI_GATEWAY_API_KEY`/OpenRouter keys unset; scripted upstreams and disposable vault/databases only |

Node 26 (the shell default during this session) replaces jsdom's `localStorage` and fails unrelated suites; use Node 24.

## Final checks

Re-run after the walkthrough fixes and the OpenAI adapter, in the same fixed profile (`output/ai-router-qualification/final-openai/`). The earlier pre-OpenAI run is kept in `final/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Type check, server build, `generate:static` | pass (type check repeated after the last edits) | `final-openai/type-check.log`, `build-server.log`, `generate-static.log` |
| `test:full` (non-live) | 761 files, 7,196 passed, 1 skipped; later edits re-covered by their owner suites (2,700+ tests) | `final-openai/test-full.log` |
| Plugin compatibility | 148 passed | `final-openai/test-plugin-compatibility.log` |
| Docs, doc examples, repomix paths | pass | `final-openai/check-*.log` |
| Static secret scan | no secret values, fixture keys, credential resolvers or SQLite module in shipped JavaScript; matches are documentation naming env vars, plus the SDK's own `OPENROUTER_API_KEY` env-name in the catalog chunk (also on base) | `final-openai/summary.txt` |
| Governance, installed package + real vault | 2 passed | `final-openai/e2e-governance.log` |
| Local chat-tool browser suite | 34 passed | `final-openai/e2e-chat-tools.log` |
| Authenticated SQLite tool suite | 10 passed, 9 profile skips | `final-openai/e2e-chat-tools-cloud-sqlite.log` |
| SQLite restart failure profile | 29 fault checks + 3 browser cases | `final-openai/e2e-restarts-sqlite.log` |
| Cross-version recovery, desktop/mobile × light/dark | pass both directions | `final-openai/cross-version.log`, `cross-version-recovery/receipt.json` |
| OpenAI adapter journey (real vault, strict Chat Completions fixture) | pass | `final-openai/e2e-openai-adapter.log`, `openai-adapter-e2e/receipt.json` |
| Production journeys | 126/126 on rerun (the first full run had 125/126: a one-off document slash-menu flake, unrelated to AI code, that then passed 6/6 alone) | `final-openai/e2e-journeys*.log` |
| Context lane | 9/9 (an earlier attempt failed the compaction family case; fixed by the wheel-gesture helper, 6/6 repeats) | `final-openai/e2e-context-rerun.log`, `flaky-repeats.log` |
| Same-host performance (task 6.6) | pass, recorded earlier | `performance-base.log`, `performance-candidate.log` |

## Confirmed fixes (failing first, then passing)

- Model-filter reasoning now follows the filtered model (`characterization.md`).
- Online search is admitted and measured on the exact provider body, client and server (`defects-baseline-replay.log`, `defects-candidate-replay.log`).
- Unsupported router/endpoint/credential fields are refused before dispatch at the stream route and `ai.complete` (`phase5-endpoint-before` history in `characterization.md`; final governance run). Other unknown `ai.complete` fields remain ignored, as on base.
- Continue decodes the legacy `:thinking` hint like Send/Retry/recovery (`continue-selection-before.log`, `continue-selection-after.log`).
- Non-OpenRouter option values no longer crash the presenters (`router-options-before.log`, `router-options-final.log`).

## Follow-up: browser walkthrough and second router

A manual walkthrough in the in-app browser (fixed Cloud profile, scripted upstream, real local vault) covered sign-in, chat streaming with reasoning and usage, model catalog and switching, thinking levels, tools, title generation, the document editor and its agent (outline read, staged edit, review, accept, persistence after reload), projects, saved memories reaching the model, workspace tools, background replies across a reload, stop, provider errors, edit-and-resend and retry.

- Fixed (base defect): workspace document/project chat tools failed with Dexie `PrematureCommitError` / "pending_ops missing from transaction scope", because tool authorization awaited a dynamic `import()` inside the handler's transaction. All 15 workspace journeys now pass (`workspace-journeys.log`), including the two base-reproduced failures.
- Fixed (test defect): the compaction "View original" journey read a hidden chat tab's list and revealed the first message with a programmatic scroll that the list's own anchor jump could override. It now reads the visible chat and scrolls with a wheel gesture, as a reader does (6/6 repeats, `flaky-repeats.log`; context lane 9/9).
- Added: a direct OpenAI router (`@openai/<model>`) behind the same boundary — see `docs/openrouter-integration.md` and the [OpenAI keys reference](../../public/_documentation/auth/reference.md). OpenAI keys never reach OpenRouter: OpenAI chats do not offer delegation/model search and the server refuses both for OpenAI parents. `bun run test:e2e:openai-adapter` passes with a strict Chat Completions fixture (`output/openai-adapter-e2e/receipt.json`).

## Follow-up: fast model, OpenAI Decisions and live runs

One workspace fast model now serves titles, editor autocomplete and project memory on either router, and memory classification uses the fast model's router's Decisions API (task section 8).

Live runs used real provider keys from the worktree `.env` (never printed or written to logs) on November 3, 2026:

| Run | Result |
| --- | --- |
| Memory evaluation, OpenAI (`OR3_EVAL_FAST_MODEL=@openai/gpt-6-luna`) | `gpt-6-luna` 39/40 labels, no false decisions (one adopted decision scored 0.78 and stays a fact); capture smokes 4/4. `planning/project-memory-classification/evaluation-current-openai-results.json` |
| Memory evaluation, OpenRouter (default fast model) | Decider V1.2 and Jev 40/40; capture smokes 4/4 with `deepseek/deepseek-v4.1-flash:nitro`. `evaluation-current-openrouter-results.json` |
| In-browser, OpenAI key only (no OpenRouter key), fast model `@openai/gpt-6-luna` | Chat on `gpt-5.4-mini`, title generated (1.5 s), autocomplete suggestion, document agent edit accepted, saved memory classified `decision` (0.99, 651 ms), automatic capture saved a TypeScript/Bun preference |
| In-browser, both keys, default OpenRouter fast model | Chat on Claude Haiku 5.5 with title, the same chat continued on OpenAI `gpt-5.4-mini`, autocomplete, document agent edit accepted, memory classified `decision` by Decider V1.2 (0.997), automatic capture saved a metric-units rule |

The OpenAI-only run found and fixed two OpenRouter-only gates (composer send and the first-run card); review found a third (Continue). The first-run card now trusts only local signals (a public `openai.hasInstanceKey` flag, this device's key, or OpenAI models in the cached catalog), so it still never fetches the catalog.

Final checks for this follow-up, same fixed profile (`output/ai-router-qualification/final-fast-model/`, rerun in `final-fast-model-rerun/`): type check, docs, doc examples and repomix paths pass; `test:full` 761 files, 7,196 passed, 1 skipped; plugin compatibility pass; production journeys 125/126 on the first run, where the one failure (the first-run card fetched the catalog) was this change's and is fixed: chat journeys 92/92 on rerun and document journeys 34/34; `test:e2e:openai-adapter` pass. After the fix the OpenAI-only app showed no first-run card and made no catalog request.

## Remaining intentional OpenRouter boundaries

OAuth, manual-key UI and the connection descriptor; the trusted `ai.provider()`/workflow server SDK client; the installed Workflows package's own model gateway; delegation and model search (their popover controls are disabled for OpenAI models); the `/api/openrouter/*` route names; saved variant values and `chat-model:*` records; OpenRouter-shaped chat messages and hooks. See `docs/openrouter-integration.md`.

## Unqualified

- Installed Workflows 0.2.1 run/resume: falls back to an ordinary chat on the historical host, base and candidate alike (`workflow-historical-host.log`, `workflow-base.log`, `workflow-candidate.log`); a defect in the Workflows package or its harness, outside this repository.
- 9 skipped authenticated delegation/restart-profile cases in the Cloud tool suite.
- Task 2.3's endpoint case was authored after the runtime factory (chronology deviation).
- Retry/Continue still receive no composer thinking/effort preference — pre-existing product behavior, not changed here.
- Dev-server crashes during the November 3 try-out were pre-existing tooling, not this branch: `bun run type-check` against a checkout whose `bun run dev` is running makes the dev server rebuild its Nitro bundle, and Rollup's sourcemap collapse pushes the Nuxt process past its 4 GB heap (1.1 GB idle → 4.06 GB in 15–21 s, no user activity). Reproduced identically on the base commit; a heap sample attributes ~1.7 of 2.3 GB to `rollup` `linkMap`/`decodedSourcemap`. The trigger is `nuxt typecheck` rewriting the dev server's `.nuxt/tsconfig*.json` and `types/nitro-routes.d.ts` with production-prepare content. Fixed in `scripts/cli/nuxt-task.ts`: with a live `nuxt dev` lock (`.nuxt/nuxt.lock`), type-check runs `vue-tsc -b --noEmit` against the dev server's current types instead of regenerating them. Verified against the running dev server (pass in 42 s, no rebuild, heap peak 1.52 GB; a probe type error still fails), and without a dev server (regenerates as before); `test:scripts` 197 passed.
