artifact_id: c1f5a8d3-7e9b-4c2a-9f6d-2a4e7b8c3d1f
content_type: text/markdown

# tasks.md

## Implementation Plan

This task list outlines the work required to implement the dual-path image handling architecture that separates UI rendering (blob: URLs) from AI model API preparation (Base64 data URLs). The implementation follows a phased approach to minimize risk and enable incremental validation.

---

## Phase 1: Foundation - Extract and Centralize Utilities

**Requirements**: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, NFR-9

### 1. Create Blob URL Management Utility

- [ ] 1.1 Create `app/utils/chat/blob-urls.ts` module
  - [ ] 1.1.1 Define `BlobUrlCacheEntry` interface with url, blob, refCount, hash, createdAt
  - [ ] 1.1.2 Define `BlobUrlCache` interface with entries Map and cleanupTimers Map
  - [ ] 1.1.3 Implement module-scoped cache instance
  - [ ] 1.1.4 Implement `getBlobUrlForHash(hash: string): Promise<string | null>`
    - Retrieves Blob from Dexie using existing `getFileBlob()`
    - Creates blob: URL with `URL.createObjectURL()`
    - Increments reference count
    - Returns cached URL if already exists
  - [ ] 1.1.5 Implement `releaseBlobUrl(hash: string): void`
    - Decrements reference count
    - Schedules cleanup timer (30s) when refCount reaches 0
    - Clears any existing cleanup timer if refCount > 0
  - [ ] 1.1.6 Implement `forceRevokeBlobUrl(hash: string): void`
    - Immediately calls `URL.revokeObjectURL()`
    - Removes entry from cache
    - Clears any pending cleanup timers
  - [ ] 1.1.7 Implement `getBlobUrlCacheStats()` for debugging
    - Returns totalUrls, activeRefs, pendingCleanups
  - [ ] 1.1.8 Add JSDoc comments documenting lifecycle and usage

**Requirements**: 3.1, 3.2, 3.3, 3.4

### 2. Create Base64 Conversion Utility

- [ ] 2.1 Create `app/utils/chat/base64.ts` module
  - [ ] 2.1.1 Implement `blobToDataUrl(blob: Blob): Promise<string>`
    - Uses FileReader.readAsDataURL()
    - Returns Promise resolving to data URL string
    - Handles errors with descriptive messages
  - [ ] 2.1.2 Implement `hashToBase64ContentPart(hash: string): Promise<ContentPart | null>`
    - Retrieves Blob and metadata from Dexie
    - Converts to Base64 using `blobToDataUrl()`
    - Returns ContentPart with type 'image' or 'file'
    - Handles PDFs differently from images
    - Returns null on errors
  - [ ] 2.1.3 Implement `hashesToBase64ContentParts(hashes: string[]): Promise<ContentPart[]>`
    - Batch processes multiple hashes
    - Uses Promise.all for parallel conversion
    - Filters out null results
    - Emits timing metrics via hook bus
  - [ ] 2.1.4 Add error handling with hook events
    - Emit `image:base64:error` on conversion failures
    - Include hash and error details in payload
  - [ ] 2.1.5 Add JSDoc comments clarifying this is for API use only

**Requirements**: 6.1, 6.2, 6.3, 6.4

### 3. Add Performance Monitoring Hooks

- [ ] 3.1 Define hook event types in `types/chat-internal.d.ts`
  - [ ] 3.1.1 Add `image:blob-url:created` event type
  - [ ] 3.1.2 Add `image:blob-url:revoked` event type
  - [ ] 3.1.3 Add `image:base64:converted` event type
  - [ ] 3.1.4 Add `image:load:error` event type
- [ ] 3.2 Emit timing events in blob-urls.ts
  - [ ] 3.2.1 Emit `image:blob-url:created` when URL created
  - [ ] 3.2.2 Emit `image:blob-url:revoked` when URL revoked
- [ ] 3.3 Emit timing events in base64.ts
  - [ ] 3.3.1 Emit `image:base64:converted` with duration
  - [ ] 3.3.2 Emit `image:load:error` on failures

### 4. Write Unit Tests for Utilities

- [ ] 4.1 Create `app/utils/chat/__tests__/blob-urls.test.ts`
  - [ ] 4.1.1 Test cache hit behavior (same hash requested twice)
  - [ ] 4.1.2 Test cache miss behavior (new hash)
  - [ ] 4.1.3 Test reference counting increment/decrement
  - [ ] 4.1.4 Test grace period cleanup (mock timers)
  - [ ] 4.1.5 Test forced revocation
  - [ ] 4.1.6 Test concurrent requests for same hash
  - [ ] 4.1.7 Test error handling for missing blobs
- [ ] 4.2 Create `app/utils/chat/__tests__/base64.test.ts`
  - [ ] 4.2.1 Test blobToDataUrl conversion correctness
  - [ ] 4.2.2 Test hashToBase64ContentPart with image
  - [ ] 4.2.3 Test hashToBase64ContentPart with PDF
  - [ ] 4.2.4 Test hashesToBase64ContentParts batch processing
  - [ ] 4.2.5 Test error handling for missing blobs
  - [ ] 4.2.6 Test hook event emissions

---

## Phase 2: Refactor useAi.ts Message Preparation

**Requirements**: 1.1, 1.2, 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3

### 5. Modify normalizeFileUrl Function

- [ ] 5.1 Update `normalizeFileUrl` in `app/composables/chat/useAi.ts` (lines 441-487)
  - [ ] 5.1.1 Remove FileReader.readAsDataURL() call for Dexie blobs
  - [ ] 5.1.2 Keep hash reference as-is for local files
  - [ ] 5.1.3 Preserve existing behavior for data: and blob: URLs
  - [ ] 5.1.4 Verify blob exists in Dexie but don't convert
  - [ ] 5.1.5 Update comments to clarify UI vs API paths

### 6. Modify hashToContentPart Function

- [ ] 6.1 Update `hashToContentPart` in `app/composables/chat/useAi.ts` (lines 493-538)
  - [ ] 6.1.1 Move Base64 conversion logic to separate function
  - [ ] 6.1.2 Keep metadata retrieval logic
  - [ ] 6.1.3 Defer actual conversion until API request assembly
  - [ ] 6.1.4 Update return type to indicate conversion is deferred

### 7. Add prepareFilesForModel Function

- [ ] 7.1 Create new `prepareFilesForModel` function in useAi.ts
  - [ ] 7.1.1 Accept array of file references (hashes, blob: URLs, data: URLs)
  - [ ] 7.1.2 Import `hashToBase64ContentPart` from base64.ts utility
  - [ ] 7.1.3 Handle blob: URLs by fetching and converting
  - [ ] 7.1.4 Handle hash references by calling utility function
  - [ ] 7.1.5 Pass through existing data: URLs without conversion
  - [ ] 7.1.6 Return array of ContentPart ready for API
  - [ ] 7.1.7 Add error handling for conversion failures
  - [ ] 7.1.8 Emit performance metrics for batch conversion

### 8. Update Message Sending Flow

- [ ] 8.1 Modify send function in useAi.ts (around line 400-560)
  - [ ] 8.1.1 Keep `hydratedFiles` as hash references for UI
  - [ ] 8.1.2 Call `prepareFilesForModel` just before API request
  - [ ] 8.1.3 Use converted ContentParts in buildOpenRouterMessages
  - [ ] 8.1.4 Store unconverted references in database
  - [ ] 8.1.5 Update `buildParts` call to preserve hash references

### 9. Update Context Hashes Processing

- [ ] 9.1 Modify assistant hash processing (around line 650)
  - [ ] 9.1.1 Convert context_hashes to Base64 only when included in API request
  - [ ] 9.1.2 Use `hashesToBase64ContentParts` utility function
  - [ ] 9.1.3 Skip conversion for hashes not in current request context
  - [ ] 9.1.4 Preserve hash references in message history

### 10. Add Unit Tests for useAi Changes

- [ ] 10.1 Update `app/composables/__tests__/useAi.test.ts` (if exists)
  - [ ] 10.1.1 Test normalizeFileUrl preserves hash references
  - [ ] 10.1.2 Test prepareFilesForModel converts to Base64
  - [ ] 10.1.3 Test send flow with hash references
  - [ ] 10.1.4 Test API request contains Base64 data
  - [ ] 10.1.5 Test database stores hash references, not Base64
  - [ ] 10.1.6 Test backward compatibility with existing data: URLs
  - [ ] 10.1.7 Test error handling for missing blobs
- [ ] 10.2 Create integration test for full send flow
  - [ ] 10.2.1 Mock Dexie blob storage
  - [ ] 10.2.2 Send message with image attachment
  - [ ] 10.2.3 Verify UI receives hash reference
  - [ ] 10.2.4 Verify API request contains Base64
  - [ ] 10.2.5 Verify message persists with hash reference

---

## Phase 3: Update UI Components to Use Blob URLs

**Requirements**: 5.1, 5.2, 5.3, 5.4, 5.5, 2.1, 2.2, 2.3, NFR-7

### 11. Refactor ChatMessage.vue Thumbnail Management

- [ ] 11.1 Update `app/components/chat/ChatMessage.vue` (lines 682-832)
  - [ ] 11.1.1 Import `getBlobUrlForHash` and `releaseBlobUrl` from blob-urls.ts
  - [ ] 11.1.2 Replace module-scoped `thumbCache` with shared cache
  - [ ] 11.1.3 Update `ensureThumb` to call `getBlobUrlForHash()`
  - [ ] 11.1.4 Update `retainThumb` to use shared reference counting
  - [ ] 11.1.5 Update `releaseThumb` to call `releaseBlobUrl()`
  - [ ] 11.1.6 Remove local cache cleanup timers (now handled by utility)
  - [ ] 11.1.7 Verify inline image hydration still uses blob: URLs
  - [ ] 11.1.8 Update comments to reference shared cache

### 12. Refactor MessageAttachmentsGallery.vue

- [ ] 12.1 Update `app/components/chat/MessageAttachmentsGallery.vue` (lines 116-198)
  - [ ] 12.1.1 Import `getBlobUrlForHash` and `releaseBlobUrl` from blob-urls.ts
  - [ ] 12.1.2 Replace global `__or3ThumbCache` with shared utility
  - [ ] 12.1.3 Update `ensure` function to call `getBlobUrlForHash()`
  - [ ] 12.1.4 Update `retainThumb` to use shared reference counting
  - [ ] 12.1.5 Update `releaseThumb` to call `releaseBlobUrl()`
  - [ ] 12.1.6 Remove local cache cleanup logic
  - [ ] 12.1.7 Verify expanded gallery still renders correctly

### 13. Verify Inline Image Hydration

- [ ] 13.1 Review `hydrateInlineImages` in ChatMessage.vue (lines 842-865)
  - [ ] 13.1.1 Confirm it uses thumbCache which now comes from shared utility
  - [ ] 13.1.2 Verify blob: URLs are used in img.src
  - [ ] 13.1.3 Test with assistant-generated inline images
  - [ ] 13.1.4 Ensure hydration happens after thumb is ready

### 14. Update ChatContainer.vue Integration

- [ ] 14.1 Review `app/components/chat/ChatContainer.vue`
  - [ ] 14.1.1 Verify file attachment flow passes hash references
  - [ ] 14.1.2 Ensure `onSend` doesn't trigger Base64 conversion
  - [ ] 14.1.3 Confirm retry/branch operations preserve hash references
  - [ ] 14.1.4 Test edit flow with image attachments

### 15. Test UI Component Changes

- [ ] 15.1 Create component tests for ChatMessage.vue
  - [ ] 15.1.1 Test attachment thumbnail rendering
  - [ ] 15.1.2 Test expanded gallery view
  - [ ] 15.1.3 Test inline image hydration
  - [ ] 15.1.4 Test ref counting during virtualization
  - [ ] 15.1.5 Test cleanup on unmount
- [ ] 15.2 Create component tests for MessageAttachmentsGallery.vue
  - [ ] 15.2.1 Test grid rendering with multiple images
  - [ ] 15.2.2 Test PDF placeholder display
  - [ ] 15.2.3 Test cache reuse across mounts
  - [ ] 15.2.4 Test error states
- [ ] 15.3 Manual testing with virtualized list
  - [ ] 15.3.1 Scroll through 50+ messages with images
  - [ ] 15.3.2 Verify blob: URLs are reused on remount
  - [ ] 15.3.3 Check DevTools for blob: URL count
  - [ ] 15.3.4 Verify no memory leaks after scrolling

---

## Phase 4: Backward Compatibility and Edge Cases

**Requirements**: 4.1, 4.2, 4.3, 4.4, NFR-12, NFR-13

### 16. Handle Mixed Content Types

- [ ] 16.1 Test messages with mixed URL types
  - [ ] 16.1.1 Message with hash references (new)
  - [ ] 16.1.2 Message with data: URLs (legacy)
  - [ ] 16.1.3 Message with blob: URLs (transient)
  - [ ] 16.1.4 Message with https: URLs (external)
  - [ ] 16.1.5 Verify all types render correctly
  - [ ] 16.1.6 Verify API requests handle all types

### 17. Test Data Migration Path

- [ ] 17.1 Load existing chat history
  - [ ] 17.1.1 Verify messages with old Base64 data: URLs still render
  - [ ] 17.1.2 Verify new messages use hash references
  - [ ] 17.1.3 Confirm no database migration required
  - [ ] 17.1.4 Test export/import with mixed content

### 18. Validate Hook Plugin Compatibility

- [ ] 18.1 Test with existing image processing hooks
  - [ ] 18.1.1 Verify `db.files.get:filter:output` hook still works
  - [ ] 18.1.2 Verify `image:*` hooks receive correct events
  - [ ] 18.1.3 Test custom image transformation plugins
  - [ ] 18.1.4 Ensure hook payloads are backward compatible

---

## Phase 5: Performance Validation and Optimization

**Requirements**: NFR-1, NFR-2, NFR-3, NFR-4, 6.1, 6.2, 6.3

### 19. Profile Image Loading Performance

- [ ] 19.1 Set up performance benchmarks
  - [ ] 19.1.1 Create test chat with 20 messages, 2MB images each
  - [ ] 19.1.2 Measure baseline performance with current Base64 approach
  - [ ] 19.1.3 Measure new performance with blob: URL approach
  - [ ] 19.1.4 Compare initial render time (Time to First Paint)
  - [ ] 19.1.5 Compare total load time for all images
  - [ ] 19.1.6 Verify ≥50% improvement in load time (NFR-1)

### 20. Profile Memory Usage

- [ ] 20.1 Take heap snapshots
  - [ ] 20.1.1 Baseline heap after loading image-heavy chat (Base64)
  - [ ] 20.1.2 New heap after loading same chat (blob: URLs)
  - [ ] 20.1.3 Calculate memory reduction
  - [ ] 20.1.4 Verify ≤30% lower memory usage (NFR-2)
  - [ ] 20.1.5 Profile blob: URL cleanup to verify no leaks (NFR-7)

### 21. Measure Scroll Performance

- [ ] 21.1 Test virtualized scrolling with Performance tab
  - [ ] 21.1.1 Record FPS during rapid scrolling
  - [ ] 21.1.2 Measure CPU utilization (should be <70%, NFR-4)
  - [ ] 21.1.3 Check for frame drops or jank
  - [ ] 21.1.4 Verify blob: URL cache hit rate
  - [ ] 21.1.5 Measure time to display image after scroll

### 22. Validate AI API Requests

- [ ] 22.1 Test API request correctness
  - [ ] 22.1.1 Capture API request payload in DevTools Network tab
  - [ ] 22.1.2 Verify images are Base64-encoded in payload
  - [ ] 22.1.3 Verify payload structure matches OpenRouter spec
  - [ ] 22.1.4 Test with multiple images in context
  - [ ] 22.1.5 Test with context_hashes carry-forward
  - [ ] 22.1.6 Verify model responses still include generated images

### 23. Optimize Cache Behavior

- [ ] 23.1 Tune cache parameters based on profiling
  - [ ] 23.1.1 Adjust grace period (default 30s) if needed
  - [ ] 23.1.2 Consider LRU eviction for large image sets
  - [ ] 23.1.3 Add cache size limits to prevent unbounded growth
  - [ ] 23.1.4 Implement preloading for messages near viewport

---

## Phase 6: Testing and Documentation

**Requirements**: All, NFR-5, NFR-6, NFR-8, NFR-11

### 24. Comprehensive Integration Testing

- [ ] 24.1 Create end-to-end test suite
  - [ ] 24.1.1 Test: Send message with image attachment
  - [ ] 24.1.2 Test: Receive assistant message with generated image
  - [ ] 24.1.3 Test: Scroll through message history
  - [ ] 24.1.4 Test: Retry message with images
  - [ ] 24.1.5 Test: Branch conversation at message with images
  - [ ] 24.1.6 Test: Edit message with images
  - [ ] 24.1.7 Test: Delete message with images
  - [ ] 24.1.8 Test: Export and import workspace with images

### 25. Cross-Browser Testing

- [ ] 25.1 Test on Chrome 90+ (NFR-11)
  - [ ] 25.1.1 Verify blob: URL creation/revocation
  - [ ] 25.1.2 Check Performance tab metrics
  - [ ] 25.1.3 Test virtualized scrolling
- [ ] 25.2 Test on Firefox 90+
  - [ ] 25.2.1 Same verification as Chrome
- [ ] 25.3 Test on Safari 15+
  - [ ] 25.3.1 Same verification, check for WebKit quirks
- [ ] 25.4 Test on Edge 90+
  - [ ] 25.4.1 Same verification as Chrome (Chromium-based)

### 26. Error Scenario Testing

- [ ] 26.1 Test error handling (NFR-5, NFR-6)
  - [ ] 26.1.1 Blob missing from IndexedDB
  - [ ] 26.1.2 Base64 conversion failure
  - [ ] 26.1.3 Blob URL revocation race condition
  - [ ] 26.1.4 Out of memory during blob: URL creation
  - [ ] 26.1.5 Network failure during blob fetch
  - [ ] 26.1.6 Verify text content still renders when images fail

### 27. Update Documentation

- [ ] 27.1 Add code comments (NFR-8)
  - [ ] 27.1.1 Document dual-path architecture in useAi.ts
  - [ ] 27.1.2 Document blob URL lifecycle in blob-urls.ts
  - [ ] 27.1.3 Document Base64 conversion timing in base64.ts
  - [ ] 27.1.4 Add JSDoc to all new functions
- [ ] 27.2 Update developer documentation
  - [ ] 27.2.1 Add architecture diagram to docs
  - [ ] 27.2.2 Explain when to use blob: URLs vs data: URLs
  - [ ] 27.2.3 Document performance characteristics
  - [ ] 27.2.4 Add troubleshooting guide for image issues
- [ ] 27.3 Update API documentation
  - [ ] 27.3.1 Document hook events for image loading
  - [ ] 27.3.2 Document cache stats API
  - [ ] 27.3.3 Add examples for plugin developers

### 28. Performance Monitoring Setup

- [ ] 28.1 Add performance logging
  - [ ] 28.1.1 Log blob: URL cache hit rate on page load
  - [ ] 28.1.2 Log average image load time
  - [ ] 28.1.3 Log Base64 conversion time during API requests
  - [ ] 28.1.4 Add opt-in telemetry for production metrics

---

## Phase 7: Deployment and Validation

### 29. Pre-Deployment Checklist

- [ ] 29.1 Review all changes
  - [ ] 29.1.1 Code review with focus on error handling
  - [ ] 29.1.2 Review test coverage (target: 80%+ for new code)
  - [ ] 29.1.3 Run full test suite and verify all pass
  - [ ] 29.1.4 Run type checker (bun run type-check)
  - [ ] 29.1.5 Run linter if available (bun run lint)
- [ ] 29.2 Build and smoke test
  - [ ] 29.2.1 Run production build (bun run build)
  - [ ] 29.2.2 Test production bundle with preview server
  - [ ] 29.2.3 Verify bundle size impact (should be minimal)
  - [ ] 29.2.4 Check for console errors/warnings

### 30. Staged Rollout Plan

- [ ] 30.1 Deploy to development environment
  - [ ] 30.1.1 Monitor error logs for blob URL issues
  - [ ] 30.1.2 Track performance metrics
  - [ ] 30.1.3 Gather user feedback
- [ ] 30.2 Deploy to staging/beta
  - [ ] 30.2.1 Extended soak test (24-48 hours)
  - [ ] 30.2.2 Monitor memory usage over time
  - [ ] 30.2.3 Validate with larger datasets
- [ ] 30.3 Deploy to production
  - [ ] 30.3.1 Gradual rollout (e.g., 10%, 50%, 100%)
  - [ ] 30.3.2 Monitor error rates and performance
  - [ ] 30.3.3 Have rollback plan ready

### 31. Post-Deployment Monitoring

- [ ] 31.1 Track key metrics for 7 days
  - [ ] 31.1.1 Image load time percentiles (p50, p95, p99)
  - [ ] 31.1.2 Memory usage trends
  - [ ] 31.1.3 Error rates for blob URL operations
  - [ ] 31.1.4 User-reported issues related to images
- [ ] 31.2 Validate success criteria
  - [ ] 31.2.1 Confirm ≥50% load time improvement (NFR-1)
  - [ ] 31.2.2 Confirm ≤30% memory reduction (NFR-2)
  - [ ] 31.2.3 Confirm no increase in image-related errors
  - [ ] 31.2.4 Confirm no AI API regressions

---

## Risk Mitigation

### High-Risk Items

1. **Base64 conversion regression in API requests**
   - Risk: AI models receive malformed image data
   - Mitigation: Comprehensive integration tests, staged rollout, monitor API error rates

2. **Blob URL memory leaks**
   - Risk: Memory grows unbounded over long sessions
   - Mitigation: Thorough ref counting tests, heap profiling, grace period tuning

3. **Race conditions during virtualization**
   - Risk: Blob URLs revoked while still in use
   - Mitigation: Reference counting, grace period, test with rapid scrolling

### Medium-Risk Items

1. **Backward compatibility with legacy data**
   - Risk: Old messages don't render correctly
   - Mitigation: Mixed content tests, gradual migration path

2. **Hook plugin compatibility**
   - Risk: Custom plugins break with new architecture
   - Mitigation: Hook contract validation, documentation updates

### Low-Risk Items

1. **Browser compatibility edge cases**
   - Risk: Safari/Firefox behave differently
   - Mitigation: Cross-browser testing, feature detection

2. **Performance variance on low-end devices**
   - Risk: Improvements not realized on slower hardware
   - Mitigation: Test on variety of devices, profile on low-end

---

## Dependencies

- Nuxt 3+ framework
- Dexie.js for IndexedDB access
- Vue 3 composition API
- Existing file storage infrastructure (`app/db/files.ts`)
- Existing message rendering components
- Hook bus system for event emission

---

## Success Metrics

The implementation will be considered complete and successful when:

1. ✅ All 31 task sections are complete
2. ✅ Test suite passes with ≥80% coverage for new code
3. ✅ Performance benchmarks show ≥50% improvement in image load time
4. ✅ Memory profiling shows ≤30% reduction in heap size
5. ✅ Cross-browser testing passes on Chrome, Firefox, Safari, Edge
6. ✅ Production deployment shows no increase in error rates
7. ✅ User feedback indicates improved perceived performance
8. ✅ AI API functionality remains fully operational
9. ✅ No memory leaks detected in 24-hour soak test
10. ✅ Documentation is complete and reviewed

---

## Timeline Estimate

- **Phase 1**: 2-3 days (Foundation utilities and tests)
- **Phase 2**: 3-4 days (Refactor useAi.ts)
- **Phase 3**: 2-3 days (Update UI components)
- **Phase 4**: 1-2 days (Backward compatibility)
- **Phase 5**: 2-3 days (Performance validation)
- **Phase 6**: 2-3 days (Testing and documentation)
- **Phase 7**: 1-2 days (Deployment and monitoring)

**Total estimate**: 13-20 days for complete implementation and validation

---

## Notes

- This plan assumes no modifications to Dexie database schema
- Performance numbers are estimates based on problem statement; actual results may vary
- Grace period of 30s is configurable and can be tuned based on real-world usage
- Preloading and progressive loading are marked as future enhancements
- Service worker caching could provide additional performance wins in future iterations
