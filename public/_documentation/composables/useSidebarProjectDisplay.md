# useSidebarProjectDisplay

Computed view over sidebar datasets that decides what to render: threads, projects (with surviving entries), and documents, honoring the current search query.

## Purpose

`useSidebarProjectDisplay(options)` returns:

-   `displayThreads` — search results when a query is active, otherwise the full thread list.
-   `displayProjects` — projects whose entries still exist, filtered to matching entries while searching. Projects with no remaining entries are dropped.
-   `displayDocuments` — document search results, or `undefined` when documents are disabled or no query is active.

## Options

```ts
{
    sidebarQuery: Ref<string>;
    items: Ref<Thread[]>;                          // all threads
    projects: Ref<SidebarProject[]>;               // projects with data entries
    docs: Ref<Post[]>;                             // all documents
    threadResults: Ref<Thread[]>;
    projectResults: Ref<Array<{ id: string }>>;
    documentResults: Ref<Post[]>;
    documentsEnabled: Ref<boolean>;
}
```

## Usage

```ts
import { useSidebarProjectDisplay } from '~/composables/sidebar/useSidebarProjectDisplay';

const { displayThreads, displayProjects, displayDocuments } =
    useSidebarProjectDisplay({
        sidebarQuery: query,
        items: threads,
        projects,
        docs,
        threadResults,
        projectResults,
        documentResults,
        documentsEnabled,
    });
```

## Notes

-   Project entries referencing deleted threads or documents are pruned before rendering.

## Related

-   `useSidebarSearch` — the results feeding this view.
-   `useProjectTreeActions` — actions for the rendered rows.
