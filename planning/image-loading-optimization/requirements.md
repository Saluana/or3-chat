# Image Loading Optimization - Requirements

## Overview

When opening a thread with multiple images (especially 2K/4K resolution), the UI experiences significant delays (3-5 seconds) due to slow IndexedDB blob retrieval. This document defines requirements for optimizing image loading performance in the chat interface.

---

## 1. Thumbnail Generation and Storage

### User Story
As a user, I want thread images to load instantly when I open a conversation, so that I can quickly scan through my chat history without waiting.

### Acceptance Criteria
- WHEN a user uploads an image THEN the system SHALL generate a thumbnail (max 400px) alongside the full image
- WHEN a thumbnail is generated THEN it SHALL be stored in a separate `file_thumbs` table with the same hash key
- WHEN thumbnail generation fails THEN the system SHALL fall back to loading the full image
- IF the image is smaller than 400px THEN the system SHALL skip thumbnail generation and use the original

---

## 2. Progressive Image Loading

### User Story
As a user, I want to see image placeholders immediately that progressively load, so that I know images are coming without staring at a blank screen.

### Acceptance Criteria
- WHEN a thread opens THEN image placeholders SHALL appear within 100ms
- WHEN thumbnails are available THEN they SHALL load first (target: <200ms for 4 images)
- WHEN a user clicks/hovers on a thumbnail THEN the full resolution SHALL load on demand
- IF thumbnails are not yet generated THEN the system SHALL show a loading skeleton with image dimensions (if known)

---

## 3. Bulk Thumbnail Retrieval

### User Story
As a developer, I want efficient bulk operations for thumbnail retrieval, so that loading a thread with N images requires minimal database transactions.

### Acceptance Criteria
- WHEN loading thread images THEN the system SHALL use bulk operations (`bulkGet`) for both thumbs and metadata
- WHEN prefetching thumbnails THEN all hashes SHALL be batched into a single debounced request (16ms window)
- WHEN a thumbnail is already cached THEN no database read SHALL occur
- IF a hash is already being loaded THEN additional requests SHALL await the in-flight promise (no duplicate reads)

---

## 4. Migration for Existing Images

### User Story
As an existing user, I want my previously uploaded images to benefit from thumbnail optimization, so that old conversations also load quickly.

### Acceptance Criteria
- WHEN the app starts THEN it SHALL check for images missing thumbnails
- WHEN missing thumbnails are detected THEN background generation SHALL queue them (low priority, non-blocking)
- WHEN generating thumbnails in background THEN the system SHALL process max 2 images concurrently to avoid UI jank
- IF the user opens a thread with un-thumbnailed images THEN on-demand generation SHALL occur and cache the result

---

## 5. Memory Management

### User Story
As a user with many images, I want the app to manage memory efficiently, so that my browser doesn't slow down or crash.

### Acceptance Criteria
- WHEN thumbnail cache exceeds 50MB THEN LRU eviction SHALL remove least recently used entries
- WHEN a thread is closed THEN its thumbnail blob URLs SHALL be released after a 30-second grace period
- WHEN the browser tab becomes hidden THEN the cache MAY flush non-pinned entries
- IF memory pressure is detected THEN aggressive eviction SHALL be triggered

---

## 6. Performance Metrics

### User Story
As a developer, I want visibility into image loading performance, so that I can identify and fix bottlenecks.

### Acceptance Criteria
- WHEN images load in dev mode THEN timing metrics SHALL be logged (DB read time, decode time, total time)
- WHEN prefetch completes THEN hit/miss/eviction counts SHALL be available via `metrics()` accessor
- WHEN a performance regression occurs THEN it SHALL be detectable via the existing Performance API marks

---

## Non-Functional Requirements

### Performance Targets
- Thread open with 4 thumbnails: <300ms
- Thread open with 10 thumbnails: <500ms
- Full image load on demand: <1s for 2K, <2s for 4K

### Storage Overhead
- Thumbnail storage should add <20% overhead to total image storage
- Thumbnail quality: 80% JPEG or WebP for photos, PNG for graphics/screenshots

### Compatibility
- Must work in all browsers supporting IndexedDB (Chrome, Firefox, Safari, Edge)
- Must gracefully degrade if canvas/OffscreenCanvas is unavailable
