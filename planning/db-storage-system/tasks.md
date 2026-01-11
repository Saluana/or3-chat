# tasks.md

artifact_id: c9f3g0e4-6g1b-5h5c-d0g7-4e3f5g7h8i9j
date: 2026-01-11

## Implementation Checklist

### 1. Schema and Data Model Extensions
- [ ] **1.1 Extend FileMetaSchema** (Requirements: 4.1, 4.2)
    - [ ] Add `storage_provider_id` and `storage_id` fields (synced metadata)
    - [ ] Keep per-device transfer state in `file_transfers` (local-only)
    - [ ] Treat `ref_count` as derived (do not LWW-sync it)
    - [ ] Update hash format documentation to support `sha256:` and `md5:` prefixes
    - [ ] Add Zod refinement for hash format validation
- [ ] **1.2 Add file_transfers Dexie table** (Requirements: 3.3)
    - [ ] Define `FileTransfer` interface
    - [ ] Add table to `Or3DB` class with indexes
    - [ ] Bump Dexie version to 7 (coordinate with sync schema changes)
- [ ] **1.3 Add sync_state Dexie table** (Requirements: 2.1)
    - [ ] Define `SyncState` interface
    - [ ] Add table to `Or3DB` class
- [ ] **1.4 Create Convex schema** (Requirements: 6.2)
    - [ ] Create `convex/schema.ts` with all tables
    - [ ] Define users, workspaces, workspaceMembers tables
    - [ ] Define threads, messages (include `order_key`), file_meta, projects tables (snake_case fields)
    - [ ] Add appropriate indexes for queries

### 2. Hashing Strategy
- [ ] **2.1 Implement hash utilities** (Requirements: 4.1, 4.2)
    - [ ] Create `parseHash()` function
    - [ ] Create `formatHash()` function
    - [ ] Update `computeFileHash()` to use SHA-256 with prefix
    - [ ] Add unit tests for hash parsing/formatting

### 3. Storage Provider Infrastructure
- [ ] **3.1 Define provider types** (Requirements: 5.1, 5.2)
    - [ ] Create `ObjectStorageProvider` interface
    - [ ] Create `PresignedUrlResult` type
    - [ ] Export types from `app/core/storage/types.ts`
- [ ] **3.2 Implement provider registry** (Requirements: 5.1, 5.2)
    - [ ] Create `provider-registry.ts` using `createRegistry()`
    - [ ] Add `registerStorageProvider()` and `getActiveProvider()` functions
    - [ ] Add runtime config for provider selection
- [ ] **3.3 Implement Convex provider** (Requirements: 6.1)
    - [ ] Create `convex-storage-provider.ts`
    - [ ] Implement `getPresignedUploadUrl()` method
    - [ ] Implement `getPresignedDownloadUrl()` method
    - [ ] Implement `commitUpload()` method
    - [ ] Register provider on app init

### 4. File Transfer Engine
- [ ] **4.1 Implement FileTransferQueue class** (Requirements: 3.1, 3.3, 10.1, 10.2)
    - [ ] Implement queue with concurrency limit
    - [ ] Add exponential backoff for retries
    - [ ] Implement `enqueue()` method
    - [ ] Implement `processTransfer()` with upload/download logic
    - [ ] Add progress tracking (bytes_done/bytes_total)
- [ ] **4.2 Integrate transfer queue with file creation** (Requirements: 3.1)
    - [ ] Modify `createOrRefFile()` to enqueue upload when authenticated
    - [ ] Add check for SSR auth enabled
    - [ ] Update `file_meta.storage_id` + `storage_provider_id` on completion
- [ ] **4.3 Implement download-on-demand** (Requirements: 3.2)
    - [ ] Create `ensureFileBlob(hash)` function
    - [ ] Check local blob first, then fetch from remote
    - [ ] Cache downloaded blob in `file_blobs`

### 5. SSR API Endpoints
- [ ] **5.1 Create presign-upload endpoint** (Requirements: 8.1, 8.2)
    - [ ] Create `server/api/storage/presign-upload.post.ts`
    - [ ] Add session and workspace membership checks
    - [ ] Call Convex mutation to generate upload URL
- [ ] **5.2 Create presign-download endpoint** (Requirements: 8.1, 8.2)
    - [ ] Create `server/api/storage/presign-download.post.ts`
    - [ ] Add session and workspace membership checks
    - [ ] Call Convex query to get file URL
- [ ] **5.3 Create commit endpoint** (Requirements: 6.1)
    - [ ] Create `server/api/storage/commit.post.ts`
    - [ ] Link storage ID to file metadata
- [ ] **5.4 Create GC endpoint** (Requirements: 7.3)
    - [ ] Create `server/api/storage/gc/run.post.ts`
    - [ ] Admin-only authorization check
    - [ ] Batch delete eligible files

### 6. Provider Functions (Convex example)
- [ ] **6.1 Implement storage mutations** (Requirements: 6.1)
    - [ ] Create `convex/storage.ts`
    - [ ] Implement `generateUploadUrl` mutation
    - [ ] Implement `commitUpload` mutation
    - [ ] Implement `getFileUrl` query
- [ ] **6.2 Implement sync functions** (Requirements: 2.1, 2.3)
    - [ ] Create `convex/sync.ts`
    - [ ] Implement `syncThread` mutation
    - [ ] Implement `syncMessage` mutation
    - [ ] Implement conflict resolution logic

### 7. Hook Integration
- [ ] **7.1 Add storage hooks to hook-types.ts** (Requirements: 9.1, 9.2)
    - [ ] Add `storage.files.upload:action:before/after`
    - [ ] Add `storage.files.download:action:before/after`
    - [ ] Add `storage.files.url:filter:options`
    - [ ] Add `storage.files.upload:filter:policy`
    - [ ] Add `storage.files.gc:action:run`
- [ ] **7.2 Add sync hooks to hook-types.ts** (Requirements: 2.3)
    - [ ] Add `sync.push:action:before/after`
    - [ ] Add `sync.pull:action:after`
    - [ ] Add `sync.conflict:action:detected`
- [ ] **7.3 Integrate hooks into transfer/sync engines**
    - [ ] Call hooks at appropriate points in upload flow
    - [ ] Call hooks at appropriate points in download flow
    - [ ] Call hooks on sync operations

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
- [ ] **9.2 Implement GC logic** (Requirements: 7.2, 7.3)
    - [ ] Query eligible files (ref_count=0, deleted=true, age > retention)
    - [ ] Delete from Convex storage
    - [ ] Delete from Convex fileMeta table

### 10. Testing
- [ ] **10.1 Unit tests** (Requirements: all)
    - [ ] Hash parsing/formatting tests
    - [ ] Transfer queue logic tests
    - [ ] Provider registry tests
- [ ] **10.2 Integration tests**
    - [ ] Upload flow test
    - [ ] Download flow test
    - [ ] Sync flow test
- [ ] **10.3 Manual E2E verification**
    - [ ] Multi-device sync verification
    - [ ] Offline resilience verification
    - [ ] File attachment flow verification

### 11. Documentation and Migration
- [ ] **11.1 Update error codes** (Requirements: all)
    - [ ] Add storage-specific error codes
    - [ ] Update error documentation
- [ ] **11.2 Create migration guide**
    - [ ] Document Dexie version upgrade
    - [ ] Document Convex setup steps
    - [ ] Document configuration options
