# useWorkspaceManagerSession

Programmatic workspace switching with server confirmation. It coordinates a revision coordinator so only the newest switch wins, even when multiple tabs act at once.

## Purpose

`useWorkspaceManagerSession(sessionContext, options?)` returns:

-   `changeActiveWorkspace(workspaceId, setActiveWorkspace)` — switch workspaces and confirm the server reflects it. Returns `{ committed, revision }`. Superseded changes are repaired by re-applying the newest revision.
-   `refreshSessionUntilWorkspace(workspaceId, isCurrent?)` — refresh the session until the expected workspace appears.
-   `refreshSessionAfterWorkspaceRemoval(removedWorkspaceId)` — refresh until the removed workspace is gone.
-   `refreshSessionForActiveWorkspaceRevision(revision)` — refresh until a revision's workspace and authorization match.
-   `repairSupersededWorkspaceChange(staleRevision, setActiveWorkspace)` — re-apply the winning revision.
-   `publishCurrentActiveWorkspaceRevision()` — broadcast the current state to the coordinator.
-   `notifyOtherTabsAuthSessionChanged()` — write a localStorage signal other tabs watch.
-   `shouldClearWorkspaceForNullSession` — re-exported guard helper.

Options: `authSessionStorageKey` (default `or3:auth-session-changed`), `revisionCoordinator`, and `delaysMs` (default `[0, 100, 200, 400, 800]`).

## Usage

```ts
import { useWorkspaceManagerSession } from '~/composables/workspace/useWorkspaceManagerSession';

const session = useWorkspaceManagerSession(sessionContext);

const { committed } = await session.changeActiveWorkspace(
    'ws-123',
    async (id) => await api.switchWorkspace(id)
);
if (!committed) toast.warn('Another workspace switch superseded this one');
```

## Notes

-   Failing to confirm a switch throws `'Server did not confirm the active workspace switch'`.
-   Intended for provider adapters and admin tooling, not routine UI.

## Related

-   `useWorkspaceManager` — reactive session-driven switching.
-   `useSessionContext` — the session source.
