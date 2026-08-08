# useWorkspaceTabMetadata

Batch resolver for tab strip titles and icons. It refreshes one compact metadata map instead of creating a live database query for every open tab.

## Purpose

`useWorkspaceTabMetadata()` returns:

-   `metadata` — shallow-reactive map of tab id to `{ title, fullTitle, icon? }`.
-   `refresh(tabs)` — resolve titles for a list of tabs. Thread titles come from `db.threads`, document titles from `db.posts`, and app titles from the registered pane app. A generation counter discards stale results.
-   `titleFor(tab)` — synchronous lookup; falls back to the cached title or a kind-based default (`New chat`, `Untitled document`, app id).

## Usage

```ts
import { useWorkspaceTabMetadata } from '~/composables/core/useWorkspaceTabMetadata';

const metadata = useWorkspaceTabMetadata();
watch(tabs, (list) => void metadata.refresh(list));

// In the tab strip template:
{{ metadata.titleFor(tab).title }}
```

## Notes

-   Soft-deleted threads and documents are skipped and keep their fallback titles.
-   Refreshing deliberately avoids per-tab `liveQuery` subscriptions.

## Related

-   `useWorkspaceTabs` — the source of the tab list.
-   `usePaneApps` — app labels and icons used for app tabs.
