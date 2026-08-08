# useWorkspaceLegacyImport

One-time migration helper that copies local (legacy) database data into a workspace-scoped database.

## Purpose

`useWorkspaceLegacyImport(baseDb)` returns:

-   `legacyStats` — counts of threads, messages, and projects in the base database.
-   `legacyHasData` — computed `true` when any legacy data exists.
-   `loadLegacyStats()` — recount the base database.
-   `importLocalData(activeWorkspaceId, options?)` — copy threads, messages, and projects from `baseDb` into the workspace database, then refresh stats and call `options.onImported`.

## Usage

```ts
import { useWorkspaceLegacyImport } from '~/composables/workspace/useWorkspaceLegacyImport';

const legacy = useWorkspaceLegacyImport(baseDb);

if (legacy.legacyHasData.value) {
    await legacy.importLocalData(activeWorkspaceId.value, {
        onImported: () => toast.success('Local data imported'),
    });
}
```

## Notes

-   This runs once when a user signs in and a workspace-scoped database is first created.
-   Stats failures are swallowed and default to zero.

## Related

-   `useWorkspaceManager` — the active database switch that triggers migration.
-   `~/db/client` — `getWorkspaceDb` used for the target.
