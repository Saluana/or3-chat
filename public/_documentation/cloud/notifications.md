# Notification Center

The OR3 Notification Center provides real-time, in-app notifications for AI events, sync conflicts, system warnings, and custom plugin events. It works offline-first and syncs across devices when OR3 Cloud is enabled.

---

## Overview

### What You Get

- **AI Streaming Notifications** - Alerts when background AI responses complete
- **Sync Conflict Alerts** - Notifications when data conflicts are automatically resolved
- **System Warnings** - Errors and important system events
- **Plugin Events** - Custom notifications from plugins and workflows

### Key Features

| Feature | Description |
|---------|-------------|
| **Local-First** | Works offline, stores data in IndexedDB |
| **Cross-Device Sync** | Notifications sync across all your devices (with OR3 Cloud) |
| **Zero Configuration** | Works immediately in both static and SSR builds |
| **Extensible** | Create custom notifications via hooks or composables |

---

## User Guide

### Using the Notification Center

1. **Bell Icon** - Look for the bell (🔔) in the sidebar
2. **Unread Badge** - Shows count of unread notifications
3. **Click to Open** - Opens the notification panel
4. **Click Notification** - Marks as read and navigates (if applicable)
5. **Bulk Actions** - "Mark all as read" or "Clear all" buttons

### Notification Types

| Type | Icon | Description |
|------|------|-------------|
| `ai.message.received` | 🤖 | AI response is ready |
| `sync.conflict` | 🔄 | Data conflict was resolved |
| `system.warning` | ⚠️ | System error or warning |
| `custom.*` | 🔌 | Plugin-specific notifications |

### Sync Conflict Notifications

When you use OR3 Cloud across multiple devices, you may occasionally see "Sync conflict resolved" notifications. This is **normal and expected**:

- OR3 automatically resolves conflicts using Last-Write-Wins
- You'll see one notification per conflict
- **During initial sync**, conflict notifications are suppressed to avoid noise
- Historical conflicts (older than 24 hours) don't generate notifications

**Why you see them:**
- You edited the same message/thread on two devices
- Network issues caused delayed sync
- Multiple rapid edits created timing conflicts

**What to do:**
- Nothing! The conflict is already resolved
- The notification is just informational
- Your data is safe and consistent

---

## Developer Guide

### Creating Notifications

#### Method 1: Via Composable (Recommended)

```typescript
import { useNotifications } from '~/composables/notifications';

const { push } = useNotifications();

await push({
    type: 'custom.event',
    title: 'Custom Event',
    body: 'Something important happened!',
    threadId: 'optional-thread-id',
    actions: [
        {
            id: 'action-1',
            label: 'View Details',
            kind: 'navigate',
            target: { route: '/custom-page' },
        },
    ],
});
```

#### Method 2: Via Hook (Event-Driven)

```typescript
import { useHooks } from '~/core/hooks/useHooks';

const hooks = useHooks();

await hooks.doAction('notify:action:push', {
    type: 'workflow.completed',
    title: 'Workflow Complete',
    body: 'Your workflow finished successfully.',
});
```

#### Method 3: System Warnings

```typescript
import { emitSystemNotification } from '~/plugins/notification-listeners.client';

await emitSystemNotification({
    title: 'Custom Warning',
    body: 'Something needs attention.',
    threadId: 'optional-thread-id',
});
```

### Filtering Notifications

Block or modify notifications before storage:

```typescript
import { useHooks } from '~/core/hooks/useHooks';

const hooks = useHooks();

hooks.addFilter('notify:filter:before_store', (notification, context) => {
    // Block spam notifications
    if (notification.title.includes('SPAM')) {
        return false; // Reject
    }
    
    // Modify notification
    if (notification.type === 'custom.event') {
        return {
            ...notification,
            title: `[Custom] ${notification.title}`,
        };
    }
    
    // Allow unchanged
    return notification;
});
```

### Reacting to Events

```typescript
import { useHooks } from '~/core/hooks/useHooks';

const hooks = useHooks();

// When notification is created
hooks.addAction('notify:action:push', (payload) => {
    console.log('Notification created:', payload);
    // Send analytics, play sound, etc.
});

// When notification is marked read
hooks.addAction('notify:action:read', ({ id, readAt }) => {
    console.log('Notification read:', id);
});

// When all notifications cleared
hooks.addAction('notify:action:cleared', ({ count }) => {
    console.log(`Cleared ${count} notifications`);
});
```

---

## Architecture

### Data Flow

```
Event Source → Hook Engine → Plugin Listener → NotificationService → Dexie → UI
```

1. **Event Source** emits a hook action (e.g., `sync.conflict:action:detected`)
2. **Hook Engine** routes to registered listeners
3. **Plugin Listener** converts to notification payload
4. **NotificationService** applies filters and stores
5. **Dexie** persists to IndexedDB
6. **UI** updates via live query

### Cross-Device Sync

When OR3 Cloud is enabled:

```
Device 1 → Dexie → Convex Cloud → Device 2
```

- Notifications sync automatically
- Read status syncs across devices
- Conflicts resolved via Last-Write-Wins

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `NotificationService` | `app/core/notifications/notification-service.ts` | Core CRUD logic |
| `useNotifications` | `app/composables/notifications/useNotifications.ts` | Reactive composable |
| `NotificationBell` | `app/components/notifications/NotificationBell.vue` | Bell icon + badge |
| `NotificationPanel` | `app/components/notifications/NotificationPanel.vue` | Notification list |
| `NotificationItem` | `app/components/notifications/NotificationItem.vue` | Single notification |

---

## Configuration

### Static Build (Default)

No configuration needed. Notifications work locally only.

```bash
# .env
OR3_CLOUD_ENABLED=false
```

### OR3 Cloud Enabled

Notifications sync across devices.

```bash
# .env
SSR_AUTH_ENABLED=true
OR3_SYNC_ENABLED=true
VITE_CONVEX_URL=https://your-project.convex.cloud
```

---

## Troubleshooting

### Notifications Not Appearing

**Check:**
```typescript
// 1. Verify client-side execution
console.log('Is client?', import.meta.client);

// 2. Check database
const db = getDb();
const count = await db.notifications.count();
console.log('Total notifications:', count);
```

**Solutions:**
- Ensure code runs client-side (check `import.meta.client`)
- Verify notification was created successfully
- Check browser console for errors

### Notifications Not Syncing

**Check:**
```bash
# Verify environment variables
echo $SSR_AUTH_ENABLED  # Should be "true"
echo $OR3_SYNC_ENABLED   # Should be "true"
echo $VITE_CONVEX_URL    # Should be set
```

**Solutions:**
- Enable OR3 Cloud features
- Configure Convex URL correctly
- Check network connectivity
- Verify user authentication

### Too Many Sync Conflict Notifications

**This is now fixed** - conflict notifications are automatically suppressed during:
- Initial workspace bootstrap (first load)
- Rescan operations (cursor reset)
- Historical conflicts (older than 24 hours)

If you're still seeing many conflict notifications:
- Check that you're on the latest version
- Verify the `notification-listeners.client.ts` plugin is loaded
- Look for console logs: `[notify] Skipping historical conflict notification`

### Debug Mode

Enable verbose logging:

```typescript
// In browser console
localStorage.setItem('debug:notifications', 'true');

// Reload page and check console for:
// [useNotifications] Query result: [...]
// [NotificationService] Creating notification: {...}
```

---

## API Reference

### NotificationCreatePayload

```typescript
interface NotificationCreatePayload {
    type: string;           // Notification type (e.g., 'sync.conflict')
    title: string;          // Short title
    body?: string;          // Detailed message
    threadId?: string;      // Associated thread
    documentId?: string;    // Associated document
    actions?: NotificationAction[];  // Action buttons
}
```

### NotificationAction

```typescript
interface NotificationAction {
    id: string;
    label: string;
    kind: 'navigate' | 'callback';
    target?: { route?: string; threadId?: string };
    data?: unknown;
}
```

### useNotifications Return Value

```typescript
{
    notifications: Ref<Notification[]>,  // All notifications
    unreadCount: Ref<number>,            // Unread count
    loading: Ref<boolean>,               // Loading state
    markRead: (id: string) => Promise<void>,
    markAllRead: () => Promise<void>,
    clearAll: () => Promise<number>,
    push: (payload) => Promise<void>,
    isThreadMuted: (threadId: string) => boolean,
    muteThread: (threadId: string) => Promise<void>,
    unmuteThread: (threadId: string) => Promise<void>,
}
```

---

## Related

- [Sync Layer](./sync-layer) - How data synchronization works
- [Auth System](./auth-system) - Authentication architecture
- [Hooks](../hooks/hooks) - Hook system documentation
- [Troubleshooting](./troubleshooting) - Common issues and solutions
