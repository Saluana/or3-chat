# Background Streaming + Notifications Fix — Requirements

artifact_id: 9f0f2c6c-4ed9-4d1e-9f5a-9c7f5c2d5c5a
date: 2026-01-24

## 1. Overview

Fix two regressions in SSR background streaming:

1. Streaming pauses when a user switches away from the active thread and returns.
2. Notifications do not appear when a background response completes while the thread is not open.

The solution must preserve static build behavior and keep existing streaming performance characteristics.

---

## 2. User Stories & Acceptance Criteria

### 2.1 Background stream continues across thread switches

**As a user**, I want an AI response to keep streaming if I switch to another thread, so I can multitask without losing real-time updates when I return.

**Acceptance Criteria:**

- WHEN I switch to another thread during streaming THEN the server-side stream SHALL continue without being aborted.
- WHEN I return to the original thread before completion THEN the response SHALL resume streaming in real time.
- WHEN I return after completion THEN the final response SHALL be visible immediately without needing a second navigation.

### 2.2 Notifications on background completion

**As a user**, I want a notification when a response finishes while its thread is not open, so I know it is ready.

**Acceptance Criteria:**

- WHEN a background stream completes AND the thread is not open THEN a notification SHALL be created with type `ai.message.received`.
- IF a background stream fails AND the thread is not open THEN a notification SHALL be created with type `system.warning`.
- IF the thread is open at completion THEN no completion notification SHALL be created.
- IF the thread is muted THEN no completion notification SHALL be created.
- Notifications SHALL be deduplicated per stream id (no duplicates for the same completion).

### 2.3 SSR vs static behavior

**As a user**, I want static builds to behave exactly as they do now.

**Acceptance Criteria:**

- WHEN SSR background streaming is disabled OR server routes are unavailable THEN client-side streaming behavior SHALL remain unchanged.
- Static builds SHALL NOT introduce new polling or server-only dependencies.

### 2.4 Performance & reliability

**As a developer**, I want the fix to be reliable and avoid excess polling.

**Acceptance Criteria:**

- Background polling intervals SHALL remain unchanged unless the thread is actively viewed.
- The fix SHALL not introduce additional hot-path allocations or repeated DB queries on every token.
- The system SHALL not leak background job subscriptions when switching threads.

---

## 3. Non-Functional Requirements

### 3.1 Performance

- Reattachment MUST use existing background job polling cadence.
- UI updates MUST remain frame-batched where applicable.

### 3.2 Reliability

- If a stream is detached before a job id is received, the system SHALL still reattach once the id arrives.
- Message history shall not be overwritten by stale pane snapshots.

### 3.3 Compatibility

- No breaking changes to existing hook names or notification types.
- SSR-only code stays server-safe; client-only logic remains in `.client.ts` or `process.client` guards.

---

## 4. Out of Scope

- Web push notifications
- Email/SMS alerts
- New provider implementations

