# Requirements

## Introduction

Add explicit context management to native OR3 chat: a context meter, blocking overflow handling, and user-requested compaction into a new reference-linked thread. A compacted thread starts with a generated summary and a bounded landmark index; historical messages remain in their original threads and are retrieved only when needed. This is a feature specification, not an implementation or a release authorization.

## Context

Inspected on 2026-09-26: OR3 uses Bun, Nuxt 4/Vue 3, Nuxt UI, workspace-scoped Dexie, OpenRouter SSE, Ajv/Zod, Vitest, and Playwright. `public/_documentation/docmap.json` led to the chat, branching, action-registry, tokenizer, sidebar, model-catalog, AI-settings and tool-runtime documentation. OpenRouter metadata is already fetched/cached through `models-service` and `useModelStore`; Dashboard `AiPage.vue` edits preferences through the KV-backed `useAiSettings`. The implementation has canonical transcript projection, mixed client/server background tools, transactional sync capture, and provider registries. Normal chat history loads local rows; `buildContext()` stitches only one parent. Token enforcement currently trims on send and continuation and applies an 8,000-token fallback and 128,000-token cap; this plan explicitly removes those context restrictions. The separate 256 KiB per-message sync limit remains a storage constraint. Provider dependencies are versioned; unrelated working-tree edits must be preserved.

## Assumptions

- The five supplied decisions remain binding: compaction creates a reference-linked fork without copying historical messages; overflow blocks unless lossy trimming is explicitly confirmed; compaction uses the chat's selected model; lineage is shown as a collapsible flat group; landmark IDs are the primary retrieval route and retrieval defaults to pre-compaction history.
- Model capacity comes from the existing OpenRouter catalog/cache, with no default OR3 context ceiling or guessed capacity. A model advertising 1,000,000 tokens exposes that full window. Input-usage estimates remain labeled estimates; they do not redefine the model's advertised limit.
- Dashboard AI settings gains an optional maximum context size, defaulting to unset (“Use model limit”). It follows the existing workspace KV preference scope, applies to newly started native chat/compaction generations, and cannot raise a model's real limit. An in-flight generation retains the preference captured at admission.
- Reply capacity follows the actual model window and any explicit reply-length setting. Without an explicit reply limit, the request can use remaining context for output up to the model's advertised output maximum; no fixed token reserve or percentage is withheld from input.
- “Same model” means the resolved model selection captured when the user starts compaction, including the selected routing variant. There is no cheaper summarizer or automatic fallback model. A dynamic router must resolve a concrete model or report that compaction is unavailable for that selection.
- A reference-linked compacted fork has different **prompt projection** from an ordinary reference fork: parentage enables retrieval, not automatic inclusion of ancestor messages.
- “Chain” describes each thread's parent path. Existing forks and concurrent compactions can create siblings; they remain a flat family list with explicit parent labels, without pretending that siblings continue one another.
- The contradictory unbounded `get_message` suggestion is tightened: both retrieval tools require an explicit `include_after_compaction: true` argument to read outside the captured historical membership. Workspace and ancestor-path boundaries never widen.
- Existing message indexes are mutable. Compaction therefore saves bounded ID-only history membership metadata, with references to earlier compaction scopes for rolling summaries. This copies references, never message content. It freezes membership, not historical versions of editable messages.
- Default compaction eligibility is at least two settled user/assistant turns within the chosen scope. A settled partial or failed assistant response counts only if it contains text; its incomplete status must be represented. Pending generations and unresolved tool execution prevent compaction.
- Initial policy values are implementation constants, not new settings: 30 landmarks; 200 Unicode characters per landmark description; five required summary headings; one corrective generation; 8,000 characters per tool output reduced to 2,000 on a second serialization pass; 120 ms meter debounce. Further byte, token, traversal, and paging bounds are specified in the design.
- Lossy trimming affects a single explicitly approved request and its tool-loop continuations. It never deletes stored history or silently becomes a thread preference.
- This covers native chat send, retry, continuation, and its foreground/background tool loops. Separate workflow engines, external-agent sessions, and Document AI budgets are outside scope.
- Ordinary delete retains its existing soft-delete meaning. Deleted content is unavailable to retrieval; protecting references does not override deletion or promise an immutable archive.
- No new compaction prompt-injection hooks, queues, services, telemetry pipeline, or automatic compaction are required. Existing action, tool, provider, and branch extension surfaces are reused.

## Out of Scope

- Automatic compaction, in-place pruning, a verbatim recent-message tail, tree visualization, merging sibling branches, and model-switching summarization.
- Semantic/vector search, a new global search index, generic history-version storage, and resurrecting deleted content.
- A guarantee of exact token counts for every model, hidden reasoning representation, image, or PDF.
- Redesigning existing media-inclusion policies or adding new caches for model metadata. Removing the legacy application context cap is explicitly in scope.
- Stable releases, dependency publication, live migrations, production data changes, or implementation during this planning task.

## Requirements

### R1: Explicit compaction controls

**User Story:** As a chat user, I want to choose when and where to compact so that I control context loss and model spending.

**Acceptance Criteria:**
- R1.AC1: WHEN an eligible thread is idle THEN the meter, message-action registry, and thread-history-action registry SHALL expose Compact, Compact here, and Compact thread respectively.
- R1.AC2: WHEN Compact here is selected THEN the operation SHALL include that exact message and exclude later messages; it SHALL reject an anchor inside an unresolved tool exchange without silently moving the anchor.
- R1.AC3: WHILE the source has active foreground/background generation, pending tools, an active compaction, or fewer than two eligible settled turns THEN compaction SHALL be disabled with a reason and SHALL also be rejected by the service boundary.
- R1.AC4: WHEN compaction starts THEN the UI SHALL identify the model, show progress and Cancel, and preserve the draft; no threshold or model response SHALL initiate compaction automatically.
- R1.AC5: IF the captured model cannot generate the summary or the operation is cancelled THEN no other model SHALL be substituted and no fork SHALL be created.

### R2: Durable request usage

**User Story:** As a user, I want the context meter to use actual provider measurements when available so that it improves after a response.

**Acceptance Criteria:**
- R2.AC1: WHEN a valid SSE usage envelope arrives, including an envelope with no choices, THEN the parser SHALL emit usage independently of text and retain it through stream termination.
- R2.AC2: WHEN an assistant generation settles THEN the last measured provider request's prompt/completion counts and request identity SHALL survive persistence, reload, sync, and background reconnect; absence of usage SHALL remain absence rather than become zero.
- R2.AC3: WHEN a generation makes multiple tool-loop requests THEN prompt-token counts SHALL NOT be summed as context occupancy; duplicate delivery of one request's usage SHALL NOT increment it.
- R2.AC4: IF stored usage belongs to another model or a changed request prefix/configuration THEN the meter SHALL invalidate that baseline; malformed or incomplete usage SHALL NOT fail otherwise valid text streaming.

### R3: Context meter and budget definition

**User Story:** As a user, I want to see my context usage against the selected model's actual capacity so that I can choose when to compact.

**Acceptance Criteria:**
- R3.AC1: WHEN chat input is available THEN the composer SHALL show estimated input / effective context window and a percentage, using amber from 70% and red from 90%; it SHALL separately expose reply capacity and block when input plus an explicitly requested reply cannot fit or no positive reply capacity remains.
- R3.AC2: WHEN the estimate is prepared THEN it SHALL account for the effective system prompt, summary and landmarks, replayed history, draft, injected context, tool definitions, arguments/results, and protocol overhead; unknown media costs SHALL be visibly identified.
- R3.AC3: WHEN a matching usage baseline exists THEN the estimate SHALL include its prompt count and only the replayed suffix not already measured, cross-checked against the whole-payload estimate; otherwise it SHALL show an input-usage estimate with uncertainty, without imposing a blanket percentage haircut on available context.
- R3.AC4: WHEN model, maximum-context preference, prompt, tools, attachments, thread history, or draft changes THEN the preview SHALL update after a 120 ms debounce; actual send SHALL perform a fresh check after all payload-changing filters.
- R3.AC5: WHEN model capacity is needed THEN the system SHALL use validated OpenRouter metadata from the existing catalog/cache and refresh it when missing; IF no valid capacity can be obtained THEN it SHALL show a recoverable metadata-unavailable state without inventing an 8k or other fallback capacity.
- R3.AC6: WHEN the selected model advertises a 1,000,000-token context and no user maximum is set THEN the effective context window SHALL be 1,000,000 tokens, with no 128k cap, fixed reply reserve, percentage reduction or automatic compaction; an explicit reply maximum SHALL be checked against the model's actual limits.

### R4: Blocking overflow without hidden trimming

**User Story:** As a user, I want an oversized request to stop explicitly so that the model never silently loses older text context.

**Acceptance Criteria:**
- R4.AC1: IF a final request cannot fit its input and reply within the effective context window THEN send, retry, continuation, and each foreground/background tool-loop iteration SHALL stop before that provider request and return a structured `context_full` result.
- R4.AC2: WHEN an initial send is blocked THEN its draft and attachments SHALL remain available, no assistant generation SHALL begin, and no duplicate durable user turn SHALL be produced on retry.
- R4.AC3: WHEN a later tool-loop request is blocked THEN accepted assistant/tool results SHALL remain durable, completed tools SHALL NOT be rerun automatically, and the generation SHALL end with an actionable context-full state.
- R4.AC4: WHEN overflow is reported locally or by the provider THEN the composer SHALL show “Context full — compact to continue,” Compact now, and an explicit lossy-trim action; editing the request or selecting a larger supported model SHALL re-evaluate the block.
- R4.AC5: WHILE the user has not confirmed a lossy request THEN no token-budget path SHALL remove historical text messages, summarize automatically, or retry with a shortened payload.

### R5: Explicit lossy escape hatch

**User Story:** As a user, I want an emergency way to send less history while understanding what will be omitted.

**Acceptance Criteria:**
- R5.AC1: WHEN lossy trimming is requested THEN a confirmation SHALL show the omitted turn/message count and resulting estimate, and SHALL state that stored history is preserved.
- R5.AC2: WHEN confirmed THEN trimming SHALL remove only complete oldest conversational groups, protect the effective system prompt, compaction summary and latest user input, and preserve tool-call/result pairing.
- R5.AC3: IF protected content still exceeds the budget or the candidate payload changes after confirmation THEN the request SHALL remain blocked and require a new decision.
- R5.AC4: WHEN a lossy request is sent THEN its omission metadata SHALL be persisted with that generation; subsequent tool iterations SHALL retain the same omission set and SHALL stop if they need additional omissions.

### R6: Stable compaction scope

**User Story:** As a user, I want compaction and retrieval to describe a specific history boundary so that later activity in an old thread does not become implied context.

**Acceptance Criteria:**
- R6.AC1: WHEN compaction captures its source THEN it SHALL use canonical transcript ordering and exclude deleted/superseded content from summarization while preserving eligible historical IDs for retrieval and replacement resolution.
- R6.AC2: WHEN the source contains an earlier compaction THEN the request SHALL contain one previous summary plus new source content; prior raw history SHALL NOT be re-expanded into the summarization request.
- R6.AC3: WHEN membership is saved THEN it SHALL use message IDs and bounded references to prior scopes; subsequent index normalization, insertion before an anchor, or growth of an ancestor SHALL NOT add messages to that saved membership.
- R6.AC4: IF a relevant source row, boundary, model selection, workspace identity, or source eligibility changes before commit THEN the operation SHALL abort as stale without creating a fork.
- R6.AC5: IF ancestry is cyclic, missing for scope capture, or exceeds the documented traversal/reference bounds THEN capture SHALL fail explicitly rather than summarize a silently incomplete history.

### R7: Bounded, validated summary generation

**User Story:** As a user, I want a summary that carries the work forward and points back to evidence.

**Acceptance Criteria:**
- R7.AC1: WHEN the summarization request is serialized THEN message IDs, roles and ordering SHALL be present, binary/media payloads SHALL be replaced by descriptive omissions, and truncated tool outputs SHALL have explicit omission markers.
- R7.AC2: WHEN the summarization prompt is built THEN serialized history SHALL precede the task/template and final reference-only guard; it SHALL request the conversation's language, exact identifiers, rolling correction of stale facts, and no answer to historical requests.
- R7.AC3: WHEN a response is accepted THEN strict JSON validation SHALL require all five nonempty sections: Objective, Important Details, Work State, Next Move, and Relevant Files; an explicit “None” entry SHALL satisfy a section with no applicable information.
- R7.AC4: WHEN landmarks are accepted THEN there SHALL be at most 30, each description SHALL be at most 200 Unicode characters, IDs SHALL be deduplicated and resolved within the captured scope, and index/role SHALL come from stored rows rather than model assertions; invalid IDs SHALL be dropped and reported.
- R7.AC5: WHEN a rolling summary is accepted THEN still-relevant prior landmark IDs SHALL be eligible alongside new IDs, the combined set SHALL respect the same cap, and valid replacement links SHALL remain resolvable.
- R7.AC6: WHEN summary output is accepted THEN its provider-visible summary plus landmark index SHALL be strictly smaller than the context it replaces and within the design's target; its complete stored row SHALL fit the existing sync payload limit.
- R7.AC7: IF schema, required-section, or size validation fails THEN at most one corrective generation SHALL use the same captured model and scope; after another failure, refusal, timeout, cancellation, or an oversized input, the operation SHALL surface the reason and create nothing.

### R8: Atomic compacted fork creation

**User Story:** As a user, I want compaction to create either a usable continuation or nothing so that a failed operation cannot leave an empty branch.

**Acceptance Criteria:**
- R8.AC1: WHEN a validated result commits THEN one Dexie write transaction SHALL create the compacted thread, its summary message at index 0, thread metadata and required outbox records; any write failure SHALL roll back the whole set.
- R8.AC2: WHEN the fork is created THEN `branch_mode` SHALL be `compacted`, its parent and anchor SHALL identify the source, and its root SHALL resolve to the chain root even if legacy ancestors lack a denormalized root ID; no source message or attachment SHALL be copied or deleted.
- R8.AC3: WHEN a commit is retried for the same operation ID THEN it SHALL resolve to the same child; separate concurrent user operations MAY create siblings without overwriting each other.
- R8.AC4: WHEN commit succeeds THEN existing thread-selection navigation SHALL open the new thread only if the originating pane/workspace is still appropriate; post-commit hook/navigation errors SHALL report the committed child rather than claim that nothing was created.
- R8.AC5: IF a synced compacted thread arrives before its required summary THEN it SHALL be marked pending and SHALL NOT send an empty or ancestor-expanded request until the summary arrives.

### R9: Summary projection and presentation

**User Story:** As a user, I want a compacted chat to start from its summary and let me inspect that summary.

**Acceptance Criteria:**
- R9.AC1: WHEN a compacted thread is loaded, continued, retried or sent THEN its initial historical context SHALL be exactly one summary with landmarks, preceded by the current effective system prompt if enabled, followed only by new local messages.
- R9.AC2: WHEN transcript rows are projected for UI/provider use THEN typed compaction and usage metadata SHALL survive reload; host-only history membership metadata SHALL NOT be sent to the model.
- R9.AC3: WHEN a summary row is rendered THEN it SHALL show a collapsible “Context compacted” card with covered message count, landmark count, summary body and View original; it SHALL not expose ordinary edit/retry controls that would invalidate the compaction boundary.
- R9.AC4: WHEN a child or source is viewed THEN lineage links SHALL show the source and actual child continuations; “View original” SHALL navigate to the stored anchor when available and display an unavailable state when it is not.
- R9.AC5: WHEN a summary or retrieved text is injected THEN it SHALL be delimited as fallible historical reference, not as new authorization or a replacement for the current system prompt.

### R10: Scoped history retrieval

**User Story:** As a model-assisted user, I want landmark lookup and bounded history search so that details omitted from the summary remain accessible.

**Acceptance Criteria:**
- R10.AC1: WHEN `get_message(message_id)` is called THEN it SHALL return bounded content, role, thread, current ordering, capture membership status and up to one eligible neighbor on each side; it SHALL reject siblings and unrelated threads regardless of supplied IDs.
- R10.AC2: WHEN `search_parent(query, kinds?, include_after_compaction?)` is called THEN it SHALL search only eligible ancestors by default, rank bounded results deterministically, and return a continuation cursor and incomplete-scan indicator when its work bound is reached.
- R10.AC3: IF either tool explicitly requests post-compaction content THEN it SHALL still restrict reads to the same authorized ancestor path and label every result outside the captured scope; neighbors SHALL obey that same scope.
- R10.AC4: WHEN a stored row has `superseded_by` THEN retrieval SHALL return bounded replacement metadata and resolve eligible replacements with cycle detection; a replacement outside the requested scope SHALL not leak its content.
- R10.AC5: IF a row is edited, deleted, missing, unsynced, or unauthorized THEN the tool SHALL return the corresponding available status without inventing the captured version; unauthorized and unrelated IDs SHALL not disclose whether content exists.
- R10.AC6: WHEN retrieval produces output THEN documented result, character, byte, ancestry and execution-time caps SHALL be enforced before the next model request, which SHALL still pass R4.

### R11: Local and authorized server retrieval

**User Story:** As a local or cloud user, I want retrieval to work in the runtimes that can actually access my history.

**Acceptance Criteria:**
- R11.AC1: WHEN foreground/static chat retrieves history THEN handlers SHALL use the captured workspace's Dexie database and stop on a workspace switch; no server SDK SHALL enter a static bundle.
- R11.AC2: WHEN an admitted server tool reads history THEN subject, workspace and current thread SHALL come from trusted execution context; `can()` authorization and canonical provider reads SHALL enforce workspace access before content is returned.
- R11.AC3: WHEN hybrid retrieval is advertised for server execution THEN a compatible provider history-reader capability and required synced lineage SHALL exist; missing capability SHALL select the existing browser-tool path or explicit foreground execution before admission.
- R11.AC4: IF canonical history is incomplete, access is revoked, or the browser executor is unavailable THEN the tool SHALL report that limitation; it SHALL NOT scan retained change logs, borrow another workspace, or pretend an empty result proves absence.
- R11.AC5: WHEN a selected model lacks tool support THEN compaction SHALL remain available and the card SHALL provide manual landmark navigation with an explicit retrieval-unavailable indication.

### R12: Collapsible lineage sidebar

**User Story:** As a user with repeated compactions and retries, I want related chats grouped without losing their individual navigation targets.

**Acceptance Criteria:**
- R12.AC1: WHEN related threads are listed THEN each family SHALL occupy one top-level group sorted by its latest member activity; expanded members SHALL be flat virtualized rows labeled Original, Compacted, Retry when provenance exists, or Branch.
- R12.AC2: WHEN a group row is selected THEN it SHALL open its most recently active non-deleted member with deterministic tie-breaking; selecting a member SHALL open that exact thread. A separate Go to latest compaction action SHALL use compaction creation order.
- R12.AC3: WHEN expansion changes THEN it SHALL persist under a workspace/root-scoped KV preference; a deleted or missing root SHALL not hide surviving members.
- R12.AC4: WHEN top-level pagination advances THEN a family SHALL not be split into duplicate groups; large expanded families SHALL use bounded member pages with an explicit Load more row.
- R12.AC5: WHEN title search, mixed documents, or project/pinned views are used THEN grouping SHALL preserve those views' filters and navigation; matching children SHALL remain discoverable even when the root does not match.
- R12.AC6: WHEN controls are used with a keyboard or screen reader THEN expansion SHALL expose `aria-expanded`, preserve focus, and use existing Nuxt UI theme tokens; no tree canvas or nested virtual scroller SHALL be introduced.

### R13: Deletion and damaged lineage

**User Story:** As a user, I want deletion behavior to be explicit about historical references.

**Acceptance Criteria:**
- R13.AC1: WHEN a thread with local descendants is hard-deleted THEN deletion SHALL be blocked with a soft-delete option; soft delete SHALL retain parent links but SHALL not make deleted message content retrievable.
- R13.AC2: WHEN a landmark message or source is deleted by another device or retained data is purged THEN the summary SHALL remain usable, affected retrieval/navigation SHALL show unavailable, and no operation SHALL silently reparent the chain.
- R13.AC3: WHEN rendering or retrieval encounters a missing parent or cycle THEN it SHALL stop within the design's bound and preserve access to the current local thread; it SHALL not claim complete lineage.

### R14: Compatibility and documented extension surfaces

**User Story:** As a maintainer, I want an additive feature that preserves existing local-first, sync and plugin contracts.

**Acceptance Criteria:**
- R14.AC1: WHEN existing root, reference and copy threads are read THEN missing new fields SHALL retain their existing meaning; new forks SHALL set lineage fields, and legacy root resolution SHALL be lazy and cycle-safe.
- R14.AC2: WHEN new metadata is stored/synced THEN snake_case schemas, provider field validation, serialization and required indexes SHALL preserve it across Dexie, SQLite and Convex; provider package compatibility SHALL be verified before enabling server retrieval.
- R14.AC3: WHEN branch types or public interfaces change THEN hook/entity type maps and generated provider contracts SHALL be updated through existing tooling; prompt-mutation hooks SHALL remain deferred.
- R14.AC4: WHEN the feature ships THEN user/developer docs and docmap entries SHALL describe compaction, meter limits, lossy confirmation, retrieval bounds and unsupported providers without claiming features that are still planned.

### R15: Repeatable verification

**User Story:** As a maintainer, I want evidence that compaction preserves the right context and fails without data loss.

**Acceptance Criteria:**
- R15.AC1: WHEN deterministic E2E verification runs THEN captured requests and durable reads SHALL prove summary-only continuation, rolling landmarks, scoped retrieval, atomic failure/cancellation, sidebar navigation and zero provider calls on locally detected overflow.
- R15.AC2: WHEN background/provider verification runs THEN usage and summary metadata SHALL survive reconnect/sync and retrieval SHALL deny an unauthorized workspace and sibling path using the production authorization boundary.
- R15.AC3: WHEN verification completes THEN its named Bun harness SHALL save a Playwright report, redacted request bodies, relevant screenshots and machine-readable assertions with the source revision and repeat command; it SHALL require no paid model traffic.
- R15.AC4: WHEN feature release qualification is requested THEN manual evaluation of three consented or synthetic long conversations—tool-heavy coding, discussion, and mixed—SHALL record landmark recall, Work State/Next Move accuracy, absence of transcript-answering, and a two-step rolling merge. Model-quality limitations SHALL be reported separately from deterministic test results.

### R16: Optional user maximum context

**User Story:** As a user, I want to optionally limit context from Dashboard AI settings while using the model's full capacity by default.

**Acceptance Criteria:**
- R16.AC1: WHEN Dashboard AI settings is opened with new or legacy preferences THEN Maximum context tokens SHALL default to “Use model limit,” with no prefilled numeric ceiling.
- R16.AC2: WHEN the user saves a positive integer maximum THEN the value SHALL persist through the existing `useAiSettings` KV path and apply to new native chat and compaction generations; blank/reset SHALL restore the model limit, and invalid input SHALL show a validation error.
- R16.AC3: WHEN a user maximum is present THEN the effective context window SHALL be the smaller of that maximum and the selected model's advertised capacity; a saved value above one model's limit SHALL remain saved for other models, and the meter SHALL identify whether the user maximum is active.
- R16.AC4: WHEN the preference or selected model changes THEN the meter and next generation's admission SHALL recalculate without trimming stored history or triggering compaction; an active generation SHALL retain its admitted preference across tool iterations and background reconnect.
- R16.AC5: WHEN preferences are reloaded or the workspace changes THEN the maximum SHALL follow the same workspace isolation and reset behavior as existing AI preferences; foreground and server/background admission SHALL apply the same captured value without treating it as authority to exceed provider limits.
