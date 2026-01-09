# Blob/Base64 Optimization - Task List

## 1. Dual-Path File Rendering in useAi.ts

### 1.1 Refactor normalizeFileUrl
- [ ] Modify `normalizeFileUrl` (lines 555-605) to verify blob existence without converting to Base64
- [ ] Return hash reference with `_verified` flag for successful lookups
- [ ] Keep data URL passthrough for pasted images not yet stored
- **Requirements**: 1, 2

### 1.2 Create prepareFilesForModel function
- [ ] Extract new `prepareFilesForModel` function for just-in-time Base64 conversion
- [ ] Add `blobToDataUrl` helper function
- [ ] Handle both image and PDF file types
- **Requirements**: 2

### 1.3 Integrate with API request path
- [ ] Move `hashToContentPart` logic into `prepareFilesForModel`
- [ ] Call `prepareFilesForModel` just before `buildOpenRouterMessages`
- [ ] Ensure Base64 strings don't leak into reactive `rawMessages` or `messages` state
- **Requirements**: 1, 2

### 1.4 Update buildParts to work with hash references
- [ ] Modify `buildParts` call to pass hash references instead of hydrated Base64 files
- [ ] Ensure API message construction uses prepared content parts
- **Requirements**: 2

---

## 2. Hash Computation Optimization

### 2.1 Cache SparkMD5 module
- [ ] Add module-level cache variable for SparkMD5
- [ ] Modify `loadSpark()` to return cached module on subsequent calls
- **Requirements**: 3

### 2.2 Increase Web Crypto threshold
- [ ] Change threshold from 4MB to 8MB
- [ ] Add comment explaining the 95% coverage rationale
- **Requirements**: 3

### 2.3 Pre-allocated hex lookup table
- [ ] Create `HEX_LOOKUP` array at module level
- [ ] Replace string concatenation loop in `bufferToHex` with array lookup
- **Requirements**: 3

### 2.4 Adaptive yielding
- [ ] Create `yieldToMain()` helper with fallback chain
- [ ] Use `scheduler.yield()` when available
- [ ] Fall back to `requestIdleCallback` then `setTimeout`
- [ ] Replace `microTask()` call in chunking loop
- **Requirements**: 3

---

## 3. Database Operation Batching

### 3.1 Parallel writes in createOrRefFile
- [ ] Wrap `file_meta.put()` and `file_blobs.put()` in `Promise.all()`
- [ ] Verify transaction integrity after change
- **Requirements**: 4

### 3.2 Bulk operations in softDeleteMany
- [ ] Collect all updates before writing
- [ ] Use `bulkPut()` instead of individual `put()` calls in loop
- [ ] Maintain hook calls for each file (consider batching hooks too)
- **Requirements**: 4

### 3.3 Bulk operations in restoreMany
- [ ] Apply same `bulkPut()` pattern as softDeleteMany
- **Requirements**: 4

### 3.4 Bulk operations in hardDeleteMany
- [ ] Use `bulkDelete()` for both file_meta and file_blobs tables
- **Requirements**: 4

### 3.5 Image loading timeout
- [ ] Add 5-second timeout to `blobImageSize()`
- [ ] Revoke object URL on timeout
- [ ] Return undefined dimensions on timeout
- **Requirements**: 6

---

## 4. Preview Cache Enhancement

### 4.1 Auto-tuned cache limits
- [ ] Create `getDefaultCacheLimits()` helper
- [ ] Check `navigator.deviceMemory` with fallback to 4GB
- [ ] Set lower limits (80 URLs, 48MB) for ≤4GB devices
- [ ] Set higher limits (120 URLs, 80MB) for >4GB devices
- **Requirements**: 5

### 4.2 Optimized eviction algorithm
- [ ] Filter unpinned entries before sorting
- [ ] Sort only unpinned subset by lastAccess
- [ ] Evict from unpinned pool only
- **Requirements**: 5

---

## 5. Testing

### 5.1 Run existing tests
- [ ] Run `bun run test -- --run app/composables/__tests__/` to verify no regressions
- [ ] Run `bun run test -- --run app/db/__tests__/` for database layer tests
- **Requirements**: All

### 5.2 Add dual-path unit tests
- [ ] Test `normalizeFileUrl` returns hash refs without Base64
- [ ] Test `prepareFilesForModel` produces correct Base64 content parts
- [ ] Test hash references in UI state don't contain Base64
- **Requirements**: 1, 2

### 5.3 Add hash optimization tests
- [ ] Test files ≤8MB use Web Crypto path
- [ ] Test hex lookup produces correct output
- [ ] Test yielding doesn't break hash computation
- **Requirements**: 3

### 5.4 Manual verification (pending user input)
- [ ] Compare heap snapshots before/after optimization
- [ ] Verify images still render correctly
- [ ] Test with 6+ image attachments in single chat
- **Requirements**: All
