Background Streaming Code Review: Test Coverage Analysis
I've completed a comprehensive review of the background streaming layer. Here's my findings:
Current Test Coverage Summary
Well-covered areas:
- ✅ Memory Job Provider: CRUD operations, authorization, max jobs limit, timeout/cleanup, AbortController, active job count
- ✅ Provider Factory: Provider selection (memory/convex/redis), fallback behavior, caching, enablement checks
- ✅ Background Streaming + Notifications Integration: Notification creation on complete/error/abort, thread mute preferences, notification actions, unread count
- ✅ Job Stream API: serializeJobStatus with content inclusion/exclusion
Critical Test Coverage Gaps
1. Stream Handler (server/utils/background-jobs/stream-handler.ts)
- Missing: No dedicated test file
- Critical needs:
  - isBackgroundModeRequest() - detect background mode from body
  - validateBackgroundParams() - validate threadId/messageId
  - startBackgroundStream() - job creation and fire-and-forget streaming
  - consumeBackgroundStream() - core streaming logic:
    - SSE parsing with parseOpenRouterSSE
    - Content accumulation and chunk counting
    - Flush scheduling (by chunk count and time interval)
    - Abort detection for Convex provider (polling)
    - Job completion with notification emission
    - Error handling with notification emission
    - Live state management (deltas vs snapshots)
  - streamInBackground() - upstream fetch, body cleanup, abort handling
  - isBackgroundStreamingAvailable() - feature detection
2. Job Viewers (server/utils/background-jobs/viewers.ts)
- Missing: No dedicated test file
- Needs:
  - registerJobViewer() - viewer counting, disposal
  - hasJobViewers() - check if job has active viewers
  - registerJobStream() - live event subscription
  - emitJobDelta() - delta emission to listeners
  - emitJobStatus() - status change emission
  - Live state cleanup scheduling (30s retention)
3. Convex Job Provider (server/utils/background-jobs/providers/convex.ts)
- Missing: No dedicated test file (complex - requires Convex mocks)
- Needs: All provider methods with Convex client mocking, checkJobAborted() polling
4. API Endpoints
- Partially covered: stream.get.ts (only serializeJobStatus)
- Missing:
  - Full SSE stream endpoint test (authentication, polling, live updates, client disconnect)
  - status.get.ts - status endpoint with offset support
  - abort.post.ts - abort endpoint with auth
  - stream.post.ts - OpenRouter proxy with background mode detection
5. Client-Side Background Streaming (app/utils/chat/openrouterStream.ts)
- Partially covered: Basic availability cache tests
- Missing:
  - startBackgroundStream() - full client flow
  - abortBackgroundStream() - abort request
  - checkBackgroundStreamingAvailable() - server capability check
  - Stream reattachment logic
  - Fallback to regular streaming when background unavailable
6. Integration Test Gaps
- Missing:
  - Full end-to-end: client starts background stream → server processes → client reattaches → notification on complete
  - Concurrent background streams (max jobs enforcement)
  - Server restart recovery (with Convex provider)
  - Abort during streaming (both memory and Convex providers)
  - Network failure during streaming (retry behavior)
  - Rate limiting integration with background streams