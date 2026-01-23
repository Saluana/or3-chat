# tasks.md

artifact_id: a1b2c3d4-5678-90ab-cdef-notification03
date: 2026-01-21

## Purpose

Implementation checklist for the Notification Center feature. Each task maps to requirements and includes subtasks for granular progress tracking.

---

## Phase 1: Schema & Data Layer

### 1. Dexie Schema Updates
Requirements: 1.1

- [x] 1.1 Add `Notification` and `NotificationAction` interfaces to `app/db/schema.ts`
- [x] 1.2 Add `notifications` table to Dexie schema in `app/db/client.ts`
    - Primary key: `&id`
    - Indexes: `user_id`, `[user_id+read_at]`, `[user_id+created_at]`, `[user_id+thread_id]`, `type`, `deleted`, `clock`
- [x] 1.3 Bump Dexie version number to v12 in `app/db/client.ts`
- [x] 1.4 Export new types from `app/db/index.ts`

### 2. Convex Schema Updates
Requirements: 1.2

- [x] 2.1 Add `notifications` table to `convex/schema.ts`
    - Fields: `workspace_id`, `id`, `user_id`, `thread_id`, `document_id`, `type`, `title`, `body`, `actions`, `read_at`, `deleted`, `deleted_at`, `created_at`, `updated_at`, `clock`
    - Indexes: `by_workspace`, `by_workspace_id`, `by_workspace_user`
- [x] 2.2 Add notifications to TABLE_INDEX_MAP in `convex/sync.ts`
- [x] 2.3 Verify schema builds correctly
- [x] 2.4 Run typecheck to verify no errors

---

## Phase 2: Hooks & Service Layer

### 3. Hook Definitions
Requirements: 6.1, 6.2

- [x] 3.1 Add notification hook keys to `app/core/hooks/hook-keys.ts`:
    - `notify:action:push`
    - `notify:action:read`
    - `notify:action:clicked`
    - `notify:action:cleared`
    - `notify:filter:before_store`
- [x] 3.2 Add payload types to `app/core/hooks/hook-types.ts`:
    - `NotificationCreatePayload`
    - Hook payload map entries for all notify hooks

### 4. NotificationService
Requirements: 1.1, 3.1, 3.2, 6.1

- [x] 4.1 Create `app/core/notifications/` directory
- [x] 4.2 Create `notification-service.ts` with:
    - Constructor (db, hooks, userId)
    - `create(payload)` method with filter hook
    - `markRead(id)` method
    - `markAllRead()` method
    - `clearAll()` method
- [x] 4.3 Create `types.ts` with notification type exports
- [x] 4.4 Create `index.ts` barrel export

### 5. Sync Integration
Requirements: 1.2

- [x] 5.1 Add `notifications` to `SYNCED_TABLES` in `app/core/sync/hook-bridge.ts`
- [x] 5.2 Conflict resolver uses generic table handling (no changes needed)
- [x] 5.3 Run typecheck to verify no errors

---

## Phase 3: Composable Layer

### 6. useNotifications Composable
Requirements: 4.1, 4.2, 4.3, 5.1

- [x] 6.1 Create `app/composables/notifications/useNotifications.ts`
- [x] 6.2 Implement reactive queries:
    - `notifications` (sorted by created_at desc)
    - `unreadCount`
- [x] 6.3 Implement actions:
    - `markRead(id)`
    - `markAllRead()`
    - `clearAll()`
    - `push(payload)` (convenience wrapper)
- [x] 6.4 Implement mute functions:
    - `isThreadMuted(threadId)`
    - `muteThread(threadId)`
    - `unmuteThread(threadId)`
- [x] 6.5 Create `app/composables/notifications/index.ts` barrel export
- [x] 6.6 Export from main composables index

---

## Phase 4: UI Components

### 7. NotificationBell
Requirements: 4.1

- [x] 7.1 Create `app/components/notifications/NotificationBell.vue`
    - Icon with click handler
    - Badge showing unread count (99+ cap)
    - Toggle panel visibility
- [x] 7.2 Add notification icons to icon system

### 8. NotificationPanel
Requirements: 4.2, 4.3

- [x] 8.1 Create `app/components/notifications/NotificationPanel.vue`
    - Slideover container
    - Header with title and action buttons
    - Scrollable notification list
    - Empty state
- [x] 8.2 Implement "Mark all as read" button
- [x] 8.3 Implement "Clear all" button with confirmation

### 9. NotificationItem
Requirements: 3.1, 3.2, 4.3

- [x] 9.1 Create `app/components/notifications/NotificationItem.vue`
    - Type icon mapping
    - Title, body, timestamp display
    - Unread visual indicator
- [x] 9.2 Implement click handler for navigate actions
- [x] 9.3 Implement click handler for callback actions (emit hook)
- [x] 9.4 Mark as read on click

### 10. Sidebar Integration
Requirements: 4.1

- [x] 10.1 Add NotificationBell to sidebar (in SideBottomNav)
- [x] 10.2 Style matches existing sidebar chrome
- [x] 10.3 Responsive behavior handled by component

---

## Phase 5: Event Source Integration

### 11. AI Message Notifications
Requirements: 2.1

- [x] 11.1 Identify AI streaming completion point in codebase
- [x] 11.2 Add notification emission for non-active thread messages
- [x] 11.3 Respect thread mute preferences before emitting

### 12. Sync Conflict Notifications
Requirements: 2.1

- [x] 12.1 Add notification emission in conflict resolver
- [x] 12.2 Include relevant conflict metadata in notification

### 13. System Warning Notifications
Requirements: 2.1

- [x] 13.1 Add notification emission for system warnings (sync errors, storage failures)
- [x] 13.2 Create helper function for system notification emission

**Note**: Event source integrations are optional enhancements that can be added incrementally after core functionality is tested.

---

## Phase 6: Testing

### 14. Unit Tests
Requirements: 7.1

- [x] 14.1 Create `app/core/notifications/__tests__/notification-service.test.ts`
    - Test create, markRead, markAllRead, clearAll
    - Test filter hook rejection
- [x] 14.2 Create `app/composables/notifications/__tests__/useNotifications.test.ts`
    - Test reactive queries
    - Test mute functions
- [x] 14.3 Create `tests/unit/background-streaming-notifications.test.ts`
    - Test AI message notifications
    - Test error/abort notifications
    - Test thread mute preferences
    - Test notification actions
- [x] 14.4 Create `tests/unit/notification-listeners.test.ts`
    - Test sync conflict notifications
    - Test system warning notifications
    - Test error handling

### 15. Integration Tests
Requirements: 7.1

- [x] 15.1 Add notifications to existing sync integration tests
- [x] 15.2 Test full hook flow: push → filter → store → query

### 16. Manual Testing Checklist

- [x] 16.1 Manual test script created in `tests/manual/notification-tests.ts`
- [ ] 16.2 Verify bell badge appears with correct count
- [ ] 16.3 Open panel, verify notification displays
- [ ] 16.4 Click notification, verify it marks as read
- [ ] 16.5 Verify "Mark all as read" works
- [ ] 16.6 Verify "Clear all" works
- [ ] 16.7 Test with sync enabled (two browser tabs)
- [ ] 16.8 Test background streaming with notifications
- [ ] 16.9 Test sync conflict generates notification
- [ ] 16.10 Test system warnings generate notifications

**Manual Test Instructions**:
1. Run `bun run dev` to start the dev server
2. Open browser console
3. Run commands from `tests/manual/notification-tests.ts`:
   - `notificationTests.testCreateNotification()` - Create a test notification
   - `notificationTests.testMultipleNotifications()` - Create 5 notifications
   - `notificationTests.testUnreadCount()` - Check unread count
   - `notificationTests.testMarkAllRead()` - Mark all as read
   - `notificationTests.testClearAll()` - Clear all notifications

---

## Phase 7: Documentation

### 17. Documentation Updates

- [ ] 17.1 Add notification hooks to hook catalog in docs
- [ ] 17.2 Update or3-cloud skill if needed
- [ ] 17.3 Add notification composable to docmap

---

## Verification Commands

```bash
# Type checking
bunx nuxi typecheck

# Run unit tests
bunx vitest run tests/unit/

# Run notification-specific tests (after creation)
bunx vitest run --grep "notification"

# Dev server for manual testing
bun run dev

# Convex schema validation
bun run convex-dev
```

---

## Dependencies

- Phase 1 blocks Phase 2 (schema needed for service)
- Phase 2 blocks Phase 3 (service needed for composable)  
- Phase 3 blocks Phase 4 (composable needed for UI)
- Phase 4 blocks Phase 5 (UI needed to see event integrations)
- All phases block Phase 6 (testing requires all components)
