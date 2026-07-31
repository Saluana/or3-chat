# requirements.md

artifact_id: a1b2c3d4-5678-90ab-cdef-notification01
date: 2026-01-21

## Introduction

The Notification Center provides a persistent, in-app event hub that informs users about important activity that occurred while they were away from a thread, pane, or the app itself. It is designed to be offline-first, sync-ready when cloud sync is enabled, and fully extensible by plugins.

Core principles:
- **Offline-first**: Notifications are stored locally in Dexie and work without cloud sync.
- **Sync-ready**: When sync is enabled, notifications sync across devices.
- **Plugin-extensible**: Any plugin can emit, transform, or consume notifications via hooks.
- **UI-agnostic**: The storage and hook layer is decoupled from rendering.

No external delivery (email, SMS, push) is built into core. Those are plugin responsibilities.

---

## Functional Requirements

### 1. Notification Storage

**1.1** As a user, I want notifications stored locally so that I can access them offline.

Acceptance Criteria:
- WHEN a notification is created THEN it SHALL be persisted to the `notifications` Dexie table.
- WHEN the app is offline THEN I SHALL be able to view all locally stored notifications.
- IF `readAt` is null THEN the notification SHALL be considered unread.

**1.2** As a user, I want notifications synced across my devices when cloud sync is enabled.

Acceptance Criteria:
- WHEN sync is enabled AND a notification is created THEN it SHALL be queued for sync via `pending_ops`.
- WHEN a notification is synced from another device THEN it SHALL appear in the local notification list.
- WHEN I mark a notification as read on one device THEN it SHALL sync to other devices.

---

### 2. Notification Types

**2.1** As a user, I want to receive different types of notifications for different events.

Acceptance Criteria:
- WHEN a new AI message arrives in a thread I'm not viewing THEN I SHALL receive an `ai.message.received` notification.
- WHEN a long-running workflow completes THEN I SHALL receive a `workflow.completed` notification.
- WHEN a sync conflict is detected THEN I SHALL receive a `sync.conflict` notification.
- WHEN a system warning occurs THEN I SHALL receive a `system.warning` notification.

**2.2** As a plugin developer, I want to define custom notification types.

Acceptance Criteria:
- WHEN a plugin emits a notification with a custom type THEN it SHALL be stored and displayed.
- IF the type is not a core type THEN it SHALL still be accepted (type is a string, not an enum).

---

### 3. Notification Actions

**3.1** As a user, I want to click a notification to navigate to related content.

Acceptance Criteria:
- WHEN I click a notification with a `navigate` action targeting `threadId` THEN I SHALL be navigated to that thread.
- WHEN I click a notification with a `navigate` action targeting `documentId` THEN I SHALL be navigated to that document.
- WHEN I click a notification with a `navigate` action targeting `route` THEN I SHALL be navigated to that route.

**3.2** As a plugin developer, I want to attach callback actions to notifications.

Acceptance Criteria:
- WHEN a notification includes a `callback` action THEN clicking it SHALL emit the `notify:action:clicked` hook with the action payload.
- WHEN a plugin has registered a handler for that action THEN it SHALL be executed.

---

### 4. UI Integration

**4.1** As a user, I want a notification bell icon that shows my unread count.

Acceptance Criteria:
- WHEN I have unread notifications THEN the bell icon SHALL display a badge with the count.
- WHEN the count exceeds 99 THEN the badge SHALL display "99+".
- WHEN all notifications are read THEN the badge SHALL not be displayed.

**4.2** As a user, I want to open a notification panel from the bell icon.

Acceptance Criteria:
- WHEN I click the bell icon THEN a notification panel SHALL open.
- WHEN the panel opens THEN it SHALL display notifications grouped by date (newest first).
- WHEN no notifications exist THEN it SHALL display an empty state message.

**4.3** As a user, I want to mark notifications as read.

Acceptance Criteria:
- WHEN I click a notification THEN it SHALL be marked as read (`readAt` set to current timestamp).
- WHEN I click "Mark all as read" THEN all unread notifications SHALL be marked as read.
- WHEN I click "Clear all" THEN all notifications SHALL be soft-deleted.

---

### 5. Thread-Level Control

**5.1** As a user, I want to mute notifications for specific threads.

Acceptance Criteria:
- WHEN I mute a thread THEN notifications targeting that thread SHALL not be displayed.
- WHEN a thread is muted THEN the mute preference SHALL be stored in the `kv` table.
- WHEN I unmute a thread THEN future notifications for that thread SHALL be displayed.

---

### 6. Hooks & Extensibility

**6.1** As a plugin developer, I want hooks to emit and transform notifications.

Acceptance Criteria:
- WHEN `notify:action:push` is emitted with a notification payload THEN it SHALL be stored.
- WHEN `notify:filter:before_store` is applied THEN plugins SHALL be able to modify or reject the notification.
- IF the filter returns `false` THEN the notification SHALL not be stored.

**6.2** As a plugin developer, I want to be notified when a user interacts with notifications.

Acceptance Criteria:
- WHEN a user clicks a notification THEN `notify:action:clicked` SHALL be emitted.
- WHEN a user marks a notification as read THEN `notify:action:read` SHALL be emitted.

---

## Non-Functional Requirements

### 7. Performance

**7.1** Unread count queries SHALL complete in under 10ms for up to 1000 notifications.

**7.2** Notification list rendering SHALL be virtualized if more than 50 items are displayed.

---

### 8. Admin Dashboard Considerations

**8.1** The notification schema SHALL support future admin use cases:
- System-wide announcements (notifications where `userId` is null or matches a broadcast pattern).
- Notification analytics (the schema supports querying by type, createdAt, readAt).

---

## Out of Scope

- External delivery (email, SMS, push notifications) — plugin responsibility.
- Complex notification grouping/threading — future enhancement.
- Notification digests — future enhancement via plugin.
