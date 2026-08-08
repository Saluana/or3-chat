# useWorkspaceManager

Single source of truth for the active workspace id. It watches the session context and switches the active Dexie database exactly once per workspace change.

## Purpose

`useWorkspaceManager()` returns `activeWorkspaceId` — a computed of the session's workspace id (or `null` for guests).

Behavior:

-   When the workspace changes, it calls `setActiveWorkspaceDb(newId)` — the only place session-driven database switching happens.
-   When the session becomes a signed-out or unsettled null, it checks `shouldClearWorkspaceForNullSession` before clearing, so transient states do not wipe local data.
-   A change token guards against out-of-order watcher runs.

Call it once per application lifecycle (for example in a plugin).

## Usage

```ts
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';

const { activeWorkspaceId } = useWorkspaceManager();

watchEffect(() => {
    console.log('Active workspace:', activeWorkspaceId.value);
});
```

## Notes

-   The module-level change token coordinates all instances, so duplicate setup does not double-switch.
-   Use `useWorkspaceManagerSession` for programmatic switches that must be confirmed by the server.

## Related

-   `useSessionContext` — the session data source.
-   `useWorkspaceManagerSession` — programmatic workspace switching.
-   `useWorkspaceManagerCache` — KV caching of workspace lists.
