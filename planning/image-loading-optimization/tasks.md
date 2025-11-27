# Image Loading Optimization - Implementation Tasks

## Overview

This task list implements image loading optimizations. **Recommended approach**: Start with Service Worker cache (Phase 0) for instant repeat access, then optionally add thumbnails for faster first loads.

---

## Phase 0: Service Worker Image Cache (Recommended First)

> This phase provides near-instant loading for any previously viewed image without schema changes or migrations. See [sw-cache-design.md](./sw-cache-design.md) for full design.

### 0. Service Worker Image Cache Implementation
- [ ] 0.1 Create `public/sw.js` with image route interception (`/_img/{hash}`)
- [ ] 0.2 Implement Cache API storage for image responses
- [ ] 0.3 Create BroadcastChannel bridge for SW ↔ main thread communication
- [ ] 0.4 Create `plugins/sw-register.client.ts` to register SW
- [ ] 0.5 Create `composables/core/useImageCacheBridge.ts` for Dexie lookups
- [ ] 0.6 Update image display components to use `/_img/{hash}` URLs
- [ ] 0.7 Add cache management utilities (clear, evict, prewarm)
- [ ] 0.8 Add fallback for browsers without SW support
- [ ] 0.9 Add unit tests for SW cache operations

**Estimated Effort**: 4-6 hours  
**Benefits**: 
- Instant repeat access (<5ms vs 50-500ms)
- No schema changes needed
- No migration needed  
- Works with existing images immediately

---

## Phase 1: Database Schema & Core Infrastructure (Thumbnails)

### 1. Add `file_thumbs` table to Dexie schema
- [ ] 1.1 Add `FileThumbRow` interface to `app/db/client.ts`
- [ ] 1.2 Add `file_thumbs` table declaration to `Or3DB` class
- [ ] 1.3 Bump database version to 6 with new store definition
- [ ] 1.4 Add `has_thumb` field to `FileMetaSchema` in `app/db/schema.ts`

**Requirements:** 1.1, 1.3

### 2. Create thumbnail storage module (`app/db/thumbs.ts`)
- [ ] 2.1 Implement `storeThumb(hash, blob)` function
- [ ] 2.2 Implement `getThumb(hash)` function
- [ ] 2.3 Implement `getThumbsBulk(hashes)` function using `bulkGet`
- [ ] 2.4 Implement `hasThumbsBulk(hashes)` for existence checking
- [ ] 2.5 Implement `deleteThumb(hash)` for cleanup
- [ ] 2.6 Add unit tests for all thumb operations

**Requirements:** 1.1, 3.1, 3.2

### 3. Create thumbnail generator utility (`app/utils/images/thumbnail.ts`)
- [ ] 3.1 Implement `generateThumbnail(blob, maxSize)` function
- [ ] 3.2 Add OffscreenCanvas support with HTMLCanvas fallback
- [ ] 3.3 Support WebP output with JPEG/PNG fallback
- [ ] 3.4 Handle edge cases (small images, SVG, corrupt blobs)
- [ ] 3.5 Add unit tests for thumbnail generation

**Requirements:** 1.1

---

## Phase 2: Upload Integration

### 4. Integrate thumbnail generation into file upload
- [ ] 4.1 Import thumbnail generator in `app/db/files.ts`
- [ ] 4.2 Modify `createOrRefFile` to generate thumbnail after storing blob
- [ ] 4.3 Store thumbnail via `storeThumb` when generation succeeds
- [ ] 4.4 Set `has_thumb: true` in metadata when thumbnail is stored
- [ ] 4.5 Handle thumbnail generation failures gracefully (log, continue)
- [ ] 4.6 Add integration tests for upload → thumbnail flow

**Requirements:** 1.1, 1.2

---

## Phase 3: Loading Optimization

### 5. Update `useThumbnails.ts` to prefer thumbnails
- [ ] 5.1 Import `getThumbsBulk` from `~/db/thumbs`
- [ ] 5.2 Modify `flushPrefetch` to load thumbnails first
- [ ] 5.3 Identify hashes needing full blob fallback
- [ ] 5.4 Load full blobs only for images without thumbnails
- [ ] 5.5 Add timing metrics for dev mode logging
- [ ] 5.6 Update unit tests for new loading logic

**Requirements:** 2.1, 2.2, 3.1, 3.2

### 6. Update `ensureThumb` for single-hash loading
- [ ] 6.1 Check `file_thumbs` before `file_blobs`
- [ ] 6.2 Fall back to full blob if no thumbnail exists
- [ ] 6.3 Consider on-demand thumbnail generation for legacy images

**Requirements:** 2.1, 2.2

---

## Phase 4: Migration

### 7. Create background thumbnail migration
- [ ] 7.1 Create `app/plugins/thumb-migration.client.ts`
- [ ] 7.2 Query images without thumbnails (`has_thumb: false`)
- [ ] 7.3 Implement batch processing with configurable concurrency
- [ ] 7.4 Use `requestIdleCallback` to avoid UI jank
- [ ] 7.5 Track migration progress in `kv` table
- [ ] 7.6 Resume from last position on app restart
- [ ] 7.7 Add dev logging for migration progress

**Requirements:** 4.1, 4.2, 4.3, 4.4

### 8. On-demand thumbnail generation for legacy images
- [ ] 8.1 When loading image without thumbnail, generate and store
- [ ] 8.2 Update `has_thumb` flag after generation
- [ ] 8.3 Ensure generation doesn't block UI (async, non-awaited)

**Requirements:** 2.1, 4.1, 4.2, 4.3, 4.4

---

## Phase 5: Full Image Loading

### 9. Implement full-resolution loading on demand
- [ ] 9.1 Add `loadFullImage(hash)` function to `useThumbnails`
- [ ] 9.2 Integrate with image viewer/gallery expand
- [ ] 9.3 Show loading indicator while full image loads
- [ ] 9.4 Cache full image URL separately from thumbnail

**Requirements:** 2.1, 2.2

---

## Phase 6: Memory Management

### 10. Integrate with existing preview cache
- [ ] 10.1 Use `useSharedPreviewCache` for thumbnail URLs
- [ ] 10.2 Implement separate cache tier for full images
- [ ] 10.3 Configure appropriate memory limits
- [ ] 10.4 Add visibility-based cache flushing

**Requirements:** 5.1

---

## Phase 7: Testing & Monitoring

### 11. Performance testing
- [ ] 11.1 Create benchmark for thread open with N images
- [ ] 11.2 Compare before/after metrics
- [ ] 11.3 Test with various image sizes (thumbnail, 2K, 4K)
- [ ] 11.4 Test migration performance

**Requirements:** All

### 12. Add performance metrics
- [ ] 12.1 Add Performance API marks for thumbnail loading
- [ ] 12.2 Track hit/miss ratio in dev mode
- [ ] 12.3 Log slow operations (>100ms) as warnings
- [ ] 12.4 Expose metrics via debug panel

**Requirements:** 6.1

---

## Dependencies Graph

```
Phase 0 (SW Cache) ─────────────────────────────────────────────────┐
    │                                                               │
    │   (Can be implemented independently, no dependencies)         │
    │                                                               │
    └───────────────────────────────────────────────────────────────┤
                                                                    │
1 (schema) ──────────────────────────────────────┐                  │
    │                                            │                  │
    ├──> 2 (thumbs.ts) ──> 5 (useThumbnails) ───┤                  │
    │                            │              │                  │
    └──> 3 (generator) ──> 4 (upload) ──────────┼──> 7 (migration) │
                                 │              │                  │
                                 └──> 6 (ensureThumb)              │
                                                │                  │
                                                ├──> 8 (on-demand) │
                                                │                  │
                                                ├──> 9 (full image)│
                                                │                  │
                                                └──> 10 (memory) ──┼──> 11, 12 (testing)
                                                                   │
                                                                   ▼
                                                    (Hybrid: SW cache + thumbnails)
```

---

## Estimated Effort

| Phase | Tasks | Estimate |
|-------|-------|----------|
| **0. SW Cache (Recommended First)** | 0 | **4-6 hours** |
| 1. Schema (Thumbnails) | 1-2 | 2 hours |
| 2. Upload | 4 | 3 hours |
| 3. Loading | 5-6 | 4 hours |
| 4. Migration | 7-8 | 4 hours |
| 5. Full Image | 9 | 2 hours |
| 6. Memory | 10 | 2 hours |
| 7. Testing | 11-12 | 3 hours |
| **SW Cache Only** | Phase 0 | **~5 hours** |
| **Full Thumbnail System** | Phases 1-7 | **~20 hours** |
| **Hybrid (Both)** | All | **~25 hours** |

---

## Success Criteria

### Phase 0 (SW Cache) - Immediate Impact
- [ ] Previously viewed images load in <10ms (down from 50-500ms)
- [ ] First-time image load unchanged (still uses Dexie)
- [ ] No JavaScript heap memory increase
- [ ] Workspace backup/restore unaffected
- [ ] Works in all major browsers (graceful fallback where unsupported)

### Phases 1-7 (Thumbnails) - Additional Optimization
- [ ] Thread with 4 thumbnails opens in <300ms (down from 3-5s)
- [ ] Thread with 10 thumbnails opens in <500ms
- [ ] No visible UI jank during thumbnail loading
- [ ] Existing images migrate within 1 week of normal usage
- [ ] Memory usage stays under configured limits
- [ ] All existing tests continue to pass

---

## Recommendation

**Start with Phase 0 (SW Cache)** for immediate, high-impact results:
- Fastest implementation (~5 hours)
- No database schema changes
- No migration needed
- Instant benefit for returning users

Then evaluate if Phase 1-7 (Thumbnails) is needed for first-load optimization.
