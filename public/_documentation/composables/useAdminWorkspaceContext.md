# useAdminWorkspaceContext

Global workspace selection state for admin pages. Super admins use it to pick which workspace they are operating on.

## Purpose

`useAdminWorkspaceContext()` returns:

-   `selectedWorkspaceId` — readonly ref of the selected workspace id (or `null`).
-   `selectedWorkspace` — readonly ref of the full selection `{ id, name, memberCount, ownerEmail? }`.
-   `selectWorkspace(workspace)` — set the selection.
-   `clearWorkspace()` — reset to `null`.
-   `hasWorkspace` — computed `true` when a workspace is selected.

State lives in Nuxt `useState` under the `admin-selected-workspace-*` keys, so all components share it. It is in-memory only; there is no persistence.

## Usage

```ts
import { useAdminWorkspaceContext } from '~/composables/admin/useAdminWorkspaceContext';

const { selectedWorkspaceId, selectWorkspace, hasWorkspace } =
    useAdminWorkspaceContext();

if (!hasWorkspace.value) {
    selectWorkspace({ id: 'ws-1', name: 'Acme', memberCount: 4 });
}
```

## Related

-   `useAdminWorkspaceGate` — drives the selector UI from this state.
-   `useAdminData` — `useAdminWorkspace` fetches data for the selected id.
