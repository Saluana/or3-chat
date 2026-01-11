# tasks.md

artifact_id: f2i6j3h7-9j4e-8k8f-g3j0-7h6i8j0k1l2m
date: 2026-01-11

## Implementation Checklist

### 1. SyncProvider Project Setup (Convex default)
- [ ] **1.1 Initialize Convex in or3-chat** (Requirements: 8.2)
    - [ ] Install convex and convex-vue dependencies
    - [ ] Create convex/ directory structure
    - [ ] Configure convex.json
    - [ ] Set up development and production deployments
- [ ] **1.2 Configure authentication integration** (Requirements: 8.2)
    - [ ] Connect Convex auth to Clerk session (JWT verification)
    - [ ] Verify workspace membership in Convex functions

### 2. Provider Schema and Functions (Convex example)
- [ ] **2.1 Create Convex schema** (Requirements: 2.1, 8.2)
    - [ ] Define change_log table with server_version index (snake_case fields)
    - [ ] Define threads, messages (include `order_key`), projects, posts, kv tables with workspace scope (snake_case fields)
    - [ ] Define file_meta table (snake_case fields)
    - [ ] Define server_version_counter table
    - [ ] Define device_cursors table for retention
    - [ ] Add all required indexes
- [ ] **2.2 Implement sync functions** (Requirements: 5.1, 5.2)
    - [ ] Implement `push` mutation with idempotency via opId
    - [ ] Implement `pull` query with cursor-based pagination
    - [ ] Implement `watchChanges` reactive query for subscriptions
    - [ ] Implement `applyOpToTable` helper with LWW check
- [ ] **2.3 Implement server version counter** (Requirements: 5.2)
    - [ ] Create `getNextServerVersion` atomic increment helper

### 3. Client-Side Sync Types
- [ ] **3.1 Define shared types** (Requirements: 3.3)
    - [ ] Create `SyncScope`, `ChangeStamp`, `PendingOp` types
    - [ ] Create `SyncChange`, `PullRequest`, `PullResponse` types
    - [ ] Create `PushBatch`, `PushResult` types
    - [ ] Create `SyncProvider` interface
- [ ] **3.2 Create Zod schemas for validation** (Requirements: 3.3)
    - [ ] Define schemas for all sync types
    - [ ] Export for both client and server use

### 4. Dexie Schema Extensions
- [ ] **4.1 Add sync tables to Dexie** (Requirements: 3.1)
    - [ ] Add `pending_ops` table with indexes
    - [ ] Add `tombstones` table
    - [ ] Add `sync_state` table
    - [ ] Add `sync_runs` table
    - [ ] Bump Dexie version to 7 (coordinate with storage schema changes)
- [ ] **4.2 Add workspace DB factory**
    - [ ] Implement `useWorkspaceDb(workspaceId)` -> `or3-db-${workspaceId}`
    - [ ] Ensure sync engine is bound to the active workspace DB
- [ ] **4.3 Add deterministic message ordering**
    - [ ] Add `order_key` to message schema (HLC-derived)
    - [ ] Update Dexie index to `[thread_id+index+order_key]`
- [ ] **4.3 Ensure clock increments on all write paths**
    - [ ] Increment `clock` on create/update/delete for threads, messages, projects, posts, kv, file_meta
    - [ ] Add tests to confirm `clock` advances on every mutation
- [ ] **4.2 Create table interfaces** (Requirements: 3.1)
    - [ ] Define `Tombstone` interface
    - [ ] Define `SyncState` interface
    - [ ] Define `SyncRun` interface

### 5. SyncProvider Implementation
- [ ] **5.1 Create provider registry** (Requirements: 8.1)
    - [ ] Create `sync-provider-registry.ts`
    - [ ] Implement `registerSyncProvider()` and `getActiveSyncProvider()`
- [ ] **5.2 Implement Convex provider** (Requirements: 8.2)
    - [ ] Create `convex-sync-provider.ts`
    - [ ] Set `mode: 'direct'` and required auth template metadata
    - [ ] Implement `subscribe()` using Convex reactive queries
    - [ ] Implement `pull()` calling Convex query
    - [ ] Implement `push()` calling Convex mutation
    - [ ] Implement `dispose()` cleanup
 - [ ] **5.3 Add gateway provider support** (Requirements: 8.3)
    - [ ] Allow providers to declare `mode: 'gateway'`
    - [ ] Route gateway providers through SSR endpoints for push/pull

### 6. HookBridge (Change Capture)
- [ ] **6.1 Create HookBridge class** (Requirements: 3.1, 3.3)
    - [ ] Capture writes using Dexie table hooks for atomic outbox writes
    - [ ] Generate ChangeStamp with deviceId, opId, hlc, clock
    - [ ] Add remote-write suppression to avoid sync loops
- [ ] **6.2 Implement HLC generation** (Requirements: 3.3)
    - [ ] Create hybrid logical clock utility
    - [ ] Ensure monotonic timestamps

### 7. OutboxManager (Push Loop)
- [ ] **7.1 Implement OutboxManager class** (Requirements: 3.2, 4.1)
    - [ ] Create flush loop with configurable interval
    - [ ] Batch pending ops respecting max batch size
    - [ ] Mark ops as 'syncing' during push
- [ ] **7.2 Implement retry logic** (Requirements: 4.1, 4.2)
    - [ ] Exponential backoff: [250, 1000, 3000, 5000]ms
    - [ ] Track attempts per op
    - [ ] Move to 'failed' after max attempts
- [ ] **7.3 Implement queue management** (Requirements: 3.2)
    - [ ] Track queue byte size
    - [ ] Coalesce updates to same record
    - [ ] Emit `sync.queue:action:full` when at capacity

### 8. Pull/Subscribe Loop
- [ ] **8.1 Create subscription manager** (Requirements: 5.1)
    - [ ] Subscribe to Convex reactive queries per table
    - [ ] Route changes to ConflictResolver
    - [ ] Handle subscription errors gracefully
- [ ] **8.2 Implement CursorManager** (Requirements: 5.2)
    - [ ] Persist cursor in sync_state table
    - [ ] Drive bootstrap pull on cold start
    - [ ] Detect cursor expiry scenarios
    - [ ] Keep a single `server_version` cursor per workspace (no per-table cursors)

### 9. ConflictResolver
- [ ] **9.1 Implement LWW conflict resolution** (Requirements: 6.1)
    - [ ] Compare clock values
    - [ ] Use HLC for tie-breaking
    - [ ] Apply winning version to Dexie
- [ ] **9.2 Emit conflict hooks** (Requirements: 6.2)
    - [ ] Call `sync.conflict:action:detected` hook with details
    - [ ] Include local, remote, and winner info

### 10. Tombstones and GC
- [ ] **10.1 Implement tombstone tracking** (Requirements: 7.1, 7.2)
    - [ ] Write tombstone on delete sync
    - [ ] Check tombstones during rescan
    - [ ] Prevent resurrection of deleted records
- [ ] **10.2 Implement GC** (Requirements: 7.3)
    - [ ] Query eligible tombstones (old + all devices advanced)
    - [ ] Purge from local and remote
    - [ ] Run during idle periods
 - [ ] **10.3 Implement change_log retention**
    - [ ] Track `device_cursors.last_seen_version`
    - [ ] Purge change_log entries below min cursor with retention window

### 11. Recovery and Rescan
- [ ] **11.1 Implement bootstrap flow** (Requirements: 9.1)
    - [ ] Paginated pull on first connection
    - [ ] Emit progress events
    - [ ] Complete when cursor catches up
- [ ] **11.2 Implement rescan** (Requirements: 9.1, 9.2)
    - [ ] Detect cursor expiry
    - [ ] Build staged dataset
    - [ ] Rebase pending ops
    - [ ] Atomic swap

### 12. Sync Plugin Integration
- [ ] **12.1 Create sync plugin** (Requirements: 1.1)
    - [ ] Create `app/plugins/convex-sync.client.ts`
    - [ ] Start engine on authenticated session
    - [ ] Stop engine on sign-out
    - [ ] Handle HMR disposal
- [ ] **12.2 Integrate with auth system**
    - [ ] Watch session changes
    - [ ] Pass workspace ID to engine
    - [ ] Respect SSR auth enabled flag
    - [ ] Ensure direct providers acquire auth tokens via `AuthTokenBroker`

### 13. Hook Type Additions
- [ ] **13.1 Add sync hooks to hook-types.ts** (Requirements: 10.1)
    - [ ] Add `sync.*` action hooks (e.g., `sync.push:action:before`)
    - [ ] Define payload types for each hook

### 14. Testing
- [ ] **14.1 Unit tests** (Requirements: all)
    - [ ] ChangeStamp/HLC generation
    - [ ] Conflict resolution matrix
    - [ ] Outbox coalescing
    - [ ] Retry backoff
- [ ] **14.2 Integration tests**
    - [ ] Push flow with mock provider
    - [ ] Pull flow with mock provider
    - [ ] Conflict scenarios
- [ ] **14.3 E2E tests**
    - [ ] Multi-device sync
    - [ ] Offline recovery
