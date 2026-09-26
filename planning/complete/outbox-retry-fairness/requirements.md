# Requirements

## Introduction

Fix ready retries being repeatedly postponed by a sustained pending backlog. This plan changes local outbox selection while preserving batching, operation identity, and revision handling. It describes a sustained-backlog risk; it does not claim that a finite queue cannot drain.

## Context

OR3 Chat uses TypeScript/Nuxt, Bun, Dexie, and Vitest. In `app/core/sync/outbox-manager.ts`, `flush()` reads up to `maxBatchSize * 10` rows per status, concatenates pending first, truncates, coalesces, and only then checks readiness. Defaults are 50 operations per request and 500 candidates. `pending_ops` currently has status and creation-time indexes but no due-time index. Existing tests cover coalescing, retries, recovery, byte packing, and request splitting. The working tree already contains unrelated database changes, including schema version 16 and derived-index hooks.

## Assumptions

- Deliver planning documents only; implementation is a later task.
- Fairness applies while the provider permits requests and operations are not superseded. Rate limits, an open circuit breaker, and session loss can still pause all work.
- Keep the current heartbeat, retry policy, and configuration. Coordinate with existing database edits and use the next unused schema version at implementation time.

## Out of Scope

Provider changes, releases, deployments, new dependencies, durable scheduling services, and a redesign of global per-record coalescing.

## Requirements

### R1: Select ready work with bounded reads

**User Story:** As a syncing user, I want deferred work to leave room for operations that can run now.

**Acceptance Criteria:**
- R1.AC1: WHEN selecting candidates THEN the outbox SHALL include only `pending` or `retry_wait` rows whose `nextAttemptAt` is absent or at most one captured flush time.
- R1.AC2: WHEN reading either status THEN eligibility SHALL be enforced by an index range before applying its limit; reads SHALL materialize at most twice the existing scan limit overall and retain at most the scan limit for coalescing.
- R1.AC3: WHEN all queued work is deferred or terminal THEN the outbox SHALL make no push request.
- R1.AC4: WHEN startup recovery resets stale `syncing`/`in_flight` rows THEN the rows SHALL be immediately eligible with no positive scheduling delay (same FIFO position as fresh ready work), so a sustained same-status backlog SHALL NOT postpone them.

### R2: Fair progress through the final request limit

**User Story:** As a user with failed writes, I want ready retries to progress while new writes continue arriving.

**Acceptance Criteria:**
- R2.AC1: WHILE at least 500 distinct pending rows remain before every flush, one due retry at the head of its status group SHALL be attempted within two eligible flushes, even when pending rows have earlier creation times.
- R2.AC2: WHEN both groups remain ready and only one operation fits each request THEN both groups SHALL receive an attempt within two eligible flushes.
- R2.AC3: WHEN only one group has ready work THEN it SHALL be allowed to fill the available request capacity.

### R3: Preserve sync correctness

**User Story:** As a user, I want improved scheduling without duplicate identities, lost edits, or oversized requests.

**Acceptance Criteria:**
- R3.AC1: WHEN selecting and coalescing candidates THEN the outbox SHALL keep the winner selected by `compareSyncRevision` for each `(tableName, pk)` and preserve its operation ID, stamp, operation, and payload semantics.
- R3.AC2: WHEN deleting superseded candidates THEN only losing rows from the selected eligible set SHALL be removed; deferred and in-flight rows outside that set SHALL remain untouched.
- R3.AC3: WHEN pushing THEN existing count/byte packing, request splitting, retry accounting, provider cooldown, lifecycle guards, and response reconciliation SHALL continue to pass their regression tests.
- R3.AC4: WHEN a push returns `applied: false` with a server winner THEN the outbox SHALL apply the winner to local state only when the winner is newer than the local materialized row/tombstone under `compareSyncRevision` (fail closed on ambiguous equal-clock ties); a stale winner SHALL NOT overwrite newer local state, while the pushed operation is still acknowledged and deferred newer rows are preserved for later convergence. The same guard SHALL protect local puts against stale deletes.

### R4: Durable scheduling and clear verification

**User Story:** As an existing user or maintainer, I want the fix to work after upgrades and subsequent queue updates.

**Acceptance Criteria:**
- R4.AC1: WHEN upgrading or reopening an existing database THEN legacy rows with absent retry times SHALL remain discoverable, and IDs, revisions, attempts, statuses, and payloads SHALL be preserved.
- R4.AC2: WHEN capture, retry, deferral, manual retry, bulk writes, or startup recovery change a row THEN its scheduling projection SHALL update atomically; the projection SHALL NOT be sent to providers.
- R4.AC3: WHEN implementation is complete THEN real-Dexie regression coverage, relevant sync/database tests, one typecheck, the existing outbox benchmark, and updated mapped documentation SHALL verify the behavior.
