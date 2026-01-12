# tasks.md

artifact_id: c9f3g0e4-6g1b-5h5c-d0g7-4e3f5g7h8i9j
date: 2026-01-11

## Implementation Checklist

### 1. Schema and Data Model Extensions
- [x] **1.1 Extend FileMetaSchema** (Requirements: 4.1, 4.2)
    - [x] Add `storage_provider_id` and `storage_id` fields (synced metadata)
    - [x] Keep per-device transfer state in `file_transfers` (local-only)
    - [x] Treat `ref_count` as derived (do not LWW-sync it)
    - [x] Update hash format documentation to support `sha256:` and `md5:` prefixes
    - [x] Add Zod refinement for hash format validation
- [x] **1.2 Add file_transfers Dexie table** (Requirements: 3.3)
    - [x] Define `FileTransfer` interface
    - [x] Add table to `Or3DB` class with indexes
    - [x] Bump Dexie version to 8 (coordinate with sync schema changes)
- [x] **1.3 Add sync_state Dexie table** (Requirements: 2.1)
    - [x] Define `SyncState` interface
    - [x] Add table to `Or3DB` class
- [x] **1.4 Create Convex schema** (Requirements: 6.2)
    - [x] Create `convex/schema.ts` with all tables
    - [x] Define users, workspaces, workspaceMembers tables
    - [x] Define threads, messages (include `order_key`), file_meta, projects tables (snake_case fields)
    - [x] Add appropriate indexes for queries

### 2. Hashing Strategy
- [x] **2.1 Implement hash utilities** (Requirements: 4.1, 4.2)
    - [x] Create `parseHash()` function
    - [x] Create `formatHash()` function
    - [x] Update `computeFileHash()` to use SHA-256 with prefix
    - [x] Add unit tests for hash parsing/formatting

### 3. Storage Provider Infrastructure
- [x] **3.1 Define provider types** (Requirements: 5.1, 5.2)
    - [x] Create `ObjectStorageProvider` interface
    - [x] Create `PresignedUrlResult` type
    - [x] Export types from `app/core/storage/types.ts`
- [x] **3.2 Implement provider registry** (Requirements: 5.1, 5.2)
    - [x] Create `provider-registry.ts` using `createRegistry()`
    - [x] Add `registerStorageProvider()` and `getActiveProvider()` functions
    - [x] Add runtime config for provider selection
- [x] **3.3 Implement Convex provider** (Requirements: 6.1)
    - [x] Create `convex-storage-provider.ts`
    - [x] Implement `getPresignedUploadUrl()` method
    - [x] Implement `getPresignedDownloadUrl()` method
    - [x] Implement `commitUpload()` method
    - [x] Register provider on app init

### 4. File Transfer Engine
- [x] **4.1 Implement FileTransferQueue class** (Requirements: 3.1, 3.3, 10.1, 10.2)
    - [x] Implement queue with concurrency limit
    - [x] Add exponential backoff for retries
    - [x] Implement `enqueue()` method
    - [x] Implement `processTransfer()` with upload/download logic
    - [x] Add progress tracking (bytes_done/bytes_total)
- [x] **4.2 Integrate transfer queue with file creation** (Requirements: 3.1)
    - [x] Modify `createOrRefFile()` to enqueue upload when authenticated
    - [x] Add check for SSR auth enabled
    - [x] Update `file_meta.storage_id` + `storage_provider_id` on completion
- [x] **4.3 Implement download-on-demand** (Requirements: 3.2)
    - [x] Create `ensureFileBlob(hash)` function
    - [x] Check local blob first, then fetch from remote
    - [x] Cache downloaded blob in `file_blobs`

### 5. SSR API Endpoints
- [x] **5.1 Create presign-upload endpoint** (Requirements: 8.1, 8.2)
    - [x] Create `server/api/storage/presign-upload.post.ts`
    - [x] Add session and workspace membership checks
    - [x] Call Convex mutation to generate upload URL
- [x] **5.2 Create presign-download endpoint** (Requirements: 8.1, 8.2)
    - [x] Create `server/api/storage/presign-download.post.ts`
    - [x] Add session and workspace membership checks
    - [x] Call Convex query to get file URL
- [x] **5.3 Create commit endpoint** (Requirements: 6.1)
    - [x] Create `server/api/storage/commit.post.ts`
    - [x] Link storage ID to file metadata
- [x] **5.4 Create GC endpoint** (Requirements: 7.3)
    - [x] Create `server/api/storage/gc/run.post.ts`
    - [x] Admin-only authorization check
    - [x] Batch delete eligible files

### 6. Provider Functions (Convex example)
- [x] **6.1 Implement storage mutations** (Requirements: 6.1)
    - [x] Create `convex/storage.ts`
    - [x] Implement `generateUploadUrl` mutation
    - [x] Implement `commitUpload` mutation
    - [x] Implement `getFileUrl` query
- [ ] **6.2 Implement sync functions** (Requirements: 2.1, 2.3)
    - [ ] Create `convex/sync.ts`
    - [ ] Implement `syncThread` mutation
    - [ ] Implement `syncMessage` mutation
    - [ ] Implement conflict resolution logic

### 7. Hook Integration
- [x] **7.1 Add storage hooks to hook-types.ts** (Requirements: 9.1, 9.2)
    - [x] Add `storage.files.upload:action:before/after`
    - [x] Add `storage.files.download:action:before/after`
    - [x] Add `storage.files.url:filter:options`
    - [x] Add `storage.files.upload:filter:policy`
    - [x] Add `storage.files.gc:action:run`
- [x] **7.2 Add sync hooks to hook-types.ts** (Requirements: 2.3)
    - [x] Add `sync.push:action:before/after`
    - [x] Add `sync.pull:action:after`
    - [x] Add `sync.conflict:action:detected`
- [x] **7.3 Integrate hooks into transfer/sync engines**
    - [x] Call hooks at appropriate points in upload flow
    - [x] Call hooks at appropriate points in download flow
    - [x] Call hooks on sync operations

### 8. Sync Engine
- [ ] **8.1 Implement sync outbox** (Requirements: 2.1)
    - [ ] Create sync outbox table in Dexie
    - [ ] Queue local writes for sync
    - [ ] Process outbox in background
- [ ] **8.2 Implement reactive subscriptions** (Requirements: 2.1)
    - [ ] Set up Convex Vue integration
    - [ ] Subscribe to remote changes
    - [ ] Merge remote changes into local DB
- [ ] **8.3 Implement conflict resolution** (Requirements: 2.3)
    - [ ] Compare clock values
    - [ ] Apply last-write-wins strategy
    - [ ] Emit conflict detection hooks

### 9. Delete and GC
- [ ] **9.1 Extend soft delete for remote** (Requirements: 7.1, 7.2)
    - [ ] Sync deleted flag to Convex
    - [ ] Store `deletedAt` timestamp
- [x] **9.2 Implement GC logic** (Requirements: 7.2, 7.3)
    - [x] Query eligible files (ref_count=0, deleted=true, age > retention)
    - [x] Delete from Convex storage
    - [x] Delete from Convex fileMeta table

### 10. Testing
- [x] **10.1 Unit tests** (Requirements: all)
    - [x] Hash parsing/formatting tests
    - [x] Transfer queue logic tests
    - [x] Provider registry tests
- [ ] **10.2 Integration tests**
    - [ ] Upload flow test
    - [ ] Download flow test
    - [ ] Sync flow test
- [ ] **10.3 Manual E2E verification**
    - [ ] Multi-device sync verification
    - [ ] Offline resilience verification
    - [ ] File attachment flow verification

### 11. Documentation and Migration
- [x] **11.1 Update error codes** (Requirements: all)
    - [x] Add storage-specific error codes
    - [ ] Update error documentation
- [ ] **11.2 Create migration guide**
    - [ ] Document Dexie version upgrade
    - [ ] Document Convex setup steps
    - [ ] Document configuration options
