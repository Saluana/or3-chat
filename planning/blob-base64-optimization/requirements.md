# Blob/Base64 Optimization Requirements

## Introduction

This document defines requirements for optimizing the image and file handling architecture in OR3.chat. The current implementation eagerly converts IndexedDB Blobs to Base64 during message preparation in `useAi.ts`, which impacts performance through:

1. **Memory bloat**: Base64 encoding increases data size by ~33%
2. **CPU overhead**: Conversion happens on every chat load, blocking the UI thread
3. **DOM thrashing**: Rendering massive Base64 data URLs is slower than native `blob:` URLs

The goal is to implement a dual-path architecture that isolates Base64 conversion to API request preparation while using efficient `blob:` URLs for UI rendering.

---

## Requirements

### 1. Dual-Path File Rendering

**User Story**: As a user, I want chat messages with attachments to load quickly without memory spikes, so that large conversations remain responsive.

**Acceptance Criteria**:
- WHEN a message with file attachments is displayed THEN the UI SHALL use `blob:` URLs via `URL.createObjectURL()` rather than Base64 data URLs
- WHEN sending a message to the AI model THEN files SHALL be converted to Base64 just-in-time during API request assembly
- WHEN the same file appears in multiple messages THEN it SHALL NOT be re-encoded on each render
- IF a file cannot be loaded from IndexedDB THEN the UI SHALL display a graceful error placeholder

### 2. Separate API Preparation Path

**User Story**: As a developer, I want Base64 encoding isolated to API calls, so that UI state remains lean and performant.

**Acceptance Criteria**:
- WHEN `normalizeFileUrl` is called for UI purposes THEN it SHALL return hash references without converting to Base64
- WHEN `prepareFilesForModel` is called before an API request THEN it SHALL convert hashes to Base64 content parts
- WHEN the conversion happens THEN it SHALL NOT pollute the reactive UI state with large Base64 strings

### 3. Hash Computation Optimization

**User Story**: As a user uploading large files, I want the upload to complete without freezing the UI, so that I can continue interacting with the app.

**Acceptance Criteria**:
- WHEN computing hashes for files up to 8MB THEN Web Crypto SHALL be used for single-shot fast hashing
- WHEN computing hashes for larger files THEN the algorithm SHALL yield to the main thread at least every 256KB
- WHEN yielding THEN `scheduler.yield()` SHALL be used with fallbacks to `requestIdleCallback` and `setTimeout`
- WHEN converting buffer to hex THEN a pre-allocated lookup table SHALL be used instead of string concatenation

### 4. Database Operation Batching

**User Story**: As a user managing files (soft delete, restore, hard delete), I want these operations to complete quickly, so that bulk actions don't hang.

**Acceptance Criteria**:
- WHEN soft deleting multiple files THEN `bulkPut()` SHALL be used instead of looping `put()` calls
- WHEN creating a file THEN metadata and blob writes SHALL happen in parallel within the transaction
- WHEN restoring multiple files THEN `bulkPut()` SHALL be used to restore all in one operation

### 5. Preview Cache Memory Management

**User Story**: As a user with limited device memory, I want the app to automatically limit cached previews, so that memory isn't exhausted.

**Acceptance Criteria**:
- WHEN `navigator.deviceMemory` is ≤4GB THEN the cache SHALL limit to 80 URLs and 48MB
- WHEN `navigator.deviceMemory` is >4GB THEN the cache SHALL limit to 120 URLs and 80MB
- WHEN evicting entries THEN only unpinned entries SHALL be considered (O(k) not O(n))
- WHEN a cached URL is no longer displayed THEN it SHALL be revoked after a 30-second grace period

### 6. Image Loading Safety

**User Story**: As a user, I want image loading to fail gracefully, so that malformed images don't freeze the app.

**Acceptance Criteria**:
- WHEN loading an image for dimension extraction THEN a 5-second timeout SHALL prevent hung operations
- WHEN chunking Base64 for large files THEN 8KB chunks SHALL be used to prevent memory spikes
- WHEN validating files before upload THEN size and empty checks SHALL occur before any allocations
