# useAdminAuth

Role-based permission helpers for admin pages. It derives computed booleans from the workspace role returned by the admin API.

## Purpose

`useAdminAuth(workspaceData)` takes the `WorkspaceResponse` ref from `useAdminWorkspace()` and returns:

-   `role` — the current workspace role (`ComputedRef<string | undefined>`).
-   `isOwner` — `true` when the role is `owner`.
-   `isEditor` — `true` for `owner` or `editor`.
-   `canManage` — `true` when `isOwner` (management actions are owner-only).

`useAdminWorkspaceAuth()` is a convenience that fetches the workspace data itself and combines it with `useAdminAuth`.

## Usage

```ts
import { useAdminWorkspaceAuth } from '~/composables/admin/useAdminAuth';

const { role, isOwner, isEditor, canManage } = useAdminWorkspaceAuth();
```

## Notes

-   The data source is the `/api/admin/workspace` endpoint via `useFetch`.
-   Use these flags to gate UI and pass them to `useExtensionManagement` / `useServerRestart`.

## Related

-   `useAdminData` — the workspace fetch helpers.
-   `useExtensionManagement` — owner-gated install/uninstall.
-   `useServerRestart` — owner-gated restart.
