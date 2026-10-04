# Manual compaction acceptance ledger

All 79 authoritative requirement criteria are retained below. “Locally verified” is a boundary-specific source qualification, not a feature release claim. Partial/external rows name the unclosed criterion; task boxes require the full task wording, not merely one related green test. Final local receipt paths and source revisions are in [LOCAL_QUALIFICATION_REVIEW_PACKET.md](./LOCAL_QUALIFICATION_REVIEW_PACKET.md). Earlier failures/reviews remain in [evidence.md](./evidence.md).

The seven current native journeys use real PageShell/controller/Dexie/writer/registered browser tools. Server authorization uses real job storage/registry/can()/retrieval with external canonical storage and membership scripted. SQLite tests import actual normal-built adapter/DB/migrations. Convex local handler storage is scripted and does not establish deployed validator/transaction isolation. No live inference, publication, merge or deployment has occurred.

## R1.AC1

WHEN an eligible thread is idle THEN the meter, message-action registry, and thread-history-action registry SHALL expose Compact, Compact here, and Compact thread respectively.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Native family/action journey; useThreadCompaction.integration; compacted-fork.integration.
- Evidence scope: Native composer, exact-message and history-menu actions, selected model/progress/Cancel, short/busy rejection and draft preservation.

## R1.AC2

WHEN Compact here is selected THEN the operation SHALL include that exact message and exclude later messages; it SHALL reject an anchor inside an unresolved tool exchange without silently moving the anchor.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Native family/action journey; useThreadCompaction.integration; compacted-fork.integration.
- Evidence scope: Native composer, exact-message and history-menu actions, selected model/progress/Cancel, short/busy rejection and draft preservation.

## R1.AC3

WHILE the source has active foreground/background generation, pending tools, an active compaction, or fewer than two eligible settled turns THEN compaction SHALL be disabled with a reason and SHALL also be rejected by the service boundary.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Native family/action journey; useThreadCompaction.integration; compacted-fork.integration.
- Evidence scope: Native composer, exact-message and history-menu actions, selected model/progress/Cancel, short/busy rejection and draft preservation.

## R1.AC4

WHEN compaction starts THEN the UI SHALL identify the model, show progress and Cancel, and preserve the draft; no threshold or model response SHALL initiate compaction automatically.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Native family/action journey; useThreadCompaction.integration; compacted-fork.integration.
- Evidence scope: Native composer, exact-message and history-menu actions, selected model/progress/Cancel, short/busy rejection and draft preservation.

## R1.AC5

IF the captured model cannot generate the summary or the operation is cancelled THEN no other model SHALL be substituted and no fork SHALL be created.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Native family/action journey; useThreadCompaction.integration; compacted-fork.integration.
- Evidence scope: Native composer, exact-message and history-menu actions, selected model/progress/Cancel, short/busy rejection and draft preservation.

## R2.AC1

WHEN a valid SSE usage envelope arrives, including an envelope with no choices, THEN the parser SHALL emit usage independently of text and retain it through stream termination.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: parseOpenRouterSSE; normalized-stream-reducer; foreground/continue/usage-persistence integration; adopted background owners.
- Evidence scope: Parser/provenance/persistence are locally verified; deployed sync/reconnect is independently gated.

## R2.AC2

WHEN an assistant generation settles THEN the last measured provider request's prompt/completion counts and request identity SHALL survive persistence, reload, sync, and background reconnect; absence of usage SHALL remain absence rather than become zero.

- State: External: exact released-provider second-client sync and background reconnect remain task6.5.
- Owner: parseOpenRouterSSE; normalized-stream-reducer; foreground/continue/usage-persistence integration; adopted background owners.
- Evidence scope: Parser/provenance/persistence are locally verified; deployed sync/reconnect is independently gated.

## R2.AC3

WHEN a generation makes multiple tool-loop requests THEN prompt-token counts SHALL NOT be summed as context occupancy; duplicate delivery of one request's usage SHALL NOT increment it.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: parseOpenRouterSSE; normalized-stream-reducer; foreground/continue/usage-persistence integration; adopted background owners.
- Evidence scope: Parser/provenance/persistence are locally verified; deployed sync/reconnect is independently gated.

## R2.AC4

IF stored usage belongs to another model or a changed request prefix/configuration THEN the meter SHALL invalidate that baseline; malformed or incomplete usage SHALL NOT fail otherwise valid text streaming.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: parseOpenRouterSSE; normalized-stream-reducer; foreground/continue/usage-persistence integration; adopted background owners.
- Evidence scope: Parser/provenance/persistence are locally verified; deployed sync/reconnect is independently gated.

## R3.AC1

WHEN chat input is available THEN the composer SHALL show estimated input / effective context window and a percentage, using amber from 70% and red from 90%; it SHALL separately expose reply capacity and block when input plus an explicitly requested reply cannot fit or no positive reply capacity remains.

- State: Locally verified: actual composer69/70/89/90% color boundaries and accessible input/reply text pass; final parent review remains pending.
- Owner: Final seven-scenario browser; context-budget/native admission owners.
- Evidence scope: Actual capacity, measured-prefix/full estimates, tool/media accounting, cached readiness and untrimmed600k/3.8M-byte native transport.

## R3.AC2

WHEN the estimate is prepared THEN it SHALL account for the effective system prompt, summary and landmarks, replayed history, draft, injected context, tool definitions, arguments/results, and protocol overhead; unknown media costs SHALL be visibly identified.

- State: Locally verified: real prompt/tool/settings/model/draft and chosen/removed/inherited historical media preview pass; unknown costs remain explicit without hydration.
- Owner: Composer meter/media journeys; actual complete-body native attachment and estimator owners.
- Evidence scope: Actual capacity, measured-prefix/full estimates, tool/media accounting, cached readiness and untrimmed600k/3.8M-byte native transport.

## R3.AC3

WHEN a matching usage baseline exists THEN the estimate SHALL include its prompt count and only the replayed suffix not already measured, cross-checked against the whole-payload estimate; otherwise it SHALL show an input-usage estimate with uncertainty, without imposing a blanket percentage haircut on available context.

- State: Locally verified: matched prefix+suffix, full-estimate lower bound, changed text/route/tools/reasoning/missing/zero and hydrated-image uncertainty/invalidation pass. Live estimator accuracy is not asserted.
- Owner: shared/chat/__tests__/request-usage.test.ts; final changed lane.
- Evidence scope: Actual capacity, measured-prefix/full estimates, tool/media accounting, cached readiness and untrimmed600k/3.8M-byte native transport.

## R3.AC4

WHEN model, maximum-context preference, prompt, tools, attachments, thread history, or draft changes THEN the preview SHALL update after a 120 ms debounce; actual send SHALL perform a fresh check after all payload-changing filters.

- State: Locally verified: actual composer pending/debounce observes at least100ms scheduling around the configured120ms interval; prompt/tool/file/model/settings updates and fresh native filtered admission pass.
- Owner: Final composer meter browser; native admission owners.
- Evidence scope: Actual capacity, measured-prefix/full estimates, tool/media accounting, cached readiness and untrimmed600k/3.8M-byte native transport.

## R3.AC5

WHEN model capacity is needed THEN the system SHALL use validated OpenRouter metadata from the existing catalog/cache and refresh it when missing; IF no valid capacity can be obtained THEN it SHALL show a recoverable metadata-unavailable state without inventing an 8k or other fallback capacity.

- State: Locally verified under approved catalog scope: cache/refresh/unknown-capacity and concrete route owners pass. Brendon accepted catalog-based admission on 2026-10-03; endpoint selection/pinning is separate future work. No independent endpoint guarantee is asserted.
- Owner: context-budget; request-usage; model-context-readiness; useAi.context-admission; real composer screenshots/lossy journey.
- Evidence scope: Actual capacity, measured-prefix/full estimates, tool/media accounting, cached readiness and untrimmed600k/3.8M-byte native transport.

## R3.AC6

WHEN the selected model advertises a 1,000,000-token context and no user maximum is set THEN the effective context window SHALL be 1,000,000 tokens, with no 128k cap, fixed reply reserve, percentage reduction or automatic compaction; an explicit reply maximum SHALL be checked against the model's actual limits.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: context-budget; request-usage; model-context-readiness; useAi.context-admission; real composer screenshots/lossy journey.
- Evidence scope: Actual capacity, measured-prefix/full estimates, tool/media accounting, cached readiness and untrimmed600k/3.8M-byte native transport.

## R4.AC1

IF a final request cannot fit its input and reply within the effective context window THEN send, retry, continuation, and each foreground/background tool-loop iteration SHALL stop before that provider request and return a structured `context_full` result.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: useAi.context-admission; stream-handler.tools; native recovery/lossy journeys.
- Evidence scope: Fresh complete-body admission, preserved accepted tools, provider context errors and same-turn checkpoint recovery. Legacy side-effecting filter boundary is documented.

## R4.AC2

WHEN an initial send is blocked THEN its draft and attachments SHALL remain available, no assistant generation SHALL begin, and no duplicate durable user turn SHALL be produced on retry.

- State: Partial: same-ID recovery and preserved draft/zero native preflight writes pass; actual attachment/background checkpoint-recovery matrix passes locally. Brendon selected pure Workflows adoption. Fresh frozen0.1.2/52be3d1 passes the normal protected archive/server/browser canary and both actual installed-package journeys in a disposable local workspace (2/2,17.5s; zero inference requests), beyond the independently qualified802cca1 hooks integration. [Exact identity, first failures and next approval](./PACKAGE_ADOPTION_PREPARATION.md). Named real-target adoption remains unapproved/unqualified; generic legacy compatibility does not qualify this criterion.
- Owner: useAi.context-admission; stream-handler.tools; native recovery/lossy journeys.
- Evidence scope: Fresh complete-body admission, preserved accepted tools, provider context errors and same-turn checkpoint recovery. Legacy side-effecting filter boundary is documented.

## R4.AC3

WHEN a later tool-loop request is blocked THEN accepted assistant/tool results SHALL remain durable, completed tools SHALL NOT be rerun automatically, and the generation SHALL end with an actionable context-full state.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: useAi.context-admission; stream-handler.tools; native recovery/lossy journeys.
- Evidence scope: Fresh complete-body admission, preserved accepted tools, provider context errors and same-turn checkpoint recovery. Legacy side-effecting filter boundary is documented.

## R4.AC4

WHEN overflow is reported locally or by the provider THEN the composer SHALL show “Context full — compact to continue,” Compact now, and an explicit lossy-trim action; editing the request or selecting a larger supported model SHALL re-evaluate the block.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: useAi.context-admission; stream-handler.tools; native recovery/lossy journeys.
- Evidence scope: Fresh complete-body admission, preserved accepted tools, provider context errors and same-turn checkpoint recovery. Legacy side-effecting filter boundary is documented.

## R4.AC5

WHILE the user has not confirmed a lossy request THEN no token-budget path SHALL remove historical text messages, summarize automatically, or retry with a shortened payload.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: useAi.context-admission; stream-handler.tools; native recovery/lossy journeys.
- Evidence scope: Fresh complete-body admission, preserved accepted tools, provider context errors and same-turn checkpoint recovery. Legacy side-effecting filter boundary is documented.

## R5.AC1

WHEN lossy trimming is requested THEN a confirmation SHALL show the omitted turn/message count and resulting estimate, and SHALL state that stored history is preserved.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: lossy native journey; lossy-request and native admission owners.
- Evidence scope: Estimate/omitted groups, edit invalidation, one explicit provider call, unchanged original rows, durable omission and next full-history block.

## R5.AC2

WHEN confirmed THEN trimming SHALL remove only complete oldest conversational groups, protect the effective system prompt, compaction summary and latest user input, and preserve tool-call/result pairing.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: lossy native journey; lossy-request and native admission owners.
- Evidence scope: Estimate/omitted groups, edit invalidation, one explicit provider call, unchanged original rows, durable omission and next full-history block.

## R5.AC3

IF protected content still exceeds the budget or the candidate payload changes after confirmation THEN the request SHALL remain blocked and require a new decision.

- State: Locally verified: actual attachment and routing edits invalidate visible confirmation; source/configuration/filter/protected-content checks pass before inference.
- Owner: Final lossy browser; lossy/native admission owners.
- Evidence scope: Estimate/omitted groups, edit invalidation, one explicit provider call, unchanged original rows, durable omission and next full-history block.

## R5.AC4

WHEN a lossy request is sent THEN its omission metadata SHALL be persisted with that generation; subsequent tool iterations SHALL retain the same omission set and SHALL stop if they need additional omissions.

- State: Locally verified: real native confirmed lossy tool loop saves accepted result once and stops before another request without expanding omissions.
- Owner: useAi.context-admission.integration; final lossy browser.
- Evidence scope: Estimate/omitted groups, edit invalidation, one explicit provider call, unchanged original rows, durable omission and next full-history block.

## R6.AC1

WHEN compaction captures its source THEN it SHALL use canonical transcript ordering and exclude deleted/superseded content from summarization while preserving eligible historical IDs for retrieval and replacement resolution.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: history.compaction.integration; compacted-fork.integration; controller integration.
- Evidence scope: Actual immutable capture, recursive canonical scope, ID/clock membership, pending tools, stale/cycle/workspace and transaction fences.

## R6.AC2

WHEN the source contains an earlier compaction THEN the request SHALL contain one previous summary plus new source content; prior raw history SHALL NOT be re-expanded into the summarization request.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: history.compaction.integration; compacted-fork.integration; controller integration.
- Evidence scope: Actual immutable capture, recursive canonical scope, ID/clock membership, pending tools, stale/cycle/workspace and transaction fences.

## R6.AC3

WHEN membership is saved THEN it SHALL use message IDs and bounded references to prior scopes; subsequent index normalization, insertion before an anchor, or growth of an ancestor SHALL NOT add messages to that saved membership.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: history.compaction.integration; compacted-fork.integration; controller integration.
- Evidence scope: Actual immutable capture, recursive canonical scope, ID/clock membership, pending tools, stale/cycle/workspace and transaction fences.

## R6.AC4

IF a relevant source row, boundary, model selection, workspace identity, or source eligibility changes before commit THEN the operation SHALL abort as stale without creating a fork.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: history.compaction.integration; compacted-fork.integration; controller integration.
- Evidence scope: Actual immutable capture, recursive canonical scope, ID/clock membership, pending tools, stale/cycle/workspace and transaction fences.

## R6.AC5

IF ancestry is cyclic, missing for scope capture, or exceeds the documented traversal/reference bounds THEN capture SHALL fail explicitly rather than summarize a silently incomplete history.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: history.compaction.integration; compacted-fork.integration; controller integration.
- Evidence scope: Actual immutable capture, recursive canonical scope, ID/clock membership, pending tools, stale/cycle/workspace and transaction fences.

## R7.AC1

WHEN the summarization request is serialized THEN message IDs, roles and ordering SHALL be present, binary/media payloads SHALL be replaced by descriptive omissions, and truncated tool outputs SHALL have explicit omission markers.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R7.AC2

WHEN the summarization prompt is built THEN serialized history SHALL precede the task/template and final reference-only guard; it SHALL request the conversation's language, exact identifiers, rolling correction of stale facts, and no answer to historical requests.

- State: External quality: deterministic prompt ordering/guard pass; conversation-language/factual behavior needs the manual scorecards8.3.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R7.AC3

WHEN a response is accepted THEN strict JSON validation SHALL require all five nonempty sections: Objective, Important Details, Work State, Next Move, and Relevant Files; an explicit “None” entry SHALL satisfy a section with no applicable information.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R7.AC4

WHEN landmarks are accepted THEN there SHALL be at most 30, each description SHALL be at most 200 Unicode characters, IDs SHALL be deduplicated and resolved within the captured scope, and index/role SHALL come from stored rows rather than model assertions; invalid IDs SHALL be dropped and reported.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R7.AC5

WHEN a rolling summary is accepted THEN still-relevant prior landmark IDs SHALL be eligible alongside new IDs, the combined set SHALL respect the same cap, and valid replacement links SHALL remain resolvable.

- State: External quality: rolling membership/landmark validation passes; live critical-landmark recall/two-step factual merge needs8.3.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R7.AC6

WHEN summary output is accepted THEN its provider-visible summary plus landmark index SHALL be strictly smaller than the context it replaces and within the design's target; its complete stored row SHALL fit the existing sync payload limit.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R7.AC7

IF schema, required-section, or size validation fails THEN at most one corrective generation SHALL use the same captured model and scope; after another failure, refusal, timeout, cancellation, or an oversized input, the operation SHALL surface the reason and create nothing.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: summary.integration; compacted-fork.integration; parseOpenRouterSSE.
- Evidence scope: Same-model serialization/correction/refusal/abort; strict Markdown/JSON, verified landmarks, rolling IDs, shrink/byte/token limits. Live quality remains separate.

## R8.AC1

WHEN a validated result commits THEN one Dexie write transaction SHALL create the compacted thread, its summary message at index 0, thread metadata and required outbox records; any write failure SHALL roll back the whole set.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: compacted-fork.integration; useAi.compaction-readiness; continue-compaction; native actions journey.
- Evidence scope: Atomic child/summary/outbox, replay/siblings, actual lineage, eventual pair readiness and committed-child navigation.

## R8.AC2

WHEN the fork is created THEN `branch_mode` SHALL be `compacted`, its parent and anchor SHALL identify the source, and its root SHALL resolve to the chain root even if legacy ancestors lack a denormalized root ID; no source message or attachment SHALL be copied or deleted.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: compacted-fork.integration; useAi.compaction-readiness; continue-compaction; native actions journey.
- Evidence scope: Atomic child/summary/outbox, replay/siblings, actual lineage, eventual pair readiness and committed-child navigation.

## R8.AC3

WHEN a commit is retried for the same operation ID THEN it SHALL resolve to the same child; separate concurrent user operations MAY create siblings without overwriting each other.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: compacted-fork.integration; useAi.compaction-readiness; continue-compaction; native actions journey.
- Evidence scope: Atomic child/summary/outbox, replay/siblings, actual lineage, eventual pair readiness and committed-child navigation.

## R8.AC4

WHEN commit succeeds THEN existing thread-selection navigation SHALL open the new thread only if the originating pane/workspace is still appropriate; post-commit hook/navigation errors SHALL report the committed child rather than claim that nothing was created.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: compacted-fork.integration; useAi.compaction-readiness; continue-compaction; native actions journey.
- Evidence scope: Atomic child/summary/outbox, replay/siblings, actual lineage, eventual pair readiness and committed-child navigation.

## R8.AC5

IF a synced compacted thread arrives before its required summary THEN it SHALL be marked pending and SHALL NOT send an empty or ancestor-expanded request until the summary arrives.

- State: External: local eventual-pair protection passes; deployed local→canonical→second-client partial delivery remains6.5.
- Owner: compacted-fork.integration; useAi.compaction-readiness; continue-compaction; native actions journey.
- Evidence scope: Atomic child/summary/outbox, replay/siblings, actual lineage, eventual pair readiness and committed-child navigation.

## R9.AC1

WHEN a compacted thread is loaded, continued, retried or sent THEN its initial historical context SHALL be exactly one summary with landmarks, preceded by the current effective system prompt if enabled, followed only by new local messages.

- State: Locally verified: real recursive reference-descendant Send/Retry/Continue and foreground accepted-tool/background request bodies retain inherited summary/later parent and exclude raw compacted ancestors; rejected Retry restores full UI.
- Owner: F1 native body matrix; final summary-only browser.
- Evidence scope: Read-only card/reload, provider-only summary/new-local body, human anchor/tool mapping, actual reverse children and fallible-reference labels.

## R9.AC2

WHEN transcript rows are projected for UI/provider use THEN typed compaction and usage metadata SHALL survive reload; host-only history membership metadata SHALL NOT be sent to the model.

- State: External: typed reload/provider-body exclusion passes; exact released-provider second-client serialization/reconnect remains6.5.
- Owner: transcript; native summary-only continuation and family/action journeys; ContextCompactionCard/ThreadChildLinks.
- Evidence scope: Read-only card/reload, provider-only summary/new-local body, human anchor/tool mapping, actual reverse children and fallible-reference labels.

## R9.AC3

WHEN a summary row is rendered THEN it SHALL show a collapsible “Context compacted” card with covered message count, landmark count, summary body and View original; it SHALL not expose ordinary edit/retry controls that would invalidate the compaction boundary.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: transcript; native summary-only continuation and family/action journeys; ContextCompactionCard/ThreadChildLinks.
- Evidence scope: Read-only card/reload, provider-only summary/new-local body, human anchor/tool mapping, actual reverse children and fallible-reference labels.

## R9.AC4

WHEN a child or source is viewed THEN lineage links SHALL show the source and actual child continuations; “View original” SHALL navigate to the stored anchor when available and display an unavailable state when it is not.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: transcript; native summary-only continuation and family/action journeys; ContextCompactionCard/ThreadChildLinks.
- Evidence scope: Read-only card/reload, provider-only summary/new-local body, human anchor/tool mapping, actual reverse children and fallible-reference labels.

## R9.AC5

WHEN a summary or retrieved text is injected THEN it SHALL be delimited as fallible historical reference, not as new authorization or a replacement for the current system prompt.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: transcript; native summary-only continuation and family/action journeys; ContextCompactionCard/ThreadChildLinks.
- Evidence scope: Read-only card/reload, provider-only summary/new-local body, human anchor/tool mapping, actual reverse children and fallible-reference labels.

## R10.AC1

WHEN `get_message(message_id)` is called THEN it SHALL return bounded content, role, thread, current ordering, capture membership status and up to one eligible neighbor on each side; it SHALL reject siblings and unrelated threads regardless of supplied IDs.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered browser history journey; server tool-registry authorization owner; source-built SQLite gateway owner.
- Evidence scope: Scoped originals/neighbors/replacements, signed cursors, truthful incomplete scans, work/output bounds, current authorization and workspace fences.

## R10.AC2

WHEN `search_parent(query, kinds?, include_after_compaction?)` is called THEN it SHALL search only eligible ancestors by default, rank bounded results deterministically, and return a continuation cursor and incomplete-scan indicator when its work bound is reached.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered browser history journey; server tool-registry authorization owner; source-built SQLite gateway owner.
- Evidence scope: Scoped originals/neighbors/replacements, signed cursors, truthful incomplete scans, work/output bounds, current authorization and workspace fences.

## R10.AC3

IF either tool explicitly requests post-compaction content THEN it SHALL still restrict reads to the same authorized ancestor path and label every result outside the captured scope; neighbors SHALL obey that same scope.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered browser history journey; server tool-registry authorization owner; source-built SQLite gateway owner.
- Evidence scope: Scoped originals/neighbors/replacements, signed cursors, truthful incomplete scans, work/output bounds, current authorization and workspace fences.

## R10.AC4

WHEN a stored row has `superseded_by` THEN retrieval SHALL return bounded replacement metadata and resolve eligible replacements with cycle detection; a replacement outside the requested scope SHALL not leak its content.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered browser history journey; server tool-registry authorization owner; source-built SQLite gateway owner.
- Evidence scope: Scoped originals/neighbors/replacements, signed cursors, truthful incomplete scans, work/output bounds, current authorization and workspace fences.

## R10.AC5

IF a row is edited, deleted, missing, unsynced, or unauthorized THEN the tool SHALL return the corresponding available status without inventing the captured version; unauthorized and unrelated IDs SHALL not disclose whether content exists.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered browser history journey; server tool-registry authorization owner; source-built SQLite gateway owner.
- Evidence scope: Scoped originals/neighbors/replacements, signed cursors, truthful incomplete scans, work/output bounds, current authorization and workspace fences.

## R10.AC6

WHEN retrieval produces output THEN documented result, character, byte, ancestry and execution-time caps SHALL be enforced before the next model request, which SHALL still pass R4.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered browser history journey; server tool-registry authorization owner; source-built SQLite gateway owner.
- Evidence scope: Scoped originals/neighbors/replacements, signed cursors, truthful incomplete scans, work/output bounds, current authorization and workspace fences.

## R11.AC1

WHEN foreground/static chat retrieves history THEN handlers SHALL use the captured workspace's Dexie database and stop on a workspace switch; no server SDK SHALL enter a static bundle.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Server tool-registry authorization owner; canonical-history-context; SQLite actual built storage; Convex actual scaffold handler owner.
- Evidence scope: Trusted real jobs and fresh can()/membership checks qualify locally. Deployed provider transactions, browser bridge/reconnect and released pins remain separate.

## R11.AC2

WHEN an admitted server tool reads history THEN subject, workspace and current thread SHALL come from trusted execution context; `can()` authorization and canonical provider reads SHALL enforce workspace access before content is returned.

- State: External: real host authorization and SQLite built storage/scaffold local handlers pass; deployed Convex validators/transaction isolation are unqualified.
- Owner: Server tool-registry authorization owner; canonical-history-context; SQLite actual built storage; Convex actual scaffold handler owner.
- Evidence scope: Trusted real jobs and fresh can()/membership checks qualify locally. Deployed provider transactions, browser bridge/reconnect and released pins remain separate.

## R11.AC3

WHEN hybrid retrieval is advertised for server execution THEN a compatible provider history-reader capability and required synced lineage SHALL exist; missing capability SHALL select the existing browser-tool path or explicit foreground execution before admission.

- State: Locally verified at host placement: real readiness/auth/job boundaries and actual native core registration choose hybrid/client/foreground before frozen catalog; source-built partial-pair controls pass. Released/deployed adoption is separately R14.AC2/task6.5.
- Owner: tool-registry existing owner; actual native placement; SQLite/Convex current-host artifact owners.
- Evidence scope: Trusted real jobs and fresh can()/membership checks qualify locally. Deployed provider transactions, browser bridge/reconnect and released pins remain separate.

## R11.AC4

IF canonical history is incomplete, access is revoked, or the browser executor is unavailable THEN the tool SHALL report that limitation; it SHALL NOT scan retained change logs, borrow another workspace, or pretend an empty result proves absence.

- State: Locally verified at registered host/storage boundaries: missing capability/summary, membership revocation, missing executor and later gaps fail explicitly without content/false absence. Deployed reconnect is separately task6.5.
- Owner: Actual H3 readiness/server job/native placement and source-built provider owners.
- Evidence scope: Trusted real jobs and fresh can()/membership checks qualify locally. Deployed provider transactions, browser bridge/reconnect and released pins remain separate.

## R11.AC5

WHEN a selected model lacks tool support THEN compaction SHALL remain available and the card SHALL provide manual landmark navigation with an explicit retrieval-unavailable indication.

- State: Locally verified: context-no-tools-final selects an actual catalog model without tools, shows unavailable-tools guidance and follows the original link without inference; final parent review remains pending.
- Owner: Server tool-registry authorization owner; canonical-history-context; SQLite actual built storage; Convex actual scaffold handler owner.
- Evidence scope: Trusted real jobs and fresh can()/membership checks qualify locally. Deployed provider transactions, browser bridge/reconnect and released pins remain separate.

## R12.AC1

WHEN related threads are listed THEN each family SHALL occupy one top-level group sorted by its latest member activity; expanded members SHALL be flat virtualized rows labeled Original, Compacted, Retry when provenance exists, or Branch.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Real two-consumer family/action journey; documented500-family scale fixture; thread-families.
- Evidence scope: Flat metadata-only grouping, exact targets, keyboard focus/reload/search, independent indexed paging and creation-order latest selection.

## R12.AC2

WHEN a group row is selected THEN it SHALL open its most recently active non-deleted member with deterministic tie-breaking; selecting a member SHALL open that exact thread. A separate Go to latest compaction action SHALL use compaction creation order.

- State: Locally verified: actual original-latest activity versus creation-latest compaction group/menu targets pass after filter/reload, with exact-member selection retained.
- Owner: Final PageShell family journey; independent raw IndexedDB creation-order read.
- Evidence scope: Flat metadata-only grouping, exact targets, keyboard focus/reload/search, independent indexed paging and creation-order latest selection.

## R12.AC3

WHEN expansion changes THEN it SHALL persist under a workspace/root-scoped KV preference; a deleted or missing root SHALL not hide surviving members.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Real two-consumer family/action journey; documented500-family scale fixture; thread-families.
- Evidence scope: Flat metadata-only grouping, exact targets, keyboard focus/reload/search, independent indexed paging and creation-order latest selection.

## R12.AC4

WHEN top-level pagination advances THEN a family SHALL not be split into duplicate groups; large expanded families SHALL use bounded member pages with an explicit Load more row.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Real two-consumer family/action journey; documented500-family scale fixture; thread-families.
- Evidence scope: Flat metadata-only grouping, exact targets, keyboard focus/reload/search, independent indexed paging and creation-order latest selection.

## R12.AC5

WHEN title search, mixed documents, or project/pinned views are used THEN grouping SHALL preserve those views' filters and navigation; matching children SHALL remain discoverable even when the root does not match.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Real two-consumer family/action journey; documented500-family scale fixture; thread-families.
- Evidence scope: Flat metadata-only grouping, exact targets, keyboard focus/reload/search, independent indexed paging and creation-order latest selection.

## R12.AC6

WHEN controls are used with a keyboard or screen reader THEN expansion SHALL expose `aria-expanded`, preserve focus, and use existing Nuxt UI theme tokens; no tree canvas or nested virtual scroller SHALL be introduced.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Real two-consumer family/action journey; documented500-family scale fixture; thread-families.
- Evidence scope: Flat metadata-only grouping, exact targets, keyboard focus/reload/search, independent indexed paging and creation-order latest selection.

## R13.AC1

WHEN a thread with local descendants is hard-deleted THEN deletion SHALL be blocked with a soft-delete option; soft delete SHALL retain parent links but SHALL not make deleted message content retrievable.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered history/family/deletion journey; threads hard-delete production APIs.
- Evidence scope: Descendant refusal before/after hooks, rollback, soft-deleted originals, missing scopes/cycles and final-member preference retirement.

## R13.AC2

WHEN a landmark message or source is deleted by another device or retained data is purged THEN the summary SHALL remain usable, affected retrieval/navigation SHALL show unavailable, and no operation SHALL silently reparent the chain.

- State: Locally verified for actual source-built SQLite canonical purge→second-client snapshot recovery and local card/tool unavailable references: summary/new turns remain usable without reparenting. Released/deployed provider propagation remains task6.5.
- Owner: SQLite real two-client/purge owner; registered history/card browser.
- Evidence scope: Descendant refusal before/after hooks, rollback, soft-deleted originals, missing scopes/cycles and final-member preference retirement.

## R13.AC3

WHEN rendering or retrieval encounters a missing parent or cycle THEN it SHALL stop within the design's bound and preserve access to the current local thread; it SHALL not claim complete lineage.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Registered history/family/deletion journey; threads hard-delete production APIs.
- Evidence scope: Descendant refusal before/after hooks, rollback, soft-deleted originals, missing scopes/cycles and final-member preference retirement.

## R14.AC1

WHEN existing root, reference and copy threads are read THEN missing new fields SHALL retain their existing meaning; new forks SHALL set lineage fields, and legacy root resolution SHALL be lazy and cycle-safe.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Transcript/schema/fork owners; generated public/provider contracts and compatibility snapshots; source-built providers; public manual guide.
- Evidence scope: Additive snake_case lineage, optional registry/reader contracts, lazy legacy behavior; no installed implementation edits or publication.

## R14.AC2

WHEN new metadata is stored/synced THEN snake_case schemas, provider field validation, serialization and required indexes SHALL preserve it across Dexie, SQLite and Convex; provider package compatibility SHALL be verified before enabling server retrieval.

- State: External: source-built SQLite fields/queries and Convex scaffold agree locally; compatible publication/pins and deployed serialization/validator qualification remain.
- Owner: Transcript/schema/fork owners; generated public/provider contracts and compatibility snapshots; source-built providers; public manual guide.
- Evidence scope: Additive snake_case lineage, optional registry/reader contracts, lazy legacy behavior; no installed implementation edits or publication.

## R14.AC3

WHEN branch types or public interfaces change THEN hook/entity type maps and generated provider contracts SHALL be updated through existing tooling; prompt-mutation hooks SHALL remain deferred.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Transcript/schema/fork owners; generated public/provider contracts and compatibility snapshots; source-built providers; public manual guide.
- Evidence scope: Additive snake_case lineage, optional registry/reader contracts, lazy legacy behavior; no installed implementation edits or publication.

## R14.AC4

WHEN the feature ships THEN user/developer docs and docmap entries SHALL describe compaction, meter limits, lossy confirmation, retrieval bounds and unsupported providers without claiming features that are still planned.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Transcript/schema/fork owners; generated public/provider contracts and compatibility snapshots; source-built providers; public manual guide.
- Evidence scope: Additive snake_case lineage, optional registry/reader contracts, lazy legacy behavior; no installed implementation edits or publication.

## R15.AC1

WHEN deterministic E2E verification runs THEN captured requests and durable reads SHALL prove summary-only continuation, rolling landmarks, scoped retrieval, atomic failure/cancellation, sidebar navigation and zero provider calls on locally detected overflow.

- State: Locally verified: final seven named committed-runtime journeys retain body/durable/readiness/retrieval/cancellation/navigation/no-inference proofs. Released-provider and live quality criteria below remain distinct.
- Owner: review-complete-candidate source/report/body/assertions/screenshots.
- Evidence scope: Deterministic scripted inference only. Live three-conversation/two-roll quality and deployed second-client/reconnect gates are not replaced by schema/test success.

## R15.AC2

WHEN background/provider verification runs THEN usage and summary metadata SHALL survive reconnect/sync and retrieval SHALL deny an unauthorized workspace and sibling path using the production authorization boundary.

- State: External: local rebuilt provider/background/registered auth owners pass; deployed second-client and reconnect qualification remains6.5.
- Owner: Named test:e2e:context manifest/report/body/assertions/screenshots; source-built provider owners; retained failures.
- Evidence scope: Deterministic scripted inference only. Live three-conversation/two-roll quality and deployed second-client/reconnect gates are not replaced by schema/test success.

## R15.AC3

WHEN verification completes THEN its named Bun harness SHALL save a Playwright report, redacted request bodies, relevant screenshots and machine-readable assertions with the source revision and repeat command; it SHALL require no paid model traffic.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: Named test:e2e:context manifest/report/body/assertions/screenshots; source-built provider owners; retained failures.
- Evidence scope: Deterministic scripted inference only. Live three-conversation/two-roll quality and deployed second-client/reconnect gates are not replaced by schema/test success.

## R15.AC4

WHEN feature release qualification is requested THEN manual evaluation of three consented or synthetic long conversations—tool-heavy coding, discussion, and mixed—SHALL record landmark recall, Work State/Next Move accuracy, absence of transcript-answering, and a two-step rolling merge. Model-quality limitations SHALL be reported separately from deterministic test results.

- State: Blocked by authorization: no paid/live model traffic or three manual two-roll scorecards was authorized/run.
- Owner: Named test:e2e:context manifest/report/body/assertions/screenshots; source-built provider owners; retained failures.
- Evidence scope: Deterministic scripted inference only. Live three-conversation/two-roll quality and deployed second-client/reconnect gates are not replaced by schema/test success.

## R16.AC1

WHEN Dashboard AI settings is opened with new or legacy preferences THEN Maximum context tokens SHALL default to “Use model limit,” with no prefilled numeric ceiling.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: AiPage.context-maximum; useAiSettings KV owners; native admission/budget; adopted background owners.
- Evidence scope: Unset/custom/reset, invalid input/workspace persistence, model intersections and captured maximums; deployed reconnect remains independently gated.

## R16.AC2

WHEN the user saves a positive integer maximum THEN the value SHALL persist through the existing `useAiSettings` KV path and apply to new native chat and compaction generations; blank/reset SHALL restore the model limit, and invalid input SHALL show a validation error.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: AiPage.context-maximum; useAiSettings KV owners; native admission/budget; adopted background owners.
- Evidence scope: Unset/custom/reset, invalid input/workspace persistence, model intersections and captured maximums; deployed reconnect remains independently gated.

## R16.AC3

WHEN a user maximum is present THEN the effective context window SHALL be the smaller of that maximum and the selected model's advertised capacity; a saved value above one model's limit SHALL remain saved for other models, and the meter SHALL identify whether the user maximum is active.

- State: Locally verified at the listed production boundary; final parent review remains pending.
- Owner: AiPage.context-maximum; useAiSettings KV owners; native admission/budget; adopted background owners.
- Evidence scope: Unset/custom/reset, invalid input/workspace persistence, model intersections and captured maximums; deployed reconnect remains independently gated.

## R16.AC4

WHEN the preference or selected model changes THEN the meter and next generation's admission SHALL recalculate without trimming stored history or triggering compaction; an active generation SHALL retain its admitted preference across tool iterations and background reconnect.

- State: External: native/server tool-loop captured preference is locally verified; exact deployed reconnect preservation remains6.5.
- Owner: AiPage.context-maximum; useAiSettings KV owners; native admission/budget; adopted background owners.
- Evidence scope: Unset/custom/reset, invalid input/workspace persistence, model intersections and captured maximums; deployed reconnect remains independently gated.

## R16.AC5

WHEN preferences are reloaded or the workspace changes THEN the maximum SHALL follow the same workspace isolation and reset behavior as existing AI preferences; foreground and server/background admission SHALL apply the same captured value without treating it as authority to exceed provider limits.

- State: External: existing KV isolation/reset and host admission agree locally; released-provider reconnect remains6.5.
- Owner: AiPage.context-maximum; useAiSettings KV owners; native admission/budget; adopted background owners.
- Evidence scope: Unset/custom/reset, invalid input/workspace persistence, model intersections and captured maximums; deployed reconnect remains independently gated.

