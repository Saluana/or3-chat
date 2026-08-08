# useWorkspaceTabPersistence

Local storage layer for the workspace tab session. It writes the tab manifest to `localStorage` per workspace and profile, debounced, and reads it back on restore.

## Purpose

The composable returns:

-   `key()` — the active storage key.
-   `snapshot()` — build a `WorkspaceTabsSnapshotV1` from the current state.
-   `schedule()` — debounce a write (default 180ms).
-   `flush()` — write immediately (also called on `pagehide`).
-   `restore()` — read the snapshot for the current workspace/profile scope.
-   `switchScope(workspaceId, profileId)` — flush, move to the new scope key, and read its snapshot.

Storage keys look like `or3:workspace-tabs:v1:<workspace>:<profile>` (`local` and `default` are the fallbacks). Snapshot reads run through a schema migration.

## Usage

```ts
import { useWorkspaceTabPersistence } from '~/composables/core/useWorkspaceTabPersistence';

const persistence = useWorkspaceTabPersistence({
    state,                                  // Ref<WorkspaceTabsState>
    paneIds: () => panes.value.map(p => p.id),
    workspaceId: () => workspaceId.value,
    profileId: () => profileId.value,
});

persistence.schedule(); // after each state commit
persistence.flush();    // before navigating away
```

## Options

| Option | Description |
| ------ | ----------- |
| `state` | Ref of the tab session state to persist. |
| `paneIds` | Getter for the visible pane ids. |
| `workspaceId` / `profileId` | Scope getters. |
| `storage` | Optional custom storage (`getItem`/`setItem`); defaults to `window.localStorage`. |
| `debounceMs` | Debounce delay (default 180). |

## Notes

-   SSR-safe: without storage the composable no-ops.
-   Writes are debounced so normal tab switching never synchronously touches storage.

## Related

-   `useWorkspaceTabs` — the session that uses this persistence layer.
-   `useWorkspaceTabDrafts` — drafts are not persisted here.
