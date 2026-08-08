# useAdminData

Client-side data fetch helpers for the admin dashboard. Each helper wraps `useFetch` against an admin API endpoint with `credentials: 'include'`.

## Helpers

| Helper | Endpoint | Description |
| ------ | -------- | ----------- |
| `useAdminSession()` | `/api/admin/auth/session` | Session kind and authentication flag. |
| `useAdminSystemStatus()` | `/api/admin/system/status` | Provider and system status. |
| `useAdminWorkspace(workspaceId?)` | `/api/admin/workspace` | Current workspace data (role, members). Pass a workspace id for super admin selection. |
| `useAdminExtensions()` | `/api/admin/extensions` | Installed plugin/theme/admin-plugin items. |
| `useAdminSystemConfig()` | `/api/admin/system/config` | Raw config key/value pairs. |
| `useAdminSystemConfigEnriched()` | `/api/admin/system/config/enriched` | Config entries with extra metadata. |
| `useAdminWorkspacesList()` | `/api/admin/workspaces` | All workspaces (super admin only), with retry. |

All calls run client-side only (`server: false`) to avoid hydration mismatches, and dedupe concurrent requests by key.

## Usage

```ts
import { useAdminWorkspace } from '~/composables/admin/useAdminData';

const { data: workspaceData, pending, error, refresh } = useAdminWorkspace();

watchEffect(() => {
    if (workspaceData.value) {
        console.log('Role:', workspaceData.value.role);
    }
});
```

## Notes

-   `useAdminWorkspace` delays fetching until the session is known; super admins must select a workspace first.
-   Results are cached in the Nuxt payload under `admin:*` keys.

## Related

-   `useAdminTypes` — the response shapes used here.
-   `useAdminAuth` — role derivations from the workspace response.
