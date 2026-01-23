# Manual Testing Guide - Phase 5: Notification Center & Background Streaming

## Purpose
This document provides step-by-step instructions for manually testing the Phase 5 implementation of the Notification Center integrated with Background Streaming.

## Prerequisites
- Bun runtime installed
- `.env` file configured with OpenRouter API key
- Dev server running

## Setup

### 1. Start the Dev Server
```bash
cd /home/runner/work/or3-chat/or3-chat
export PATH="$HOME/.bun/bin:$PATH"
bun run dev
```

The server should start on http://localhost:3000

### 2. Open Browser
Open Chrome/Firefox and navigate to http://localhost:3000

### 3. Open Browser DevTools
Press F12 to open DevTools and switch to the Console tab

---

## Test Suite 1: Basic Notification Functionality

### Test 1.1: Notification Bell Visibility
**Expected:** Notification bell icon should be visible in the sidebar
**Steps:**
1. Look at the sidebar (usually left side of the screen)
2. Find the notification bell icon
3. Verify the icon is clickable

**Pass Criteria:** ✅ Bell icon is visible and clickable

---

### Test 1.2: Create Manual Test Notification
**Expected:** Notification appears in the panel
**Steps:**
1. Open browser console
2. Run the following command:
```javascript
const { useNotifications } = await import('/app/composables/notifications/useNotifications.ts');
const { push } = useNotifications();
await push({
    type: 'test',
    title: 'Test Notification',
    body: 'This is a test notification created manually.'
});
```
3. Click the notification bell icon
4. Verify notification appears in the panel

**Pass Criteria:** 
- ✅ Notification panel opens
- ✅ Notification is visible with correct title and body
- ✅ Badge shows "1" unread count

---

### Test 1.3: Mark as Read
**Expected:** Notification marked as read, badge decrements
**Steps:**
1. With notification panel open (from Test 1.2)
2. Click on the notification
3. Observe the unread badge

**Pass Criteria:**
- ✅ Notification visual indicator changes (e.g., color/opacity)
- ✅ Badge decrements to "0"

---

### Test 1.4: Mark All as Read
**Expected:** All notifications marked as read
**Steps:**
1. Create multiple notifications via console:
```javascript
for (let i = 0; i < 3; i++) {
    await push({
        type: 'test',
        title: `Test ${i + 1}`,
        body: `Notification ${i + 1}`
    });
}
```
2. Click notification bell
3. Click "Mark all as read" button
4. Observe badge and notification indicators

**Pass Criteria:**
- ✅ All notifications show as read
- ✅ Badge shows "0"

---

### Test 1.5: Clear All Notifications
**Expected:** All notifications deleted
**Steps:**
1. With notification panel open
2. Click "Clear all" button
3. Confirm in modal if prompted
4. Observe notification panel

**Pass Criteria:**
- ✅ All notifications removed from panel
- ✅ Empty state shown
- ✅ Badge shows "0"

---

## Test Suite 2: Background Streaming Integration

### Test 2.1: Background Stream Completion Notification
**Expected:** Notification created when stream completes after navigation
**Steps:**
1. Start a new chat conversation
2. Send a message to AI
3. IMMEDIATELY navigate to a different page/thread (before stream completes)
4. Wait for AI response to complete (30-60 seconds)
5. Check notification bell

**Pass Criteria:**
- ✅ Notification appears after stream completes
- ✅ Title: "AI response ready"
- ✅ Body: "Your background response is ready."
- ✅ Action button: "Open chat"
- ✅ Clicking notification navigates to the thread

---

### Test 2.2: Background Stream Error Notification
**Expected:** Error notification when stream fails
**Setup:** Configure invalid API key or force network error
**Steps:**
1. Start a new chat conversation
2. Send a message
3. Navigate away immediately
4. Wait for error (should be quick)
5. Check notification bell

**Pass Criteria:**
- ✅ Notification appears with error
- ✅ Title: "AI response failed"
- ✅ Type: "system.warning"

---

### Test 2.3: Thread Mute Preference
**Expected:** No notification if thread is muted
**Steps:**
1. Open a thread
2. Mute the thread via console:
```javascript
const { useNotifications } = await import('/app/composables/notifications/useNotifications.ts');
const { muteThread } = useNotifications();
await muteThread('THREAD_ID_HERE'); // Replace with actual thread ID
```
3. Send a message
4. Navigate away immediately
5. Wait for completion
6. Check notification bell

**Pass Criteria:**
- ✅ No notification appears for muted thread
- ✅ Notification appears for non-muted threads

---

### Test 2.4: Background Stream Abort
**Expected:** Abort notification when stream is stopped
**Steps:**
1. Start a new chat conversation
2. Send a message
3. Click abort/stop button before navigating away
4. Navigate to different thread
5. Check notification bell

**Pass Criteria:**
- ✅ No notification appears (user was still on page)
- OR
- ✅ Notification with title "AI response stopped"

---

## Test Suite 3: Sync Conflict Notifications

### Test 3.1: Simulate Sync Conflict
**Expected:** Notification created on conflict detection
**Setup:** Requires sync enabled with Convex
**Steps:**
1. Open two browser tabs with same workspace
2. Create/edit same entity in both tabs with different clocks
3. Trigger sync
4. Check notification bell

**Pass Criteria:**
- ✅ Notification appears with title "Sync conflict resolved"
- ✅ Body includes table name and winner
- ✅ Type: "sync.conflict"

---

### Test 3.2: Conflict Metadata
**Expected:** Notification includes conflict details
**Steps:**
1. From Test 3.1, open notification panel
2. Click on sync conflict notification
3. Observe action button

**Pass Criteria:**
- ✅ "Details" action button present
- ✅ Clicking reveals conflict metadata (table, pk, clocks, winner)

---

## Test Suite 4: System Warning Notifications

### Test 4.1: Manual System Warning
**Expected:** System warning notification created
**Steps:**
1. Open browser console
2. Run:
```javascript
const { emitSystemNotification } = await import('/app/plugins/notification-listeners.client.ts');
await emitSystemNotification({
    title: 'Test System Warning',
    body: 'This is a test system warning.'
});
```
3. Check notification bell

**Pass Criteria:**
- ✅ Notification appears
- ✅ Type: "system.warning"
- ✅ Title and body match

---

### Test 4.2: System Warning with Thread Context
**Expected:** Notification includes thread navigation
**Steps:**
1. Open browser console
2. Run:
```javascript
await emitSystemNotification({
    title: 'Thread Error',
    body: 'Error in thread.',
    threadId: 'THREAD_ID_HERE' // Replace with actual thread ID
});
```
3. Click notification

**Pass Criteria:**
- ✅ Notification created
- ✅ Clicking navigates to specified thread

---

## Test Suite 5: Notification Filtering

### Test 5.1: Filter Hook Rejection
**Expected:** Notifications can be blocked via filters
**Steps:**
1. Open browser console
2. Add filter hook:
```javascript
const { useHooks } = await import('~/core/hooks/useHooks');
const hooks = useHooks();
hooks.addFilter('notify:filter:before_store', (notification) => {
    if (notification.title.includes('BLOCK')) {
        return false; // Block notification
    }
    return notification;
});
```
3. Create notification with "BLOCK" in title
4. Check notification bell

**Pass Criteria:**
- ✅ Notification with "BLOCK" is not created
- ✅ Other notifications still work

---

### Test 5.2: Filter Hook Modification
**Expected:** Notifications can be modified via filters
**Steps:**
1. Add filter hook:
```javascript
hooks.addFilter('notify:filter:before_store', (notification) => {
    return {
        ...notification,
        title: '[MODIFIED] ' + notification.title
    };
});
```
2. Create any notification
3. Check notification bell

**Pass Criteria:**
- ✅ Notification title is prefixed with "[MODIFIED]"

---

## Test Suite 6: Unread Count

### Test 6.1: Badge Count Accuracy
**Expected:** Badge shows correct unread count
**Steps:**
1. Clear all notifications
2. Create exactly 5 notifications
3. Observe badge
4. Mark 2 as read
5. Observe badge

**Pass Criteria:**
- ✅ Badge shows "5" initially
- ✅ Badge shows "3" after marking 2 as read

---

### Test 6.2: Badge Count Cap
**Expected:** Badge caps at "99+"
**Steps:**
1. Create 100+ notifications via console loop
2. Observe badge

**Pass Criteria:**
- ✅ Badge shows "99+" not "100"

---

## Test Suite 7: Cross-Tab Sync (Requires Convex)

### Test 7.1: Notification Sync Across Tabs
**Expected:** Notifications sync across browser tabs
**Setup:** Sync enabled with Convex
**Steps:**
1. Open two browser tabs to same workspace
2. In Tab 1: Create notification
3. In Tab 2: Check notification bell

**Pass Criteria:**
- ✅ Notification appears in Tab 2 within ~2 seconds
- ✅ Unread count matches across tabs

---

### Test 7.2: Mark as Read Sync
**Expected:** Read status syncs across tabs
**Steps:**
1. With two tabs open (from 7.1)
2. In Tab 1: Mark notification as read
3. In Tab 2: Check notification status

**Pass Criteria:**
- ✅ Notification shows as read in Tab 2
- ✅ Unread count decrements in Tab 2

---

## Test Results Summary

Date: _________________
Tester: _________________

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1.1 - Bell Visibility | ☐ | ☐ | |
| 1.2 - Create Notification | ☐ | ☐ | |
| 1.3 - Mark as Read | ☐ | ☐ | |
| 1.4 - Mark All Read | ☐ | ☐ | |
| 1.5 - Clear All | ☐ | ☐ | |
| 2.1 - BG Completion | ☐ | ☐ | |
| 2.2 - BG Error | ☐ | ☐ | |
| 2.3 - Thread Mute | ☐ | ☐ | |
| 2.4 - BG Abort | ☐ | ☐ | |
| 3.1 - Sync Conflict | ☐ | ☐ | |
| 3.2 - Conflict Meta | ☐ | ☐ | |
| 4.1 - System Warning | ☐ | ☐ | |
| 4.2 - Warning Context | ☐ | ☐ | |
| 5.1 - Filter Reject | ☐ | ☐ | |
| 5.2 - Filter Modify | ☐ | ☐ | |
| 6.1 - Badge Accuracy | ☐ | ☐ | |
| 6.2 - Badge Cap | ☐ | ☐ | |
| 7.1 - Cross-Tab Sync | ☐ | ☐ | |
| 7.2 - Read Sync | ☐ | ☐ | |

**Overall Result:** ☐ Pass ☐ Fail

**Critical Issues Found:**
1. 
2. 
3. 

**Notes:**
