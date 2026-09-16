# Requirements

## Introduction

This plan makes the OR3 sync layer release-safe. A three-lane audit of the client engine, gateway/server boundary, and both provider implementations (SQLite native/D1 and Convex gateway/direct) found two P0 correctness/privacy defects and a cluster of P1 defects that can lose data, skip history, or stall recovery. The work is a bug-fix hardening pass over the existing change-log + snapshot + outbox protocol, not a new sync design.

## Context

Canonical types and Zod contracts live in `or3-chat/shared/sync/{types,schemas,revision}.ts`. The client engine is `or3-chat/app/core/sync/*` plus `app/plugins/convex-sync.client.ts`. Gateway routes are `or3-chat/server/api/sync/*`. SQLite/D1 push, pull, snapshot, and LWW live in `or3-provider-sqlite/src/runtime/server/sync/sqlite-sync-gateway-adapter.ts`. Convex functions live in `or3-provider-convex/templates/convex/{sync,notifications,storage,admin,snapshot,workspaces,crons}.ts`. Convex already binds notification ownership to the caller and filters pull/watch; SQLite does not. Convex server writers emit `op_id` values that fail `ChangeStampSchema` (`z.string().uuid()`), so gateway pull returns 502. `or3-chat` currently has unrelated dirty admin-update files that this work must not mix with. Both provider repositories are clean.

## Assumptions

- The audit findings are accepted as the defect list; this plan does not re-litigate severity.
- `ChangeStamp.opId` remains a UUID. Server-authored ops use `crypto.randomUUID()` (or the already-generated notification UUID) instead of prefixed strings such as `server:notif:<uuid>`.
- Bundled SSR Cloud continues to use gateway transport. Direct Convex remains a supported non-SSR path and must actually boot.
- In-process rate limiting is kept; a distributed limiter is out of scope.
- Pull retention fields are additive. Core, gateway, and both providers ship together.
- Existing unrelated `or3-chat` worktree changes stay untouched. Sync edits land on a dedicated branch with explicitly staged paths.
- Provider packages must be rebuilt (`dist/`) before `or3-chat` can observe their behavior.

## Out of Scope

- CRDT / field-level merge (LWW remains the conflict rule).
- New sync providers or a protocol version bump.
- Multi-instance shared rate-limit storage (Redis/etc.).
- Changing the admin-update / Cloud operator work already in the dirty `or3-chat` tree.
- Relaxing UUID `opId` validation to accept `server:*` prefixes.
- Binary blob transfer (storage layer), except that Convex `file_meta` mutations must enter the change log.

## Requirements

### R1: SQLite notification ownership

**User Story:** As a workspace member, I want only my notifications to sync, so that other members cannot read, spoof, or delete them.

**Acceptance Criteria:**
- R1.AC1: WHEN a caller pushes a `notifications` put THEN SQLite (native and D1) SHALL set `payload.user_id` to the authenticated caller and SHALL reject a mismatched owner with a per-op authorization error.
- R1.AC2: WHEN a caller pushes a `notifications` delete THEN SQLite SHALL reject the op unless the materialized row exists and `user_id` equals the caller.
- R1.AC3: WHEN a caller pulls or snapshots THEN SQLite SHALL omit other users' notification rows, tombstones, and change-log entries, matching Convex `scopeNotificationWrite` / `isChangeVisibleToUser`.
- R1.AC4: IF the caller identity cannot be resolved THEN SQLite SHALL reject notification writes and SHALL return no notification rows on pull/snapshot.

### R2: Convex server-authored `op_id` is a UUID

**User Story:** As a synced client, I want server-created notifications to appear in pull, so that gateway and direct sync do not stall.

**Acceptance Criteria:**
- R2.AC1: WHEN Convex `notifications.create` writes `change_log` THEN `op_id` SHALL be a UUID accepted by `ChangeStampSchema`.
- R2.AC2: WHEN a client pulls after a server-created notification THEN the gateway SHALL return HTTP 200 with a schema-valid change, and the direct watch parser SHALL accept the page.
- R2.AC3: Existing prefixed `server:notif:*` values SHALL NOT be written by current Convex functions.

### R3: Convex auxiliary writers participate in sync history

**User Story:** As a multi-device user, I want server-side notification read state, storage metadata, storage deletion, and admin KV writes to reach every device, so that incremental sync and snapshots stay consistent.

**Acceptance Criteria:**
- R3.AC1: WHEN Convex mutates a synced table outside `sync.push` THEN it SHALL allocate `server_version`, write `change_log` with a UUID `op_id`, stamp `clock`/`hlc`/`op_id` on the row, and write a tombstone plus preimage when deleting.
- R3.AC2: Covered writers SHALL include `notifications.markRead`, `storage` file_meta create/patch/delete, and `admin.setWorkspaceSetting`.
- R3.AC3: WHEN `resolveSnapshotWinner` considers a candidate THEN a missing `serverVersion` SHALL make that candidate ineligible. Rows written after the frozen watermark SHALL NOT appear in the snapshot page.
- R3.AC4: WHEN a workspace is deleted THEN Convex SHALL also delete `notifications`, snapshot sessions/items, and preimages in addition to the tables already purged.

### R4: Snapshot recovery preserves durable local work

**User Story:** As a user returning from an expired cursor, I want local unsynced work to survive snapshot replacement, so that I do not lose offline edits.

**Acceptance Criteria:**
- R4.AC1: WHEN snapshot bootstrap or expired-cursor recovery runs THEN the engine SHALL NOT start outbox flush against empty/partial local tables before the snapshot is applied.
- R4.AC2: WHEN snapshot replacement clears synced tables THEN the engine SHALL reapply every durable outbox row whose status is `pending`, `in_flight`, `retry_wait`, `failed_retryable`, or equivalent non-terminal durable state. Terminal `failed_permanent` / `discarded` rows SHALL NOT be silently dropped from disk during reapply, but SHALL NOT overwrite the snapshot.
- R4.AC3: IF a snapshot item and a queued outbox payload share a primary key THEN after snapshot apply the queued payload SHALL win locally until push LWW completes (local-first). The outbox row SHALL remain queued.

### R5: Successful-but-unapplied pushes reconcile local state

**User Story:** As a user whose write lost LWW, I want my device to adopt the server winner, so that the source device does not diverge forever.

**Acceptance Criteria:**
- R5.AC1: WHEN a provider returns `success: true` and `applied: false` THEN the outbox SHALL treat the op as acknowledged, SHALL NOT keep retrying it, and SHALL replace the local row with the returned winning payload (or a tombstone for a winning delete).
- R5.AC2: WHEN `applied` is false THEN the client SHALL NOT echo-filter the winning remote change for that primary key.
- R5.AC3: SQLite native and D1 push results SHALL include `applied` from the LWW outcome. Idempotent replays SHALL return the stored `applied` semantics (replay of a logged op is success; `applied` reflects whether that op is the current materialized winner, or omit `applied` only when the logged fingerprint matches and no rewrite occurs — documented in design as “replay returns `applied: true` only if the materialized row still carries that `op_id`”).
- R5.AC4: IF `applied` is false and no winning payload is present THEN the client SHALL NOT delete the outbox row; it SHALL retry as a retryable error.

### R6: Invalid or oversized ops do not poison valid siblings

**User Story:** As a client flushing a mixed outbox, I want valid operations to apply even if a sibling is invalid or the packed batch is too large.

**Acceptance Criteria:**
- R6.AC1: WHEN gateway `/api/sync/push` receives a structurally valid batch containing some schema-invalid ops THEN it SHALL return HTTP 200 with per-op `success: false` / `VALIDATION_ERROR` for invalid ops and SHALL dispatch valid ops to the adapter. A wholly unparseable body remains HTTP 400.
- R6.AC2: WHEN the outbox packs a flush THEN it SHALL honor both `MAX_SYNC_PUSH_BATCH_OPS` (100) and `MAX_SYNC_PUSH_BATCH_BYTES` (2 MiB), packing greedily without exceeding either ceiling.
- R6.AC3: WHEN a transport/schema failure still rejects the whole request THEN the outbox SHALL NOT mark every batched op failed-permanent on a single 400/413; it SHALL split the batch (binary split down to one) and retry.

### R7: Pull advertises a retention floor

**User Story:** As a client whose cursor is older than retained history, I want an explicit snapshot signal, so that I do not skip deleted versions.

**Acceptance Criteria:**
- R7.AC1: Pull responses SHALL include `oldestRetainedVersion` (inclusive floor still readable from change_log) and `requiresSnapshot` (true when `cursor < oldestRetainedVersion`).
- R7.AC2: WHEN `requiresSnapshot` is true THEN the client SHALL run snapshot recovery and SHALL NOT advance the cursor across the gap.
- R7.AC3: The client SHALL NOT infer expiry solely from a 24-hour `lastSyncAt` heuristic when the server provides these fields.
- R7.AC4: SQLite and Convex pull SHALL compute the floor from actual retained change-log minima (or 0 when the log still contains version 1+ from the start).

### R8: Workflow catalog hydrates from snapshot then pull

**User Story:** As background execution, I want the workflow catalog to see posts that still exist after change-log GC, so that jobs do not fail with “missing workflow”.

**Acceptance Criteria:**
- R8.AC1: WHEN the catalog cache expires THEN hydration SHALL load posts via snapshot (or equivalent materialized listing) and THEN pull changes with `cursor = highWatermark`.
- R8.AC2: Cursor-zero change-log replay SHALL NOT be the only hydration path.

### R9: SQLite idempotency is fingerprint-safe

**User Story:** As the sync protocol, I want reused `op_id` values with a different fingerprint to fail, so that clients are not told a different operation succeeded.

**Acceptance Criteria:**
- R9.AC1: WHEN native SQLite or D1 finds an existing `op_id` THEN it SHALL compare workspace, table, pk, operation, payload, clock, hlc, and deviceId (the same fingerprint Convex uses).
- R9.AC2: IF the fingerprint or workspace differs THEN the op SHALL fail with `CONFLICT` and SHALL NOT be acknowledged as success.
- R9.AC3: IF they match THEN the op SHALL be acknowledged with the original `serverVersion`.

### R10: D1 concurrent retries cannot create version gaps

**User Story:** As a D1 deployment, I want concurrent retries of the same `op_id` to serialize on the unique log constraint, so that counters and logs stay aligned.

**Acceptance Criteria:**
- R10.AC1: D1 SHALL insert `change_log` with a hard unique `op_id` (no `INSERT OR IGNORE`). A unique conflict SHALL fail the atomic batch so the counter increment rolls back.
- R10.AC2: The retried request SHALL then take the idempotent fingerprint path in R9.
- R10.AC3: Materialized writes SHALL NOT commit without a corresponding change-log row for that `op_id`.

### R11: SQLite LWW matches the shared comparator

**User Story:** As a multi-device user, I want SQLite and Convex to pick the same winner for equal clock/HLC writes, so that replicas converge.

**Acceptance Criteria:**
- R11.AC1: Native and D1 put/delete LWW SHALL use `compareSyncRevision` / `incomingRevisionWins` (`clock`, `hlc`, `opId`).
- R11.AC2: Tombstone upsert SHALL use the same revision tuple, not `(clock, server_version)` alone.
- R11.AC3: WHEN a put targets a missing materialized row THEN SQLite SHALL still lose to an existing orphan tombstone with a winning revision (no stale resurrection).

### R12: Convex direct mode is reachable and can advance

**User Story:** As a non-SSR Convex user, I want the core engine to start in direct mode and keep pulling new pages, so that sync is not dead code.

**Acceptance Criteria:**
- R12.AC1: WHEN `ssrAuthEnabled` is false, `sync.enabled` is true, and the Convex direct provider is registered THEN the core engine SHALL start. WHEN `ssrAuthEnabled` is true THEN the engine SHALL keep using gateway transport and SHALL NOT register the direct provider.
- R12.AC2: Direct `subscribe` SHALL advance its query cursor/window after a page is delivered. Filtering to a table subset SHALL NOT freeze the cursor or suppress the advancement callback.
- R12.AC3: Invalid watch pages SHALL be recorded as failures (circuit breaker) and SHALL NOT silently stall forever.

### R13: Circuit breaker probes complete

**User Story:** As a recovering client, I want a half-open probe to succeed or fail, so that sync resumes without a reload.

**Acceptance Criteria:**
- R13.AC1: `canRetry()` SHALL be a non-mutating read. Claiming the single half-open probe SHALL be a separate `beginProbe()` (or equivalent) that is always paired with `recordSuccess` or `recordFailure`.
- R13.AC2: An empty outbox flush SHALL NOT claim a probe.
- R13.AC3: Subscription bootstrap/rescan SHALL record success or failure for every claimed probe, including thrown errors.

### R14: Sync routes enforce size, auth, and rate limits on admission

**User Story:** As an operator, I want sync endpoints to refuse oversized unauthenticated bodies and count every admitted request against the budget.

**Acceptance Criteria:**
- R14.AC1: `/api/sync/push` and `/api/sync/pull` SHALL read bodies through `readLimitedJsonBody` with a ceiling of `MAX_SYNC_PUSH_BATCH_BYTES` (push) or a documented pull-request ceiling, before schema work that retains an unbounded buffer.
- R14.AC2: Authentication/authorization SHALL run before adapter work. Declared `Content-Length` above the ceiling SHALL return 413 without buffering the body.
- R14.AC3: Rate-limit check and record SHALL happen on admission (after auth, before adapter). Failed adapter calls SHALL still consume the budget. Concurrent requests in one process SHALL not each observe the pre-record remaining quota for a 100-op batch in a way that multiplies the documented 200 requests/minute into thousands of ops/minute beyond `MAX_SYNC_PUSH_BATCH_OPS` per recorded request. Documented budget remains request-based; the multiplier bug of recording only after success is removed.

### R15: Convex public push validates stamps before allocating versions

**User Story:** As a Convex workspace, I want invalid ops to fail without burning `server_version` numbers, so that history stays contiguous.

**Acceptance Criteria:**
- R15.AC1: Convex `sync.push` SHALL reject non-UUID `op_id` values and stamp fields that violate the shared ChangeStamp constraints before `allocateServerVersions`.
- R15.AC2: Per-op schema failures after allocation SHALL NOT occur for stamp/payload checks that can run first. Apply-time LWW still allocates because the op is accepted.

### R16: Convex history GC actually runs

**User Story:** As a Convex operator, I want advertised snapshot-v1 retention to delete acknowledged history, so that the change log cannot grow forever.

**Acceptance Criteria:**
- R16.AC1: A Convex cron SHALL invoke workspace history GC (change log and tombstones) using internal mutations only.
- R16.AC2: The gateway `gcChangeLog` / `gcTombstones` adapters SHALL follow `hasMore` / `nextCursor` until complete or `MAX_SYNC_GC_CONTINUATIONS`, not a single page discard.
- R16.AC3: The Convex admin adapter SHALL expose the same GC actions the SQLite admin path already expects, or the core maintenance plugin SHALL drive Convex GC through the gateway adapter. Either way, GC is reachable without a public mutation.

### R17: Gateway idempotent replay does not fire duplicate side effects

**User Story:** As a webhook consumer, I want retries of an already-applied Convex push to skip duplicate emissions.

**Acceptance Criteria:**
- R17.AC1: Convex gateway replay SHALL NOT default missing `applied` to `true`. Missing `applied` plus `wasExisting: true` SHALL skip webhook emission.
- R17.AC2: Duplicate successful replays SHALL NOT emit `notify:action:push` / thread hooks again.

### R18: HookBridge uninstalls Dexie hooks

**User Story:** As a user switching workspaces or restarting sync, I want stopped engines to stop capturing writes, so that disabled closures cannot enqueue into a dead outbox.

**Acceptance Criteria:**
- R18.AC1: `HookBridge.stop()` and `cleanupHookBridge` SHALL unsubscribe the Dexie `creating` / `updating` / `deleting` hooks they installed.
- R18.AC2: A subsequent `start()` on a new instance for the same Dexie DB SHALL install exactly one active hook set.

### R19: Regression coverage for the audit gaps

**User Story:** As a release engineer, I want tests that fail if these defects return, so that the missing coverage named in the audit is closed.

**Acceptance Criteria:**
- R19.AC1: Targeted tests SHALL cover: multi-user SQLite notifications; Convex server UUID `op_id` pull; auxiliary Convex writers in change_log; snapshot ineligibility without `serverVersion`; non-pending outbox reapply; `applied: false` reconciliation; mixed/oversized push batches; `requiresSnapshot` stale cursors; SQLite fingerprint mismatch; D1 unique-conflict retry; full `(clock, hlc, opId)` LWW plus tombstone resurrection; direct-mode subscribe rollover; half-open breaker recovery; admission rate-limit recording; HookBridge unsubscribe.
- R19.AC2: Tests SHALL live in the existing canonical suites where possible (`sqlite-sync-gateway-adapter.test.ts`, Convex sync/snapshot tests, `outbox-manager.test.ts`, `subscription-manager.test.ts`, gateway route tests). No permanently skipped tests and no source-string assertions for cosmetics.

### R20: Public docs match the hardened contract

**User Story:** As an operator, I want sync-layer docs to describe notification scoping, retention signaling, and LWW ties, so that production behavior is not tribal knowledge.

**Acceptance Criteria:**
- R20.AC1: `public/_documentation/cloud/sync-layer.md` and `docmap.json` SHALL describe notification owner filtering, pull `requiresSnapshot`, UUID `op_id` for server writes, and `(clock, hlc, opId)` LWW.
- R20.AC2: Provider READMEs SHALL mention notification scoping (SQLite) and history GC cron (Convex) if those surfaces change operator-visible behavior.
