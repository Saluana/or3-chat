# Database Sync Layer

The OR3 Sync Layer provides offline-first, bidirectional synchronization between the local Dexie database and the Convex backend. It enables users to work offline and have their changes automatically synced when connectivity is restored, with support for multi-device synchronization and conflict resolution.

---

## Architecture Overview

The sync layer operates on a "local-first" principle. All UI reads and writes target the local Dexie database. The sync engine runs in the background to propagate changes.

### Core Components

| Component | Responsibility |
|-----------|----------------|
| **HookBridge** | Intercepts Dexie writes (`put`, `delete`) and queues them as `PendingOp` entries. |
| **OutboxManager** | Flushes pending operations to the server in batches, handling retries and failure strategies. |
| **SubscriptionManager** | Manages real-time subscriptions to server changes and performs bootstrap/rescan operations. |
| **ConflictResolver** | Applies remote changes to the local DB using Last-Write-Wins (LWW) and Hybrid Logical Clocks (HLC). |
| **GcManager** | Periodically cleans up tombstones and old change logs to manage storage. |
| **ConvexSyncProvider** | Adapter that communicates with the Convex backend APIs using the shared Sync Protocol. |

---

## Data Flow

### Write Path (Local to Remote)

1.  **Application Write**: The UI writes to Dexie (e.g., `db.messages.put(...)`).
2.  **Capture**: `HookBridge` intercepts the transaction via Dexie hooks.
3.  **Queue**: A `PendingOp` is created and added to the `pending_ops` table within the *same transaction*.
4.  **Flush**: `OutboxManager` detects pending items and pushes them to the backend (`mutation: sync.push`).
5.  **Confirmation**: On success, the `PendingOp` is removed. On failure, it is scheduled for retry.

### Read Path (Remote to Local)

1.  **Subscription**: `SubscriptionManager` listens for changes since the last known cursor (`query: sync.watchChanges`).
2.  **Receive**: The provider receives a batch of `SyncChange` objects.
3.  **Conflict Resolution**: `ConflictResolver` applies changes to Dexie:
    *   Compares remote timestamp (`HLC`) with local record.
    *   If remote is newer -> Apply change.
    *   If local is newer -> Ignore remote (Local Wins).
    *   If conflicting timestamps -> `HLC` tie-breaking.
4.  **Reactivity**: Dexie live queries update automatically, refreshing the UI.

---

## Conflict Resolution

We use a **Last-Write-Wins (LWW)** strategy driven by **Hybrid Logical Clocks (HLC)**.

*   Every record has a `clock` (counter) and `hlc` (timestamp-based string).
*   When a change occurs, the clock is incremented.
*   **Tombstones** are used to track deletions, ensuring that "delete wins" against older "put" operations.
*   **Tie-Breaking**: If two changes have the exact same clock, the alphanumeric comparison of the HLC string determines the winner.

---

## Observability Hooks

The sync engine emits lifecycle hooks that plugins can listen to:

| Hook Key | Description |
|----------|-------------|
| `sync.op:action:captured` | A local write was intercepted and queued. |
| `sync.push:action:after` | A batch of operations was successfully pushed. |
| `sync.pull:action:received` | Remote changes were received from the server. |
| `sync.conflict:action:detected` | A conflict occurred (local and remote modified same record). |
| `sync.error:action` | A sync operation failed (retryable or permanent). |
| `sync.subscription:action:statusChange` | Connection status changed (connected, disconnected, syncing). |


## Implementing a Custom Provider

The sync layer is backend-agnostic. You can implement your own provider (e.g., for Supabase, Firebase, or a custom WebSocket server) by implementing the `SyncProvider` interface.

### 1. The SyncProvider Interface

The core contract is defined in `shared/sync/types.ts`. Your provider must implement these methods:

```typescript
export interface SyncProvider {
    id: string; // Unique identifier (e.g., 'supabase', 'custom-ws')
    mode: 'direct' | 'gateway'; // 'direct' for client-side, 'gateway' for SSR proxies

    // Real-time subscription
    subscribe(
        scope: SyncScope,
        tables: string[],
        onChanges: (changes: SyncChange[]) => void
    ): Promise<() => void>;

    // Bootstrap / Catch-up
    pull(request: PullRequest): Promise<PullResponse>;

    // Outbox Flush
    push(batch: PushBatch): Promise<PushResult>;

    // Cursor Checkpointing
    updateCursor(scope: SyncScope, deviceId: string, version: number): Promise<void>;
}
```

### 2. Backend Requirements

To support the OR3 Sync Protocol, your backend must:

1.  **Store Cursors**: Maintain a monotonic "server version" or "cursor" for the workspace.
2.  **LWW Logic**: When receiving a push, compare validation logic:
    *   If `incoming.clock > current.clock`: Write.
    *   If `incoming.clock == current.clock` and `incoming.hlc > current.hlc`: Write.
    *   Else: Ignore (out of order).
3.  **Tombstones**: Never hard-delete synced records. Mark them as `deleted=true` so the deletion can propagate to other clients.
4.  **Batching**: Support atomic batches for both reads (`pull`) and writes (`push`).

### 3. Implementation Example (Skeleton)

```typescript
import { registerSyncProvider } from '~/core/sync/sync-provider-registry';
import type { SyncProvider, SyncChange } from '~~/shared/sync/types';

export class MyCustomProvider implements SyncProvider {
    id = 'my-custom-backend';
    mode = 'direct' as const;

    async subscribe(scope, tables, onChanges) {
        // 1. Connect to your WebSocket / Realtime channel
        const channel = myClient.subscribe(`workspace:${scope.workspaceId}`);
        
        // 2. Listen for events
        channel.on('db_change', (event) => {
            // 3. Map backend event to SyncChange format
            const changes: SyncChange[] = event.data.map(row => ({
                tableName: row.table,
                pk: row.id,
                op: row.deleted ? 'delete' : 'put',
                payload: row.data,
                serverVersion: row.global_sequence_number,
                stamp: {
                    clock: row.clock,
                    hlc: row.hlc,
                    deviceId: row.device_id,
                    opId: row.op_id,
                }
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
