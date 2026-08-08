# useWorkspaceManagerCache

KV-backed cache for workspace lists. It stores workspace summaries plus the active id so workspace switching can render instantly before a fetch completes.

## Purpose

`useWorkspaceManagerCache(baseDb, cacheKey)` returns:

-   `cachedWorkspaces` — ref of cached `WorkspaceSummary[]` (each flagged `isActive`).
-   `cachedActiveId` — ref of the cached active workspace id.
-   `loadCache()` — read and parse the KV entry; corrupt data resets to empty.
-   `saveCache(list)` — persist the list; the active id is derived from the entry with `isActive: true`.

## Usage

```ts
import { useWorkspaceManagerCache } from '~/composables/workspace/useWorkspaceManagerCache';

const cache = useWorkspaceManagerCache(baseDb, 'workspaces.v1');
await cache.loadCache();
// render from cache, then replace with fresh data:
await cache.saveCache(freshList);
```

## Notes

-   Storage uses `setKvByName` / `getKvByName` from `~/db/kv`.
-   Read failures are non-fatal.

## Related

-   `useWorkspaceManager` — the active workspace source.
-   `~/db/kv` — the backing key-value table.
