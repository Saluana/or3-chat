artifact_id: a7c8d3f1-9b2e-4a5c-8d7f-1e3b5a9c7d2f
content_type: text/markdown

# requirements.md

## Introduction

The current image rendering architecture in OR3.chat converts efficient binary Blobs stored in IndexedDB into Base64-encoded data URLs during the message presentation phase. This design decision, while necessary for AI model consumption (which requires Base64 encoding), inadvertently impacts UI performance in three critical ways:

1. **Conversion Overhead**: Every chat load triggers CPU-intensive Base64 encoding for every image
2. **Memory Bloat**: Base64 strings are ~33% larger than binary data, consuming excessive heap memory
3. **DOM Thrashing**: Rendering massive text strings in `<img>` tags is significantly slower than using blob: URLs

The root cause is architectural: the `useAi.ts` composable's `normalizeFileUrl` and `hashToContentPart` functions retrieve Blobs from Dexie but immediately convert them to Base64 strings (lines 446-553). These expanded strings then flow into UI state and are rendered directly into DOM `src` attributes, negating the benefits of efficient Blob storage.

This document defines requirements for a dual-path architecture that:
- Keeps Base64 conversion isolated to AI model context preparation
- Uses native blob: URLs for UI rendering to maximize performance
- Maintains backward compatibility with existing chat functionality

## Functional Requirements

### 1. Separation of UI and AI Model Data Paths

**User Story**: As a user viewing chat history with images, I want images to render instantly without unnecessary CPU overhead, so that the chat interface remains responsive even with many images.

**Acceptance Criteria**:

1.1 WHEN the chat UI needs to display an image from IndexedDB, THEN it SHALL create a blob: URL directly from the Blob without Base64 conversion.

1.2 WHEN preparing messages for AI model consumption, THEN the system SHALL convert Blobs to Base64 data URLs only at the point of API request assembly.

1.3 WHEN a message contains file attachments, THEN the UI rendering path SHALL never access Base64-encoded versions of those files.

1.4 IF an image Blob cannot be loaded from IndexedDB, THEN the system SHALL display an error placeholder without attempting Base64 conversion.

### 2. Blob URL Lifecycle Management

**User Story**: As a developer, I want blob: URLs to be properly managed throughout their lifecycle, so that memory leaks are prevented and resources are efficiently reclaimed.

**Acceptance Criteria**:

2.1 WHEN a blob: URL is created for UI display, THEN it SHALL be registered in a centralized cache with reference counting.

2.2 WHEN a component unmounts or an image is no longer visible, THEN the blob: URL SHALL be released after a grace period (30 seconds recommended).

2.3 WHEN reference count for a blob: URL reaches zero, THEN `URL.revokeObjectURL()` SHALL be called to free browser resources.

2.4 WHEN the same file hash is requested multiple times, THEN the system SHALL reuse existing blob: URLs instead of creating duplicates.

2.5 IF a tab becomes hidden (Page Visibility API), THEN blob: URL cleanup MAY be deferred until the tab becomes visible again to avoid interrupting user sessions.

### 3. Message Content Preparation for AI Models

**User Story**: As a system, I need to prepare messages with images for AI model API calls, so that models receive properly formatted Base64 data without impacting UI performance.

**Acceptance Criteria**:

3.1 WHEN assembling a request to an AI model API, THEN images SHALL be converted from Blob to Base64 at request preparation time.

3.2 WHEN building `ContentPart` objects for model context, THEN the conversion logic SHALL operate independently from UI rendering logic.

3.3 WHEN a message contains both text and images, THEN only the images being sent to the model SHALL be Base64-encoded.

3.4 IF Base64 conversion fails during API request preparation, THEN the system SHALL emit an error event and exclude the failed image from the request.

3.5 WHEN context hashes are processed (carry-forward from previous messages), THEN Base64 conversion SHALL only occur for hashes included in the current API request.

### 4. Backward Compatibility and Migration

**User Story**: As a user with existing chat history, I want the new image rendering system to work seamlessly with my existing data, so that no manual migration is required.

**Acceptance Criteria**:

4.1 WHEN loading messages that were created before this change, THEN images SHALL render correctly using the new blob: URL approach.

4.2 WHEN encountering pre-existing data: URLs in message data, THEN the system SHALL handle them gracefully without errors.

4.3 IF a message contains mixed URL types (blob:, data:, hash), THEN each SHALL be processed according to its type.

4.4 WHEN the system starts up, THEN no database migration SHALL be required for this change.

### 5. UI Component Integration

**User Story**: As a user interacting with chat messages, I want all image display components to benefit from the performance improvements, so that the entire interface feels faster.

**Acceptance Criteria**:

5.1 WHEN `ChatMessage.vue` renders attachments, THEN it SHALL use blob: URLs for thumbnail display.

5.2 WHEN `MessageAttachmentsGallery.vue` displays the expanded image grid, THEN it SHALL use blob: URLs for all image sources.

5.3 WHEN assistant messages contain inline images (file-hash: references), THEN hydration SHALL replace placeholders with `<img>` tags using blob: URLs.

5.4 WHEN user messages show collapsed attachment previews, THEN thumbnail images SHALL use blob: URLs.

5.5 IF an image is displayed in multiple locations simultaneously, THEN blob: URL reuse SHALL prevent duplicate Blob retrievals.

### 6. Performance Monitoring and Metrics

**User Story**: As a developer, I want to measure the performance impact of this change, so that I can verify the improvements and identify any regressions.

**Acceptance Criteria**:

6.1 WHEN images are loaded for display, THEN timing metrics SHALL be emitted via the hook bus (`image:load:start`, `image:load:complete`).

6.2 WHEN Base64 conversion occurs for AI models, THEN separate timing metrics SHALL distinguish it from UI rendering.

6.3 WHEN blob: URLs are created or revoked, THEN cache metrics SHALL be available for debugging (total URLs, active references).

6.4 IF blob: URL creation fails, THEN error telemetry SHALL capture the failure mode and affected file hash.

## Non-Functional Requirements

### Performance

NFR-1: Image rendering latency SHALL be reduced by at least 50% compared to Base64 data URL rendering for images ≥1MB.

NFR-2: Memory consumption for a chat with 20 images (2MB average) SHALL be ≤30% lower than the Base64 approach.

NFR-3: Time to First Paint (FTP) for chat messages with images SHALL improve by ≥200ms on mid-range devices.

NFR-4: CPU utilization during chat history scrolling SHALL remain below 70% on devices with 4 CPU cores or more.

### Reliability

NFR-5: The system SHALL handle blob: URL lifecycle errors gracefully without crashing or corrupting UI state.

NFR-6: Blob retrieval failures SHALL NOT block rendering of text content in the same message.

NFR-7: Reference counting logic SHALL prevent memory leaks even under rapid virtualization churn (scrolling).

### Maintainability

NFR-8: The separation between UI and AI model data paths SHALL be clearly documented in code comments.

NFR-9: Blob URL management logic SHALL be centralized in a single utility module to avoid duplication.

NFR-10: Type definitions SHALL distinguish between `BlobReference` (for UI) and `DataUrlContent` (for API) to prevent mixing concerns.

### Compatibility

NFR-11: The solution SHALL work in all browsers supported by Nuxt 3 (Chrome 90+, Firefox 90+, Safari 15+, Edge 90+).

NFR-12: The solution SHALL NOT require changes to the Dexie database schema or IndexedDB structure.

NFR-13: Existing hook-based image processing plugins SHALL continue to work without modification.

## Success Criteria

The implementation will be considered successful when:

1. Chat messages with images render visibly faster during initial load and scrolling
2. Browser DevTools Performance profiling shows ≥50% reduction in JS execution time for image-heavy chats
3. Memory profiling shows proportional reduction in heap size when viewing chats with multiple images
4. All existing unit and integration tests pass without modification
5. No regressions in AI model functionality (images still sent correctly to OpenRouter APIs)
6. No user-reported issues with image display in chat after deployment to production
