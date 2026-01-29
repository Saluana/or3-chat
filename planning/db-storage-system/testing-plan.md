Current Test Coverage Summary
Well-covered areas:
- ✅ Hash Utilities: parseHash(), formatHash(), isValidHash() - SHA-256, MD5, legacy support
- ✅ Provider Registry: Registration, memoization, reset, active provider selection
- ✅ Transfer Queue (Basic): Max attempts failure, state transitions
- ✅ Storage Integration Tests: Hash format, deduplication, transfer queue logic, presigned URLs, authorization, soft delete/GC, hooks, quotas, edge cases
Critical Test Coverage Gaps
1. Transfer Queue - Core Functionality (app/core/storage/transfer-queue.ts)
- Missing: Only 1 test (max attempts failure)
- Critical needs:
  - Upload flow: presign → fetch → commit → metadata persistence
  - Download flow: presign → fetch → hash verification → blob storage
  - Concurrency limiting (adaptive based on connection type)
  - Exponential backoff calculation
  - Workspace switching (cancel in-flight transfers)
  - Transfer cancellation (AbortController)
  - Progress tracking (readBlobWithProgress)
  - Waiter pattern (waitForTransfer, ensureDownloadedBlob)
  - Cleanup of old transfers
  - Policy filter rejection
  - Hook emissions (upload:before/after, download:before/after)
  - Hash verification on download
  - 413 "file too large" handling (non-retryable)
2. Convex Storage Provider (app/core/storage/providers/convex-storage-provider.ts)
- Missing: No dedicated test file
- Needs: SSR endpoint integration, Zod schema validation, error handling
3. Hash Computation (app/utils/hash.ts)
- Partially covered: Only parsing/formatting tested
- Missing:
  - computeHashHex() - actual SHA-256/MD5 computation
  - computeFileHash() - full file hashing with prefix
  - Error handling for WebCrypto unavailability
  - Performance measurement integration
4. File Attachment Utilities (app/utils/files/attachments.ts)
- Missing: No test file
- Needs: parseHashes() with various input formats, hash merging/deduplication
5. SSR API Endpoints (server/api/storage/)
- Missing: No test files
- Needs: 
  - presign-upload.post.ts - auth, workspace validation, Convex integration
  - presign-download.post.ts - auth, workspace validation
  - commit.post.ts - metadata linking
  - gc/run.post.ts - admin authorization, batch deletion
6. Integration Test Gaps
- Missing: 
  - Full upload → download roundtrip
  - Concurrent upload deduplication (in-flight coalescing)
  - Network failure recovery
  - Expired presigned URL retry
  - Workspace isolation (cross-workspace access denied)
---
Action Plan
Would you like me to proceed with implementing the missing tests? I recommend this priority order:
Phase 1 (Critical Core)
1. Transfer queue comprehensive tests - core upload/download flows
2. Hash computation tests - actual SHA-256/MD5 computation
3. Convex storage provider tests
Phase 2 (Supporting Components)
4. File attachment utilities tests
5. SSR API endpoint tests (may need different test setup)
Phase 3 (Integration)
6. Full upload → download roundtrip tests
7. Concurrent upload deduplication tests
8. Network failure recovery tests