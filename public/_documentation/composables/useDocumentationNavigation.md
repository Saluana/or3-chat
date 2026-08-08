# useDocumentationNavigation

Sidebar navigation for the documentation viewer. It builds category/group/item trees from the docmap and tracks which groups are expanded.

## Purpose

`useDocumentationNavigation(routePath, navigationOverride)` returns:

-   `internalNavigation` — categories built from the docmap (when no override is provided).
-   `resolvedNavigation` — the override when set, otherwise the internal tree.
-   `expandedGroups` — set of expanded group keys.
-   `groupKey(category, group)` — stable key for a group.
-   `isGroupExpanded` / `setGroupExpanded` / `toggleGroup` — group expansion controls.
-   `expandGroupsForPath(path)` — expand groups that contain a path.
-   `applyDocmapNavigation(map)` — build the tree from a docmap object. Getting Started sorts first, files are sorted by name, and file categories become group labels.

## Usage

```ts
import { useDocumentationNavigation } from '~/composables/documents/useDocumentationNavigation';

const nav = useDocumentationNavigation(routePathRef, overrideRef);
nav.applyDocmapNavigation(docmap);
```

## Notes

-   The override is typically supplied by a theme that ships its own navigation.
-   The internal tree only builds once.

## Related

-   `useDocumentationContent` — page content for the selected path.
-   `public/_documentation/docmap.json` — the source data.
