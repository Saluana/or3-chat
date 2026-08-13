# Database Sync Layer

The OR3 Sync Layer provides offline-first, bidirectional synchronization between the local Dexie database and the Convex backend. It enables users to work offline and have their changes automatically synced when connectivity is restored, with support for multi-device synchronization and conflict resolution.

## Materialized snapshot bootstrap contract

Cold bootstrap uses a provider-neutral materialized snapshot instead of cursor
zero change-log replay. Each page is bound to one workspace, opaque
`snapshotId`, and `highWatermark`; continuation tokens are opaque and returned
unchanged. Providers order canonical rows and tombstones by
`(tableName, primaryKey, kind)`, use bounded reads, and preserve the same
watermark across the complete page chain. The client applies the complete
snapshot transactionally, then begins incremental replay strictly after the
watermark.

SQLite and Convex implement provider-side materialized snapshot page generators,
and the client atomically installs their page chains before replaying strictly
after the watermark. Cross-provider coverage verifies deterministic rows,
tombstones, intervening writes, duplicate boundaries, and fresh-device recovery
after the original log entries have been pruned. Change-log and tombstone
retention is enabled for adapters that declare the `snapshot-v1` retention
contract; adapters that do not fail closed with `503`.

When an existing device's cursor expires, snapshot-capable providers use the
same canonical replacement path instead of attempting cursor-zero replay.
Materialized rows and tombstones for the requested tables are replaced
atomically, changes after the snapshot watermark are replayed, and pending local
puts/deletes are re-applied before the live subscription resumes.

## Pull retention and snapshot recovery

Every pull response includes `oldestRetainedVersion` and `requiresSnapshot`.
`requiresSnapshot` is true when the requested cursor would skip versions the
server has already garbage-collected. Clients must snapshot-recover instead of
advancing across that gap. Wall-clock cursor age (24h) is only a fallback when
the retention fields are absent.

## Notification scoping

SQLite push/pull/snapshot bind `notifications.user_id` to the session user.
Spoofed owners are rejected. Pull and snapshot omit other users' notification
rows and tombstones, while the pull cursor still advances over the unfiltered
change-log window so filtering cannot stall sync.

## Server-authored operations

Convex auxiliary writers (notifications, `file_meta`, workspace settings) mint a
fresh UUID `op_id`, allocate a `server_version`, and append `change_log` using
the same stamp contract as client pushes. Historical non-UUID `op_id`s are
skipped on pull/watch without failing the request.

## Conflict resolution

LWW compares `clock`, then `hlc`, then `op_id`. Equal clock/hlc ties are
deterministic. Tombstones use the same revision tuple. A push that loses LWW
returns `{ success: true, applied: false, payload: <winner> }`; the client
applies the winner locally and drops the outbox row.

Gateway `/api/sync/push` validates each operation independently and returns
HTTP 200 mixed results. Request bodies are bounded; rate limits are recorded on
admission, including when the adapter later fails.

---

## Architecture Overview

The sync layer operates on a "local-first" principle. All UI reads and writes target the local Dexie database. The sync engine runs in the background to propagate changes.

### Core Components

| Component                 | Responsibility                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| **HookBridge**            | Intercepts Dexie writes (`put`, `delete`) and queues them as `PendingOp` entries.                   |
| **OutboxManager**         | Flushes pending operations to the server in batches, handling retries and failure strategies.       |
| **SubscriptionManager**   | Manages real-time subscriptions to server changes and performs bootstrap/rescan operations.         |
| **ConflictResolver**      | Applies remote changes to the local DB using Last-Write-Wins (LWW) and Hybrid Logical Clocks (HLC). |
| **GcManager**             | Client lifecycle shell; server retention is capability-gated and administrative.                    |
| **CursorManager**         | Tracks the sync cursor (server version) per workspace for incremental sync.                         |
| **RecentOpCache**         | Prevents echoing of recently pushed operations back from the server.                                |
| **SyncPayloadNormalizer** | Handles snake_case/camelCase field mapping and payload validation.                                  |
| **ConvexSyncProvider**    | Adapter that communicates with the Convex backend APIs using the shared Sync Protocol.              |
| **GatewaySyncProvider**   | Alternative provider that routes sync through SSR server endpoints.                                 |

### Retention safety

Sync `change_log` and tombstone garbage collection is available only when the
active server adapter explicitly declares both `snapshotBootstrap` and
`historyRetention` as `snapshot-v1`. Missing capabilities fail closed with
`503`. SQLite and Convex collectors preserve history newer than the minimum
registered-device cursor; fresh devices recover canonical state from a snapshot
and replay strictly after its watermark.

---

## Data Flow

### Write Path (Local to Remote)

1.  **Application Write**: The UI writes to Dexie (e.g., `db.messages.put(...)`).
2.  **Capture**: `HookBridge` intercepts the transaction via Dexie hooks.
3.  **Queue**: A `PendingOp` is created and added to the `pending_ops` table within the _same transaction_.
4.  **Flush**: `OutboxManager` detects pending items and pushes them to the backend (`mutation: sync.push`).
5.  **Confirmation**: On success, the `PendingOp` is removed. On failure, it is scheduled for retry.

### Read Path (Remote to Local)

1.  **Subscription**: `SubscriptionManager` listens for changes since the last known cursor (`query: sync.watchChanges`).
2.  **Receive**: The provider receives a batch of `SyncChange` objects.
3.  **Conflict Resolution**: `ConflictResolver` applies changes to Dexie:
    - Compares remote timestamp (`HLC`) with local record.
    - If remote is newer -> Apply change.
    - If local is newer -> Ignore remote (Local Wins).
    - If conflicting timestamps -> `HLC` tie-breaking.
4.  **Reactivity**: Dexie live queries update automatically, refreshing the UI.

---

## Conflict Resolution

We use a **Last-Write-Wins (LWW)** strategy driven by **Hybrid Logical Clocks (HLC)**.

- Every materialized record and tombstone persists the same `(clock, hlc, op_id)` tuple as its outbox/change-log operation.
- When a change occurs, the clock is incremented.
- **Tombstones** are used to track deletions, ensuring that "delete wins" against older "put" operations.
- **Tie-Breaking**: one total comparator orders clock, then HLC, then operation ID. Equal-clock legacy tombstones missing tie-break metadata fail closed.
- **Legacy repair**: the internal Convex `sync.repairLegacyTombstones` command repairs only tombstones with one uniquely matching delete in `change_log`. Missing or ambiguous history is reported and never guessed; the command is bounded and safe to repeat.

---

## Observability Hooks

The sync engine emits lifecycle hooks that plugins can listen to:

### Write Path Hooks

| Hook Key                     | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `sync.op:action:captured`    | A local write was intercepted and queued.               |
| `sync.capture:action:nonAtomic` | A write was captured outside a Dexie transaction.    |
| `sync.push:action:before`    | A batch is about to be pushed to the server.            |
| `sync.push:action:after`     | A batch push finished (counts successes and failures).  |
| `sync.retry:action`          | An op was scheduled for retry.                          |
| `sync.queue:action:full`     | Pending op queue is near capacity (500 ops).            |
| `sync.error:action`          | A sync operation failed (retryable or permanent).       |

### Read Path Hooks

| Hook Key                        | Description                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `sync.pull:action:received`     | Remote changes were received from the server.                |
| `sync.pull:action:applied`      | Remote changes were successfully applied to local DB.        |
| `sync.pull:action:after`        | A pull cycle finished.                                       |
| `sync.pull:action:error`        | Failed to apply remote changes.                              |
| `sync.conflict:action:detected` | A conflict occurred (local and remote modified same record). |

### Bootstrap/Rescan Hooks

| Hook Key                         | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `sync.bootstrap:action:start`    | Bootstrap (initial sync) has started.             |
| `sync.bootstrap:action:progress` | Bootstrap progress update (cursor, pulled count). |
| `sync.bootstrap:action:complete` | Bootstrap has completed.                          |
| `sync.bootstrap:action:error`    | Bootstrap failed.                                 |
| `sync.rescan:action:starting`    | Rescan (cursor reset) has started.                |
| `sync.rescan:action:progress`    | Rescan progress update.                           |
| `sync.rescan:action:completed`   | Rescan has completed.                             |

### Subscription Hooks

| Hook Key                                      | Description                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| `sync.subscription:action:statusChange`       | Connection status changed (connected, disconnected, syncing). |
| `sync.subscription:action:maxRetriesExceeded` | Max reconnection attempts reached.                            |
| `sync.stats:action`                           | Periodic sync statistics report.                              |

### Notification Suppression During Bootstrap

**Important:** During bootstrap and rescan operations, sync error notifications are suppressed to avoid overwhelming the user:

- **Sync error notifications** - Not created during bootstrap/rescan
- **Burst suppression** - More than 5 sync errors within 10 seconds starts a 60-second cooldown
- **Deduplication** - Repeated errors for the same record and message are deduplicated within a 15-second window

Sync conflict events (`sync.conflict:action:detected`) are not user-facing at all. They only emit development logs, so loading a workspace for the first time can never produce a "notification storm".

```typescript
// These hooks are useful for showing loading indicators
hooks.addAction("sync.bootstrap:action:start", () => {
  showLoadingState("Syncing workspace data...");
});

hooks.addAction("sync.bootstrap:action:complete", () => {
  hideLoadingState();
});
```

## Implementing a Custom Provider

The sync layer is backend-agnostic. You can implement your own provider (e.g., for Supabase, Firebase, or a custom WebSocket server) by implementing the `SyncProvider` interface.

### 1. The SyncProvider Interface

The core contract is defined in `shared/sync/types.ts`. Your provider must implement these methods:

```typescript
export interface SyncProvider {
  id: string; // Unique identifier (e.g., 'supabase', 'custom-ws')
  mode: "direct" | "gateway"; // 'direct' for client-side, 'gateway' for SSR proxies

  // Real-time subscription
  subscribe(
    scope: SyncScope,
    tables: string[],
    onChanges: (changes: SyncChange[]) => void,
  ): Promise<() => void>;

  // Bootstrap / Catch-up
  pull(request: PullRequest): Promise<PullResponse>;

  // Outbox Flush
  push(batch: PushBatch): Promise<PushResult>;

  // Cursor Checkpointing
  updateCursor(
    scope: SyncScope,
    deviceId: string,
    version: number,
  ): Promise<void>;
}
```

### 2. Backend Requirements

To support the OR3 Sync Protocol, your backend must:

1.  **Store Cursors**: Maintain a monotonic "server version" or "cursor" for the workspace.
2.  **LWW Logic**: When receiving a push, compare validation logic:
    - If `incoming.clock > current.clock`: Write.
    - If `incoming.clock == current.clock` and `incoming.hlc > current.hlc`: Write.
    - Else: Ignore (out of order).
3.  **Tombstones**: Never hard-delete synced records. Mark them as `deleted=true` so the deletion can propagate to other clients.
4.  **Batching**: Support atomic batches for both reads (`pull`) and writes (`push`).

Push handlers validate each operation before allocating its server version. A
malformed operation returns its own `VALIDATION_ERROR` while valid siblings
continue; logical primary keys and workspace ownership fields cannot be changed
through payload data. Repeated operation IDs are allocated and applied once only
when their complete operation fingerprints match. Conflicting reuse of an ID,
including a conflict with an already-processed operation, returns `CONFLICT`
without consuming another version.

Each operation may carry at most 256 KB of serialized payload data. Oversized
workflow messages are compacted into a bounded cross-device snapshot before
they enter the outbox; the complete workflow state remains in local storage and
the durable background execution checkpoint.

Server push requests are rate limited (`sync:push`: 200 requests per minute).
Client outbox flushing treats HTTP 429 (and 502/503/504) as a deferral, not a
failure: the batch moves back to `retry_wait` with `nextAttemptAt` taken from
the `Retry-After` header, and `attempts` is not incremented. Only genuine
failures count against the retry budget (`[250ms, 1s, 3s, 5s]`), so a hot outbox
cannot exhaust healthy operations under sustained rate limiting.

HTTP 401/403 responses stop gateway polling and trigger session refresh. Queued
writes stay in `retry_wait` without consuming an attempt, so signing out or an
expired session does not create a retry/log storm or discard local changes.

### 3. Implementation Example (Skeleton)

```typescript
import { registerSyncProvider } from "~/core/sync/sync-provider-registry";
import type { SyncProvider, SyncChange } from "~~/shared/sync/types";

export class MyCustomProvider implements SyncProvider {
  id = "my-custom-backend";
  mode = "direct" as const;

  async subscribe(scope, tables, onChanges) {
    // 1. Connect to your WebSocket / Realtime channel
    const channel = myClient.subscribe(`workspace:${scope.workspaceId}`);

    // 2. Listen for events
    channel.on("db_change", (event) => {
      // 3. Map backend event to SyncChange format
      const changes: SyncChange[] = event.data.map((row) => ({
        tableName: row.table,
        pk: row.id,
        op: row.deleted ? "delete" : "put",
        payload: row.data,
        serverVersion: row.global_sequence_number,
        stamp: {
          clock: row.clock,
          hlc: row.hlc,
          deviceId: row.device_id,
          opId: row.op_id,
        },
      }));

      onChanges(changes);
    });

    // Return cleanup function
    return () => channel.unsubscribe();
  }

  async pull(req) {
    // Fetch changes > req.cursor
    // Return { changes: [], nextCursor: 123, hasMore: false }
  }

  async push(batch) {
    // Send batch.ops to server
    // Return results for each op (success/fail) to update local queue
  }
}

// 4. Register the provider
registerSyncProvider(new MyCustomProvider());
```

### 4. Integration

To activate your provider:

1.  Create a client plugin (e.g., `plugins/my-sync.client.ts`).
2.  Instantiate your provider.
3.  Call `registerSyncProvider(instance)`.
4.  Ensure `activeProviderId` is set to your provider's ID (or relying on default behavior if it's the only one).

The `ConvexSyncClient` (`plugins/convex-sync.client.ts`) is a reference implementation showing how to hook into session state and start/stop the engine.

---

## Troubleshooting Sync Issues

### Sync Not Working

**Symptoms:** Changes don't appear on other devices, no sync activity visible.

**Checks:**

```bash
# 1. Verify environment variables
echo $SSR_AUTH_ENABLED  # Should be "true"
echo $OR3_SYNC_ENABLED   # Should be "true"
echo $VITE_CONVEX_URL    # Should be set
```

**Solutions:**

- Ensure OR3 Cloud is enabled (see [or3-cloud-config](./or3-cloud-config))
- Check network connectivity
- Verify user is authenticated
- Check browser console for sync errors

### Too Many Conflict Notifications

**Symptoms:** Dozens of "Sync conflict resolved" notifications on first load.

**This is no longer possible.** Conflict events never create notifications. They only produce development logs. Sync error notifications are the only sync-related notification type, and they are:

- Suppressed during bootstrap/rescan
- Deduplicated within a 15-second window per record and message
- Burst-limited (more than 5 in 10 seconds triggers a 60-second cooldown)

If you still see repeated sync error notifications:

- Check that `notification-listeners.client.ts` is loaded
- Look for debug logs: `[notify]` entries in the browser console

### Bootstrap Taking Too Long

**Symptoms:** Initial workspace load is very slow.

**Solutions:**

- This is normal for large workspaces (1000+ records)
- Snapshot bootstrap is paginated (300 rows per batch by default)
- Monitor progress via `sync.bootstrap:action:progress` hook
- Consider implementing a loading indicator

For repeatable local measurements, run:

```bash
bun run sync:outbox:benchmark
bun run sync:snapshot:benchmark
bun run sync:benchmarks:check
bun run performance:workspace:check
```

The outbox harness seeds superseded writes and verifies bounded 50-operation
batches, deterministic coalescing, and a fully drained queue. The snapshot
harness installs 50,000 materialized rows in 300-row pages and verifies the row
count and replay watermark. Override fixture sizes with
`OR3_BENCH_OUTBOX_RECORDS`, `OR3_BENCH_OUTBOX_REVISIONS`,
`OR3_BENCH_SNAPSHOT_ROWS`, and `OR3_BENCH_SNAPSHOT_PAGE_SIZE`.
Both harnesses enforce wall-time and throughput regression budgets and write
versioned JSON reports under `output/performance/`. Override runner-specific
budgets with `OR3_BENCH_OUTBOX_MAX_DRAIN_MS`,
`OR3_BENCH_OUTBOX_MIN_OPS_PER_SECOND`,
`OR3_BENCH_SNAPSHOT_MAX_APPLY_MS`, and
`OR3_BENCH_SNAPSHOT_MIN_ROWS_PER_SECOND`. `bun run performance:check` also
enforces a populated-workspace profile (1,200 threads and 14,400 messages by
default), command-palette budgets, and browser Core Web Vitals. Override the
workspace fixture with `OR3_BENCH_WORKSPACE_THREADS` and
`OR3_BENCH_WORKSPACE_MESSAGES_PER_THREAD`; the workspace benchmark stays
bounded and does not create large browser quota fixtures. CI also builds the
production application and enforces total/largest compressed and uncompressed
JavaScript and CSS budgets. All gates retain versioned reports as trend
artifacts once the standalone dependency publishing blocker described in the
[provider compatibility matrix](./provider-compatibility-matrix) is resolved.

### Cursor Reset / Rescan Loop

**Symptoms:** Sync keeps restarting, data re-downloads frequently.

**Causes:**

- Cursor expiration (default 24 hours)
- Device cursor tracking issues

**Solutions:**

- Check `sync.rescan:action:starting` hook frequency
- Verify device cursor is being updated via `updateDeviceCursor`
- Review GC retention settings

### Data Not Appearing After Sync

**Symptoms:** Sync completes but data doesn't show in UI.

**Checks:**

```typescript
// 1. Verify sync completed
hooks.addAction("sync.bootstrap:action:complete", (data) => {
  console.log("Bootstrap complete:", data);
  // Check totalPulled count
});

// 2. Check Dexie directly
const db = getDb();
const count = await db.messages.count();
console.log("Local message count:", count);
```

**Solutions:**

- Verify live queries are set up correctly
- Check for filter predicates that might exclude data
- Ensure user_id matches between synced data and queries

---

## Related

- [Notifications](./notifications) - Notification system that integrates with sync
- [Auth System](./auth-system) - Authentication required for sync
- [Troubleshooting](./troubleshooting) - General troubleshooting guide
- [Hooks](../hooks/hooks) - Hook system for sync events
