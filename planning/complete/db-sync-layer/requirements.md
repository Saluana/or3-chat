# requirements.md

artifact_id: d0g4h1f5-7h2c-6i6d-e1h8-5f4g6h8i9j0k
date: 2026-01-11

## Introduction

This document defines requirements for the **database synchronization layer** in OR3 Chat SSR mode. The sync layer enables multi-device and multi-user access by keeping local Dexie data synchronized with a SyncProvider backend (Convex default).

### Scope (this plan)

- Server-side record store mirroring OR3 entities
- Change-log based sync with deterministic cursor ordering
- LWW conflict resolution with clock field
- Tombstone-based deletion with garbage collection
- SyncProvider abstraction (Convex first, future: Firebase, Postgres)
- Direct vs gateway provider modes for DB-agnostic operation
- Integration with SSR auth system for workspace-scoped authorization (Clerk default)
- Convex stores synced records using the same snake_case wire schema as Dexie

### Non-goals (explicitly out of scope)

- Binary blob sync (handled by storage layer separately)
- CRDT-based field merging (LWW is sufficient for v1)
- Server-side search index
- Real-time collaborative editing (Yjs)

---

## Requirements

### 1. Local-first with remote sync

1.1 As a user, I want local Dexie to remain the source of truth for UI, so that the app feels instant and works offline.

- WHEN displaying data THEN the UI SHALL read from Dexie tables directly.
- WHEN a remote change arrives THEN it SHALL be written to Dexie; UI reacts via Dexie's live queries.

1.2 As a user, I want my offline changes to sync when I reconnect, so that nothing is lost.

- WHEN a local write occurs offline THEN it SHALL be persisted in the sync outbox.
- WHEN connectivity resumes THEN the outbox SHALL flush in FIFO order.

### 2. Workspace-scoped sync

2.1 As a multi-tenant operator, I want all synced data scoped by workspace, so that users only see their team's content.

- WHEN syncing data THEN every record SHALL include `workspaceId`.
- WHEN pulling changes THEN the provider SHALL filter by `scope.workspaceId`.
- WHEN pushing changes THEN the server SHALL verify workspace membership.

2.2 As a developer, I want sync scope to be extensible for future project-level filtering.

- WHEN defining sync scope THEN it SHALL accept `{ workspaceId, projectId? }`.
- WHEN projectId is provided THEN it SHALL filter to that project's records.

### 3. Change capture and outbox

3.1 As a developer, I want local mutations captured automatically via hooks, so that sync is transparent.

- WHEN a DB write hook fires THEN HookBridge SHALL enqueue a PendingOp in the same Dexie transaction.
- WHEN a write is applied from remote sync THEN HookBridge SHALL suppress capture to avoid sync loops.

3.2 As a user, I want the outbox to preserve all my changes without data loss.

- WHEN the outbox approaches capacity THEN it SHALL coalesce updates and apply backpressure.
- WHEN backpressure is active THEN `sync.queue:action:full` SHALL be emitted.
- The outbox SHALL NOT drop operations automatically.

3.3 As a developer, I want each operation to have a stable identifier for idempotency.

- WHEN creating a PendingOp THEN it SHALL include `opId` (UUID), `deviceId`, `hlc`, and `clock`.
- WHEN pushing to server THEN `opId` SHALL be the idempotency key.

### 4. Push loop with retry

4.1 As a user, I want my changes to push reliably even with transient failures.

- WHEN a push fails THEN the sync engine SHALL retry with exponential backoff.
- WHEN retry attempts are exhausted THEN `sync.error:action` SHALL be emitted.

4.2 As a developer, I want partial failure handling at the operation level.

- WHEN a batch push returns partial success THEN only successful ops SHALL be removed from outbox.
- WHEN an op fails THEN it SHALL remain in the outbox for retry.

4.3 As an operator, I want rate limiting respected to avoid server overload.

- WHEN server returns rate-limit headers THEN the push loop SHALL throttle accordingly.

### 5. Pull loop and realtime subscriptions

5.1 As a user, I want changes from other devices to appear automatically.

- WHEN a remote change occurs THEN the client SHALL receive it via subscription.
- WHEN a subscription update arrives THEN the change SHALL be applied to Dexie.

5.2 As a developer, I want cursor-based deterministic ordering for recovery scenarios.

- WHEN pulling changes THEN they SHALL be ordered by `serverVersion` (monotonic).
- WHEN a cursor expires THEN the client SHALL trigger a rescan.

5.3 As a developer, I want provider-native reactivity leveraged for efficiency.

- WHEN using a reactive provider THEN subscriptions SHALL replace manual polling.
- WHEN data changes on server THEN provider subscriptions SHALL push updates.

### 6. Conflict resolution (LWW)

6.1 As a user, I want conflicts resolved automatically so I don't see corrupted data.

- WHEN two devices write the same record THEN the higher `clock` SHALL win.
- IF clocks are equal THEN `hlc` or `opId` SHALL break the tie deterministically.
- IF two messages share the same `index` THEN ordering SHALL be stabilized by `(index, hlc, id)` or a server-assigned `server_index`.

6.2 As a developer, I want conflict visibility for debugging.

- WHEN a conflict occurs THEN `sync.conflict:action:detected` SHALL be emitted with details.
- WHEN a conflict is auto-resolved THEN the losing version SHALL NOT be applied.

6.3 As a developer, I want deterministic message ordering across devices.

- WHEN two messages share the same `index` THEN ordering SHALL be stabilized using a stored `order_key` derived from the operation HLC (or equivalent).
- The `order_key` SHALL be included in sync payloads to avoid divergent ordering.

### 7. Tombstones and garbage collection

7.1 As a user, I want deletions to sync across devices without resurrection.

- WHEN a record is deleted locally THEN `deletedAt` timestamp SHALL be set.
- WHEN the delete syncs THEN a tombstone record SHALL be created on server.

7.2 As a developer, I want tombstones to prevent resurrection during rescan.

- WHEN doing a full rescan THEN tombstones SHALL be respected.
- WHEN a pulled record has `deletedAt` THEN it SHALL NOT be applied as live.

7.3 As an operator, I want GC to eventually clean up old tombstones.

- WHEN a tombstone is older than retention window AND all devices have advanced past it THEN it MAY be purged.
- WHEN GC runs THEN it SHALL be conservative (never purge prematurely).

7.4 As an operator, I want change log retention to be bounded.

- WHEN all active devices have advanced past a `server_version` watermark THEN older `change_log` entries MAY be purged.
- WHEN retention is configured THEN the backend SHALL enforce a minimum retention window to avoid data loss on long-offline devices.

### 8. Provider abstraction

8.1 As a developer, I want to implement a single `SyncProvider` interface to add backends.

- WHEN adding a new backend THEN it SHALL implement `subscribe`, `pull`, `push`, `dispose`.
- WHEN the provider is swapped THEN client sync logic SHALL remain unchanged.

8.3 As a developer, I want providers to declare whether they are direct or gateway, so that auth and transport are consistent.

- WHEN a provider supports direct client access THEN it SHALL declare `mode = 'direct'` and require a provider token.
- WHEN a provider does not support direct access THEN it SHALL declare `mode = 'gateway'` and use SSR endpoints for push/pull.

8.4 As a developer, I want a shared token broker for direct providers.

- WHEN a provider declares `mode = 'direct'` THEN it SHALL obtain tokens via `AuthTokenBroker` (from the auth subsystem).

8.2 As an operator, I want Convex as the first supported provider with Clerk auth.

- WHEN Convex is configured THEN it SHALL use Convex mutations for push and queries for pull.
- WHEN subscriptions are needed THEN Convex's reactive queries SHALL be used (exact client API selected at implementation time).

### 9. Recovery and rescan

9.1 As a user, I want data to recover gracefully from edge cases.

- WHEN cursor is expired/invalid THEN a full rescan SHALL be triggered.
- WHEN restarting after long offline period THEN bootstrap SHALL restore state.

9.2 As a developer, I want rescan to preserve read-your-writes.

- WHEN rescan is in progress THEN pending ops SHALL overlay the staged data.
- WHEN swap occurs THEN UI SHALL see consistent data without flicker.

### 10. Observability and telemetry

10.1 As a developer, I want sync status visible for debugging.

- WHEN sync operations occur THEN `sync.stats:action` SHALL emit pending counts and cursors.
- WHEN errors occur THEN `sync.error:action` and `sync.retry:action` SHALL be emitted.

10.2 As an operator, I want telemetry persisted for post-hoc analysis.

- WHEN a sync run completes THEN stats SHALL be written to `sync_runs` table.
- WHEN viewing dev overlay THEN sync state SHALL be visible.
2.3 As a developer, I want local data isolated per workspace without adding `workspaceId` to every row.

- WHEN a workspace is active THEN the client SHALL open a workspace-specific Dexie DB (`or3-db-${workspaceId}`).
- WHEN switching workspaces THEN the client SHALL switch DB instances without mutating existing rows.
