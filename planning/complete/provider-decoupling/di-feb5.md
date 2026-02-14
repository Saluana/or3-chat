# Sync System Neckbead Review (Feb 5)

## 1) Your gateway push validation is backwards for posts
**Location:** `server/api/sync/push.post.ts:60-65`, `shared/sync/schemas.ts:95-106`, `shared/sync/field-mappings.ts:7-18`

`push.post.ts` converts payloads with `toClientFormat(...)` and then validates against `TABLE_PAYLOAD_SCHEMAS`. For `posts`, that mapping turns `post_type` into `postType`, but `PostPayloadSchema` explicitly requires `post_type`.

Why this is bad:
- The endpoint rejects valid wire payloads.
- The code comment claims schemas expect camelCase. They do not.

Real consequence:
- Valid post sync writes get 400s.
- Outbox retries become noise and can degrade into permanent failure handling.

Concrete fix:
```ts
const schema = TABLE_PAYLOAD_SCHEMAS[op.tableName];
if (schema) {
  // Validate canonical wire payload directly
  const result = schema.safeParse(op.payload);
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: ... });
  }
}
```
If you truly want camelCase validation, then rewrite schemas to camelCase. Right now the code and schema contracts disagree.

## 2) Bootstrap "infinite loop" detection is wrong
**Location:** `app/core/sync/subscription-manager.ts:208-223`

You check `response.nextCursor <= cursor` before considering `response.hasMore`. On the terminal page, `hasMore` can be `false` and `nextCursor` can equal `cursor` legitimately. You still log "Infinite loop detected" and break.

Why this is bad:
- You are flagging valid pagination completion as a loop.

Real consequence:
- False error hooks.
- Misleading diagnostics during normal operation.

Concrete fix:
```ts
if (response.hasMore && response.nextCursor <= cursor) {
  // loop detected
}
```

## 3) Backlog drain can spin forever
**Location:** `app/core/sync/subscription-manager.ts:503-527`

`drainBacklog()` loops on `hasMore` and never checks cursor progress. If a backend bug returns `hasMore: true` with a stable cursor, this never terminates.

Why this is bad:
- A single malformed response can trap the sync worker in a tight pull loop.

Real consequence:
- Unbounded API calls.
- Battery/network churn.
- User-facing lag while event loop is busy.

Concrete fix:
```ts
const prev = cursor;
cursor = response.nextCursor;
hasMore = response.hasMore;
if (hasMore && cursor <= prev) {
  // emit error hook + break
}
```

## 4) Gateway polling has the same infinite-loop footgun
**Location:** `app/core/sync/providers/gateway-sync-provider.ts:111-136`

The poll loop trusts `hasMore` blindly and only updates cursor when `nextCursor > cursor`, but it does not break when `hasMore` stays true and cursor does not advance.

Why this is bad:
- Same failure mode as backlog drain, now in provider transport code.

Real consequence:
- Hot spin against `/api/sync/pull`.
- Self-inflicted rate limiting and degraded sync reliability.

Concrete fix:
```ts
const prev = cursor;
if (response.nextCursor > cursor) cursor = response.nextCursor;
hasMore = response.hasMore;
if (hasMore && cursor <= prev) break;
```

## 5) You re-pull changes you just applied
**Location:** `app/core/sync/subscription-manager.ts:400-403`, `app/core/sync/subscription-manager.ts:426-446`

`handleChanges()` reads `currentCursor`, applies new changes, computes `maxVersion`, then calls `drainBacklog(currentCursor)` instead of `drainBacklog(maxVersion)`.

Why this is bad:
- You re-fetch the same window you just processed.

Real consequence:
- Duplicate apply work.
- Extra pull traffic.
- Inflated conflict/skipped counters.

Concrete fix:
```ts
const drainResult = await this.drainBacklog(maxVersion);
```

## 6) Duplicate deliveries are mislabeled as conflicts
**Location:** `app/core/sync/conflict-resolver.ts:240-274`, `app/core/sync/conflict-resolver.ts:147-187`

When `remoteClock === localClock` and `compareHLC(...) === 0`, code falls into the "local wins conflict" path instead of treating it as idempotent duplicate.

Why this is bad:
- Equal stamp is duplicate delivery, not a conflict.

Real consequence:
- False conflict hooks and noisy telemetry.
- Any conflict-driven UX is polluted.

Concrete fix:
```ts
const cmp = compareHLC(stamp.hlc, localHlc);
if (cmp > 0) { ...remote wins... }
if (cmp === 0) {
  return { applied: false, skipped: true, isConflict: false };
}
// cmp < 0 => local wins conflict
```

## 7) "Atomic outbox capture" is mostly not atomic
**Location:** `app/core/sync/hook-bridge.ts:8-9`, `app/core/sync/hook-bridge.ts:335-356`, `app/core/sync/hook-bridge.ts:374-388`

The code advertises atomic capture, but if `pending_ops` / `tombstones` are not in the transaction store set, it defers writes using `transaction.on('complete')` and separate DB calls.

Why this is bad:
- That is explicitly outside the original transaction.

Real consequence:
- Local write commits but outbox/tombstone enqueue can fail later.
- Silent divergence risk under tab close/crash/IO error.

Concrete fix:
- Enforce writes through explicit transactions that include business table + `pending_ops` (+ `tombstones` for deletes).
- If that guarantee cannot be met, fail fast instead of deferred best-effort.

## 8) Synced-table contract is inconsistent for `notifications`
**Location:** `app/core/sync/hook-bridge.ts:23-31`, `app/core/sync/subscription-manager.ts:21`, `shared/sync/schemas.ts:135-142`, `shared/sync/sanitize.ts:10`, `shared/sync/table-metadata.ts:1-8`

`notifications` is treated as synced in runtime table lists, but the shared sync contract tables do not include it in schema maps/metadata/sanitization lists.

Why this is bad:
- Runtime sync surface and shared contract surface are drifting.

Real consequence:
- `notifications` payloads bypass shared validation.
- Future schema drift for this table will fail late and inconsistently.

Concrete fix:
- Add `NotificationPayloadSchema`.
- Register it in `TABLE_PAYLOAD_SCHEMAS`.
- Add `notifications` to `TABLE_METADATA` and `TABLES_WITH_DELETED`.

## 9) `errorCode` is defined in types and dropped by runtime schema
**Location:** `shared/sync/types.ts:106-113`, `shared/sync/schemas.ts:166-171`, `app/core/sync/providers/convex-sync-provider.ts:154-165`

`PushResult` type includes `errorCode`; `PushResultItemSchema` does not. Convex provider parses with `PushResultSchema`, so structured codes are erased before Outbox sees them.

Why this is bad:
- You built code-paths that depend on `errorCode`, then strip the field.

Real consequence:
- Retry classification falls back to brittle message matching.
- Permanent/transient handling is less predictable.

Concrete fix:
- Extend `PushResultItemSchema` with `errorCode` enum matching `SyncErrorCode`.
- Return codes from backend and preserve them end-to-end.

## 10) Server LWW uses arrival order on equal clocks
**Location:** `convex/sync.ts:294-317`

Server-side apply uses `if (op.clock >= existing.clock)` for puts with no HLC tie-break when clocks are equal.

Why this is bad:
- Equal-clock concurrent writes resolve by who arrives last at server, not deterministic causal ordering.

Real consequence:
- Server table state can disagree with client conflict resolver semantics.
- Debugging cross-device divergence becomes a mess.

Concrete fix:
- Persist comparable tie-break data on synced rows (e.g., `hlc`), and when clocks tie, only apply if `incomingHlc > storedHlc`.

## 11) Batch apply is parallelized where ordering matters
**Location:** `convex/sync.ts:516-560`

You run `Promise.allSettled(...)` over `opsToApply`. That parallelizes writes that can target the same record while server versions are pre-assigned sequentially.

Why this is bad:
- State transitions can execute out of logical version order.

Real consequence:
- Final row state can violate the same batch's server_version ordering assumptions.
- Replays/debug traces become non-deterministic.

Concrete fix:
- Apply operations sequentially in assigned `serverVersion` order.
- If you insist on parallelism, partition by `(table_name, pk)` and serialize each partition.

## 12) Test coverage does not protect these failure modes
**Location:** `app/core/sync/__tests__/subscription-manager.test.ts`, `app/core/sync/__tests__/gateway-sync-provider.test.ts`, `server/api/sync/push.post.ts`

Current tests do not cover:
- `hasMore=true` + non-advancing cursor loop protection.
- Backlog drain starting from stale cursor.
- Equal-HLC duplicate idempotency.
- Gateway push validation of posts payload mapping.

Why this is bad:
- Regressions in core sync invariants are currently cheap to introduce.

Real consequence:
- You only discover breakage in production behavior, not in CI.

Concrete fix:
- Add explicit tests for each bullet above before touching sync internals again.
