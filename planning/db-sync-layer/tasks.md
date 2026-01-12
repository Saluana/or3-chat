# tasks.md

artifact_id: f2i6j3h7-9j4e-8k8f-g3j0-7h6i8j0k1l2m
date: 2026-01-11

## Implementation Checklist

### 1. SyncProvider Project Setup (Convex default)
- [ ] **1.1 Initialize Convex in or3-chat** (Requirements: 8.2)
    - [x] Install convex and convex-vue dependencies
    - [x] Create convex/ directory structure
    - [x] Configure convex.json
    - [x] Set up development and production deployments
- [ ] **1.2 Configure authentication integration** (Requirements: 8.2)
    - [x] Connect Convex auth to Clerk session (JWT verification)
    - [x] Verify workspace membership in Convex functions

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
- [x] **3.1 Define shared types** (Requirements: 3.3)
    - [x] Create `SyncScope`, `ChangeStamp`, `PendingOp` types
    - [x] Create `SyncChange`, `PullRequest`, `PullResponse` types
    - [x] Create `PushBatch`, `PushResult` types
    - [x] Create `SyncProvider` interface
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
- [x] **4.4 Ensure clock increments on all write paths**
    - [x] Increment `clock` on create/update/delete for threads, messages, projects, posts, kv, file_meta
    - [ ] Add tests to confirm `clock` advances on every mutation
- [x] **4.5 Create table interfaces** (Requirements: 3.1)
    - [x] Define `Tombstone` interface
    - [x] Define `SyncState` interface
    - [x] Define `SyncRun` interface

### 5. SyncProvider Implementation
- [x] **5.1 Create provider registry** (Requirements: 8.1)
    - [x] Create `sync-provider-registry.ts`
    - [x] Implement `registerSyncProvider()` and `getActiveSyncProvider()`
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
- [x] **6.1 Create HookBridge class** (Requirements: 3.1, 3.3)
    - [x] Capture writes using Dexie table hooks for atomic outbox writes
    - [x] Generate ChangeStamp with deviceId, opId, hlc, clock
    - [x] Add remote-write suppression to avoid sync loops
- [x] **6.2 Implement HLC generation** (Requirements: 3.3)
    - [x] Create hybrid logical clock utility
    - [x] Ensure monotonic timestamps

### 7. OutboxManager (Push Loop)
- [x] **7.1 Implement OutboxManager class** (Requirements: 3.2, 4.1)
    - [x] Create flush loop with configurable interval
    - [x] Batch pending ops respecting max batch size
    - [x] Mark ops as 'syncing' during push
- [x] **7.2 Implement retry logic** (Requirements: 4.1, 4.2)
    - [x] Exponential backoff: [250, 1000, 3000, 5000]ms
    - [x] Track attempts per op
    - [x] Move to 'failed' after max attempts
- [x] **7.3 Implement queue management** (Requirements: 3.2)
    - [x] Track queue byte size
    - [x] Coalesce updates to same record
    - [x] Emit `sync.queue:action:full` when at capacity

### 8. Pull/Subscribe Loop
- [x] **8.1 Create subscription manager** (Requirements: 5.1)
    - [x] Subscribe to Convex reactive queries per table
    - [x] Route changes to ConflictResolver
    - [x] Handle subscription errors gracefully
- [x] **8.2 Implement CursorManager** (Requirements: 5.2)
    - [x] Persist cursor in sync_state table
    - [x] Drive bootstrap pull on cold start
    - [x] Detect cursor expiry scenarios
    - [x] Keep a single `server_version` cursor per workspace (no per-table cursors)

### 9. ConflictResolver
- [x] **9.1 Implement LWW conflict resolution** (Requirements: 6.1)
    - [x] Compare clock values
    - [x] Use HLC for tie-breaking
    - [x] Apply winning version to Dexie
- [x] **9.2 Emit conflict hooks** (Requirements: 6.2)
    - [x] Call `sync.conflict:action:detected` hook with details
    - [x] Include local, remote, and winner info

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
- [x] **14.1 Unit tests** (Requirements: all)
    - [x] ChangeStamp/HLC generation
    - [x] Conflict resolution matrix
    - [x] Outbox coalescing
    - [x] Retry backoff
- [x] **14.2 Integration tests**
    - [x] Push flow with mock provider
    - [x] Pull flow with mock provider
    - [x] Conflict scenarios
- [ ] **14.3 E2E tests**
    - [ ] Multi-device sync
    - [ ] Offline recovery

---

## Recommended Implementation Order

> **Note:** Phases are grouped by dependency, not by number. Complete each group before moving to the next.

### Group 1: Client Sync Infrastructure ✅
- [x] **3.1** Shared sync types
- [x] **6** HookBridge (change capture)
- [x] **7** OutboxManager (push loop)
- [x] **9** ConflictResolver (LWW resolution)
- [x] **5.1** Provider registry
- [x] **14.1-14.2** Unit & integration tests

### Group 2: Pull/Subscribe (Current)
- [/] **8** Pull/Subscribe Loop (CursorManager + SubscriptionManager)

### Group 3: Dexie Schema Migration
- [ ] **4.1-4.3** Add sync tables to Dexie (pending_ops, tombstones, sync_state, sync_runs)
- [ ] **4.4** Clock increment tests

### Group 4: Convex Backend
- [ ] **2** Convex schema and functions
- [ ] **5.2** Convex provider implementation
- [ ] **3.2** Zod validation schemas (optional)

### Group 5: Integration & Recovery
- [ ] **10** Tombstones and GC
- [ ] **11** Bootstrap and rescan flows
- [ ] **12** Sync plugin integration
- [ ] **13** Hook type additions
- [ ] **5.3** Gateway provider support (optional)

### Group 6: E2E Validation
- [ ] **14.3** E2E tests (multi-device, offline recovery)
