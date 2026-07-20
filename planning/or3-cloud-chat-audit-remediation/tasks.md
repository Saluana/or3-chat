# Tasks

This is the single checkbox source of truth for the combined audit. Tasks are ordered by dependency and intended to fit roughly one to four engineering hours each. Finding IDs resolve to `findings.md`; requirement IDs resolve to `requirements.md`; component IDs resolve to `design.md`.

## 0. Immediate containment and release guardrails

- [x] 0.1 Add a release-blocked audit gate to the release checklist
      Requirements: R12.AC4, R12.AC5
      Components: C1, C3, C6, C15
      Findings: all Blocker and High findings
      Done when: release documentation names this plan and rejects release while any Blocker/High linked task is open.

- [x] 0.2 Disable sync change-log/tombstone GC in Convex and SQLite-backed deployments
      Requirements: R2.AC2
      Components: C1, C3, C6, C15
      Findings: CS-001, CST-001
      Done when: runtime configuration and tests prove retained history cannot be deleted until task 2.9 re-enables it.

- [x] 0.3 Disable destructive FS/S3 blob GC paths that infer liveness from logs or partial listings
      Requirements: R5.AC1, R5.AC2
      Components: C1, C3, C6, C15
      Findings: CST-001, CST-002, CST-010
      Done when: affected GC paths report disabled/safe-scan status and cannot issue deletes.

- [x] 0.4 Block public Convex invite/identity mutations and viewer sync writes with temporary subject/role guards
      Requirements: R1.AC1, R1.AC2
      Components: C1, C3, C6, C15
      Findings: CA-001, CA-002
      Done when: direct unauthenticated and viewer regression tests fail closed before the permanent capability refactor.

- [x] 0.5 Require authentication plus paid/background capability before selecting the managed OpenRouter key
      Requirements: R1.AC2, R1.AC7
      Components: C1, C3, C6, C15
      Findings: CA-003
      Done when: anonymous and viewer requests cannot consume the instance key or start paid background work.

## 1. Authentication, identity, and authorization boundary

- [x] 1.1 Document the capability matrix for every public Convex, workspace, sync, storage, AI, and server-tool operation
      Requirements: R1.AC1-R1.AC7
      Components: C1, C2
      Findings: CA-001, CA-002, CA-003, CA-005, CHT-002
      Done when: each operation has one subject source, resource scope, capability, and allowed role with no caller-authoritative actor fields.

- [x] 1.2 Implement the shared `CapabilityGate` result contract
      Requirements: R1.AC1, R1.AC2
      Components: C1, C2
      Findings: CA-001, CA-002, CA-005
      Done when: unit tests cover unauthenticated, viewer, editor, owner/admin, and wrong-workspace decisions without resource-existence leaks.

- [x] 1.3 Convert server-only Convex identity/session functions to internal functions
      Requirements: R1.AC1, R1.AC2
      Components: C1, C2
      Findings: CA-001
      Done when: direct public callers cannot invoke `resolveSession` or enumerate identity mappings and internal call sites still pass.

- [x] 1.4 Subject-bind Convex invitation creation, listing, revocation, and consumption
      Requirements: R1.AC1, R1.AC2, R1.AC5
      Components: C1, C2
      Findings: CA-001
      Done when: inviter/accepting user/role are derived or validated server-side and owner/`users.manage` tests pass.

- [x] 1.5 Split Convex sync membership checks into read, write, and administrative-GC capabilities
      Requirements: R1.AC1, R1.AC2
      Components: C1, C2
      Findings: CA-002
      Done when: viewers can pull but cannot push or run GC, and only bounded internal/admin GC is callable.

- [x] 1.6 Make Convex identity provisioning return one stable internal user ID on first and later requests
      Requirements: R1.AC8
      Components: C1, C2
      Findings: CA-004
      Done when: first-request and existing-user paths return the same ID and Basic Auth UUIDs are never cast by prefix guessing.

- [x] 1.7 Add target-workspace membership authorization for workspace activation
      Requirements: R1.AC4
      Components: C1, C2
      Findings: CA-005
      Done when: the real policy permits a member to activate the target workspace and rejects a non-member without mocking `can()`.

- [x] 1.8 Make invite validation, user creation, membership creation, and consumption atomic
      Requirements: R1.AC5
      Components: C1, C2
      Findings: CA-006
      Done when: injected failures at every step leave neither a bypass-capable user nor a reusable consumed invite.

- [x] 1.9 Validate Basic Auth invite signature, expiry, state, and normalized email before account creation
      Requirements: R1.AC5
      Components: C1, C2
      Findings: CA-007
      Done when: garbage, expired, consumed, and wrong-email tokens fail before user/session creation.

- [x] 1.10 Require verified primary email for Clerk email-bound provisioning
      Requirements: R1.AC6
      Components: C1, C2
      Findings: CA-008
      Done when: absent/unverified primary email is rejected and verified email succeeds.

- [x] 1.11 Replace raw bearer/cookie token cache keys with namespaced digests and authorization revision
      Requirements: R1.AC8, R11.AC4
      Components: C1, C2
      Findings: CA-009
      Done when: cache inspection and logs contain no raw credential and role/membership revisions invalidate stale entries.

- [x] 1.12 Add generation checks so stale session requests cannot overwrite newer auth/workspace state
      Requirements: R1.AC8
      Components: C1, C2
      Findings: CA-010
      Done when: deferred older refresh completing after sign-out or workspace change is ignored.

- [x] 1.13 Broadcast active-workspace revisions across tabs and reject stale commits
      Requirements: R4.AC7
      Components: C1, C2
      Findings: CA-011
      Done when: two-tab tests converge on the latest workspace and older in-flight requests cannot switch it back.

- [x] 1.14 Internalize auxiliary Convex persistence and subject-bind remaining public job/user operations
      Requirements: R1.AC1, R1.AC2, R1.AC3, R4.AC4
      Components: C1, C2, C11, C13
      Findings: CA-012
      Done when: direct callers cannot create/update/complete/fail/clean background jobs, author cross-user notifications, mutate webhook delivery state, or choose rate-limit subjects; any remaining public get/abort/read operations derive ownership from authenticated context and reject wildcard bypasses.

## 2. Snapshot bootstrap and retention safety

- [x] 2.1 Define the provider-neutral snapshot/high-watermark contract and pagination token
      Requirements: R2.AC1, R2.AC5
      Components: C3, C15
      Findings: CS-001
      Done when: types specify consistency point, page ordering, included tables/tombstones, and replay boundary.

- [x] 2.2 Implement snapshot page generation from canonical SQLite materialized tables
      Requirements: R2.AC1, R2.AC5
      Components: C3, C15
      Findings: CS-001
      Done when: a bounded page fixture returns every live row exactly once at one high-watermark.

- [x] 2.3 Implement snapshot page generation from canonical Convex materialized tables
      Requirements: R2.AC1, R2.AC5
      Components: C3, C15
      Findings: CS-001
      Done when: paginated Convex tests return the same logical snapshot and watermark as the shared fixture.

- [x] 2.4 Implement transactional client snapshot apply into an empty workspace database
      Requirements: R2.AC1
      Components: C3, C15
      Findings: CS-001
      Done when: failure rolls back the partial snapshot and success stores the watermark before incremental replay.

- [x] 2.5 Start incremental replay strictly after the applied snapshot watermark
      Requirements: R2.AC1
      Components: C3, C15
      Findings: CS-001
      Done when: changes committed before/during/after snapshot generation appear exactly once in concurrency tests.

- [x] 2.6 Add fresh-device-after-retention integration fixtures for SQLite and Convex
      Requirements: R2.AC1, R12.AC1
      Components: C3, C15
      Findings: CS-001
      Done when: unchanged records whose original log entries are absent still bootstrap completely.

- [x] 2.7 Validate device cursor type, monotonicity, workspace maximum, and ownership
      Requirements: R2.AC3, R2.AC4
      Components: C3, C15
      Findings: CS-008
      Done when: negative, fractional, regressing, future, and cross-device/workspace cursor tests fail.

- [x] 2.8 Bound retention arguments and server-bind tombstone deletion timestamps
      Requirements: R2.AC4
      Components: C3, C15
      Findings: CS-015
      Done when: clients cannot accelerate retention with supplied timestamps or unbounded retention/cursor values.

- [x] 2.9 Re-enable sync retention only behind snapshot capability and passing contract tests
      Requirements: R2.AC2, R12.AC1
      Components: C3, C15
      Findings: CS-001
      Done when: unsupported providers remain disabled and supported providers pass snapshot-plus-replay tests before deletion runs.

- [x] 2.10 Honor bounded `Retry-After` values in pull polling
      Requirements: R2.AC6
      Components: C3, C15
      Findings: CS-017
      Done when: seconds and HTTP-date forms delay the next pull and abort interrupts the delay.

## 3. Deterministic revision, tombstone, and batch semantics

- [x] 3.1 Implement and exhaustively test one `(clock, HLC, opId)` comparator
      Requirements: R3.AC1
      Components: C4, C5, C15
      Findings: CS-002, CS-003, CS-005, CS-006, CS-012
      Done when: shared winner fixtures cover puts, deletes, equal clocks, equal HLCs, and deterministic final ties.

- [x] 3.2 Extend shared and Convex tombstone schemas with HLC, op ID, version, and server deletion time
      Requirements: R3.AC1, R3.AC4, R12.AC3
      Components: C4, C5, C15
      Findings: CS-006, CS-015
      Done when: schema/type generation and compatibility reads pass for legacy and new tombstones.

- [x] 3.3 Add idempotent legacy tombstone backfill and forward-repair command
      Requirements: R3.AC4, R12.AC3
      Components: C4, C5, C15
      Findings: CS-006
      Done when: repeated execution is safe and ambiguous legacy ties are surfaced rather than silently guessed.

- [x] 3.4 Compare Convex missing-row inserts against existing tombstones
      Requirements: R3.AC1
      Components: C4, C5, C15
      Findings: CS-002
      Done when: stale puts cannot resurrect deleted records and newer puts deterministically win.

- [x] 3.5 Update local per-key resolver state after every operation in a pulled page
      Requirements: R3.AC2
      Components: C4, C5, C15
      Findings: CS-003
      Done when: winning clock 2 followed by losing clock 1 leaves the fresh client at clock 2.

- [x] 3.6 Atomically stamp the same revision tuple onto each local row and outbox operation
      Requirements: R3.AC3
      Components: C4, C5, C15
      Findings: CS-005
      Done when: transaction-failure tests cannot observe a row/op revision mismatch.

- [x] 3.7 Add missing revision fields to every synced table or define a canonical sidecar revision table
      Requirements: R3.AC3, R12.AC3
      Components: C4, C5, C15
      Findings: CS-005
      Done when: all synced table registrations have one tested revision source and migration path.

- [x] 3.8 Deduplicate identical in-batch operation IDs before version allocation
      Requirements: R3.AC5
      Components: C4, C5, C15
      Findings: CS-007
      Done when: identical duplicates apply once and conflicting duplicate payloads fail without consuming multiple versions.

- [x] 3.9 Replace millisecond outbox coalescing with monotonic revision ordering
      Requirements: R3.AC6
      Components: C4, C5, C15
      Findings: CS-011
      Done when: same-tick put/delete and delete/put sequences retain the later logical operation.

- [x] 3.10 Reject mutations of logical primary key and indexed ownership fields
      Requirements: R3.AC7
      Components: C4, C5, C15
      Findings: CS-014
      Done when: update payloads cannot move an existing record to another logical key/workspace/user.

- [x] 3.11 Make soft-delete helpers emit delete operations and tombstones
      Requirements: R4.AC3
      Components: C4, C5, C15
      Findings: CS-016
      Done when: soft-delete fixtures produce delete transport semantics and prevent later stale resurrection.

- [x] 3.12 Port the shared stale-delete comparison to the Convex provider template
      Requirements: R3.AC8, R12.AC1
      Components: C4, C5, C15
      Findings: CS-012
      Done when: generated template tests reject an older delete against newer live data.

- [x] 3.13 Isolate malformed operations within a batch result
      Requirements: R4.AC2
      Components: C4, C5, C15
      Findings: CS-013
      Done when: one malformed operation fails permanently while valid siblings apply and return their own versions.

## 4. Durable sync lifecycle and data scoping

- [x] 4.1 Replace implicit outbox failure handling with explicit recoverable states
      Requirements: R4.AC1
      Components: C2, C5
      Findings: CS-004
      Done when: schema/types distinguish retry wait, retry-exhausted, permanent, applied, and discarded states.

- [x] 4.2 Remove startup deletion of retry-exhausted outbox operations
      Requirements: R4.AC1
      Components: C2, C5
      Findings: CS-004
      Done when: reload preserves the failed operation and its original payload/error metadata.

- [x] 4.3 Implement explicit retry and discard operations for retained failures
      Requirements: R4.AC1
      Components: C2, C5
      Findings: CS-004
      Done when: retry returns an operation to pending and discard records an intentional terminal decision.

- [x] 4.4 Move notifications to a user-scoped stream with server-bound authorship
      Requirements: R4.AC4
      Components: C2, C5
      Findings: CS-009
      Done when: workspace members cannot pull or author another user's notification.

- [x] 4.5 Replace lossy oversized-message sanitization with typed rejection or lossless externalization
      Requirements: R4.AC5
      Components: C2, C5
      Findings: CS-010
      Done when: oversized message content is never replaced by a success marker and its outbox operation remains recoverable.

- [x] 4.6 Add a sync lifecycle generation to every subscription, poll, timer, and callback
      Requirements: R4.AC6
      Components: C2, C5
      Findings: CS-018
      Done when: callbacks resolving after `stop()` cannot resubscribe or schedule more work.

- [x] 4.7 Add shutdown/restart race tests for pull, push, subscriptions, and backoff timers
      Requirements: R4.AC6, R12.AC5
      Components: C2, C5
      Findings: CS-018
      Done when: every deferred completion is ignored after stop and explicit restart creates exactly one loop.

## 5. Canonical storage, upload integrity, quota, and GC

- [x] 5.1 Define the canonical storage-reference query contract
      Requirements: R5.AC1, R5.AC5, R5.AC6
      Components: C6, C7, C15
      Findings: CST-001, CST-006, CST-010
      Done when: providers can page live metadata and reference edges without reading retained operation logs.

- [x] 5.2 Switch quota calculation to canonical materialized metadata plus active reservations
      Requirements: R5.AC1, R5.AC4
      Components: C6, C7, C15
      Findings: CST-001, CST-009
      Done when: pruned logs and losing LWW operations cannot undercount or overcount live bytes.

- [x] 5.3 Switch filesystem GC to canonical reference queries
      Requirements: R5.AC1, R5.AC5
      Components: C6, C7, C15
      Findings: CST-001
      Done when: pruned winning puts and later losing deletes never make a live blob eligible.

- [x] 5.4 Verify S3 marker/blob counterparts beyond the current listing page
      Requirements: R5.AC2
      Components: C6, C7, C15
      Findings: CST-002
      Done when: split-page tests in both object orders issue no false deletion.

- [x] 5.5 Make committed S3 blob/marker pairs eligible for canonical reference-driven GC
      Requirements: R5.AC5
      Components: C6, C7, C15
      Findings: CST-010
      Done when: an unreferenced retained pair is deleted together while any referenced pair survives.

- [x] 5.6 Add upload-intent and quota-reservation persistence with expiry and one-time consumption
      Requirements: R5.AC3, R5.AC4, R12.AC3
      Components: C6, C7, C15
      Findings: CST-007, CST-008, CST-009
      Done when: schema/migration tests cover reserve, commit, cancel, expire, and duplicate consumption.

- [x] 5.7 Bind Convex upload commit to intent, workspace, object ID, digest, size, and MIME
      Requirements: R5.AC3
      Components: C6, C7, C15
      Findings: CST-007
      Done when: arbitrary object IDs, wrong digest/size/MIME, replayed intent, and cross-workspace commit fail.

- [x] 5.8 Require S3 checksum and maximum content length at presign/upload
      Requirements: R5.AC3
      Components: C6, C7, C15
      Findings: CST-008
      Done when: provider tests reject wrong SHA-256 and oversized uncommitted objects.

- [x] 5.9 Re-verify actual S3 object metadata at commit and consume the intent atomically
      Requirements: R5.AC3, R5.AC4
      Components: C6, C7, C15
      Findings: CST-008, CST-009
      Done when: commit cannot succeed after reservation expiry, object mutation, or concurrent intent consumption.

- [x] 5.10 Make quota reservation atomic across concurrent presign requests
      Requirements: R5.AC4
      Components: C6, C7, C15
      Findings: CST-009
      Done when: parallel uploads cannot collectively reserve beyond the workspace quota.

- [x] 5.11 Remove `ref_count` as an imported authority or recompute it transactionally
      Requirements: R5.AC6
      Components: C6, C7, C15
      Findings: CST-006
      Done when: inbound sync cannot produce `NaN`/arbitrary reference counts and GC reads canonical references.

- [x] 5.12 Page FS and Convex GC scans before applying per-run batch limits
      Requirements: R5.AC8
      Components: C6, C7, C15
      Findings: CST-013
      Done when: load tests show bounded memory and database reads for large metadata sets.

- [x] 5.13 Cap all signed storage URL lifetimes at one hour
      Requirements: R5.AC7
      Components: C6, C7, C15
      Findings: CST-014
      Done when: configuration validation and provider tests reject longer TTLs.

- [x] 5.14 Create reusable canonical-storage contract fixture helpers
      Requirements: R5.AC1-R5.AC8, R12.AC1
      Components: C6, C7, C15
      Findings: CST-001, CST-002, CST-006-CST-010, CST-013, CST-014
      Done when: one fixture API can express live-reference, checksum, quota, marker-pair, pagination, and retention cases and one provider executes a sentinel case.

## 6. Workspace-bound transfer queue recovery

- [x] 6.1 Add typed `pending_upload` and `remote_missing` transfer outcomes
      Requirements: R6.AC1
      Components: C8, C15
      Findings: CST-003
      Done when: callers can distinguish temporary metadata absence from authoritative deletion.

- [x] 6.2 Remove synced deletion and cached-blob removal from missing `storage_id` and single 404/410 paths
      Requirements: R6.AC1
      Components: C8, C15
      Findings: CST-003
      Done when: existing destructive expectations are replaced with non-mutating retry/reconciliation tests.

- [x] 6.3 Capture immutable `{workspaceId, dbName, db}` context for each claimed transfer
      Requirements: R6.AC2
      Components: C8, C15
      Findings: CST-004
      Done when: switching the active workspace cannot redirect row/blob writes or cleanup.

- [x] 6.4 Add transfer lease owner, expiry, retry-at, and attempt fields with migration
      Requirements: R6.AC3, R12.AC3
      Components: C8, C15
      Findings: CST-005
      Done when: legacy queued/running rows migrate idempotently and expired running rows are queryable.

- [x] 6.5 Implement transactional transfer claim and lease renewal
      Requirements: R6.AC3
      Components: C8, C15
      Findings: CST-005
      Done when: two workers/tabs cannot own the same transfer and a healthy owner renews before expiry.

- [x] 6.6 Recover stale running transfers after crash/reload
      Requirements: R6.AC3
      Components: C8, C15
      Findings: CST-005
      Done when: simulated crash followed by a new runner reclaims and completes the transfer exactly once.

- [x] 6.7 Make queue pumping honor persisted `retryAt`
      Requirements: R6.AC4
      Components: C8, C15
      Findings: CST-011
      Done when: immediate rescheduling cannot bypass exponential backoff and wakeup occurs at the intended time.

- [x] 6.8 Stream downloads with a hard byte cap and MIME verification
      Requirements: R6.AC5
      Components: C8, C15
      Findings: CST-012
      Done when: large/lying responses abort before exceeding the cap, avoid duplicate whole buffers, and preserve verified MIME.

- [x] 6.9 Centralize transfer execution cleanup in an idempotent disposer
      Requirements: R6.AC6
      Components: C8, C15
      Findings: CST-015
      Done when: success, failure, abort, timeout, workspace switch, and disposal leave zero timers/waiters/listeners/object URLs.

- [x] 6.10 Create reusable transfer fault-injection fixture helpers
      Requirements: R6.AC1-R6.AC6, R12.AC5
      Components: C8, C15
      Findings: CST-003-CST-005, CST-011, CST-012, CST-015
      Done when: deferred I/O, crash, multi-runner, workspace-switch, retry-clock, oversize-response, and timeout controls are reusable and one sentinel scenario passes.

## 7. Tool authorization, validation, idempotency, and cancellation

- [x] 7.1 Introduce `ToolExecutionContext` and compatibility overloads for existing handlers
      Requirements: R1.AC3, R7.AC4
      Components: C1, C11, C14
      Findings: CHT-002, CHT-004
      Done when: server/client handlers can receive subject, workspace, thread, message, call, request, and abort context.

- [x] 7.2 Snapshot request-scoped allowed tool definitions before streaming
      Requirements: R7.AC1
      Components: C1, C11, C14
      Findings: CHT-001
      Done when: enabled/runtime changes after request admission cannot expand the active allowlist.

- [x] 7.3 Enforce allowlist, enabled state, runtime, and definition equality before foreground execution
      Requirements: R7.AC1
      Components: C1, C11, C14
      Findings: CHT-001
      Done when: disabled, server-only, and unadvertised registered handlers receive zero calls.

- [x] 7.4 Enforce allowlist and authenticated authorization context before background server execution
      Requirements: R1.AC3, R7.AC1
      Components: C1, C11, C14
      Findings: CHT-002
      Done when: a model returning an unadvertised privileged name cannot invoke it and handlers receive exact authenticated context.

- [x] 7.5 Add one shared standards-compliant JSON Schema validator
      Requirements: R7.AC2
      Components: C1, C11, C14
      Findings: CHT-005
      Done when: client/server tests identically reject wrong types, enums, bounds, nested requirements, and additional properties.

- [x] 7.6 Validate tool definitions at registration and server request boundaries
      Requirements: R7.AC2
      Components: C1, C11, C14
      Findings: CHT-005
      Done when: malformed schemas and mismatched client/server definitions fail before provider invocation.

- [x] 7.7 Define the call-ID fingerprint and ledger result contract
      Requirements: R7.AC3
      Components: C1, C11, C14
      Findings: CHT-003
      Done when: unit tests distinguish new, exact replay, conflicting replay, running, completed, and failed states.

- [x] 7.8 Apply replay protection to foreground tool loops
      Requirements: R7.AC3
      Components: C1, C11, C14
      Findings: CHT-003
      Done when: duplicate call events/iterations invoke the handler once and exact replay returns the prior result.

- [x] 7.9 Persist the background tool ledger before and after side effects
      Requirements: R7.AC3, R9.AC1
      Components: C1, C11, C14
      Findings: CHT-003, CHP-006
      Done when: reconnect or post-handler persistence retry cannot repeat a completed side effect.

- [x] 7.10 Replace `Promise.race` timeout helpers with composed abort signals and typed errors
      Requirements: R7.AC4, R10.AC3
      Components: C1, C11, C14
      Findings: CHT-004
      Done when: timers clear on fast success, cooperative handlers abort, and ordinary errors containing “timeout” are not misclassified.

- [x] 7.11 Enforce UTF-8 byte limits for arguments, durable results, previews, model output, and SSE state
      Requirements: R7.AC5, R11.AC4
      Components: C1, C11, C14
      Findings: CHT-006
      Done when: N-byte boundaries and one-megabyte result fixtures remain within every configured representation limit.

- [x] 7.12 Remove raw tool arguments/results from production logging
      Requirements: R7.AC5, R11.AC4
      Components: C1, C11, C14
      Findings: CHT-007
      Done when: password, API key, email, malformed JSON, and oversized payload tests reveal only length/hash/correlation metadata.

- [x] 7.13 Return ownership-bound tool registration disposers and stop watcher handles on unregister
      Requirements: R7.AC6, R8.AC6
      Components: C1, C11, C14
      Findings: CHT-008, CHT-009
      Done when: plugin A disposal cannot unregister plugin B's replacement and repeated register/unregister leaves no active watcher.

- [x] 7.14 Align the public tool API types, runtime shape, and documentation
      Requirements: R7.AC2, R12.AC1
      Components: C1, C11, C14
      Findings: CHT-010
      Done when: `defineTool` accepts a validated `ToolDefinition`, documented `listTools`/`hydrate` usage matches runtime, and contract tests compile and pass.

## 8. Chat request state machine and user actions

- [x] 8.1 Define `SendResult`, `ChatRequestState`, and typed terminal failure reasons
      Requirements: R8.AC1, R8.AC4, R10.AC3
      Components: C9, C10, C12
      Findings: CHO-001, CHO-006
      Done when: public contracts represent accepted, rejected, failed, aborted, complete, and detached states without `void` ambiguity.

- [x] 8.2 Add atomic in-flight admission before the first `sendMessage` await
      Requirements: R8.AC1
      Components: C9, C10, C12
      Findings: CHO-001
      Done when: two sends during a deferred hook create one accepted request and one deterministic busy rejection.

- [x] 8.3 Move abort controller, accumulator, stream ID, tool ledger, and persistence handles into request scope
      Requirements: R8.AC1
      Components: C9, C10, C12
      Findings: CHO-001
      Done when: concurrent/replaced requests cannot reset, abort, or persist another request's state.

- [x] 8.4 Separate cumulative UI assistant content from per-tool-iteration provider content
      Requirements: R8.AC2
      Components: C9, C10, C12
      Findings: CHO-002
      Done when: multi-iteration fixtures send only each iteration's own assistant preamble while UI content remains cumulative.

- [x] 8.5 Make foreground and background iteration-limit exhaustion a typed terminal error
      Requirements: R8.AC2, R10.AC5
      Components: C9, C10, C12
      Findings: CHO-003
      Done when: the final allowed tool request never finalizes as success without a model response.

- [x] 8.6 Implement branch-preserving retry admission before any tombstone/delete
      Requirements: R8.AC3
      Components: C9, C10, C12
      Findings: CHO-004
      Done when: missing key, filter, quota, and thrown-send cases leave the original turn unchanged.

- [x] 8.7 Build retry context from the selected turn boundary, including associated tool rows and excluding future turns
      Requirements: R8.AC3, R9.AC1
      Components: C9, C10, C12
      Findings: CHO-005, CHP-006
      Done when: retrying an older turn produces a valid branch with no orphan tool rows or later conversation context.

- [x] 8.8 Make composer submission await `SendResult` and clear only after durable acceptance
      Requirements: R8.AC4
      Components: C9, C10, C12
      Findings: CHO-006
      Done when: auth/filter/limit/busy rejection preserves text, editor JSON, attachments, and object URLs.

- [x] 8.9 Replace presentation-only history mutation with an atomic canonical history API
      Requirements: R8.AC5
      Components: C9, C10, C12
      Findings: CHO-007
      Done when: a parent/sync edit changes both visible UI and the next provider payload.

- [x] 8.10 Trim complete conversation/tool groups while protecting only system and final-user input
      Requirements: R8.AC7
      Components: C9, C10, C12
      Findings: CHO-008
      Done when: returned token count is bounded and no assistant tool call is separated from its tool results.

- [x] 8.11 Dispose the previous chat instance before prompt/thread replacement and split `dispose` from conversation clearing
      Requirements: R8.AC6
      Components: C9, C10, C12
      Findings: CHO-009
      Done when: repeated prompt/thread changes leave exactly one hook/subscription set and clearing has explicit persistence semantics.

- [x] 8.12 Make programmatic pane submission asynchronous and return the real `SendResult`
      Requirements: R8.AC4
      Components: C9, C10, C12
      Findings: CHO-010
      Done when: loading/auth/filter/limit rejection returns the correct result instead of `true`, and accepted sends await durable admission.

- [x] 8.13 Bound the live `HelpChat` tool loop after confirming its runtime consumer
      Requirements: R8.AC2, R12.AC1
      Components: C9, C10, C12
      Findings: CHO-011
      Done when: runtime registration search identifies the documentation consumer and the live implementation uses the shared iteration cap and typed terminal failure.

## 9. Canonical transcript, persistence, and reload recovery

- [x] 9.1 Define canonical transcript records and parent/call/generation relationships
      Requirements: R9.AC1, R9.AC8
      Components: C10, C11, C13
      Findings: CHP-006, CHP-009
      Done when: types can represent user, assistant, tool call, tool result, reasoning, files, branch, and terminal state without transport-specific fields.

- [x] 9.2 Implement UI and OpenRouter projections from the canonical transcript
      Requirements: R8.AC5, R9.AC1
      Components: C10, C11, C13
      Findings: CHO-007, CHP-006
      Done when: persisted tool transcripts round-trip into valid assistant `tool_calls` followed by matching tool messages.

- [x] 9.3 Migrate the foreground writer to the canonical tool transcript
      Requirements: R9.AC1, R10.AC5
      Components: C10, C11, C13
      Findings: CHP-006
      Done when: foreground tool calls/results persist through the canonical repository and round-trip into a valid provider projection.

- [x] 9.4 Consolidate duplicate assistant persisters into latest-row patch operations
      Requirements: R9.AC2
      Components: C10, C11, C13
      Findings: CHP-007, CHP-011
      Done when: one implementation transactionally preserves concurrent custom data, edits, files, reasoning, and tool state.

- [x] 9.5 Persist completed tool state before issuing the next model request
      Requirements: R7.AC3, R9.AC2
      Components: C10, C11, C13
      Findings: CHP-011
      Done when: a crash between tool completion and follow-up request reloads the completed ledger/result rather than `loading`.

- [x] 9.6 Finalize or delete assistant placeholders when background start fails
      Requirements: R9.AC3
      Components: C10, C11, C13
      Findings: CHP-002
      Done when: start rejection, 503, malformed JSON, and local metadata failure never leave a reload spinner.

- [x] 9.7 Pin originating workspace/database identity in background trackers
      Requirements: R9.AC4
      Components: C10, C11, C13
      Findings: CHP-003
      Done when: switching workspaces does not abort the job and completion writes only to the origin database.

- [x] 9.8 Persist a foreground generation lease/heartbeat and reconcile stale pending rows
      Requirements: R9.AC5
      Components: C10, C11, C13
      Findings: CHP-004
      Done when: reload and A→B→A navigation either reattach or surface `stream_interrupted`, never an endless pending row.

- [x] 9.9 Persist continuation `pending:true`, new stream ID, and cleared error before streaming
      Requirements: R9.AC6
      Components: C10, C11, C13
      Findings: CHP-005
      Done when: inspecting Dexie after the first continuation delta shows the correct in-progress generation identity.

- [x] 9.10 Include tool/workflow fingerprints in background dirty-state persistence
      Requirements: R9.AC7
      Components: C10, C11, C13
      Findings: CHP-008
      Done when: no-text tool loading→complete and workflow/HITL version changes persist, while identical repeats do not write.

- [x] 9.11 Re-read normalized neighbors and query/sort messages by `(index, order_key)`
      Requirements: R9.AC8
      Components: C10, C11, C13
      Findings: CHP-009
      Done when: adjacent insert-after and equal-index sync fixtures produce one deterministic order across UI/model/reload.

- [x] 9.12 Remove or replace the unbounded module-global raw message archive
      Requirements: R11.AC5
      Components: C10, C11, C13
      Findings: CHP-010
      Done when: production retains no global raw conversation/file archive; any development replacement is redacted and bounded.

- [x] 9.13 Migrate the background writer to the canonical tool transcript
      Requirements: R9.AC1, R10.AC5
      Components: C10, C11, C13
      Findings: CHP-006
      Done when: an equivalent foreground/background tool fixture produces identical durable records and provider projections.

## 10. Streaming protocol, background recovery, and resource bounds

- [x] 10.1 Replace line-based parsing with a standards-compliant SSE event parser
      Requirements: R10.AC1
      Components: C12, C13, C14
      Findings: CHS-001
      Done when: optional space, multiline data, split UTF-8, CRLF, comments, and final unterminated event tests pass.

- [x] 10.2 Normalize provider error envelopes and finish reasons into typed stream failures
      Requirements: R10.AC1
      Components: C12, C13, C14
      Findings: CHS-001
      Done when: top-level error, error finish reason, and partial-text-then-error never become successful completion.

- [x] 10.3 Emit exactly one terminal event and terminate consumption immediately on `[DONE]`
      Requirements: R10.AC1
      Components: C12, C13, C14
      Findings: CHS-001
      Done when: an upstream connection left open after `[DONE]` cannot keep the request pending.

- [x] 10.4 Add typed retryable polling errors and bounded jitter/backoff
      Requirements: R10.AC2
      Components: C12, C13, C14
      Findings: CHP-001
      Done when: offline, 429, and 5xx polls retain tracking and later authoritative completion succeeds.

- [x] 10.5 Add bounded not-found and auth-refresh reconciliation for background polling
      Requirements: R10.AC2
      Components: C12, C13, C14
      Findings: CHP-001
      Done when: transient 404/401 behavior is classified without instantly fabricating model failure.

- [x] 10.6 Preserve `aborted` when upstream fetch rejects before response headers
      Requirements: R10.AC3
      Components: C12, C13, C14
      Findings: CHS-002
      Done when: foreground/background/tool pre-header abort remains aborted and emits no failure notification.

- [x] 10.7 Compose caller abort, response deadline, and idle watchdog signals for all upstream operations
      Requirements: R10.AC3, R10.AC4
      Components: C12, C13, C14
      Findings: CHS-003
      Done when: never-resolving headers, silent bodies, retry sleeps, and background-start waits terminate predictably.

- [x] 10.8 Extract a pure normalized stream/tool-loop reducer and migrate foreground consumption
      Requirements: R10.AC5
      Components: C12, C13, C14
      Findings: CHO-002, CHO-003, CHP-006, CHS-002, CHS-003
      Done when: foreground transport feeds normalized events into the reducer and no longer owns independent iteration/content/terminal rules.

- [x] 10.9 Migrate background consumption to the shared reducer and add parity fixtures
      Requirements: R10.AC5, R12.AC5
      Components: C12, C13, C14
      Findings: CHO-002, CHO-003, CHP-006, CHS-001-CHS-003
      Done when: background transport owns only I/O/persistence adaptation and sentinel text/tool/abort fixtures match foreground canonical states.

- [x] 10.10 Replace per-viewer 80 ms polling with one adaptive per-job reconciliation loop
      Requirements: R11.AC1
      Components: C12, C13, C14
      Findings: CHS-005
      Done when: N viewers create one provider poller and healthy live delivery suppresses hot polling.

- [x] 10.11 Bound SSE viewer queues and share idempotent cancel/close cleanup
      Requirements: R11.AC2
      Components: C12, C13, C14
      Findings: CHS-004
      Done when: slow consumers stay under the byte cap, disconnect with an offset, and leave no listener/interval.

- [x] 10.12 Coalesce provider and Dexie stream writes by time/size with terminal flush
      Requirements: R11.AC3
      Components: C12, C13, C14
      Findings: CHS-005, CHS-006
      Done when: 500 text and 200 reasoning events produce bounded writes without losing terminal content/reasoning.

- [x] 10.13 Track all dirty event kinds instead of using text-only modulo persistence
      Requirements: R11.AC3
      Components: C12, C13, C14
      Findings: CHS-006
      Done when: reasoning/image/tool-only streams do not write once per event and still persist progress.

- [x] 10.14 Expose and reset accumulator aborted state
      Requirements: R10.AC6
      Components: C12, C13, C14
      Findings: CHS-007
      Done when: abort, success, error, and reset tests expose distinct accurate public state.

- [x] 10.15 Remove prompt/body previews from direct OpenRouter production failure logs
      Requirements: R11.AC4
      Components: C12, C13, C14
      Findings: CHS-008
      Done when: a secret prompt/tool argument is absent from captured production diagnostics.

- [x] 10.16 Isolate background subscribers and finalize polling state after persistence/callback exceptions
      Requirements: R9.AC2, R10.AC2
      Components: C12, C13, C14
      Findings: CHP-012
      Done when: one throwing subscriber or transient Dexie failure cannot leave `polling=true`, lose the durable offset, or prevent later completion.

- [x] 10.17 Replace ambiguous streamed-field duplicate heuristics with an explicit provider mode
      Requirements: R10.AC1
      Components: C12, C13, C14
      Findings: CHS-009
      Done when: two identical standard argument deltas concatenate, cumulative snapshots replace, and both modes have fixtures.

- [x] 10.18 Bound stream-hook backlog and isolate slow/failing hook consumers
      Requirements: R11.AC3
      Components: C12, C13, C14
      Findings: CHS-010
      Done when: a slow hook cannot retain an unbounded per-token promise chain or delay terminal persistence beyond the configured bound.

## 11. Provider parity, migrations, documentation, and release verification

- [x] 11.1 Build shared authorization contract fixtures for Convex, Basic Auth, Clerk, and core routes
      Requirements: R1.AC1-R1.AC8, R12.AC1
      Components: C14, C15
      Findings: CA-001-CA-010
      Done when: direct/public/provider paths pass the same subject, role, invite, email, and stale-session cases.

- [x] 11.2 Build the shared sync contract-harness adapter API
      Requirements: R2.AC1-R2.AC6, R3.AC1-R3.AC8, R12.AC1
      Components: C14, C15
      Findings: CS-001-CS-018
      Done when: SQLite, Convex, and generated-template adapters can execute one common bootstrap and one common revision fixture; individual implementation tasks own the remaining cases.

- [x] 11.3 Wire FS, S3, and Convex into the shared storage/transfer harnesses
      Requirements: R5.AC1-R5.AC8, R6.AC1-R6.AC6, R12.AC1
      Components: C14, C15
      Findings: CST-001-CST-015
      Done when: all three providers execute one shared reference fixture and applicable transfer providers execute one shared lease fixture.

- [x] 11.4 Build the chat adversarial state-transition harness
      Requirements: R7-R11, R12.AC5
      Components: C14, C15
      Findings: CHT-001-CHT-010, CHO-001-CHO-011, CHP-001-CHP-012, CHS-001-CHS-010
      Done when: fake clock, deferred transport, reloadable Dexie, duplicate-event, workspace-switch, slow-consumer, and abort controls are reusable and one sentinel transition passes.

- [x] 11.5 Add migration dry-run, repeat-run, and forward-repair verification
      Requirements: R12.AC3
      Components: C14, C15
      Findings: CS-005, CS-006, CST-005, CST-007-CST-009, CHP-006, CHP-009
      Done when: every new schema field/data model has idempotent migration evidence and a documented repair path.

- [x] 11.6 Prevent cloud/auth provider runtime modules from loading during static generation
      Requirements: R12.AC2
      Components: C14, C15
      Findings: CR-001
      Done when: static import-boundary/build tests prove disabled provider modules are absent from evaluation and output paths.

- [x] 11.7 Update public architecture and provider documentation to match implemented contracts
      Requirements: R12.AC1-R12.AC3
      Components: C14, C15
      Findings: all
      Done when: docs describe capability gates, snapshot bootstrap, revision tuple, canonical storage, transfer leases, chat state machine, transcript, tool boundary, and streaming recovery without stale claims.

- [x] 11.8 Run and record main application verification commands
      Requirements: R12.AC4
      Components: C14, C15
      Findings: all `or3-chat` findings
      Done when: `bun run test`, `bun run type-check`, `bun run check-imports`, required SSR/static builds, and targeted integration suites are green.

- [ ] 11.9 Run and record every provider's tests, type checks, and required builds
      Requirements: R12.AC1, R12.AC4
      Components: C14, C15
      Findings: all cloud/provider findings
      Done when: Basic Auth, Clerk, Convex, SQLite, FS, and S3 packages pass their `bun run test`, `bun run type-check`, and relevant build commands.
      Blocked: Basic Auth has 27 passing tests, a passing type check, and a passing build, but its 10 loopback endpoint tests cannot bind `127.0.0.1` in this sandbox. The escalation request was rejected because the approval service reported its account usage limit. Exact evidence is in `verification.md`.

- [x] 11.10 Run bounded-memory and write-amplification performance gates
      Requirements: R2.AC5, R5.AC8, R11.AC1-R11.AC3, R12.AC4
      Components: C14, C15
      Findings: CST-013, CHS-004-CHS-006
      Done when: measured page counts, heap bounds, viewer queue bytes, poller counts, and persistence write counts meet documented limits.

- [ ] 11.11 Close findings and lift the release block
      Requirements: R12.AC4, R12.AC5
      Components: C14, C15
      Findings: all
      Done when: every Blocker/High finding status is Closed, every linked task/test is complete, temporary containment is safely retired, and unresolved lower-severity items are explicitly accepted with owners.
      Blocked: all findings are Closed; release-gate removal awaits only task 11.9's environment-blocked Basic Auth endpoint rerun.

## Traceability Matrix

| Requirement | Design component(s) | Task sections |
|---|---|---|
| R1 | C1 CapabilityGate, C2 IdentitySessionCoordinator, C11 ToolExecutionBoundary | 0, 1, 7, 11 |
| R2 | C3 SnapshotBootstrap, C15 ProviderContractHarness | 0, 2, 11 |
| R3 | C4 RevisionResolver, C5 DurableOutbox, C15 ProviderContractHarness | 3, 11 |
| R4 | C2 IdentitySessionCoordinator, C5 DurableOutbox | 1, 3, 4, 11 |
| R5 | C1 CapabilityGate, C6 CanonicalStorageIndex, C7 UploadIntentQuotaManager | 0, 5, 11 |
| R6 | C8 TransferLeaseRunner | 6, 11 |
| R7 | C11 ToolExecutionBoundary | 7, 11 |
| R8 | C9 ChatRequestMachine, C10 TranscriptRepository, C12 NormalizedStreamEngine | 8, 9, 10, 11 |
| R9 | C10 TranscriptRepository, C11 ToolExecutionBoundary, C13 BackgroundDeliveryHub | 7, 9, 10, 11 |
| R10 | C9 ChatRequestMachine, C12 NormalizedStreamEngine, C13 BackgroundDeliveryHub | 7, 8, 10, 11 |
| R11 | C11 ToolExecutionBoundary, C12 NormalizedStreamEngine, C13 BackgroundDeliveryHub, C14 RedactingDiagnostics | 7, 9, 10, 11 |
| R12 | C14 RedactingDiagnostics, C15 ProviderContractHarness | 0, 2-11 |

## Definition of Done

- Every acceptance criterion in `requirements.md` has deterministic verification evidence.
- Every Blocker and High finding in `findings.md` is Closed and every linked task is checked.
- All schema migrations/backfills are idempotent and have forward-repair instructions.
- Main application and provider tests, type checks, import-boundary checks, static/SSR builds, and contract suites are green.
- Fresh-device bootstrap after retention, direct authorization, LWW convergence, storage integrity/GC, transfer recovery, tool replay, chat reload, and malformed/aborted streaming tests pass.
- Performance tests demonstrate bounded GC/snapshot memory, background pollers, SSE queue bytes, transfer download bytes, tool payloads, and streaming persistence writes.
- Public documentation reflects the implemented architecture and no temporary containment flag is removed before its replacement gate passes.
- The traceability matrix and every task's finding/requirement references have no gaps.
