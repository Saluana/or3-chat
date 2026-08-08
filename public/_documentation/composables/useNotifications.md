# useNotifications

Reactive notification center backed by Dexie live queries and the notification hook system. It is the app-wide surface for reading and mutating notifications.

## Purpose

`useNotifications()` returns:

-   `notifications` — ordered notifications for the active user.
-   `unreadCount` — unread count.
-   `loading` — `true` while the list is loading.
-   `markRead(id)` — mark one notification read.
-   `markAllRead()` — mark everything read.
-   `clearAll()` — soft-delete all notifications; returns the count removed.
-   `push(payload)` — create a notification through the hooks system (`notify:action:push`).
-   `isThreadMuted(threadId)` — check a thread's mute state.
-   `muteThread(threadId)` / `unmuteThread(threadId)` — mute or unmute a thread.

State is scoped to the resolved user and active workspace. A shared `NotificationService` instance is reused across callers to avoid duplicate listeners.

## Usage

```ts
import { useNotifications } from '~/composables/notifications/useNotifications';

const { notifications, unreadCount, markRead } = useNotifications();

watchEffect(() => {
    document.title = `(${unreadCount.value}) OR3`;
});
```

## Notes

-   On SSR (or when IndexedDB is missing) it returns a no-op implementation.
-   Subscriptions are cleaned up with the calling scope.

## Related

-   `NotificationService` (`~/core/notifications/notification-service`) — the shared engine.
-   `useSessionContext` — user scoping.
