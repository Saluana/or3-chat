# Background Streaming - Requirements

artifact_id: bg-stream-001
date: 2026-01-22

## 1. Overview

Enable AI message generation to continue on the server when users navigate away, close tabs, or leave the website (SSR mode only). When users return, completed messages are synced and notifications inform them of new responses.

This feature is **SSR-only**. Static builds will continue to stream client-side as they do today.

---

## 2. User Stories & Acceptance Criteria

### 2.1 Background Streaming (SSR Mode)

**As a user**, I want my AI message to complete even if I navigate away, so that I don't lose responses when multitasking.

**Acceptance Criteria:**

- WHEN I send a message in SSR mode AND navigate away from the chat THEN the AI response SHALL continue generating on the server.
- WHEN I return to the chat THEN the completed message SHALL be visible.
- WHEN I close the browser tab during generation THEN the response SHALL complete on the server.
- WHEN the response completes while I'm away THEN a notification SHALL be created.
- IF the server response fails THEN an error notification SHALL be created.

### 2.2 In-Pane Streaming (Existing Behavior)

**As a user**, I want to see AI responses stream in real-time when I'm viewing the chat, so that I can read as it generates.

**Acceptance Criteria:**

- WHEN I stay on the chat pane THEN I SHALL see tokens stream in real-time.
- WHEN streaming completes THEN the message SHALL transition from streaming to final state.
- WHEN I abort the stream THEN the server job SHALL be cancelled.

### 2.3 Static Build Compatibility

**As a user of a static deployment**, I want the app to work without server routes.

**Acceptance Criteria:**

- WHEN the app is deployed as a static build THEN streaming SHALL work client-side as it does today.
- WHEN server routes are unavailable THEN the client SHALL fall back to direct OpenRouter calls.
- WHEN background streaming is unavailable THEN navigating away SHALL abort the stream (existing behavior).

### 2.4 Notification Integration

**As a user**, I want to be notified when background AI responses complete, so I know to review them.

**Acceptance Criteria:**

- WHEN a background stream completes THEN a notification SHALL be created with type `ai.message.received`.
- WHEN the notification is clicked THEN I SHALL navigate to the completed message.
- IF the thread is muted THEN no notification SHALL be created.
- IF I'm viewing the thread when it completes THEN no notification SHALL be created (no duplicate alert).

---

## 3. Non-Functional Requirements

### 3.1 Performance

- Background jobs SHALL timeout after 5 minutes maximum.
- Server memory usage SHALL be bounded (max concurrent background streams configurable).
- Job metadata SHALL be stored in memory; only the final message is persisted to DB.

### 3.2 Reliability

- IF the server restarts during a background stream THEN the partial message SHALL NOT be lost (graceful shutdown).
- Failed jobs SHALL be marked with error state and cleaned up.

### 3.3 Security

- Background jobs SHALL be scoped to the user who initiated them.
- Job status endpoints SHALL require authentication (SSR auth mode).
- API keys SHALL never be logged.

### 3.4 Compatibility

- The feature SHALL be opt-in for SSR deployments via `NUXT_BACKGROUND_STREAMING=true`.
- Existing streaming behavior SHALL be unchanged when feature is disabled.
- Static builds SHALL be unaffected.

---

## 4. Constraints

1. **No Convex dependency** - Background streaming must be implemented in Nitro server only.
2. **Minimal code** - Reuse existing OpenRouter streaming infrastructure.
3. **Platform-agnostic** - Solution must work with any LLM provider adapter in the future.
4. **Graceful degradation** - If background streaming isn't available, fall back to current behavior.

---

## 5. Out of Scope

- Browser push notifications (web push API)
- Email notifications
- Mobile app background sync
- Workflow execution in background (separate feature)
