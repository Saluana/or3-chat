# useAdminTypes

Type definitions shared by the admin dashboard API responses. These are types only — no runtime code.

## Types

| Type | Description |
| ---- | ----------- |
| `ProviderStatus` | A single provider's health: id, name, ready, and optional details. |
| `ProviderAction` | An action available for a provider (e.g. restart, migrate). |
| `SystemStatus` | Aggregated system health: providers, config, and environment. |
| `StatusResponse` | Response shape of `/api/admin/system/status`. |
| `ConfigEntry` | Raw config entry: key and value. |
| `EnrichedConfigEntry` | Config entry plus metadata (category, description, safety). |
| `ConfigGroup` | Grouping of config entries for the UI. |
| `WorkspaceResponse` | Workspace payload: id, name, role, and members. |

## Usage

```ts
import type { WorkspaceResponse } from '~/composables/admin/useAdminTypes';

function renderRole(workspace: WorkspaceResponse | null) {
    return workspace?.role ?? 'unknown';
}
```

## Notes

-   These types are the contract between the admin pages and the server API.
-   Use them with `useAdminData` helpers for fully typed fetches.

## Related

-   `useAdminData` — the fetch helpers returning these shapes.
-   `useAdminAuth` — role derivations over `WorkspaceResponse`.
