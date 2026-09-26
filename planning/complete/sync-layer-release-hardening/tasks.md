# Tasks

## 1. Shared contract

- [x] 1.1 Add `oldestRetainedVersion` and `requiresSnapshot` to `PullResponse`, `PullResponseSchema`, and gateway/client parsers
      Requirements: R7.AC1
      Done when: schema tests accept the new fields and reject a pull payload that omits them.

- [x] 1.2 Split `SyncCircuitBreaker.canRetry` into a read-only check plus `beginProbe`, and always clear the probe in `recordSuccess` / `recordFailure`
    Requirements: R13.AC1
      Done when: unit tests show a half-open empty `canRetry` loop does not stick `probeInFlight`, and an unpaired `beginProbe` is released by record methods.

## 2. P0 — SQLite notification ownership

- [x] 2.1 Add failing SQLite tests for two-user notification push, pull, and snapshot (native; D1 equivalent if the suite already drives D1)
      Requirements: R1.AC1, R1.AC3, R19.AC1
      Done when: tests fail on current adapter (foreign notification visible; spoofed `user_id` accepted).

- [x] 2.2 Implement `NotificationScopeGuard` on native and D1 push/pull/snapshot
      Requirements: R1.AC1, R1.AC2, R1.AC3, R1.AC4
      Done when: tests in 2.1 pass; missing session user rejects notification writes and returns no notification snapshot/pull rows.

## 3. P0 — Convex server `op_id`

- [x] 3.1 Add a failing Convex test that `notifications.create` change-log `op_id` parses with `ChangeStampSchema`, and that pull mapping skips or UUID-rewrites legacy `server:notif:*` rows without 502
      Requirements: R2.AC1, R2.AC2, R19.AC1
      Done when: the test fails on `server:notif:${id}`.

- [x] 3.2 Write UUID `op_id` from `notifications.create` via `ServerAuthoredSyncWriter` (or a local UUID) and sanitize non-UUID historical `op_id`s on pull/watch
      Requirements: R2.AC1, R2.AC2, R2.AC3
      Done when: test 3.1 passes; no new prefixed ids are inserted.

## 4. Convex auxiliary writers, snapshots, purge

- [x] 4.1 Route `notifications.markRead`, storage `file_meta` create/patch/delete, and `admin.setWorkspaceSetting` through `ServerAuthoredSyncWriter`
      Requirements: R3.AC1, R3.AC2
      Done when: tests assert a change_log row + version bump for each writer.

- [x] 4.2 Make `resolveSnapshotWinner` ineligible when `serverVersion` is missing or greater than the watermark
      Requirements: R3.AC3
      Done when: snapshot tests include an unversioned row that does not appear in the page.

- [x] 4.3 Validate UUID/stamp constraints in `validateSyncOperation` before `allocateServerVersions`
      Requirements: R15.AC1, R15.AC2
      Done when: a non-UUID `op_id` fails without incrementing `server_version_counter`.

- [x] 4.4 Extend workspace delete to notifications, snapshot sessions/items, and preimages
      Requirements: R3.AC4
      Done when: workspace-delete tests show those tables empty.

- [x] 4.5 Default gateway replay `applied` only when the Convex result is explicitly true; skip webhooks on `wasExisting`
      Requirements: R17.AC1, R17.AC2
      Done when: adapter tests emit no hooks on idempotent replay.

## 5. SQLite LWW, fingerprint, D1 atomicity

- [x] 5.1 Compare existing `op_id` rows with the Convex fingerprint; mismatch → `CONFLICT`
      Requirements: R9.AC1, R9.AC2, R9.AC3
      Done when: reuse of an id with a different pk/payload fails native and D1 tests.

- [x] 5.2 Replace D1 `INSERT OR IGNORE` on `change_log` with `INSERT`; unique conflicts fail the batch
      Requirements: R10.AC1, R10.AC2, R10.AC3
      Done when: a sequential retry after a unique failure acknowledges the original version and does not leave a counter gap in the test fixture.

- [x] 5.3 Switch native/D1 LWW and tombstone predicates to `incomingRevisionWins`; check orphan tombstones before insert
      Requirements: R11.AC1, R11.AC2, R11.AC3
      Done when: equal clock/hlc different opId is deterministic; a tombstone-only pk rejects a stale put. `verifySyncContract` uses production LWW.

- [x] 5.4 Return `applied` (and winning `payload` when false) from native and D1 push results
      Requirements: R5.AC3
      Done when: an LWW loser result is `{ success: true, applied: false, payload: <winner> }`.

## 6. Client engine recovery

- [x] 6.1 Start OutboxManager only after snapshot/bootstrap completes; keep HookBridge capture active for local writes during bootstrap
      Requirements: R4.AC1
      Done when: plugin tests or engine-start tests show no flush before snapshot apply.

- [x] 6.2 Reapply durable non-terminal outbox statuses after snapshot replacement; queued payload wins locally for the same pk
      Requirements: R4.AC2, R4.AC3
      Done when: subscription-manager tests cover `in_flight` / `retry_wait` / `failed_retryable` reapply.

- [x] 6.3 Reconcile `applied: false` in OutboxManager (apply winner, drop outbox, do not echo-filter the winner)
      Requirements: R5.AC1, R5.AC2, R5.AC4
      Done when: outbox tests cover winner payload, missing payload retry, and success+applied true delete.

- [x] 6.4 Pack outbox batches by count and `MAX_SYNC_PUSH_BATCH_BYTES`; binary-split on whole-request 400/413
      Requirements: R6.AC2, R6.AC3
      Done when: a 3×256 KiB valid set flushes as multiple requests; one invalid sibling no longer permanently fails neighbors after gateway 6.6.

- [x] 6.5 Honor `requiresSnapshot` in SubscriptionManager; stop using 24h `lastSyncAt` as the sole expiry signal when the field is present
      Requirements: R7.AC2, R7.AC3
      Done when: a pull with `requiresSnapshot: true` triggers snapshot recovery in tests.

- [x] 6.6 Change gateway `push.post.ts` to per-op validation + HTTP 200 mixed results; use `readLimitedJsonBody`; record rate limits on admission for push and pull
      Requirements: R6.AC1, R14.AC1, R14.AC2, R14.AC3
      Done when: route tests show 413 on oversize, 401 before adapter, mixed validation results, and `recordSyncRequest` even when adapter throws.

- [x] 6.7 Store Dexie unsubscribe functions and call them from `HookBridge.stop` / `cleanupHookBridge`
      Requirements: R18.AC1, R18.AC2
      Done when: a second start after cleanup captures writes once, not twice.

- [x] 6.8 Wire circuit breaker `beginProbe` into outbox flush (only when work exists) and subscription bootstrap/rescan `finally`
      Requirements: R13.AC2, R13.AC3
      Done when: empty flush leaves half-open available; thrown bootstrap records failure.

## 7. Workflow catalog, direct mode, Convex GC

- [x] 7.1 Hydrate workflow catalog from snapshot then pull-after-watermark
      Requirements: R8.AC1, R8.AC2
      Done when: a catalog test with empty change_log and a materialized post still resolves the workflow.

- [x] 7.2 Allow core engine start for non-SSR direct Convex; keep SSR on gateway-only; advance direct subscribe cursors
      Requirements: R12.AC1, R12.AC2, R12.AC3
      Done when: plugin tests cover SSR vs non-SSR gates; provider tests resubscribe/advance after a filtered empty page.

- [x] 7.3 Implement Convex history GC cron, paginated gateway GC, and admin/maintenance reachability
      Requirements: R16.AC1, R16.AC2, R16.AC3
      Done when: cron registers an internal GC job; adapter tests loop `hasMore`; a disabled/no-op `runWorkspaceGc` is no longer the only scheduled path.

- [x] 7.4 SQLite and Convex pull compute `oldestRetainedVersion` from retained log minima
      Requirements: R7.AC4
      Done when: after GC, a stale cursor pull returns `requiresSnapshot: true`.

## 8. Docs and verification

- [x] 8.1 Update `public/_documentation/cloud/sync-layer.md`, `docmap.json`, and provider READMEs for notification scoping, retention signaling, UUID server ops, and LWW ties
      Requirements: R20.AC1, R20.AC2
      Done when: docmap summaries mention the new contract fields.

- [x] 8.2 Rebuild provider `dist/` and run targeted vitest: affected or3-chat files, sqlite sync tests, convex sync/snapshot/gateway tests
      Requirements: R19.AC1, R19.AC2
      Done when: named suites pass; no new skipped tests.

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | NotificationScopeGuard | 2.1, 2.2 |
| R2 | ServerAuthoredSyncWriter | 3.1, 3.2 |
| R3 | ServerAuthoredSyncWriter, SnapshotEligibility, WorkspacePurge | 4.1, 4.2, 4.4 |
| R4 | SnapshotRecovery | 6.1, 6.2 |
| R5 | AppliedReconciler | 5.4, 6.3 |
| R6 | PushAdmission, OutboxPacker | 6.4, 6.6 |
| R7 | PullRetentionContract | 1.1, 6.5, 7.4 |
| R8 | WorkflowCatalogHydrator | 7.1 |
| R9 | IdempotencyFingerprint | 5.1 |
| R10 | D1AtomicPush | 5.2 |
| R11 | SharedLww | 5.3 |
| R12 | DirectModeBootstrap | 7.2 |
| R13 | CircuitBreakerProbe | 1.2, 6.8 |
| R14 | PushAdmission | 6.6 |
| R15 | ServerAuthoredSyncWriter | 4.3 |
| R16 | ConvexHistoryGc | 7.3 |
| R17 | ReplaySideEffects | 4.5 |
| R18 | HookBridgeLifecycle | 6.7 |
| R19 | tests in each section | 2.1, 3.1, 8.2 |
| R20 | SyncDocs | 8.1 |

## Definition of Done

- Every acceptance criterion in `requirements.md` has a task above and a failing-then-passing test where R19 applies.
- Provider packages are rebuilt; targeted vitest in all three repos is green.
- Unrelated dirty `or3-chat` admin-update files are not staged.
- `public/_documentation/cloud/sync-layer.md` and `docmap.json` match the shipped pull/LWW/notification contract.
