# Tasks

This is an implementation plan, not a record of completed implementation. All checkboxes start unchecked. Execute in dependency order; no production adapter beyond OpenRouter is included. Component IDs refer to `design.md`; requirement IDs refer to `requirements.md`.

Each item is intended to take roughly 1–4 hours of focused engineering work. If a task exposes a larger problem, split it before proceeding rather than widening the change. The aggregate planning allowance is roughly 3–5 engineer-weeks, including characterization, extraction, and qualification; revise after section 2. This is broader than just introducing a router interface.

## 1. Establish the source and compatibility baseline

- [ ] 1.1 Capture the intended source snapshot without disturbing user changes. (1–2h)
      Components: C10.
      Requirements: R11.AC3, R12.AC1, R12.AC3.
      Done when: branch/commit, relevant dirty diff identity, lockfile/runtime versions and all pre-existing/concurrently modified paths are recorded, including the settled Online/search migration; a disposable baseline can be reproduced without personal `.env`, credentials or databases.
- [ ] 1.2 Finish the inference, catalog and compatibility import inventory. (2–3h)
      Components: C5, C6, C9, C10.
      Requirements: R2.AC1, R7.AC2, R7.AC3, R9.AC1–R9.AC3, R11.AC2.
      Done when: every native/secondary/SDK/Decisions/workflow call has an owner, future boundary, contract, and test owner; explicit OpenRouter exceptions are distinguished from inference bypasses.
- [ ] 1.3 Record public behavior and failure-mode ownership. (2–3h)
      Components: C1–C10.
      Requirements: R1.AC1–R1.AC4, R3.AC1–R3.AC6, R4.AC1–R4.AC5, R5.AC1–R5.AC5, R6.AC1–R6.AC4, R12.AC1.
      Done when: the compatibility matrix has concrete scenario IDs, captured hook/persistence ordering, current mode/credential policies, and a primary test owner per invariant; missing coverage is explicit.
- [ ] 1.4 Run the focused existing core/protocol/security baseline. (2–4h)
      Components: C6, C8, C9, C10.
      Requirements: R2.AC2, R6.AC1–R6.AC4, R7.AC2, R8.AC1–R8.AC4, R12.AC1, R12.AC3.
      Done when: existing model/variant/transport/request/persistence/credential/plugin suites have source-identified results; failures are reproduced or recorded as unresolved, not silently excluded.
- [ ] 1.5 Run the browser and authenticated Cloud baseline. (2–4h)
      Components: C1, C3, C4, C8, C10.
      Requirements: R1.AC1–R1.AC4, R4.AC3, R5.AC1–R5.AC5, R7.AC1, R12.AC1–R12.AC3.
      Done when: relevant journey/context/tool/connection cases run with scripted upstream traffic, Cloud persistence uses the SQLite profile, and receipts identify executed versus skipped scenarios.

Gate A: source and behavior are identified. An unknown or failing baseline cannot be described as a passing compatibility gate.

## 2. Add missing characterization before production changes

- [ ] 2.1 Extend the model/variant cases at their existing boundaries. (3–4h)
      Components: C6, C7, C10.
      Requirements: R3.AC1–R3.AC6, R4.AC4, R11.AC1.
      Done when: Off/Web search/Nitro/Floor, saved `online` precedence and exactly-once final search-tool injection, already-suffixed Off, free identities, thinking ambiguity, effort restoration, aliases, missing metadata and cache provenance have independent expected outcomes and upstream request assertions.
- [ ] 2.2 Extend lifecycle E2E gaps in the canonical journey/tool harnesses. (3–4h)
      Components: C1–C4, C10.
      Requirements: R1.AC1–R1.AC4, R4.AC1–R4.AC3, R5.AC1–R5.AC5, R6.AC2, R6.AC3.
      Done when: missing admission/draft, cancellation, edit/Retry/Continue, owner-switch, hook-order and uncertain-outcome cases produce durable receipts; existing stronger cases are reused rather than duplicated.
- [ ] 2.3 Extend security and governed-completion gaps before factory changes. (2–4h)
      Components: C8–C10.
      Requirements: R2.AC4, R7.AC2, R8.AC1–R8.AC4.
      Done when: personal/instance precedence, revoked origin, account switch, browser non-disclosure, unknown endpoint rejection, plugin spend/output limits and missing-usage refusal are exercised at real authorization/HTTP boundaries.
- [ ] 2.4 Characterize secondary consumer request semantics. (2–4h)
      Components: C5, C6, C9, C10.
      Requirements: R7.AC3, R9.AC1–R9.AC3, R11.AC2.
      Done when: existing document/autocomplete/title/HelpChat/compaction/Decisions/workflow owners record prompts, model identities, output bounds, timeout/retry differences and fallback behavior; only genuine gaps receive new cases.
- [ ] 2.5 Specify neutral adapter conformance as a failing-first contract. (2–3h)
      Components: C5, C6, C10.
      Requirements: R2.AC1–R2.AC4, R3.AC2, R3.AC5, R3.AC6.
      Done when: a deterministic nonshipping fixture defines opaque colon-bearing model IDs, a non-OpenRouter response format, unsupported options and normalized events through the proposed production constructor; it requires no production test-only global/flag.
- [ ] 2.6 Reproduce or dismiss the source-based defect hypotheses. (2–4h)
      Components: C2, C6, C7, C10.
      Requirements: R3.AC3, R3.AC4, R4.AC2, R10.AC4, R12.AC3.
      Done when: model-changing hooks/old reasoning metadata, normalization drift, unknown tools policy, ownership coupling and late search-transform admission/measurement each have a concrete disposition; claims are labeled confirmed, intentional, or unresolved with evidence.
- [ ] 2.7 Resolve one confirmed touched-path blocker or record that none requires repair. (1–4h)
      Components: the owning C1–C9 component, C10.
      Requirements: R1.AC4, R10.AC4, R12.AC3.
      Done when: the selected blocker has a pre-fix failing regression, a narrowly scoped repair and passing result in a separate change, or no repair is required. Add separate 1–4h tasks for any additional confirmed blockers before Gate B and refresh the baseline. Larger behavioral changes are scoped separately and do not disappear into extraction.

Gate B: necessary tests exist before implementation, deliberate behavior corrections have explicit evidence, and estimate/scope are updated. Preserve passing existing behavior even if a newer upstream API offers an alternative.

## 3. Introduce the neutral boundary and qualify OpenRouter

- [ ] 3.1 Define the minimal neutral operation/message/event types. (2–3h)
      Components: C5, C6, C9.
      Requirements: R2.AC1, R2.AC2, R10.AC3, R11.AC2.
      Done when: shared types import no vendor SDK or runtime-specific state; existing reusable event/message definitions have one owner with compatible old imports; unused abstractions are absent.
- [ ] 3.2 Implement the OpenRouter selection/metadata resolver and legacy decoder. (3–4h)
      Components: C6, C7, C9.
      Requirements: R3.AC1–R3.AC4, R4.AC4, R11.AC1.
      Done when: request/catalog/legacy identities are distinct, characterized precedence is retained, and the existing model/variant contract cases pass without client/server duplicate parsers.
- [ ] 3.3 Add capability/option descriptors and the unchanged OpenRouter presenter. (2–4h)
      Components: C6, C7, C1.
      Requirements: R1.AC1, R3.AC1, R3.AC4–R3.AC6.
      Done when: existing menu labels/order and reasoning behavior are reproduced, unknown facts remain explicit, unsupported fixture options fail before dispatch, and no new controls or combinations are enabled.
- [ ] 3.4 Route catalog discovery through the adapter while retaining one cache owner. (2–4h)
      Components: C5–C7, C9.
      Requirements: R2.AC1, R4.AC4, R9.AC1, R11.AC1, R11.AC2.
      Done when: SDK pagination/mapping is adapter-owned, old catalog consumers see compatible fields, and provenance, TTL, stale fallback, forced refresh and delayed-hydration tests pass without new cache storage.
- [ ] 3.5 Extract provider request encoding and complete-body admission integration. (3–4h)
      Components: C2, C5, C6, C8.
      Requirements: R2.AC2, R3.AC1–R3.AC4, R4.AC2, R4.AC5, R6.AC4.
      Done when: the encoded body admitted is the body dispatched, routing/search/reasoning/cache/media fields and admission/measurement inputs match the qualified baseline, server revalidation remains authoritative, and no secret/DB handle enters the prepared request.
- [ ] 3.6 Adapt streaming and nonstreaming response decoding. (3–4h)
      Components: C5, C6, C9.
      Requirements: R2.AC1–R2.AC3, R6.AC2, R6.AC4, R7.AC4, R9.AC1.
      Done when: existing SSE parsing and completion parsing feed neutral results, raw SSE compatibility remains possible without double consumption, provider search remains separate from OR3 tool receipts, and fragmented/tool/image/reasoning/usage fixtures pass.
- [ ] 3.7 Preserve provider errors and operation-specific retry/deadline policy. (2–4h)
      Components: C5, C6, C8.
      Requirements: R6.AC1–R6.AC4, R7.AC2, R8.AC4.
      Done when: 402, 429, context errors, pre-/midstream failures, cancellation and SDK retry guards match the baseline; titles, plugin completions and Decisions do not inherit new retries.
- [ ] 3.8 Compose client/server runtimes around existing credential and access owners. (3–4h)
      Components: C5, C8, C9.
      Requirements: R2.AC4, R6.AC1, R8.AC1–R8.AC4, R11.AC2.
      Done when: production composition selects only OpenRouter, server secrets remain in request-scoped closures, static/direct and Cloud proxy paths retain their rules, and credential/authorization cases pass.
- [ ] 3.9 Finish neutral conformance and delegate existing provider exports. (2–3h)
      Components: C5, C6, C9, C10.
      Requirements: R1.AC4, R2.AC1–R2.AC4, R3.AC2, R3.AC5, R11.AC2.
      Done when: both OpenRouter compatibility fixtures and the nonshipping opaque-ID adapter exercise the same constructor; old entry points delegate to one implementation with no runtime A/B path.

Gate C: OpenRouter request/event behavior is qualified through the new boundary before dismantling the large chat coordinator.

## 4. Extract chat responsibilities in small reversible changes

- [ ] 4.1 Extract view/history projection ownership. (3–4h)
      Components: C1, C10.
      Requirements: R1.AC1, R1.AC2, R5.AC2, R5.AC5, R10.AC1–R10.AC3.
      Done when: current thread/pane state, canonical refresh, tail projection, edits and subscriptions have one owner and UI/navigation/draft receipts remain unchanged.
- [ ] 4.2 Extract background attachment and reattachment coordination. (3–4h)
      Components: C4, C1, C10.
      Requirements: R5.AC1, R5.AC2, R5.AC4, R5.AC5, R10.AC1–R10.AC3.
      Done when: the view subscribes to existing trackers rather than owning tracker state; reconnect, detach, account switch and completion notifications pass existing scenarios.
- [ ] 4.3 Extract native checkpoint recovery. (3–4h)
      Components: C3, C10.
      Requirements: R4.AC3, R5.AC1–R5.AC4, R11.AC1, R11.AC3.
      Done when: checkpoint capture/validation/cleanup and safe Retry re-entry retain the existing schema, fingerprint inputs, ownership and no-duplicate-turn behavior across reload and rollback.
- [ ] 4.4 Extract turn preparation and hook sequencing. (3–4h)
      Components: C2, C6, C7, C10.
      Requirements: R1.AC3, R3.AC3, R3.AC4, R4.AC1–R4.AC5, R10.AC1, R10.AC3.
      Done when: captured inputs, model/hook resolution, history/media/project hydration and admission leave the facade, while hook order, draft retention, context and lossy-review receipts match the baseline.
- [ ] 4.5 Extract durable acceptance and workflow delegation handoff. (3–4h)
      Components: C3, C9, C10.
      Requirements: R1.AC2–R1.AC4, R4.AC3, R5.AC1, R7.AC3, R10.AC1, R10.AC2.
      Done when: user persistence/composer clearing, assistant generation, post-write hooks, commit acknowledgement and workflow detach retain the current order and outcome.
- [ ] 4.6 Extract native execution dispatch. (3–4h)
      Components: C3, C5, C10.
      Requirements: R4.AC2, R5.AC1–R5.AC5, R6.AC2, R6.AC3, R7.AC1, R10.AC1–R10.AC3.
      Done when: foreground/background choice and execution orchestration leave `useAi.ts`, but current request controller, tool loop and finalization remain authoritative and cancellation/recovery cases pass.
- [ ] 4.7 Connect Retry/Continue to shared selection/preparation where semantics match. (3–4h)
      Components: C2, C3, C6, C10.
      Requirements: R3.AC3, R3.AC4, R4.AC1, R4.AC2, R5.AC3, R10.AC2, R10.AC3.
      Done when: suffix/capability drift is eliminated at the provider boundary while separate revision claims/history rules remain; retries/continuations preserve reasoning, tools, media, usage and origin ownership.
- [ ] 4.8 Reduce the facade to composition and public projections. (2–3h)
      Components: C1–C4, C10.
      Requirements: R1.AC2, R5.AC5, R10.AC1–R10.AC4.
      Done when: the original public return surface is compatible, no inline native pipeline or reconciliation loop remains, dependencies are focused, and no new giant context object or duplicate loading/finalization authority has appeared.

Gate D: main chat behavior matches the baseline after each ownership extraction; a large diff without matching receipts is not ready to integrate.

## 5. Complete server and secondary-consumer cutover

- [ ] 5.1 Separate host job HTTP operations from provider streaming. (3–4h)
      Components: C4, C8, C9.
      Requirements: R2.AC2, R5.AC4, R6.AC1, R6.AC3, R7.AC1, R11.AC2.
      Done when: admission/status/polling/abort/handoff have a host transport owner, old exports delegate, and uncertain admission retains idempotency rather than falling back to foreground.
- [ ] 5.2 Delegate existing server routes and trusted context admission. (3–4h)
      Components: C5, C6, C8, C9.
      Requirements: R2.AC4, R4.AC5, R6.AC1–R6.AC4, R8.AC1–R8.AC4, R11.AC2.
      Done when: URLs, envelopes, markers, status codes, byte limits, raw SSE and upstream disconnect cancellation remain unchanged; no client-declared capacity or endpoint becomes authoritative.
- [ ] 5.3 Cut over server workers and delegation model resolution. (3–4h)
      Components: C3, C5, C6, C8.
      Requirements: R3.AC3, R4.AC5, R5.AC4, R6.AC3, R7.AC1, R9.AC1.
      Done when: worker streaming/tool loops and delegated catalog access use the adapter while leases, unknown outcomes, tool receipts and canonical terminal writes survive SQLite restart/handoff cases.
- [ ] 5.4 Cut over document AI and autocomplete. (2–4h)
      Components: C5, C6, C9.
      Requirements: R4.AC1, R6.AC2, R9.AC1, R11.AC2.
      Done when: current prompts/models, cancellation, offline behavior, workspace ownership and non-chat save/review semantics are unchanged in their canonical tests/journeys.
- [ ] 5.5 Cut over titles, HelpChat, compaction and title-model catalog validation. (3–4h)
      Components: C5–C7, C9.
      Requirements: R4.AC2–R4.AC4, R6.AC2, R9.AC1, R11.AC1.
      Done when: prompt bytes, output allowances, timeout/retry differences, compaction history/JSON validation and title fallback stay unchanged; no direct native inference bypass remains in these consumers.
- [ ] 5.6 Connect governed plugin completion through its existing provider port. (3–4h)
      Components: C5, C8, C9.
      Requirements: R7.AC2, R8.AC3, R9.AC1, R11.AC2.
      Done when: `PluginAiProvider` delegates inference while model/price validation, response ceiling, missing-usage refusal, spend reservation/settlement, grants and public RPC results stay intact.
- [ ] 5.7 Preserve trusted SDK access and installed workflow compatibility. (2–4h)
      Components: C6, C8, C9.
      Requirements: R1.AC3, R7.AC2, R7.AC3, R8.AC3, R9.AC3, R11.AC2.
      Done when: adapter-owned client creation retains the supported actual SDK shape and request guards, installed workflows run/resume, and the compatibility inventory explains the remaining package-owned OpenRouter coupling without claiming universal workflow portability.
- [ ] 5.8 Isolate OpenRouter Decisions behind the existing optional classifier operation. (2–3h)
      Components: C5, C6, C9.
      Requirements: R4.AC1, R8.AC3, R9.AC2, R9.AC3.
      Done when: domain memory classification no longer constructs a vendor SDK client and the origin gate, deadline, validated classifications, cost handling and unclassified-fact fallback match the baseline.

Gate E: every inventoried AI consumer is migrated or is an explicitly supported OpenRouter compatibility boundary with a test owner. No generic raw-client replacement is fabricated to satisfy an import count.

## 6. Simplify, document and qualify the integrated result

- [ ] 6.1 Update public and source documentation. (2–3h)
      Components: C9, C10.
      Requirements: R2.AC1, R7.AC3, R9.AC3, R12.AC5.
      Done when: `public/_documentation/docmap.json`, chat lifecycle, model service, message builder, stream/auth/plugin guides, source map and `docs/openrouter-integration.md` describe actual owners; affected integration/provider READMEs are updated where their contract changed, without advertising additional routers.
- [ ] 6.2 Perform the responsibility and simplification review. (2–3h)
      Components: C1–C10.
      Requirements: R2.AC1, R2.AC2, R9.AC3, R10.AC1–R10.AC4, R11.AC2.
      Done when: duplicate implementations/parsers/state and unused contracts are removed; remaining compatibility facades are justified; no speculative cache, registry, dependency, flag or migration was introduced; every final diff is inspected.
- [ ] 6.3 Run the final deterministic browser compatibility matrix. (3–4h)
      Components: C1–C7, C10.
      Requirements: R1.AC1–R1.AC4, R3.AC1–R3.AC6, R4.AC1–R4.AC4, R5.AC1–R5.AC5, R9.AC1, R11.AC1, R11.AC3, R12.AC2–R12.AC4.
      Done when: baseline/candidate request/event/row comparisons and desktop/mobile light/dark settings/chat screenshots show no unexplained differences; required cases are executed and artifacts are replayable.
- [ ] 6.4 Run final Cloud security, durability and installed-integration qualification. (3–4h)
      Components: C3–C10.
      Requirements: R4.AC5, R5.AC4, R6.AC1–R6.AC4, R7.AC1–R7.AC4, R8.AC1–R8.AC4, R9.AC2, R9.AC3, R12.AC2–R12.AC4.
      Done when: disposable SQLite job recovery, browser handoff, origin revocation, credential/billing policy, plugin governance and installed workflows pass their actual supported profiles; vault tests run where changed composition requires them.
- [ ] 6.5 Run the final relevant suites, type check and static/server builds. (3–4h)
      Components: C5, C6, C8–C10.
      Requirements: R2.AC1, R2.AC4, R8.AC3, R11.AC2, R12.AC4, R12.AC5.
      Done when: the design's final commands and inventoried owner suites pass in recorded fixed profiles; static output excludes server secrets/imports; full type check and doc/source-map checks are green; no passing claim relies on developer `.env` or an unverified server.
- [ ] 6.6 Compare performance and side-effect counts on the same host. (2–3h)
      Components: C1, C3, C5, C10.
      Requirements: R1.AC4, R6.AC3, R10.AC4, R12.AC4.
      Done when: existing performance budgets pass and candidate/base streaming/UI/request-count evidence shows no unexplained regression; failing budgets are investigated, not waived or hidden with timeouts.
- [ ] 6.7 Produce the final compatibility receipt and reviewable handoff. (1–2h)
      Components: C9, C10.
      Requirements: R1.AC4, R9.AC3, R10.AC4, R11.AC1–R11.AC3, R12.AC1–R12.AC5.
      Done when: the receipt links baseline/candidate identities, checks, profile configuration, fixtures, screenshots/traces, request/event/storage comparisons, confirmed fixes, remaining intentional OpenRouter boundaries, and rollback-readability results. Any missing proof remains explicitly unqualified. No release or deployment occurs as part of this plan.

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
