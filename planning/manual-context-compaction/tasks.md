# Tasks

Progress snapshot: **35 complete, 18 partial, 2 not started (55 tasks)**. Checked boxes mean the full stated task criteria are implemented and verified at the linked boundary. Partial and unverified work remains unchecked; this is not a full-feature completion claim. Reviewed background-usage runtime is adopted at `e832700f` (tree `82821322afb51b88273a4f8560187bcfb23a4eef`); publication and exact-head CI remain held. On 2026-10-03 Brendon removed per-phase review gates; locally authorized work continues with final parent review. All79 exact criteria and their boundary-specific limits: [ACCEPTANCE_LEDGER.md](./ACCEPTANCE_LEDGER.md). Current local source receipts: [LOCAL_QUALIFICATION_REVIEW_PACKET.md](./LOCAL_QUALIFICATION_REVIEW_PACKET.md). Evidence and retained first failures: [evidence.md](./evidence.md). Each task is intended to take roughly 1–4 hours; split a task at its existing component/provider boundary if discovery makes it larger. Dependencies run from top to bottom. Where fixtures are written first, their final assertions become green only when the corresponding production task is complete; do not commit permanently skipped cases as a substitute.

This plan changes native chat only. Preserve unrelated working-tree edits. Provider source changes require their owning source checkout and builds; installed `node_modules` files are not implementation targets. No task authorizes publication, a stable release, or production data changes.

## 1. Establish acceptance owners and deterministic fixtures

- [x] 1.1 Record failure cases and assign each to its primary verification boundary (2h).
      Components: C12.
      Requirements: R15.AC1, R15.AC2, R15.AC3, R15.AC4.
      Done when: an acceptance ledger lists the design's race, overflow, scope, provider, projection and UI scenarios; isolated tests have a distinct contract and credible regression under the test-audit authoring gate.
      Status: Complete — All79 authoritative ACs have boundary owners, linked packet evidence and explicit unqualified scopes in ACCEPTANCE_LEDGER.md. RETRIEVAL_ACCEPTANCE_PLAN.md and retained first failures distinguish canonical storage, native admission, registered tools, provider conformance and real UI owners; no policy replacement fixtures or new unit files were introduced.

- [ ] 1.2 Extend the existing production chat journey fixtures with long history, deterministic summary JSON and captured SSE requests (3h).
      Components: C12.
      Requirements: R15.AC1, R15.AC3.
      Done when: fixtures exercise production chat/DB code, external inference alone is mocked, a summary-only continuation assertion fails against the pre-feature host, and no real key or paid network is needed.
      Status: Partial — Actual long-history/controller/writer/PageShell fixtures and captured summary-only continuation pass without paid traffic. The explicit pre-feature summary-only assertion failure required by this task is not established by the retained navigation failures; that proof stays open.

- [x] 1.3 Add the named `test:e2e:context` harness and artifact manifest (3h).
      Components: C12.
      Requirements: R15.AC3.
      Done when: a Bun command selects only context scenarios, saves redacted bodies, screenshots, Playwright report and JSON assertions, records fixture/source versions, and runs against an isolated workspace/profile. Do not run a broad Playwright suite.
      Status: Complete — Named Bun test:e2e:context selects only five context scenarios, uses disposable profiles and scripted inference, and emits source/fixture versions, redacted captured bodies, JSON assertions, screenshots and Playwright report. context-final-candidate passes5/5 on d3bea638; final no-tool addition passes the sole changed family scenario on ecea59f2. Full feature acceptance remains distinct from harness completion.

## 2. Phase A — usage, estimation and hard admission

- [x] 2.1 Add failing usage wire-contract cases in the existing parser suite (2h).
      Components: C1, C12.
      Requirements: R2.AC1, R2.AC3, R2.AC4.
      Done when: cases cover final usage with empty choices, fragmented events, duplicates, missing/malformed counters and usage after a finish reason without implementing parser behavior inside fixtures.
      Status: Complete — final empty-choice/fragmented/duplicate/missing/malformed/after-finish usage cases pass in shared/openrouter/__tests__/parseOpenRouterSSE.test.ts; qualifying4fd25dd5/376f17b0 Core/Contracts and evidence.md.

- [x] 2.2 Carry normalized per-request usage through parser, reducer and foreground/continuation persistence (3h).
      Components: C1.
      Requirements: R2.AC1, R2.AC2, R2.AC3, R2.AC4.
      Done when: last-request measurement, model and request-prefix provenance persist without damaging text/tool state; malformed usage does not fail a successful response and parser cases pass.
      Status: Complete — foreground/continue last-request provenance, tool iterations, error/terminal flush and actual DB reload pass in foreground-usage.integration.test.ts, continue-usage.integration.test.ts and usage-persistence.integration.test.ts; qualifying376f17b0 Core/Contracts. Background/provider work is separate below.

- [x] 2.3 Add background usage survival cases at the existing terminal-history boundary before changing its contracts (2h).
      Components: C1, C9, C12.
      Requirements: R2.AC2, R2.AC3, R15.AC2.
      Done when: a measured multi-iteration generation is finalized and reloaded through real job/history APIs, and the pre-change failure demonstrates dropped usage.
      Status: Complete — Reviewed pre-change host/SQLite/Convex dropped-usage failures and real execution/history/canonical reload owners were adopted at e832700f. Mac host98/SQLite111/Convex72 qualification is retained in evidence.md. Deployed second-client/reconnect and released pins remain6.5.

- [x] 2.4 Extend background job snapshots, finalization and client tracking with usage (3h).
      Components: C1, C9.
      Requirements: R2.AC2, R2.AC3, R14.AC2.
      Done when: server text/tool paths, terminal snapshots, status/SSE and client reload carry the same measurement; generation-state writes merge owned fields rather than replace unrelated message data.
      Status: Complete — Adopted reviewed V3 carries last-request usage through actual text/tool execution, terminal/status/SSE/client Dexie reload and owned-field merges, preserving attempt/auth/workspace/lease fences. Cloud445 and Mac98 receipts remain valid source evidence. Deployed reconnect is6.5.

- [x] 2.5a Implement usage-aware finalization in the SQLite provider source and rebuild it (4h).
      Components: C1, C9.
      Requirements: R2.AC2, R14.AC2, R15.AC2.
      Done when: provider-source contract cases written first prove terminal usage survives canonical persistence and sync; rebuilt artifacts are consumed in host verification. Missing provider source is reported as an explicit dependency, never patched into installed dist.
      Status: Complete — Private SQLite source preserves usage-aware finalization and canonical persistence/sync owners. Its normal rebuild is consumed by actual-host contract fixtures; the final current built gateway/background/registration lane passes112/112 at642612a. Installed dependencies were not edited; publication/pins and deployed second-client qualification remain6.5.

- [ ] 2.5b Implement usage-aware finalization in the Convex provider source/scaffold and rebuild it (4h).
      Components: C1, C9.
      Requirements: R2.AC2, R14.AC2, R15.AC2.
      Done when: contract cases written first prove terminal usage survives canonical persistence and sync through Convex, schema/scaffold changes agree with the host, and rebuilt artifacts are consumed in host verification without editing installed dist.
      Status: Partial — Private Convex31940bd normal-built runtime and generated internal scaffold owners qualify local usage/canonical handler contracts;222 existing provider cases and standalone types pass. Scripted scaffold storage does not prove deployed validators/transaction isolation, local→canonical→second-client sync or reconnect. Publication/pins and deployed matrix remain6.5.

- [ ] 2.6 Specify failing budget/admission and lossy-confirmation cases before replacing implicit trimming (3h).
      Components: C2, C12.
      Requirements: R3.AC1, R3.AC2, R3.AC3, R3.AC5, R3.AC6, R4.AC1, R4.AC2, R4.AC3, R4.AC5, R5.AC1, R5.AC2, R5.AC3, R5.AC4, R16.AC1, R16.AC2, R16.AC3, R16.AC4, R16.AC5.
      Done when: cases cover a 1,000,000-token model with no default cap, input beyond 128k, positive remaining reply capacity, explicit output limits, missing/cached metadata, unset/custom/reset AI preferences, stale usage, tool/media input, initial/loop overflow and changed lossy confirmation. Write settings persistence cases before extending that shape, and assign each case to its strongest existing owner.
      Status: Partial — Native owner plus real lossy browser cover1M/no default cap, >128k untrimmed payloads, output/unknown-capacity rejection, cancellation/filter/delegation, durable lossy decisions and draft invalidation. Missing full measured-prefix/media/attachment/UI matrices remain explicit in the per-AC ledger; green generic suites do not close them.

- [ ] 2.7 Extract the shared budget policy and request estimator (3h).
      Components: C2.
      Requirements: R2.AC4, R3.AC1, R3.AC2, R3.AC3, R3.AC5, R3.AC6, R16.AC3.
      Done when: capacity comes from OpenRouter metadata, native chat has no 128k cap/8k fallback/fixed or percentage reserve, optional user maximum intersects with model capacity, reply allowance uses the actual remainder/model output maximum, and measured-prefix/full-payload checks distinguish estimated occupancy from known capacity.
      Status: Partial — Shared factual model-window/reply/user-maximum/route policy and complete-body estimator are implemented; current budget/native/server owners pass. The measured-prefix estimator is implemented but its complete matched/stale/media/suffix cross-check acceptance matrix is not fully qualified. No application cap or guessed fallback is present.

- [ ] 2.7a Integrate existing catalog/cache metadata with budget readiness and refresh (2h).
      Components: C2.
      Requirements: R3.AC5, R3.AC6.
      Done when: native browser/server budget preparation uses validated OpenRouter records and route-relevant constraints, valid cached metadata remains usable, a missing record refreshes through the existing catalog path, and failure retains the draft with metadata-unavailable rather than a guessed numeric capacity. No parallel catalog/cache is introduced.
      Status: Partial — Existing catalog/cache/SDK normalization owners prove valid cached metadata, exact selected identity, refresh/race cancellation and recoverable unknown capacity; independent server readiness rejects forged client capacity. Concrete selected-route endpoint constraints beyond catalog facts and the complete browser recovery matrix remain.

- [x] 2.7b Add the optional maximum to Dashboard AI settings and existing KV persistence (3h).
      Components: C2.
      Requirements: R16.AC1, R16.AC2, R16.AC3, R16.AC5.
      Done when: `AiPage.vue` and `useAiSettings` support `maxContextTokens: number | null`, default/legacy/reset values mean Use model limit, invalid custom input is rejected, an above-model value remains saved for other models, and reload/workspace isolation match existing preferences.
      Status: Complete — AiPage exposes Use model limit/custom optional maximum and the existing settings/KV owner preserves null/legacy/reset, invalid input, above-model saved values, reload and workspace isolation. Current Dashboard owner and preference owners pass in the affected lane. Captured reconnect envelope remains2.7c/6.5.

- [ ] 2.7c Capture the optional user maximum in generation admission and reconnect metadata (3h).
      Components: C2, C1.
      Requirements: R16.AC4, R16.AC5.
      Done when: new generations capture the current preference, foreground/background iterations and reconnect retain that value, server admission still resolves the model's actual capacity independently, and internal context metadata never becomes an unrelated provider parameter.
      Status: Partial — Native/server/auxiliary requests capture the optional maximum in a private envelope and re-admit independently; replay checkpoint owns real saved IDs and exact source/tool identity. Released-provider background iterations/reconnect preference capture is not qualified; remains6.5.

- [ ] 2.8 Admit native send/retry/continue before durable turn mutations (4h).
      Components: C2, C4.
      Requirements: R3.AC4, R3.AC6, R4.AC1, R4.AC2, R4.AC4, R4.AC5, R16.AC4.
      Done when: final filtered requests are checked without trimming; rejected send keeps draft/attachments; retry does not supersede existing history on rejection; workflow-handled paths remain correctly delegated.
      Status: Partial — Real native initial/retry/continue owners and browser preserve zero-write native preflight rejection, same-ID reload recovery, draft and once-only final filter. Current source/tool changes, unsupported checkpoint versions, quota-storage failure and accepted-tool-loop checkpoint cleanup pass. Complete attachment/background recovery matrix remains. Legacy side-effecting filters retain their post-write compatibility boundary until published pure-contract adoption; universal zero-write admission is not claimed.

- [x] 2.9 Guard every foreground and server tool-loop provider request (3h).
      Components: C2.
      Requirements: R3.AC6, R4.AC1, R4.AC3, R4.AC4, R4.AC5, R16.AC4, R16.AC5.
      Done when: oversized tool results terminate with `context_full`, previously accepted results remain durable, no tool repeats, server applies actual model capacity and the captured optional user maximum without an independent application ceiling, and provider context errors never trigger a trimmed retry.
      Status: Complete — actual native foreground and real server job owners retain an oversized accepted tool result, execute it once and stop before the next fetch with context_full under captured choices. Worker recovery rechecks the checkpoint without replay; terminal leases remain fenced. Known provider context HTTP/SSE machine codes preserve permanent actionable ERR_CONTEXT_FULL, with no trimmed retry. Thread-bound tools/schema overhead and malformed reply limits are checked. The terminal-history owner also delivers the same accepted result and structured context failure through canonical reconciliation. Legacy non-native callers without the envelope retain their prior compatibility boundary; global product/provider/browser qualification remains tracked separately below.

- [ ] 2.10 Implement the one-turn lossy projection and confirmation binding (3h).
      Components: C2.
      Requirements: R5.AC1, R5.AC2, R5.AC3, R5.AC4.
      Done when: users inspect omitted groups/counts, confirmation binds the exact candidate, protected content and tool pairs remain intact, omission metadata persists, and subsequent iterations cannot increase omissions without a new decision.
      Status: Partial — Explicit one-use omission inspection, estimate, protected system/summary/latest user, complete tool groups and exact source/configuration/payload binding are implemented. Real browser verifies draft-edit invalidation, zero pre-confirmation writes, saved originals, one send, durable omission and next ordinary full-history block. Complete attachment/model UI races and multi-iteration lossy native tool-loop matrix remain.

- [ ] 2.11 Add the reactive meter and blocking banner to native composer content (3h).
      Components: C2, C7.
      Requirements: R3.AC1, R3.AC2, R3.AC4, R3.AC5, R3.AC6, R4.AC2, R4.AC4, R5.AC1, R16.AC3, R16.AC4.
      Done when: the meter uses the full model window by default (including 1,000,000), labels an active user maximum and reply capacity separately, shows metadata/usage uncertainty honestly, preserves drafts, and responds to settings/model changes after 120 ms without auto-compaction or media hydration. Compact now is not advertised until Phase B is usable.
      Status: Partial — Production120ms read-only preview includes canonical system/history/draft/tool configuration, measured-prefix support and honest unknown media; input/reply/model/user limits and recovery are separate. Actual meter/Compact, rejection/lossy and16 inspected theme/mobile images pass. Full70%/90% color/screen-reader, prompt/tool/attachment debounce and media/attachment UI matrices remain.

## 3. Phase B — schemas, history boundaries and atomic commit

- [x] 3.1 Add failing storage/projection scenarios for compacted roots, reference descendants and partial sync (3h).
      Components: C4, C6, C7, C12.
      Requirements: R6.AC1, R6.AC2, R6.AC3, R8.AC1, R8.AC5, R9.AC1, R9.AC2, R14.AC1.
      Done when: real DB fixtures cover a normal root, two reference generations, a copy branch, a compacted boundary, superseded tools and a child delivered before its summary. Canonical projection is not mocked.
      Status: Complete — actualDB history.compaction.integration.test.ts covers reference generations, copy/legacy, canonical tools/supersession and missing summary pair; send/continue eventual-pair owners cover partial arrival. Qualifying da817454 Core/Contracts; evidence.md records first failures.

- [x] 3.2 Add versioned compaction/usage metadata, branch enums and thread summary/root/provenance fields (3h).
      Components: C4, C6, C7.
      Requirements: R8.AC2, R8.AC5, R9.AC2, R14.AC1, R14.AC2, R14.AC3.
      Done when: DB, canonical transcript, UI and hook/entity types admit the new discriminated metadata; old rows validate unchanged; typed fields survive projection while internal scope recipes remain out of provider payloads.
      Status: Complete — shared/chat/compaction.ts, DB/thread/hook types and canonical/UI metadata round trips preserve old rows and exclude internal fields from provider wire bodies. Transcript/fork/schema/contract owners pass at e604123b Core/Contracts37011525411. Provider serialization verification is separate3.3/6.5.

- [ ] 3.3 Add the Dexie root index and provider schema/serialization additions (3h).
      Components: C6, C9, C10.
      Requirements: R12.AC4, R14.AC1, R14.AC2.
      Done when: a version upgrade preserves existing data/indexes; Convex host and provider-owned schemas retain all new fields; SQLite JSON round trips are verified; no eager legacy rewrite or startup outbox flood occurs.
      Status: Partial — Dexie21 lineage indexes preserve legacy rows/no eager outbox; source schemas and private SQLite materialized JSON reader retain compaction/usage/lineage fields. Convex deployed schema validators and released cross-client serialization are not qualified;6.2/6.5 remain.

- [ ] 3.4 Implement recursive prompt projection with compacted stopping boundaries (3h).
      Components: C4, C7.
      Requirements: R6.AC1, R6.AC2, R9.AC1, R14.AC1.
      Done when: send/history/retry/continue share the same ordering, supersession and branch policy, preserve tool roles, and never re-expand through a compaction summary or silently omit reference ancestors.
      Status: Partial — Canonical reference/compacted projection and shared retry/continue/history policy are implemented; real browser captured continuation contains one summary plus new user input, no raw ancestor rows. Complete native reference/retry/background/tool-loop captured-body matrix remains unqualified.

- [x] 3.5 Implement bounded capture recipes and snapshot revalidation (4h).
      Components: C3, C4.
      Requirements: R6.AC3, R6.AC4, R6.AC5, R10.AC6.
      Done when: newly covered ID/clock segments reference prior scopes instead of copying them; insertion, index normalization, edit, missing anchor, loop and excessive-depth cases return defined results; out-of-path scope pointers are rejected.
      Status: Complete — actualDB immutable ID/clock scopes, inherited references, insertion/reindex/edit/missing-anchor/cycle/out-of-path and ancestry revalidation controls pass in compacted-fork.integration.test.ts and history.compaction.integration.test.ts (da817454/e604123b). Valid130-generation traversal passes; the user explicitly forbids an arbitrary depth/conversation cap.

- [x] 3.6 Add failing transaction, cancellation and commit-replay cases before writing the atomic writer (2h).
      Components: C3, C6, C12.
      Requirements: R6.AC4, R8.AC1, R8.AC3, R8.AC4, R8.AC5.
      Done when: fixtures exercise failure between writes, rollback of outbox records, same-operation retry, separate sibling operations, workspace switch and post-commit navigation failure at the actual DB boundary.
      Status: Complete — actualDB second-write/outbox rollback, replay, siblings, cancellation/workspace round trips and post-commit failure controls pass in compacted-fork.integration.test.ts; qualifying da817454/e604123b Core/Contracts; first-failure logs linked in evidence.md.

- [x] 3.7a Implement `createCompactedFork` (4h).
      Components: C6.
      Requirements: R8.AC1, R8.AC2, R8.AC3, R8.AC4, R14.AC1, R14.AC3.
      Done when: a single transaction validates and writes child/summary/outbox; summary starts at index 0 with normal clocks/order keys; the source is untouched; legacy roots resolve correctly; hook failure after commit returns the committed child.
      Status: Complete — atomic child/summary/outbox writer, index0/clocks/order keys, intact originals, actual roots and truthful saved receipt pass in compacted-fork.integration.test.ts; qualifying da817454/e604123b Core/Contracts. Initial/rolling coverage counts corrected in b4e0cf33.

- [x] 3.7b Update both existing fork APIs and retry callers for safe lineage inheritance (3h).
      Components: C4, C6, C10.
      Requirements: R8.AC2, R12.AC1, R14.AC1, R14.AC3.
      Done when: the helpers in `app/db/branching.ts` and `app/db/threads.ts` stamp roots/provenance, ordinary forks clear inherited compacted-only pointers, legacy unanchored behavior stays local-only, and no generic override/filter bypasses the validated compacted writer. Add the failing source-compacted fork case before changing these helpers.
      Status: Complete — branching.ts/threads.ts ordinary and retry forks preserve actual roots/provenance, clear compacted-only pointers and reject generic/filter bypasses. compaction-fork-lineage.integration.test.ts plus130-generation history controls pass; qualifying da817454 Core/Contracts.

- [x] 3.8 Implement the summary-pair readiness guard and byte-budget boundary (2h).
      Components: C6, C7.
      Requirements: R7.AC6, R8.AC5, R9.AC1, R14.AC2.
      Done when: incomplete or mismatched summary/thread pairs cannot send, eventual sync enables a valid pair, and the complete serialized summary row fits the existing 256 KiB payload ceiling without truncating metadata.
      Status: Complete — actualDB send/continue readiness rejects missing/mismatched pairs and accepts later valid arrival; complete serialized row is checked against existing256KiB without trimming metadata. useAi.compaction-readiness/continue-compaction and compacted-fork integration owners pass; qualifying da817454/e604123b. Provider round trips remain6.5.

## 4. Phase B — generation, controls and summary presentation

- [ ] 4.1 Add failing summary-generation and rolling fixtures (3h).
      Components: C5, C12.
      Requirements: R1.AC5, R7.AC1, R7.AC2, R7.AC3, R7.AC4, R7.AC5, R7.AC6, R7.AC7.
      Done when: mocked transport covers valid JSON, five-section failure, refusal, one correction, unknown/prior IDs, overlong descriptions, nonshrinking output, tool/media omission and an input that remains oversized.
      Status: Partial — Summary/validator/serializer existing owners cover valid JSON, sections/landmarks/refusal/correction/budget/rolling/tool/media behavior at their distinct boundaries. The full stated mocked-transport failure matrix, including every validator failure routed through generation, remains unclosed.

- [x] 4.2 Implement transcript serialization, prior-summary extraction and prompt construction (3h).
      Components: C4, C5.
      Requirements: R6.AC2, R7.AC1, R7.AC2, R7.AC5, R7.AC7.
      Done when: history-first ordering and guard are visible in captured requests; canonical tool content is serialized once; prior summaries are not raw-expanded; media omission and the two documented tool-output limits are applied without dropping whole conversational turns.
      Status: Complete — same-model summary.integration.test.ts captures history-first guarded requests, one prior summary, single canonical tool content, media/reasoning omissions and8000→2000 auxiliary excerpts without dropping turns; qualifying0f9e54e1/da817454 Core/Contracts. These are summary artifact limits, not native chat caps.

- [x] 4.3 Implement strict envelope validation, landmark normalization and summary target checks (3h).
      Components: C5.
      Requirements: R7.AC3, R7.AC4, R7.AC5, R7.AC6, R7.AC7.
      Done when: all headings have bodies, model identity fields cannot spoof stored records, 30/200-character caps hold, inherited IDs are eligible, response-byte and decoded-token limits apply, and invalid IDs produce a discarded count.
      Status: Complete — strict five-section JSON/landmark validation, Unicode30/200 shape, host-owned identities, inherited IDs, discarded counts, decoded target and response/final-row bytes pass in compacted-fork/summary/parser owners; qualifying85422e58/da817454/e604123b Core/Contracts. Live quality remains8.3.

- [ ] 4.4 Integrate the same-model auxiliary request with existing authenticated transport (3h).
      Components: C5.
      Requirements: R1.AC5, R7.AC2, R7.AC7, R11.AC1.
      Done when: direct/static and forced SSR routes work, summarizer tools/background/fallback models are absent, ordinary chat filters do not inject unrelated context, there is at most one corrective call, and abort stops late persistence.
      Status: Partial — Same-model branded auxiliary request uses complete-body admission and captured policy with no ordinary side-effecting chat filters/tools/background/fallback. Local summary/controller/native direct route qualifies cancellation/correction. Forced authenticated SSR summary runtime/routing matrix remains; a green SSR build alone is not that round trip.

- [x] 4.5 Implement the compaction controller and eligibility state (3h).
      Components: C3, C4, C5, C6.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R1.AC4, R1.AC5, R6.AC4, R8.AC4, R16.AC2, R16.AC4.
      Done when: all triggers share one workspace-bound cancellable operation with the admitted optional context preference, pending jobs/tools and short scopes disable it, draft is preserved, model/source changes make it stale, and no background threshold initiates compaction. A user maximum that makes summarization too large is explained with explicit recovery choices.
      Status: Complete — Actual controller/writer owner and all three native actions share one workspace/source/model-bound cancellable operation and captured preference. Existing controller22 and writer26 owners pass; real family browser verifies progress/model/Cancel, short child disabled reason, exact anchor, successful child opening and preserved source draft. Oversized/unknown metadata/source changes reject without a fallback or automatic compaction.

- [x] 4.6 Register composer/message/thread actions and render the compaction card (3h).
      Components: C3, C7.
      Requirements: R1.AC1, R1.AC2, R1.AC4, R9.AC2, R9.AC3, R9.AC5, R11.AC5.
      Done when: actions use existing registries, the card survives reload with summary/landmarks/counts, summary edit/retry is unavailable, manual links work without model tools, and the current message-renderer work is accommodated.
      Status: Complete — Existing composer/message/history registries drive the actual pane controller. Durable read-only card, counts, landmarks, reload and manual links pass real PageShell journeys and canonical card owners. The changed family journey selects an actual no-tool catalog model, shows unavailable-tools guidance, follows View original without inference and preserves the original root draft. Sixteen theme/mobile images remain separately inspected and delivered.

- [x] 4.7 Wire source/anchor and reverse-child navigation through the existing selection flow (2h).
      Components: C7.
      Requirements: R8.AC4, R9.AC4, R13.AC2.
      Done when: View original reaches the correct stored message with a human ordinal, reverse links list actual children, missing content shows unavailable, and a stale pane never receives late forced navigation.
      Status: Complete — Real View original reaches stored tool evidence via its verified visible assistant with human ordinal, and actual reverse links select the exact compacted child. Canonical card owners cover deleted/replaced/wrong-owner/missing targets and late pane/workspace changes without navigation. Two reverse-link production first failures remain; corrected browser passes and current affected lane includes transcript/navigation dependencies.

## 5. Phase C — browser retrieval and authorization contracts

- [x] 5.1 Add failing retrieval scope/security scenarios at production tool boundaries (3h).
      Components: C4, C8, C9, C12.
      Requirements: R10.AC1, R10.AC2, R10.AC3, R10.AC4, R10.AC5, R10.AC6, R11.AC1, R11.AC2, R11.AC4.
      Done when: fixtures cover T0→T1→T2 landmarks, siblings, forged IDs/cursors, neighbor leakage, late insertion, later replacement, deletion, workspace switch and bounded scan continuation; denials reach the intended authorization/scope guard.
      Status: Complete — Registered browser journeys cover T0→T1→T2 inherited/immediate evidence, sibling/unknown IDs, scoped neighbors, late expansion, changed/deleted/replaced rows, forged/changed cursors, bounded continuation, cross-connection invalidation and held-read workspace switch. Real durable-job/can()/registry owner independently proves forged execution identities and revoked membership; first failures remain recorded.

- [x] 5.2 Implement the shared retrieval policy and captured-workspace Dexie reader (4h).
      Components: C4, C8.
      Requirements: R10.AC1, R10.AC3, R10.AC4, R10.AC5, R10.AC6, R11.AC1.
      Done when: membership/ancestor validation precedes content, bounded lookup returns scoped neighbors and replacement metadata, changed/deleted statuses are truthful, loops terminate, and workspace switches cancel reads.
      Status: Complete — Shared captured-workspace policy is qualified through actual registered browser tools: captured membership and ancestry precede bounded content/neighbor/replacement reads; cycles terminate, changes/deletions are truthful and late workspace switches cancel. Current host types, changed lane and final five browser journeys pass.

- [x] 5.3 Implement bounded parent search and continuation cursors (3h).
      Components: C8.
      Requirements: R10.AC2, R10.AC3, R10.AC6.
      Done when: 500-row/1-MiB work caps, 20-result limits and output-byte limits hold, kinds use verified annotations, per-page ordering is deterministic, and partial scans clearly report incomplete coverage.
      Status: Complete — Actual registered search proves500 physical-row/1MiB processed-text/20-result/16KiB output bounds, deterministic per-page ranking, verified kinds, signed query/scope/revision cursors and explicit incomplete empty pages. Current-thread writes retain continuation while ancestor edits invalidate it. No conversation or model cap was added.

- [x] 5.4 Register the core browser tools with shared schemas and availability checks (2h).
      Components: C8.
      Requirements: R10.AC1, R10.AC2, R11.AC1, R11.AC5.
      Done when: names cannot silently override another registration, context identity is captured rather than passed as model arguments, only appropriate chat threads expose the tools, and a no-tool model retains manual landmark navigation.
      Status: Complete — Core browser get_message/search_parent share schemas, capture host identity outside model arguments and retain collision guards. Actual registered tool journeys pass. The real no-tool model selection shows unavailable-tools guidance while manual original navigation still works without model traffic. Server collision cleanup is independently tested at its registry owner.

- [ ] 5.5 Add the optional canonical chat-reader capability and provider conformance fixtures (3h).
      Components: C9, C12.
      Requirements: R11.AC2, R11.AC3, R11.AC4, R14.AC2, R14.AC3.
      Done when: gateway contracts define bounded by-ID/thread-page reads, existing adapters remain valid without the capability, and shared failure cases verify materialized reads, authorization context and incomplete-history status before provider implementations are added.
      Status: Partial — Optional canonicalChatHistory v1 bounded contract keeps old adapters valid. Current five generated host contracts/public compatibility pass; actual SQLite built reader and Convex scaffold plus registered server missing-capability/scope cases qualify local conformance. Full absent/unavailable executor/readiness/deployed provider matrix and original failure-first fixture ordering remain explicit.

## 6. Phase C — provider implementations and background placement

- [x] 6.1 Implement SQLite canonical chat reads in the provider source (4h).
      Components: C9.
      Requirements: R11.AC2, R11.AC4, R14.AC2.
      Done when: exact workspace/thread/message reads and bounded ordered pages exercise real storage; any necessary JSON/query index migration is documented; retained sync logs are never used as content history; provider builds pass.
      Status: Complete — Private SQLite642612a normal-built adapter/DB/migrations exercise materialized member/workspace-scoped reads, bounded by-ID and ordered forward/backward legacy-tie pages, cancellation, revocation, revision triggers and orphan cleanup. Migration023 resolves the temporary sort and retained-sync foreign-key failures; query plan has no temporary B-tree.112/112 and standalone types pass. D1 does not advertise this capability; release/deployed round trips remain6.5.

- [ ] 6.2 Implement Convex canonical chat reads in the provider source/scaffold (4h).
      Components: C9.
      Requirements: R11.AC2, R11.AC4, R14.AC2.
      Done when: workspace-constrained queries and indexes support the contract and preserve new fields; direct-provider auth uses existing token/service pathways; scaffold/generated references do not make an unselected Convex provider load in static builds.
      Status: Partial — Private Convex31940bd has service-authorized indexed canonical reads, stable paging/revisions, additive lineage schema and generated references. Normal build/types/template pack and actual internal-handler source owners pass222 cases with scripted storage. Deployed validators/transactions, selected/unselected host rollout and real token/service round trips remain unqualified.

- [x] 6.3 Integrate current authorization and server tool handlers (3h).
      Components: C8, C9.
      Requirements: R11.AC2, R11.AC4, R15.AC2.
      Done when: trusted job context is required, current `can()` workspace-read checks run before content, revoked membership and foreign/sibling IDs are denied through real boundaries, and no raw request-supplied scope becomes authority.
      Status: Complete — Existing server registry owner uses real memory durable job storage, canonicalHistoryContext, can() and retrieval. It verifies matching captured provider/subject/workspace/thread/message/request identity, zero canonical reads for five forged fields, sibling/unknown denial, pre/post-read revocation, missing capability/summary and collision cleanup. Current16 owner cases pass in the919-case affected lane; scripted external storage does not qualify deployed backend isolation.

- [ ] 6.4 Decide retrieval runtime before freezing the admitted tool catalog (3h).
      Components: C8, C9.
      Requirements: R11.AC3, R11.AC4, R11.AC5.
      Done when: canonical capability and synced summary/lineage enable hybrid server use, missing support selects the existing browser bridge or foreground path explicitly, and a later gap returns scope-incomplete instead of a false empty search.
      Status: Partial — Authenticated read-only readiness and server job creation independently decide canonical/hybrid versus browser/foreground placement before catalog freeze; later gaps fail scope_incomplete. Full absent-capability/partial-sync/browser-executor/reconnect qualification remains; no live provider/bridge round trip is claimed.

- [ ] 6.5 Verify provider round trips and background reconnect with rebuilt provider artifacts (3h).
      Components: C1, C7, C9, C12.
      Requirements: R2.AC2, R8.AC5, R9.AC2, R11.AC2, R11.AC3, R14.AC2, R15.AC2.
      Done when: summary, scope, branch fields and usage survive local→canonical→second-client reads, partial delivery blocks safely, and background retrieval/usage survives navigation and reconnect on supported providers.
      Status: Not started — rebuilt-provider second-client round trips/background reconnect matrix is not run.

## 7. Phase D — flat lineage groups and deletion

- [x] 7.1 Add failing grouped-sidebar and deletion journeys before changing pagination (3h).
      Components: C10, C11, C12.
      Requirements: R12.AC1, R12.AC2, R12.AC3, R12.AC4, R12.AC5, R12.AC6, R13.AC1, R13.AC2, R13.AC3.
      Done when: fixtures include siblings, legacy/missing roots, a root outside the first page, matching child-only search, mixed documents, filtered project/pinned views, keyboard expansion and hard-delete with descendants.
      Status: Complete — Failure-first real DB/PageShell fixtures cover siblings, legacy/wrong/missing/cyclic roots, root outside the first page, matching child-only search, mixed documents, project/pinned membership, keyboard/KV reload and hard deletion with descendants including a before-hook race. Retained cycle-cache and project-document first failures demonstrate real regressions. Deployed purge/sync remains7.5/6.5.

- [x] 7.2 Implement lazy root resolution and shared family pagination (4h).
      Components: C4, C10.
      Requirements: R12.AC1, R12.AC2, R12.AC4, R12.AC5, R14.AC1.
      Done when: top-level limits count distinct families/documents, sort keys match DB scanning, both sidebar consumers share one flat row model, and expanded family members page separately without loading messages.
      Status: Complete — Both sidebar consumers use metadata-only flat shared family pagination. Final exact10k/500-family/200-member fixture proves cumulative50→100 distinct top-level rows, separate50-member paging through200 unique members, sparse legacy hints/root outside the first page and zero message reads. Final grouping p95/max19.6ms and member53.2ms (7/3 samples); current types/contracts/builds pass.

- [ ] 7.3 Render collapsible rows, workspace KV expansion and row-menu navigation (3h).
      Components: C10.
      Requirements: R12.AC1, R12.AC2, R12.AC3, R12.AC6.
      Done when: Original/Compacted/known Retry/Branch labels are truthful, group and exact-member targets differ correctly, latest compaction is separate from latest activity, keyboard focus/aria state work, and expansion survives reload.
      Status: Partial — Flat truthful branch labels, keyboard Enter/Space/focus/aria, workspace KV reload and both consumers are browser-qualified; exact member/anchor/reverse-child actions pass. Actual creation-order policy has DB evidence. Complete group/menu latest-activity-versus-latest-compaction UI target matrix remains unqualified.

- [x] 7.4 Integrate filters, child-only matches and damaged lineage UI (3h).
      Components: C10, C11.
      Requirements: R12.AC3, R12.AC5, R13.AC2, R13.AC3.
      Done when: search reveals matching children without altering saved expansion, project/pinned membership stays constrained, and missing/cyclic parents cannot hide otherwise usable local threads.
      Status: Complete — Both real sidebar consumers reveal matching children without changing persisted expansion. Real DB project/pinned/mixed-document cases retain only constrained membership; missing roots remain visible and cyclic starts stay standalone. Corrected failure-first cases, final browser, types and both builds pass.

- [ ] 7.5 Guard central hard deletion and represent unavailable historical references (2h).
      Components: C11.
      Requirements: R13.AC1, R13.AC2, R13.AC3.
      Done when: known descendants block central hard delete with an explicit soft-delete alternative, deleted content is never returned by tools, and remote purge/missing message cases leave summaries usable without silent reparenting.
      Status: Partial — Actual central deletion blocks descendants before and after hooks, rolls back hook-inserted child/deletion atomically, preserves soft-deleted summary context and cleans retired preference only for final member. Registered tools return no deleted content; canonical card missing/deleted/replaced targets stay finite without navigation. Released-provider remote purge/second-client and complete cleanup matrix remain6.5.

## 8. Complete evidence and documentation

- [x] 8.1 Run the deterministic context journeys and inspect artifacts (3h).
      Components: C12.
      Requirements: R15.AC1, R15.AC2, R15.AC3.
      Done when: the named harness is green, request-body evidence proves summary-only context and no implicit trimmed sends, failure paths show zero partial children, and report/screenshots/assertions are repeatable from the manifest.
      Status: Complete — Five named journeys pass on committed runtime d3bea638 (50.7s, workers1/retries0): native actions/families, lossy confirmation, registered retrieval/deletion/scale, same-ID recovery and summary-only continuation. Captured bodies exclude raw ancestors/internal recipes; refusal/cancellation/DB checks preserve originals and no partial children. Report/assertions/source manifest and screenshots are retained; changed no-tool family passes on ecea59f2.

- [x] 8.2 Measure the documented scale fixture and remove accidental whole-history work (3h).
      Components: C2, C8, C10, C12.
      Requirements: R3.AC4, R3.AC6, R10.AC6, R12.AC4, R15.AC3.
      Done when: the 10k-thread fixture records grouping/refresh durations, bounds per-call retrieval and member reads, performs no sidebar message-content reads, and explains/resolves p95 grouping above 500 ms on the recorded configuration. A separate mocked-inference fixture proves untrimmed requests beyond 128k and near a 1,000,000-token model window traverse native request construction/transport with valid per-message storage sizes; performance fixes do not reintroduce an application context cap.
      Status: Complete — Final actual10k/500-family/200-member browser fixture records7 grouping/3 member samples, nearest-rank p95/max19.6ms/53.2ms and zero message reads; all200 members page independently. Registered retrieval work/output bounds pass. Actual native transport owners send600,000/3,800,000 canonical bytes under a1M model window with valid per-row sizes and no trimming. Current types and static/SSR builds pass.

- [ ] 8.3 Run and record three manual quality evaluations, including two rolling compactions each (3h, with user-approved model traffic).
      Components: C5, C12.
      Requirements: R7.AC2, R7.AC5, R9.AC5, R15.AC4.
      Done when: tool-heavy, discussion and mixed scorecards record the model, critical facts, next action, landmark resolution and transcript-answering outcomes; factual failures block qualification rather than being hidden by schema success.
      Status: Not started — live scorecards require separately approved paid/model traffic; none was authorized or run.

- [x] 8.4 Document shipped behavior and extension contracts (3h).
      Components: C12.
      Requirements: R14.AC3, R14.AC4, R16.AC1, R16.AC2, R16.AC3.
      Done when: `public/_documentation/` includes compaction/context and retrieval guidance registered in `docmap.json`; AI-settings docs explain Use model limit and the optional maximum; model-capacity versus usage-estimation semantics are explicit; branching/chat/sidebar docs and hook type maps match implementation, with no unimplemented prompt hooks advertised.
      Status: Complete — Registered public context/retrieval guide and existing AI preferences/chat lifecycle/branching/deletion docs now match optional limits, provider acceptance, once-only recovery, pure plugin prepare/real-ID commit, tool-anchor navigation hints and fallible historical output. Generated compatibility/public contracts pass with additive optional registry fields. Provider/release and legacy filter limits are explicit; no unimplemented hook is advertised.

- [x] 8.5 Verify static/server builds, types, generated contracts and affected lanes (3h).
      Components: C9, C12.
      Requirements: R11.AC1, R14.AC1, R14.AC2, R14.AC3, R15.AC2.
      Done when: narrow owner tests, `bun run test:changed`, affected provider/integration checks, `bun run type-check`, `bun run generate:static` and `bun run build` pass; generated provider host contracts are current; branch/public surface changes pass the applicable compatibility lane or have an explicit resolved compatibility decision.
      Status: Complete — Current runtime d3bea638: affected lane919/919 across86 files, configured BasicAuth/SQLite/fs types, strict changed TS plus explicitly nonignored plugin lint, public contracts, refreshed compatibility snapshots/ledger and full static/SSR wrappers pass. Current five provider host contracts are verified; private SQLite112/Convex222 source-built/scaffold owners, provider types/build/template receipts are recorded. New test-only no-tool family passes33.0s on ecea59f2. No exact-head remote CI or deployed-provider pass is claimed.

- [x] 8.6 Close traceability and record capability/quality limitations (1h).
      Components: C12.
      Requirements: R14.AC4, R15.AC1, R15.AC2, R15.AC3, R15.AC4.
      Done when: each acceptance criterion links to evidence, provider support and quality limitations are stated, all task boxes reflect actual completion, and no shipping claim depends on unavailable provider code or unrun checks.
      Status: Complete — ACCEPTANCE_LEDGER.md retains all79 exact authoritative criteria with evidence owners and explicit partial/external limits. This55-task board checks only full local task wording, and the final packet separates source qualification, parent review, remote CI, provider release/deployed reconnect and live quality. First failures/source versions remain; no all55 or release-complete claim.

## Traceability Matrix

| Requirement | Design components | Task numbers |
| --- | --- | --- |
| R1 | C3, C5, C7 | 4.1, 4.4–4.6 |
| R2 | C1, C2, C9 | 2.1–2.4, 2.5a, 2.5b, 2.7, 6.5 |
| R3 | C1, C2, C7 | 2.6, 2.7, 2.7a, 2.8–2.9, 2.11, 8.2 |
| R4 | C2, C4, C7 | 2.6, 2.8–2.9, 2.11 |
| R5 | C2 | 2.6, 2.10–2.11 |
| R6 | C3, C4, C6 | 3.1, 3.4–3.6, 4.2, 4.5 |
| R7 | C5, C6 | 3.8, 4.1–4.4, 8.3 |
| R8 | C3, C6, C7 | 3.1–3.2, 3.6, 3.7a, 3.7b, 3.8, 4.5, 4.7, 6.5 |
| R9 | C4, C7 | 3.1–3.2, 3.4, 3.8, 4.6–4.7, 6.5, 8.3 |
| R10 | C4, C8, C9 | 3.5, 5.1–5.4, 8.2 |
| R11 | C7, C8, C9 | 4.4, 4.6, 5.1–5.5, 6.1–6.5, 8.5 |
| R12 | C10 | 3.3, 3.7b, 7.1–7.4, 8.2 |
| R13 | C11, C7 | 4.7, 7.1, 7.4–7.5 |
| R14 | C4, C6, C9, C10, C12 | 2.4, 2.5a, 2.5b, 3.1–3.4, 3.7a, 3.7b, 3.8, 5.5, 6.1–6.2, 6.5, 7.2, 8.4–8.6 |
| R15 | C12 | 1.1–1.3, 2.3, 2.5a, 2.5b, 6.3, 6.5, 8.1–8.3, 8.5–8.6 |
| R16 | C2, C12 | 2.6, 2.7, 2.7b, 2.7c, 2.8–2.9, 2.11, 4.5, 8.4 |

## Definition of Done

- All acceptance criteria in `requirements.md` pass with linked evidence; the matrix has no missing requirement or component.
- Original messages and attachments are preserved by compaction; the child starts with one summary/index and never silently re-expands ancestors.
- No implicit token trimming remains in native send, retry, continuation or tool-loop requests; explicit lossy confirmation is bound to its exact omission set.
- Native chat uses the full OpenRouter-advertised model context by default, including a 1,000,000-token model; no numeric application ceiling, guessed metadata fallback or fixed/percentage reply reserve remains. Dashboard maximum context is optional, defaults to unset, and is verified across persistence, model changes and background admission.
- Local transaction rollback, eventual-sync readiness, workspace isolation and provider capability fallbacks have been exercised through production boundaries.
- The named E2E harness produces the report, redacted requests, screenshots, assertions and repeat manifest; manual model-quality scorecards are recorded separately.
- Narrow tests and applicable integration/provider/compatibility checks are green; final types and static/server builds pass. Any pre-existing failure is documented and distinguished from a regression, not silently counted as success.
- User/developer docs and generated contract files describe the implemented state, all completed boxes are checked, and unfinished provider/quality gates prevent a feature-complete claim.
- No release ceremony, package publication or deployment is performed as an incidental task-completion step.
