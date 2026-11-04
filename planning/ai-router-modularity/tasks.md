# Tasks

Checkboxes record acceptance conditions actually completed; unchecked items remain unqualified. Execute in dependency order; no production adapter beyond OpenRouter is included. Component IDs refer to `design.md`; requirement IDs refer to `requirements.md`.

Each item is intended to take roughly 1–4 hours of focused engineering work. If a task exposes a larger problem, split it before proceeding rather than widening the change. The aggregate planning allowance is roughly 3–5 engineer-weeks, including characterization, extraction, and qualification; revise after section 2. This is broader than just introducing a router interface.

## 1. Establish the source and compatibility baseline

- [x] 1.1 Capture the intended source snapshot without disturbing user changes. (1–2h)
      Components: C10.
      Requirements: R11.AC3, R12.AC1, R12.AC3.
      Done when: branch/commit, relevant dirty diff identity, lockfile/runtime versions and all pre-existing/concurrently modified paths are recorded, including the settled Online/search migration; a disposable baseline can be reproduced without personal `.env`, credentials or databases.
- [x] 1.2 Finish the inference, catalog and compatibility import inventory. (2–3h)
      Components: C5, C6, C9, C10.
      Requirements: R2.AC1, R7.AC2, R7.AC3, R9.AC1–R9.AC3, R11.AC2.
      Done when: every native/secondary/SDK/Decisions/workflow call has an owner, future boundary, contract, and test owner; explicit OpenRouter exceptions are distinguished from inference bypasses.
- [x] 1.3 Record public behavior and failure-mode ownership. (2–3h)
      Components: C1–C10.
      Requirements: R1.AC1–R1.AC4, R3.AC1–R3.AC6, R4.AC1–R4.AC5, R5.AC1–R5.AC5, R6.AC1–R6.AC4, R12.AC1.
      Done when: the compatibility matrix has concrete scenario IDs, captured hook/persistence ordering, current mode/credential policies, and a primary test owner per invariant; missing coverage is explicit.
- [x] 1.4 Run the focused existing core/protocol/security baseline. (2–4h)
      Components: C6, C8, C9, C10.
      Requirements: R2.AC2, R6.AC1–R6.AC4, R7.AC2, R8.AC1–R8.AC4, R12.AC1, R12.AC3.
      Done when: existing model/variant/transport/request/persistence/credential/plugin suites have source-identified results; failures are reproduced or recorded as unresolved, not silently excluded.
- [x] 1.5 Run the browser and authenticated Cloud baseline. (2–4h)
      Components: C1, C3, C4, C8, C10.
      Requirements: R1.AC1–R1.AC4, R4.AC3, R5.AC1–R5.AC5, R7.AC1, R12.AC1–R12.AC3.
      Done when: relevant journey/context/tool/connection cases run with scripted upstream traffic, Cloud persistence uses the SQLite profile, and receipts identify executed versus skipped scenarios.

Gate A: source and behavior are identified. An unknown or failing baseline cannot be described as a passing compatibility gate.

## 2. Add missing characterization before production changes

- [x] 2.1 Extend the model/variant cases at their existing boundaries. (3–4h)
      Components: C6, C7, C10.
      Requirements: R3.AC1–R3.AC6, R4.AC4, R11.AC1.
      Done when: Off/Web search/Nitro/Floor, saved `online` precedence and exactly-once final search-tool injection, already-suffixed Off, free identities, thinking ambiguity, effort restoration, aliases, missing metadata and cache provenance have independent expected outcomes and upstream request assertions.
- [x] 2.2 Extend lifecycle E2E gaps in the canonical journey/tool harnesses. (3–4h)
      Components: C1–C4, C10.
      Requirements: R1.AC1–R1.AC4, R4.AC1–R4.AC3, R5.AC1–R5.AC5, R6.AC2, R6.AC3.
      Done when: missing admission/draft, cancellation, edit/Retry/Continue, owner-switch, hook-order and uncertain-outcome cases produce durable receipts; existing stronger cases are reused rather than duplicated.
- [x] 2.3 Extend security and governed-completion gaps before factory changes. (2–4h)
      Components: C8–C10.
      Requirements: R2.AC4, R7.AC2, R8.AC1–R8.AC4.
      Done when: personal/instance precedence, revoked origin, account switch, browser non-disclosure, unknown endpoint rejection, plugin spend/output limits and missing-usage refusal are exercised at real authorization/HTTP boundaries.
      Qualification: the conditions are exercised — personal/instance precedence, forged headers and browser non-disclosure (`governance-precedence-final.log`, also passing on the frozen base); unknown endpoint/router refusal, output and spend limits, missing-usage refusal and activation revocation (`governance-completion-final.log`); revoked workspace origin (`chat-tools-cloud.spec.ts` revoked-origin receipt); account-scoped credential lookup (`server/secrets/__tests__/openrouter.test.ts`) plus the client account-switch lifecycle suites. **Chronology deviation:** the endpoint/router case was authored after the runtime factory, not before it (see `characterization.md`); the later failing-first replay is the evidence, not pre-factory characterization.
- [x] 2.4 Characterize secondary consumer request semantics. (2–4h)
      Components: C5, C6, C9, C10.
      Requirements: R7.AC3, R9.AC1–R9.AC3, R11.AC2.
      Done when: existing document/autocomplete/title/HelpChat/compaction/Decisions/workflow owners record prompts, model identities, output bounds, timeout/retry differences and fallback behavior; only genuine gaps receive new cases.
- [x] 2.5 Specify neutral adapter conformance as a failing-first contract. (2–3h)
      Components: C5, C6, C10.
      Requirements: R2.AC1–R2.AC4, R3.AC2, R3.AC5, R3.AC6.
      Done when: a deterministic nonshipping fixture defines opaque colon-bearing model IDs, a non-OpenRouter response format, unsupported options and normalized events through the proposed production constructor; it requires no production test-only global/flag.
- [x] 2.6 Reproduce or dismiss the source-based defect hypotheses. (2–4h)
      Components: C2, C6, C7, C10.
      Requirements: R3.AC3, R3.AC4, R4.AC2, R10.AC4, R12.AC3.
      Done when: model-changing hooks/old reasoning metadata, normalization drift, unknown tools policy, ownership coupling and late search-transform admission/measurement each have a concrete disposition; claims are labeled confirmed, intentional, or unresolved with evidence.
- [x] 2.7 Resolve one confirmed touched-path blocker or record that none requires repair. (1–4h)
      Components: the owning C1–C9 component, C10.
      Requirements: R1.AC4, R10.AC4, R12.AC3.
      Done when: the selected blocker has a pre-fix failing regression, a narrowly scoped repair and passing result in a separate change, or no repair is required. Add separate 1–4h tasks for any additional confirmed blockers before Gate B and refresh the baseline. Larger behavioral changes are scoped separately and do not disappear into extraction.
- [x] 2.7a Repair confirmed Online admission and usage-provenance drift. (1–4h)
      Components: C2, C6, C8, C10.
      Done when: failing-first direct/server regressions pass, the provider projection is used for client/server admission and measurement, and the legacy host envelope remains available for server-side tool authorization.
- [x] 2.7b Refuse unsupported router and endpoint overrides before dispatch. (1–4h)
      Components: C8, C9, C10.
      Done when: the real plugin and chat HTTP boundaries reject unrecognized router/endpoint inputs without inference, while documented OpenRouter and plugin calls retain their existing behavior.

Gate B: necessary tests exist before implementation, deliberate behavior corrections have explicit evidence, and estimate/scope are updated. Preserve passing existing behavior even if a newer upstream API offers an alternative.

## 3. Introduce the neutral boundary and qualify OpenRouter

- [x] 3.1 Define the minimal neutral operation/message/event types. (2–3h)
      Components: C5, C6, C9.
      Requirements: R2.AC1, R2.AC2, R10.AC3, R11.AC2.
      Done when: shared types import no vendor SDK or runtime-specific state; existing reusable event/message definitions have one owner with compatible old imports; unused abstractions are absent.
      Qualification: neutral completion and foreground stream requests now reach real consumers; complete native chat preparation and background selection still have OpenRouter-specific compatibility boundaries and remain subject to 6.2–6.5.
- [x] 3.2 Implement the OpenRouter selection/metadata resolver and legacy decoder. (3–4h)
      Components: C6, C7, C9.
      Requirements: R3.AC1–R3.AC4, R4.AC4, R11.AC1.
      Done when: request/catalog/legacy identities are distinct, characterized precedence is retained, and the existing model/variant contract cases pass without client/server duplicate parsers.
- [x] 3.3 Add capability/option descriptors and the unchanged OpenRouter presenter. (2–4h)
      Components: C6, C7, C1.
      Requirements: R1.AC1, R3.AC1, R3.AC4–R3.AC6.
      Done when: existing menu labels/order and reasoning behavior are reproduced, unknown facts remain explicit, unsupported fixture options fail before dispatch, and no new controls or combinations are enabled.
- [x] 3.4 Route catalog discovery through the adapter while retaining one cache owner. (2–4h)
      Components: C5–C7, C9.
      Requirements: R2.AC1, R4.AC4, R9.AC1, R11.AC1, R11.AC2.
      Done when: SDK pagination/mapping is adapter-owned, old catalog consumers see compatible fields, and provenance, TTL, stale fallback, forced refresh and delayed-hydration tests pass without new cache storage.
- [x] 3.5 Extract provider request encoding and complete-body admission integration. (3–4h)
      Components: C2, C5, C6, C8.
      Requirements: R2.AC2, R3.AC1–R3.AC4, R4.AC2, R4.AC5, R6.AC4.
      Done when: the encoded body admitted is the body dispatched, routing/search/reasoning/cache/media fields and admission/measurement inputs match the qualified baseline, server revalidation remains authoritative, and no secret/DB handle enters the prepared request.
- [x] 3.6 Adapt streaming and nonstreaming response decoding. (3–4h)
      Components: C5, C6, C9.
      Requirements: R2.AC1–R2.AC3, R6.AC2, R6.AC4, R7.AC4, R9.AC1.
      Done when: existing SSE parsing and completion parsing feed neutral results, raw SSE compatibility remains possible without double consumption, provider search remains separate from OR3 tool receipts, and fragmented/tool/image/reasoning/usage fixtures pass.
- [x] 3.7 Preserve provider errors and operation-specific retry/deadline policy. (2–4h)
      Components: C5, C6, C8.
      Requirements: R6.AC1–R6.AC4, R7.AC2, R8.AC4.
      Done when: 402, 429, context errors, pre-/midstream failures, cancellation and SDK retry guards match the baseline; titles, plugin completions and Decisions do not inherit new retries.
- [x] 3.8 Compose client/server runtimes around existing credential and access owners. (3–4h)
      Components: C5, C8, C9.
      Requirements: R2.AC4, R6.AC1, R8.AC1–R8.AC4, R11.AC2.
      Done when: production composition selects only OpenRouter, server secrets remain in request-scoped closures, static/direct and Cloud proxy paths retain their rules, and credential/authorization cases pass.
- [x] 3.9 Finish neutral conformance and delegate existing provider exports. (2–3h)
      Components: C5, C6, C9, C10.
      Requirements: R1.AC4, R2.AC1–R2.AC4, R3.AC2, R3.AC5, R11.AC2.
      Done when: both OpenRouter compatibility fixtures and the nonshipping opaque-ID adapter exercise the same constructor; old entry points delegate to one implementation with no runtime A/B path.

Gate C: OpenRouter request/event behavior is qualified through the new boundary before dismantling the large chat coordinator.

## 4. Extract chat responsibilities in small reversible changes

- [x] 4.1 Extract view/history projection ownership. (3–4h)
      Components: C1, C10.
      Requirements: R1.AC1, R1.AC2, R5.AC2, R5.AC5, R10.AC1–R10.AC3.
      Done when: current thread/pane state, canonical refresh, tail projection, edits and subscriptions have one owner and UI/navigation/draft receipts remain unchanged.
- [x] 4.2 Extract background attachment and reattachment coordination. (3–4h)
      Components: C4, C1, C10.
      Requirements: R5.AC1, R5.AC2, R5.AC4, R5.AC5, R10.AC1–R10.AC3.
      Done when: the view subscribes to existing trackers rather than owning tracker state; reconnect, detach, account switch and completion notifications pass existing scenarios.
- [x] 4.3 Extract native checkpoint recovery. (3–4h)
      Components: C3, C10.
      Requirements: R4.AC3, R5.AC1–R5.AC4, R11.AC1, R11.AC3.
      Done when: checkpoint capture/validation/cleanup and safe Retry re-entry retain the existing schema, fingerprint inputs, ownership and no-duplicate-turn behavior across reload and rollback.
- [x] 4.4 Extract turn preparation and hook sequencing. (3–4h)
      Components: C2, C6, C7, C10.
      Requirements: R1.AC3, R3.AC3, R3.AC4, R4.AC1–R4.AC5, R10.AC1, R10.AC3.
      Done when: captured inputs, model/hook resolution, history/media/project hydration and admission leave the facade, while hook order, draft retention, context and lossy-review receipts match the baseline.
- [x] 4.5 Extract durable acceptance and workflow delegation handoff. (3–4h)
      Components: C3, C9, C10.
      Requirements: R1.AC2–R1.AC4, R4.AC3, R5.AC1, R7.AC3, R10.AC1, R10.AC2.
      Done when: user persistence/composer clearing, assistant generation, post-write hooks, commit acknowledgement and workflow detach retain the current order and outcome.
- [x] 4.6 Extract native execution dispatch. (3–4h)
      Components: C3, C5, C10.
      Requirements: R4.AC2, R5.AC1–R5.AC5, R6.AC2, R6.AC3, R7.AC1, R10.AC1–R10.AC3.
      Done when: foreground/background choice and execution orchestration leave `useAi.ts`, but current request controller, tool loop and finalization remain authoritative and cancellation/recovery cases pass.
- [x] 4.7 Connect Retry/Continue to shared selection/preparation where semantics match. (3–4h)
      Components: C2, C3, C6, C10.
      Requirements: R3.AC3, R3.AC4, R4.AC1, R4.AC2, R5.AC3, R10.AC2, R10.AC3.
      Done when: suffix/capability drift is eliminated at the provider boundary while separate revision claims/history rules remain; retries/continuations preserve reasoning, tools, media, usage and origin ownership.
      Qualification: Retry and recovery already entered the shared send/recovery selection. Continue was the remaining raw path: a legacy `:thinking` override reached OpenRouter unchanged and without reasoning (`continue-selection-before.log`). It now uses `resolveOpenRouterLegacySelection`, resolves reasoning from the filtered model's catalog facts and checks image input on the decoded request model; its revision claim, prompt and history rules are unchanged (`continue-selection-after.log`, 44 passed). Retry and Continue still receive no composer thinking/effort preference from `ChatContainer`; that predates this plan and is a product decision, not drift.
- [x] 4.8 Reduce the facade to composition and public projections. (2–3h)
      Components: C1–C4, C10.
      Requirements: R1.AC2, R5.AC5, R10.AC1–R10.AC4.
      Done when: the original public return surface is compatible, no inline native pipeline or reconciliation loop remains, dependencies are focused, and no new giant context object or duplicate loading/finalization authority has appeared.

Gate D: main chat behavior matches the baseline after each ownership extraction; a large diff without matching receipts is not ready to integrate.

## 5. Complete server and secondary-consumer cutover

- [x] 5.1 Separate host job HTTP operations from provider streaming. (3–4h)
      Components: C4, C8, C9.
      Requirements: R2.AC2, R5.AC4, R6.AC1, R6.AC3, R7.AC1, R11.AC2.
      Done when: admission/status/polling/abort/handoff have a host transport owner, old exports delegate, and uncertain admission retains idempotency rather than falling back to foreground.
- [x] 5.2 Delegate existing server routes and trusted context admission. (3–4h)
      Components: C5, C6, C8, C9.
      Requirements: R2.AC4, R4.AC5, R6.AC1–R6.AC4, R8.AC1–R8.AC4, R11.AC2.
      Done when: URLs, envelopes, markers, status codes, byte limits, raw SSE and upstream disconnect cancellation remain unchanged; no client-declared capacity or endpoint becomes authoritative.
- [x] 5.3 Cut over server workers and delegation model resolution. (3–4h)
      Components: C3, C5, C6, C8.
      Requirements: R3.AC3, R4.AC5, R5.AC4, R6.AC3, R7.AC1, R9.AC1.
      Done when: worker streaming/tool loops and delegated catalog access use the adapter while leases, unknown outcomes, tool receipts and canonical terminal writes survive SQLite restart/handoff cases.
- [x] 5.4 Cut over document AI and autocomplete. (2–4h)
      Components: C5, C6, C9.
      Requirements: R4.AC1, R6.AC2, R9.AC1, R11.AC2.
      Done when: current prompts/models, cancellation, offline behavior, workspace ownership and non-chat save/review semantics are unchanged in their canonical tests/journeys.
- [x] 5.5 Cut over titles, HelpChat, compaction and title-model catalog validation. (3–4h)
      Components: C5–C7, C9.
      Requirements: R4.AC2–R4.AC4, R6.AC2, R9.AC1, R11.AC1.
      Done when: prompt bytes, output allowances, timeout/retry differences, compaction history/JSON validation and title fallback stay unchanged; no direct native inference bypass remains in these consumers.
- [x] 5.6 Connect governed plugin completion through its existing provider port. (3–4h)
      Components: C5, C8, C9.
      Requirements: R7.AC2, R8.AC3, R9.AC1, R11.AC2.
      Done when: `PluginAiProvider` delegates inference while model/price validation, response ceiling, missing-usage refusal, spend reservation/settlement, grants and public RPC results stay intact.
- [ ] 5.7 Preserve trusted SDK access and installed workflow compatibility. (2–4h)
      Components: C6, C8, C9.
      Requirements: R1.AC3, R7.AC2, R7.AC3, R8.AC3, R9.AC3, R11.AC2.
      Done when: adapter-owned client creation retains the supported actual SDK shape and request guards, installed workflows run/resume, and the compatibility inventory explains the remaining package-owned OpenRouter coupling without claiming universal workflow portability.
      Status: SDK shape and guards are qualified — browser `ai.provider()` and the workflow server port both build the real client through `shared/openrouter/client.ts` (unchanged by this branch; `trusted-sdk-final.log`, 29 passed), and `docs/openrouter-integration.md` lists the package-owned coupling. **Open:** the installed Workflows 0.2.1 no-model run falls back to an ordinary chat at the same step on the unchanged base and the candidate (`workflow-base.log`, `workflow-candidate.log`), so installed run/resume is not qualified. That is a pre-existing host/package incompatibility owned by the Workflows package, outside this refactor.
      Follow-up: Workflows 0.2.1 also falls back to an ordinary chat on the historical host (`workflow-historical-host.log`), so the defect is in the package or its harness, not in this host or refactor. Open until the Workflows package is fixed.
- [x] 5.8 Isolate OpenRouter Decisions behind the existing optional classifier operation. (2–3h)
      Components: C5, C6, C9.
      Requirements: R4.AC1, R8.AC3, R9.AC2, R9.AC3.
      Done when: domain memory classification no longer constructs a vendor SDK client and the origin gate, deadline, validated classifications, cost handling and unclassified-fact fallback match the baseline.

Gate E: every inventoried AI consumer is migrated or is an explicitly supported OpenRouter compatibility boundary with a test owner. No generic raw-client replacement is fabricated to satisfy an import count.

## 6. Simplify, document and qualify the integrated result

- [x] 6.1 Update public and source documentation. (2–3h)
      Components: C9, C10.
      Requirements: R2.AC1, R7.AC3, R9.AC3, R12.AC5.
      Done when: `public/_documentation/docmap.json`, chat lifecycle, model service, message builder, stream/auth/plugin guides, source map and `docs/openrouter-integration.md` describe actual owners; affected integration/provider READMEs are updated where their contract changed, without advertising additional routers.
- [x] 6.2 Perform the responsibility and simplification review. (2–3h)
      Components: C1–C10.
      Requirements: R2.AC1, R2.AC2, R9.AC3, R10.AC1–R10.AC4, R11.AC2.
      Done when: duplicate implementations/parsers/state and unused contracts are removed; remaining compatibility facades are justified; no speculative cache, registry, dependency, flag or migration was introduced; every final diff is inspected.
      Status: review pass recorded 8 findings. Fixed: `ai.complete` once again ignores unknown fields and refuses only router/endpoint/credential overrides (shared `hasRouterConfiguration` with the stream route); Continue's catalog port matches canonical slugs like send; `turnAcceptance.ts` extraction leftovers removed (`review-fixes.log`, 235 passed on Node 24.22.1). Deliberately left: the three server `createAiRuntime(...).openPrepared` sites (pure indirection), test-fixture-only presenter option props, the input-mutating `admitServerProviderBody`, and repeated `encodeOpenRouterRequest` call sites (a single host/provider body owner would remove the repeats). No new cache, registry, dependency, flag or migration was found. **Open:** every modified production diff was read, but the moved bodies of the large extracted owners (`backgroundAttachment`, `nativeExecution`, `turnDispatch`, `turnPreparation`) were only spot-checked against the base (dispose, history sync, acceptance), not compared line by line.
      Line-by-line (follow-up): every line of base `useAi.ts`, `openrouterStream.ts`, `continue.ts` and `foregroundStream.ts` was matched against the new owners with a whitespace- and port-prefix-normalized line diff; the unmatched lines are renames into ports or the confirmed fixes. The skipped encode/runtime findings are now fixed: the six provider-body call sites use `encodeProviderRequest` (`shared/ai/provider-body.ts`) and the server stream/worker sites call `openChatUpstream` (`server/utils/ai/chat-router.ts`) instead of building a runtime to call their own fetch. Still skipped, with reasons above: presenter option props used by fixtures, `admitServerProviderBody` returning its mutated host body.
- [x] 6.3 Run the final deterministic browser compatibility matrix. (3–4h)
      Components: C1–C7, C10.
      Requirements: R1.AC1–R1.AC4, R3.AC1–R3.AC6, R4.AC1–R4.AC4, R5.AC1–R5.AC5, R9.AC1, R11.AC1, R11.AC3, R12.AC2–R12.AC4.
      Done when: baseline/candidate request/event/row comparisons and desktop/mobile light/dark settings/chat screenshots show no unexplained differences; required cases are executed and artifacts are replayable.
      Qualification (`output/ai-router-qualification/final/`, after the review fixes): cross-version recovery passes in both directions with desktop/mobile light/dark chat and settings screenshots (`cross-version.log`, `../cross-version-recovery/receipt.json`); local chat tools **34 passed**; journeys **123/126**; context **8/9**. All four failures reproduce on the unchanged base — the compaction-family "View original" poll at `production-chat-journey.spec.ts:1450` (`baseline-compaction-repeat.log`) and the two workspace document-creation cases (`workspace-create-baseline.log`). Those three scenarios stay unqualified on both versions; no difference between base and candidate is unexplained.
- [ ] 6.4 Run final Cloud security, durability and installed-integration qualification. (3–4h)
      Components: C3–C10.
      Requirements: R4.AC5, R5.AC4, R6.AC1–R6.AC4, R7.AC1–R7.AC4, R8.AC1–R8.AC4, R9.AC2, R9.AC3, R12.AC2–R12.AC4.
      Done when: disposable SQLite job recovery, browser handoff, origin revocation, credential/billing policy, plugin governance and installed workflows pass their actual supported profiles; vault tests run where changed composition requires them.
      Status: passing — governance with the real disposable vault and installed package (**2 passed**: governed completion, endpoint/router refusal, limits, missing usage, revocation, personal/instance precedence, non-disclosure); authenticated SQLite tool suite (**10 passed**, 9 profile-specific skips not counted); SQLite restart failure profile (**29 fault checks, 3 browser cases**; active-job receipt shows 1 tool execution, 2 model requests, preserved history and reauthentication across a new boot). **Open:** installed Workflows run/resume (see 5.7, fails identically on base) and the 9 skipped Cloud delegation/restart-profile cases.
      Follow-up: unchanged — only the installed Workflows run/resume (package defect, also on the historical host) and the 9 profile skips remain.
- [x] 6.5 Run the final relevant suites, type check and static/server builds. (3–4h)
      Components: C5, C6, C8–C10.
      Requirements: R2.AC1, R2.AC4, R8.AC3, R11.AC2, R12.AC4, R12.AC5.
      Done when: the design's final commands and inventoried owner suites pass in recorded fixed profiles; static output excludes server secrets/imports; full type check and doc/source-map checks are green; no passing claim relies on developer `.env` or an unverified server.
      Qualification: `output/ai-router-qualification/final/` (profile `tests.yml` Basic Auth + SQLite + filesystem, no `.env`, Node 24.22.1, Bun 1.3.14, recorded in `profile.txt`): type check, `test:full` (761 files, **7,196 passed, 1 skipped**; it includes the integration and chat-tools owner files), plugin compatibility, `check:docs`, `check:docs:examples`, `check:repomix-paths`, server build and `generate:static` all exit 0. Static scan of shipped JS/HTML/JSON finds no key values, fixture secrets, credential resolver or SQLite module; the only hit is the OpenRouter SDK's own `OPENROUTER_API_KEY` environment-variable name in the browser catalog chunk, which the base already imports. Node 26 (the shell default at the time) breaks jsdom `localStorage`; runs must use the recorded Node 24.
- [x] 6.6 Compare performance and side-effect counts on the same host. (2–3h)
      Components: C1, C3, C5, C10.
      Requirements: R1.AC4, R6.AC3, R10.AC4, R12.AC4.
      Done when: existing performance budgets pass and candidate/base streaming/UI/request-count evidence shows no unexplained regression; failing budgets are investigated, not waived or hidden with timeouts.
- [x] 6.7 Produce the final compatibility receipt and reviewable handoff. (1–2h)
      Components: C9, C10.
      Requirements: R1.AC4, R9.AC3, R10.AC4, R11.AC1–R11.AC3, R12.AC1–R12.AC5.
      Done when: the receipt links baseline/candidate identities, checks, profile configuration, fixtures, screenshots/traces, request/event/storage comparisons, confirmed fixes, remaining intentional OpenRouter boundaries, and rollback-readability results. Any missing proof remains explicitly unqualified. No release or deployment occurs as part of this plan.
      Receipt: `receipt.md`.

## 7. Prove the boundary with a second router: direct OpenAI

- [x] 7.1 Fix the walkthrough defects found in the browser. Workspace document/project tools failed inside their own Dexie transaction because tool authorization awaited a dynamic `import()` (base defect; `PrematureCommitError` / "pending_ops missing from transaction scope"). The import now loads before the handler runs; the two failing workspace journeys and all 15 workspace journeys pass. The compaction "View original" journey read a hidden tab's message list with a programmatic scroll the list's anchor jump could override; its helper now reads the visible chat and scrolls with a wheel gesture (6/6 repeats; context lane 9/9).
- [x] 7.2 Add the OpenAI router behind the existing boundary: `@openai/<model>` IDs, catalog mapping and capacity table (`shared/openai/models.ts`), the Chat Completions wire projection (`shared/openai/adapter.ts`), per-router credential/endpoint dispatch on the server (`server/utils/ai/chat-router.ts`, `server/secrets/openai.ts`), `/api/openai/{credentials,models}`, the AI Settings key section, catalog merge, and router-aware error copy. OpenRouter requests are unchanged.
- [x] 7.3 Keep credentials on their router: OpenAI chats never offer delegation or model search, and the server refuses both for OpenAI parents, so an OpenAI key never reaches OpenRouter. Plugin completions stay on OpenRouter; titles and memory moved to the fast model in section 8.
- [x] 7.4 Qualify with a repeatable E2E (`bun run test:e2e:openai-adapter`): real local vault, fixed Cloud profile, a strict Chat Completions fixture; personal key save/remove, OpenAI chat with exact wire keys and tools, OpenRouter in the same chat with the instance key, `ERR_AUTH` without a key. Receipt: `output/openai-adapter-e2e/receipt.json`.

## 8. Swappable providers: one fast model and OpenAI Decisions

- [x] 8.1 One **Fast Model** setting (Dashboard → AI Settings, `shared/ai/fast-model.ts`) names chats and documents, drives editor autocomplete and extracts project memories, on either router. It is stored under the existing `ai.title_generation_model` / `titleGenerationModel` keys so saved title models carry over and the plugin-facing `AiSettingsV1` shape is unchanged. Saving validates against that router's catalog; OpenAI IDs take no routing variant.
- [x] 8.2 Project memory follows the fast model's router: OpenRouter Decisions (`perplexity/pplx-decider-v1.2`) or OpenAI Decisions (`POST /v1/decisions`, `gpt-6-luna`, `shared/openai/decisions.ts`) for the classification and capture gate, then the fast model for extraction. Local installs infer OpenRouter in the browser with the device key; their OpenAI inference goes through the memory route with the device key (never the instance key), so it reaches `OR3_OPENAI_BASE_URL`.
- [x] 8.3 Remove OpenRouter-only gates found in a live OpenAI-only run: the composer refused to send without an OpenRouter key and the first-run card demanded an OpenRouter connection. Both now accept a working OpenAI key. OpenAI reasoning efforts map to what each model family accepts (`gpt-5.1+`: none…xhigh, `gpt-5`: minimal…high, o-series: low…high).
- [x] 8.4 Live qualification with real keys (no scripted upstream): the memory evaluation on both Decisions APIs and an in-browser run of chat, titles, autocomplete, the document agent, explicit memory classification and automatic capture, first with only an OpenAI key and then with both keys and the OpenRouter fast model. The repeatable `test:e2e:openai-adapter` now also covers the OpenAI fast model, titles and Decisions. See the receipt.
- [x] 8.5 Plugin `ai.complete` routes allowlisted `@openai/` models to the OpenAI router with its host key and base URL; the allowlist and price parsers accept `@openai/` IDs, and the OpenAI key is resolved only when the allowlist names an OpenAI model. Prices stay the operator's table for both routers.
- [x] 8.6 The chat settings popover keeps OpenRouter's model variants and the delegation/model search tools visible but disabled for OpenAI models ("OpenRouter only" / "Available with OpenRouter models"), keeping their saved choice.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 — Product/public parity | C1–C4, C9, C10 | 1.3, 1.5, 2.2, 2.7, 3.3, 3.9, 4.1, 4.4, 4.5, 4.8, 5.7, 6.3, 6.6, 6.7 |
| R2 — Router modularity | C5–C8, C10 | 1.2, 1.4, 2.3, 2.5, 3.1, 3.4–3.9, 5.1, 5.2, 6.1, 6.2, 6.5 |
| R3 — Models/options | C2, C6, C7, C10 | 1.3, 2.1, 2.5, 2.6, 3.2, 3.3, 3.5, 3.9, 4.4, 4.7, 5.3, 6.3 |
| R4 — Preparation/admission | C2, C3, C6–C8, C10 | 1.3, 1.5, 2.1, 2.2, 2.6, 3.2, 3.4, 3.5, 4.3–4.7, 5.2–5.5, 5.8, 6.3, 6.4 |
| R5 — Durable lifecycle | C1, C3, C4, C8, C10 | 1.3, 1.5, 2.2, 4.1–4.3, 4.5–4.8, 5.1, 5.3, 6.3, 6.4 |
| R6 — Transport parity | C3–C6, C8, C10 | 1.3–1.5, 2.2, 3.5–3.8, 4.6, 5.1–5.5, 6.4, 6.6 |
| R7 — Tools/extensions | C3, C8–C10 | 1.2, 1.4, 1.5, 2.3, 2.4, 3.6, 3.7, 4.5, 4.6, 5.1, 5.3, 5.6, 5.7, 6.1, 6.4 |
| R8 — Auth/secrets | C8–C10 | 1.4, 2.3, 3.7, 3.8, 5.2, 5.6–5.8, 6.4, 6.5 |
| R9 — All consumers | C5, C6, C9, C10 | 1.2, 2.4, 3.4, 3.6, 5.3–5.8, 6.1, 6.2, 6.3, 6.4, 6.7 |
| R10 — Maintainability | C1–C5, C10 | 2.6, 2.7, 3.1, 4.1, 4.2, 4.4–4.8, 6.2, 6.6, 6.7 |
| R11 — Data/API compatibility | C7–C10 | 1.1, 1.2, 2.1, 2.4, 3.1, 3.2, 3.4, 3.8, 3.9, 4.3, 5.1, 5.2, 5.4–5.7, 6.2, 6.3, 6.5, 6.7 |
| R12 — Evidence/docs | C10 | 1.1, 1.3–1.5, 2.6, 2.7, 6.1, 6.3–6.7 |

## Definition of Done

- All R1–R12 acceptance criteria have passing evidence and the traceability matrix has no gaps.
- OpenRouter is the only production router and the existing UI, stored data, routes, credentials, hook/SDK behavior and billing policies remain compatible.
- Core AI operations use the neutral boundary; a nonshipping adapter proves IDs/protocols are not assumed to be OpenRouter. Explicit SDK/workflow compatibility exceptions are documented and tested.
- `useAi.ts` is a composition facade. Request, persistence, tracking, tools and authorization each retain one authoritative owner; no large generic context bag or second execution engine was introduced.
- Model identity, routing, search and reasoning are separated internally without changing qualified routing/search requests or exposing new features.
- Relevant regression suites, deterministic browser/Cloud scenarios, full type check, static/server builds, documentation checks and proportionate performance comparison pass with repeatable artifacts.
- Suspected bugs are not presented as confirmed; confirmed fixes are independently reproduced and reviewed. Missing or failed checks block a complete qualification claim.
- Public documentation, docmap and relevant READMEs reflect the actual supported boundaries.
- Final diffs are inspected, unrelated work remains untouched, and no release, deployment or production-data mutation has occurred.
