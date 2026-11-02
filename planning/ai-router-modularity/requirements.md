# Requirements

## Introduction

Refactor OR3's AI integration into replaceable router implementations and reduce the responsibilities of `useAi.ts`, while shipping only OpenRouter and preserving the existing product experience. This is a compatibility-focused internal refactor, not a new router launch or a chat redesign. The work must establish repeatable evidence of current behavior before changing execution ownership.

## Context

Research on 2026-11-02 examined the `or3-chat` checkout on branch `or3-cloud`, HEAD `c4702724ea67a649e61361c4a0f2fe8f342b4e64`, including its uncommitted settings/theme work. Further concurrent edits arrived during planning, including a saved-Online-to-server-search translation; the implementation baseline must capture the settled source, not HEAD alone. OR3 uses Nuxt/Vue, Bun, Dexie, optional authenticated Cloud services, Vitest and Playwright; the lockfile resolves `@openrouter/sdk` to 1.2.145. `app/composables/chat/useAi.ts` exports `useChat` and contains 4,616 lines; `openrouterStream.ts` contains 1,533, client background tracking 1,976, and server streaming 1,966. Existing request ownership, canonical transcripts, persistence, context admission, SSE parsing, and browser/Cloud test harnesses are substantial reusable foundations. OpenRouter assumptions span model discovery, capabilities, settings, credentials, ordinary and background inference, tools, documents, titles, plugins, workflows, and project memory classification. Research inspected code and existing test cases; it did not execute the application or establish a passing baseline.

## Assumptions

- This deliverable authorizes planning only. Implementation, publishing, deployment, real-account credential changes, and paid inference have not been performed.
- OpenRouter remains the only enabled production router. No router switcher, additional connection UI, or new deployment configuration is needed in this phase.
- Existing behavior includes static/local operation, Cloud with personal or instance billing, foreground/background execution, and supported plugin/workflow contracts.
- The pre-existing and concurrently edited source/test/documentation files belong to the user. Implementation must first record the intended baseline including relevant changes, without stashing, reverting, or merging over that work. Planning adds only this directory.
- “Without breaking anything” is a release acceptance objective supported by explicit contracts and evidence, not a claim that finite testing proves the absence of every defect.
- Confirmed defects in the touched AI paths may be fixed in separate, reproducible changes. A structural refactor must not silently change behavior to match newer upstream documentation. Suspected bugs remain hypotheses until reproduced.
- Existing routes, environment variables, credential storage, DB schemas, public types, and hook payloads remain compatible. Small delegating facades are justified by this explicit compatibility requirement; duplicate execution implementations are not.
- Model identifiers are opaque outside the selected router. A router is an API service such as OpenRouter; it is distinct from a model creator such as Anthropic and from OR3 auth/sync/storage providers.
- Runtime reasoning defaults, including omission versus explicit disabling, are preserved. A capability marked unknown is not automatically interpreted as supported or unsupported for every router.

## Out of Scope

- Vercel, Ollama, LM Studio, other production adapters, simultaneous connections, local network bridges, and router-specific onboarding.
- Replacing the existing pipeline with AI SDK, changing SDK versions, introducing dependency injection frameworks, dynamic plugin-installed routers, or adding a generalized agent framework.
- New web-search integrations or semantics beyond the separately edited Online migration, citation UI, additional variant controls, arbitrary new suffix combinations, automatic model fallbacks, or changes to prices/billing selection. Preserve the settled search migration rather than implementing a competing change.
- Rewriting canonical history, sync, tools, durable job storage, or the existing request lifecycle; database and deployment migrations.
- Unrelated cleanup, deletion of tests merely because they make refactoring inconvenient, or new caching, queues, telemetry services, or performance infrastructure.

## Requirements

### R1: Preserve the public chat experience

**User Story:** As an existing user or extension author, I want the refactor to retain the chat experience and contracts I already rely on.

**Acceptance Criteria:**
- R1.AC1: WHEN an existing chat journey is repeated THEN the composer, model/settings controls, messages, reasoning, attachments, tool cards, Stop, Retry, Continue, scrolling, and draft recovery SHALL retain the established behavior.
- R1.AC2: WHEN callers import `useChat` from `app/composables/chat/useAi.ts` THEN its existing arguments, returned refs/methods, `SendResult` outcomes, and `ChatRequestState` transitions SHALL remain compatible.
- R1.AC3: WHEN a hook-enabled request executes THEN existing hook order, payload shape, ownership validation, veto behavior, and durable-write timing SHALL match the recorded baseline.
- R1.AC4: WHEN the same OpenRouter fixture runs before and after extraction THEN upstream request semantics, ordered events, durable rows, and visible outcomes SHALL match except for independently documented defect fixes.

### R2: Establish a replaceable router boundary

**User Story:** As a maintainer, I want to add a router later without rewriting chat state, persistence, or UI components.

**Acceptance Criteria:**
- R2.AC1: WHEN core AI consumers perform catalog lookup, request preparation, streaming, or completion THEN they SHALL use a neutral operation contract whose public types do not import the OpenRouter SDK.
- R2.AC2: WHEN OpenRouter runs THEN its SDK mapping, URL construction, request encoding, SSE interpretation, provider errors, and provider-specific behavior SHALL have named adapter owners.
- R2.AC3: WHEN a deterministic second adapter is supplied through the same runtime composition boundary in qualification THEN an opaque model ID and normalized text/tool events SHALL reach the existing consumer without OpenRouter parsing or core code changes. This adapter SHALL NOT be shipped or enabled as a production router.
- R2.AC4: WHEN a client submits unrecognized router configuration or an arbitrary endpoint THEN server execution SHALL refuse it; this refactor SHALL NOT create a generic credential-bearing proxy.

### R3: Separate identity, routing, search, and reasoning

**User Story:** As a user, I want saved model choices to behave identically, while future routers expose only options they actually support.

**Acceptance Criteria:**
- R3.AC1: WHEN OpenRouter's Off, Web search (saved `online`), Nitro, or Floor selection is used THEN labels, ordering, persistence, inheritance, and provider request encoding SHALL match the qualified source snapshot, including `modelVariant` precedence over legacy `online`.
- R3.AC2: WHEN core code handles a model identifier THEN it SHALL NOT split or strip colon suffixes; router-specific legacy decoding and request encoding SHALL own that operation.
- R3.AC3: WHEN metadata is resolved THEN catalog identity, outbound request identity, canonical alias, and user selection SHALL remain distinguishable; a free catalog entry SHALL NOT be replaced with its paid base entry to obtain metadata or retry inference.
- R3.AC4: WHEN a saved legacy thinking hint or reasoning preference is used THEN the existing effort selection, fallback/restoration, budget, and omission/disable behavior SHALL be retained and verified across send, Retry, Continue, and recovery.
- R3.AC5: WHEN a router lacks a routing/search/reasoning feature THEN its descriptors SHALL omit the corresponding control and execution SHALL reject an explicitly requested unsupported option without paid dispatch or silently substituting a capability.
- R3.AC6: WHEN missing capability metadata is encountered THEN the adapter SHALL distinguish unknown facts from its compatibility policy; OpenRouter's existing effective behavior SHALL remain covered rather than becoming the default for future routers.

### R4: Preserve preparation and context admission

**User Story:** As a user, I want all selected content and context to reach the intended model without silent losses.

**Acceptance Criteria:**
- R4.AC1: WHEN preparation crosses asynchronous hooks, catalog reads, or media hydration THEN captured account, workspace, thread/project identity, selections, and cancellation SHALL remain authoritative.
- R4.AC2: WHEN context is admitted THEN the complete encoded request, including provider-injected search tools, media, reasoning/routing configuration, output allowance, and existing project-context policy SHALL be checked using the established admission rules.
- R4.AC3: IF admission fails before user-message persistence THEN the draft SHALL remain; IF refusal occurs after persistence THEN the saved turn SHALL own Retry/recovery, without duplicating a user message.
- R4.AC4: WHEN metadata is stale, missing, or unavailable THEN current cache provenance, bounded catalog retries, context errors, lossy-review confirmation, and explicit recovery behavior SHALL remain observable.
- R4.AC5: WHEN the server receives a request THEN it SHALL resolve trusted metadata and revalidate admission rather than accepting browser-declared capacity or capabilities as authority.

### R5: Preserve lifecycle and durable ownership

**User Story:** As a user, I want navigation, interruption, and recovery to preserve my conversation without duplicate work.

**Acceptance Criteria:**
- R5.AC1: WHEN a request completes, fails, aborts, detaches, or encounters a persistence failure THEN existing request/finalization owners SHALL retain their distinct results and once-only terminal behavior.
- R5.AC2: WHEN account, workspace, pane, thread, project ownership, or permissions change during an await THEN stale work SHALL NOT update another view or write to another owner.
- R5.AC3: WHEN Retry or Continue races another pane or a remote edit THEN existing revision claims, supersession, generation leases, and canonical ordering SHALL prevent conflicting writes.
- R5.AC4: WHEN the tab closes, connectivity drops, or a background job restarts THEN current admission recovery, reattachment, unknown outcomes, and durable tool receipts SHALL prevent duplicate provider/tool execution.
- R5.AC5: WHEN a composable is disposed THEN subscriptions, view attachments, timers, and cancellation ownership SHALL be released according to current semantics, without deleting saved history or falsely reporting a background job stopped.

### R6: Preserve transport behavior

**User Story:** As an operator, I want the modular transport to retain today's reliability and deployment behavior.

**Acceptance Criteria:**
- R6.AC1: WHEN static/local and authenticated Cloud requests run THEN the existing server-first/direct rules, route-marker interpretation, credential requirements, and availability-cache behavior SHALL be preserved.
- R6.AC2: WHEN Stop/disconnect occurs before headers or during the stream THEN upstream cancellation, iterator cleanup, response deadlines, and idle deadlines SHALL remain effective.
- R6.AC3: WHEN retryable errors occur THEN retry count/timing, `Retry-After`, and no retry after consumer-visible output SHALL match the baseline; uncertain background admission SHALL NOT start a second execution mode.
- R6.AC4: WHEN OpenRouter applies credit reservation or special request requirements THEN the existing affordable-reply retry, attribution, prompt caching, media handling, reasoning, usage accounting, and error classification SHALL remain adapter-specific and behaviorally unchanged.

### R7: Preserve tools, plugins, and workflows

**User Story:** As a user of tools and extensions, I want the AI refactor to preserve their permissions, execution, and integration contracts.

**Acceptance Criteria:**
- R7.AC1: WHEN client, server, or hybrid tools run THEN existing enablement, authorization, argument limits, iteration limits, handoff, durable receipts, and continuation behavior SHALL remain owned by OR3 execution services.
- R7.AC2: WHEN plugins use model lists, governed completions, or supported trusted provider access THEN response shapes, grants, origin checks, model allowlists, spend reservations/settlement, and Cloud secret restrictions SHALL remain compatible.
- R7.AC3: WHEN installed workflows execute or resume THEN their existing package-owned model gateway and host ports SHALL continue working without a new package release being required by this refactor.
- R7.AC4: WHEN a provider runs its own search THEN it SHALL NOT be conflated with OR3's user-enabled tool registry or counted as an OR3 local tool receipt.

### R8: Preserve credentials and authorization

**User Story:** As an operator or account owner, I want existing OpenRouter connections to keep working without moving or disclosing credentials.

**Acceptance Criteria:**
- R8.AC1: WHEN personal, instance, required-user-key, or override policies are evaluated THEN the existing credential resolver SHALL remain the billing authority and preserve its precedence.
- R8.AC2: WHEN OAuth, manual-key save, reconnect, or disconnect runs THEN existing routes, key validation, account scoping, vault identifiers, and static/local storage behavior SHALL remain compatible.
- R8.AC3: WHILE Cloud inference runs the browser SHALL receive neither server nor personal vault credentials; neutral request/model objects, persisted checkpoints, hooks, diagnostics, and artifacts SHALL contain no credential.
- R8.AC4: WHEN authorization or secret lookup fails THEN the failure SHALL remain explicit and SHALL NOT trigger a weaker direct-request fallback.

### R9: Cover existing AI consumers

**User Story:** As a maintainer, I want modularity to include the AI features outside the main composer.

**Acceptance Criteria:**
- R9.AC1: WHEN document AI, autocomplete, HelpChat, compaction, titles, delegated model search, or governed plugin completion performs inference/catalog access THEN it SHALL enter the appropriate shared runtime boundary while preserving its existing prompt, model choice, limits, timeout, retries, and origin guards.
- R9.AC2: WHEN project memory classification uses OpenRouter Decisions THEN its optional provider-specific operation SHALL retain its existing timeout, validation, and unclassified-fact fallback; it SHALL NOT be converted into an ordinary chat request.
- R9.AC3: WHEN remaining vendor imports are reviewed THEN each SHALL belong to the concrete adapter, an explicit OpenRouter compatibility/auth facade, or a documented package-owned integration; no unexplained native inference bypass SHALL remain.

### R10: Reduce responsibilities without duplicating state

**User Story:** As a maintainer, I want to understand and change one AI responsibility without editing a large intertwined controller.

**Acceptance Criteria:**
- R10.AC1: WHEN extraction is complete THEN `useAi.ts` SHALL compose existing/new focused owners and project public state; it SHALL NOT implement provider encoding, the native send pipeline, background reconciliation, or tool-loop execution inline.
- R10.AC2: WHEN ownership is extracted THEN existing `requestController`, foreground persistence, background tracker, canonical transcript, and tool ledger SHALL remain authoritative rather than acquiring parallel state machines.
- R10.AC3: WHEN modules collaborate THEN dependencies SHALL be explicit and responsibility-specific; they SHALL NOT receive the entire composable state through `any`, a service locator, or a single unrestricted context bag.
- R10.AC4: WHEN structural changes are reviewed THEN each SHALL have a small reversible change boundary, unchanged observable contracts, and a simplification pass; line-count reduction alone SHALL NOT count as completion.

### R11: Preserve stored and external contracts

**User Story:** As an existing installation owner, I want to update without migrating chats, settings, or integrations.

**Acceptance Criteria:**
- R11.AC1: WHEN existing messages, favorites, per-chat/project defaults, drafts, model caches, recovery checkpoints/fingerprints, usage measurements, and background jobs load THEN the refactor SHALL read them without DB migrations, bulk rewrites, or fabricated freshness.
- R11.AC2: WHEN existing public routes, environment variables, OpenRouter-shaped SDK/model surfaces, or hook payloads are consumed THEN a single delegating compatibility boundary SHALL preserve their contract without retaining a second AI implementation.
- R11.AC3: WHEN code is rolled back to the qualified baseline THEN records written during this phase SHALL remain readable; new router identity SHALL remain internal unless an independently reviewed compatibility requirement proves persistence is necessary.

### R12: Produce evidence and maintained documentation

**User Story:** As a reviewer, I want repeatable proof of compatibility and a clear map of the new boundaries.

**Acceptance Criteria:**
- R12.AC1: BEFORE a production extraction begins the relevant failure modes, canonical test owners, baseline source identity, and missing coverage SHALL be recorded; necessary regression tests SHALL be authored before the implementation they protect.
- R12.AC2: WHEN a phase is qualified THEN affected deterministic E2E cases SHALL produce a repeatable receipt containing source identity, fixture/version, nonsecret request/event observations, persistence checks, and applicable screenshots/traces.
- R12.AC3: WHEN a defect is claimed THEN a pre-fix failing reproducer and post-fix passing result SHALL distinguish it from hypotheses and refactor regressions; existing failing checks SHALL NOT be silently waived.
- R12.AC4: BEFORE final acceptance all relevant tests, a full type check, static/server build boundaries, and a same-host performance comparison SHALL pass or the work SHALL remain explicitly unqualified. Existing unrelated failures SHALL be reported separately with comparative evidence.
- R12.AC5: WHEN internal/public extension documentation changes THEN the affected public guides and `docmap.json`, source map, OpenRouter integration notes, and relevant integration READMEs SHALL describe the supported boundary accurately.
