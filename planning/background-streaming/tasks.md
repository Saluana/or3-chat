# Background Streaming - Tasks

artifact_id: bg-stream-001
date: 2026-01-22
updated: 2026-01-22

## Purpose

Implementation checklist for background AI streaming with pluggable provider support.

---

## Phase 1: Provider Interface & Types

### 1. Define Provider Interface
Requirements: 2.1, 3.4

- [x] 1.1 Create `server/utils/background-jobs/types.ts`
    - [x] Define `BackgroundJob` interface
    - [x] Define `CreateJobParams` interface
    - [x] Define `JobUpdate` interface
    - [x] Define `BackgroundJobProvider` interface
    
- [x] 1.2 Create `server/utils/background-jobs/store.ts`
    - [x] Implement `getJobProvider()` factory
    - [x] Implement `isBackgroundStreamingEnabled()`
    - [x] Implement `resetJobProvider()` for testing
    - [x] Read config from `runtimeConfig.backgroundJobs`

---

## Phase 2: Memory Provider (Default)

### 2. Implement Memory Provider
Requirements: 2.1, 3.1, 3.2

- [x] 2.1 Create `server/utils/background-jobs/providers/memory.ts`
    - [x] Implement `createJob()` with UUID generation
    - [x] Implement `getJob()` with user authorization
    - [x] Implement `updateJob()` for chunk accumulation
    - [x] Implement `completeJob()`
    - [x] Implement `failJob()`
    - [x] Implement `abortJob()` with AbortController
    - [x] Implement `getAbortController()`
    - [x] Implement `cleanupExpired()` with timeout handling
    
- [x] 2.2 Add lifecycle management
    - [x] Enforce max concurrent jobs limit
    - [x] Start cleanup interval on first job
    - [x] Handle job timeout (mark as error)
    - [x] Clean up stale completed jobs

---

## Phase 3: Convex Provider

### 3. Implement Convex Provider
Requirements: 2.1, 3.1

- [x] 3.1 Add Convex schema
    - [x] Add `backgroundJobs` table to `convex/schema.ts`
    - [x] Add indexes: `by_user`, `by_status`, `by_message`
    
- [x] 3.2 Create Convex functions
    - [x] `convex/backgroundJobs.ts` - mutations & queries
    - [x] `create` mutation
    - [x] `get` query with user filter
    - [x] `update` mutation
    - [x] `complete` mutation
    - [x] `fail` mutation
    - [x] `abort` mutation
    - [x] `cleanup` mutation (scheduled or on-demand)
    
- [x] 3.3 Create `server/utils/background-jobs/providers/convex.ts`
    - [x] Implement all provider interface methods
    - [x] Use ConvexHttpClient for server-side calls
    - [x] Handle poll-based abort (no AbortController)

---

## Phase 4: Stream Endpoint Enhancement

### 4. Enhance `/api/openrouter/stream`
Requirements: 2.1, 2.2

- [x] 4.1 Add background mode detection
    - [x] Check for `_background: true` in request body
    - [x] Validate `_threadId` and `_messageId`
    - [x] Check `isBackgroundStreamingEnabled()`
    
- [x] 4.2 Implement background mode handler
    - [x] Get provider via `getJobProvider()`
    - [x] Create job and return `{ jobId, status }` immediately
    - [x] Handle max jobs exceeded (503)
    
- [x] 4.3 Implement `streamInBackground()` function
    - [x] Get AbortController from provider (if supported)
    - [x] Stream from OpenRouter
    - [x] Update provider with chunks periodically
    - [x] Check for abort status (poll-based for Convex)
    - [x] Call `completeJob()` on success
    - [x] Call `failJob()` on error
    
- [x] 4.4 Preserve existing foreground behavior
    - [x] No breaking changes for non-background requests

---

## Phase 5: Job Management API

### 5. Create Job Endpoints
Requirements: 2.1, 3.3

- [x] 5.1 Create `server/api/jobs/[id]/status.get.ts`
    - [x] Resolve user from session
    - [x] Get job from provider
    - [x] Return status, progress, timestamps
    - [x] Handle 404 for missing/unauthorized
    
- [x] 5.2 Create `server/api/jobs/[id]/abort.post.ts`
    - [x] Resolve user from session
    - [x] Call provider's `abortJob()`
    - [x] Return `{ aborted: boolean }`

---

## Phase 6: Client Integration

### 6. Client-Side Changes
Requirements: 2.1, 2.2, 2.3

- [x] 6.1 Add to `app/utils/chat/openrouterStream.ts`
    - [x] Export `startBackgroundStream()` 
    - [x] Export `pollJobStatus()`
    - [x] Export `abortBackgroundJob()`
    - [x] Export `isBackgroundStreamingEnabled()` (client-side)
    
- [ ] 6.2 Modify `app/composables/chat/useAi.ts`
    - [x] Modify `clear()` to detach instead of abort (SSR mode)
    - [x] Add reattach logic on thread load
    - [x] Store detached stream references
    - [x] Handle completed background jobs

---

## Phase 7: Notification Integration

### 7. Connect to Notification Center
Requirements: 2.4

- [ ] 7.1 Server-side notification emission
    - [x] Create `emitBackgroundComplete()` helper
    - [x] Store notification via Convex/Dexie
    - [x] Include threadId for navigation
    
- [ ] 7.2 Mute preference handling
    - [x] Check thread mute status before creating notification
    - [x] Skip notification if user is viewing thread

---

## Phase 8: Configuration

### 8. Add Runtime Config
Requirements: 3.4

- [x] 8.1 Update `nuxt.config.ts`
    - [x] Add `runtimeConfig.backgroundJobs` section
    - [x] Document environment variables in README
    
- [ ] 8.2 Ensure static build compatibility
    - [x] Feature detection prevents background code paths
    - [ ] Test static build has no regressions

---

## Phase 9: Testing

### 9. Unit Tests
Requirements: All

- [ ] 9.1 Memory provider tests
    - [ ] All CRUD operations
    - [ ] Max jobs limit
    - [ ] Timeout/cleanup
    - [ ] Authorization checks
    
- [ ] 9.2 Convex provider tests
    - [ ] All CRUD operations
    - [ ] Poll-based abort
    
- [ ] 9.3 Provider factory tests
    - [ ] Correct provider selection
    - [ ] Fallback behavior

### 10. Integration Tests

- [ ] 10.1 Full background stream flow
    - [ ] Start → complete → notification
    - [ ] Start → abort → verify aborted
    - [ ] Start → timeout → error notification
    
- [ ] 10.2 Provider switching
    - [ ] Memory → Convex via config change

### 11. Manual Tests

- [ ] 11.1 SSR mode with Memory provider
    - [ ] Send message → close tab → reopen → message present
    
- [ ] 11.2 SSR mode with Convex provider
    - [ ] Same as above, verify persistence
    
- [ ] 11.3 Static build
    - [ ] Verify no regressions

---

## Dependencies

```mermaid
graph TD
    P1[Phase 1: Types] --> P2[Phase 2: Memory]
    P1 --> P3[Phase 3: Convex]
    P2 --> P4[Phase 4: Stream Endpoint]
    P3 --> P4
    P4 --> P5[Phase 5: Job API]
    P4 --> P6[Phase 6: Client]
    P5 --> P6
    P6 --> P7[Phase 7: Notifications]
    P4 --> P8[Phase 8: Config]
    P7 --> P9[Phase 9: Testing]
    P8 --> P9
```

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Types & Interface | 0.5 hours ✅ |
| Phase 2: Memory Provider | 1.5 hours ✅ |
| Phase 3: Convex Provider | 2 hours ✅ |
| Phase 4: Stream Endpoint | 1.5 hours ✅ |
| Phase 5: Job API | 1 hour ✅ |
| Phase 6: Client Integration | 2 hours (partial) |
| Phase 7: Notifications | 1 hour |
| Phase 8: Configuration | 0.5 hours (partial) |
| Phase 9: Testing | 2 hours |
| **Total** | **~12 hours** |

---

## Parallel Development Strategy

Since Memory and Convex providers share the same interface, they can be developed in parallel:

```
Developer A                    Developer B
-----------                    -----------
Phase 1 (Types)                Phase 1 (Types)
     |                              |
Phase 2 (Memory)               Phase 3 (Convex)
     |                              |
     +---------> Phase 4 <----------+
                (Stream Endpoint)
                     |
              Phase 5-9 (Sequential)
```

**Testing strategy:** Run all tests against both providers to ensure interface compliance.
