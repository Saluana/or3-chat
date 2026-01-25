# Background Streaming + Notifications Fix — Tasks (SSE)

artifact_id: 2cfe9a2b-833a-4a9e-9ad4-5a2d0b8d3d1f
date: 2026-01-25

---

## 1. Server-authoritative background streaming

- [x] 1.1 Remove hybrid `tee()` path from `/api/openrouter/stream` (background mode now returns jobId only)
- [x] 1.2 Ensure background jobs flush frequently (`flushOnEveryChunk`, small interval)
- [x] 1.3 Strip `_backgroundMode` from upstream payload

## 2. SSE job stream endpoint

- [x] 2.1 Add `/api/jobs/:id/stream` SSE endpoint with snapshot + delta events
- [x] 2.2 Use active/idle polling intervals to match existing UX (80ms active)
- [x] 2.3 Add keep-alive pings and clean disconnect handling

## 3. Notification gating

- [x] 3.1 Add viewer tracking for SSE connections
- [x] 3.2 Server notifications only when no viewers

## 4. Client SSE integration

- [x] 4.1 Add `subscribeBackgroundJobStream()` helper
- [x] 4.2 Refactor `useAi` background flow to start job + SSE
- [x] 4.3 Remove hybrid background mode references

## 5. Tests

- [x] 5.1 Update `openrouterStream` tests for removed hybrid mode
- [ ] 5.2 Add/expand SSE flow tests (optional)

## 6. Manual verification

- [ ] 6.1 SSR mode: switch thread mid-stream, reattach shows live updates
- [ ] 6.2 SSR mode: background completion notification when thread closed
- [ ] 6.3 Static build: fallback direct streaming unchanged
