# usePaginatedSidebarItems

Paged, searchable list of sidebar items (threads and documents) backed by Dexie live queries. It grows the result window as the user scrolls.

## Purpose

`usePaginatedSidebarItems(options)` returns:

-   `items` — unified sidebar items (`UnifiedSidebarItem[]`), most recently updated first.
-   `hasMore` — whether more items exist beyond the current window.
-   `loading` — `true` while a page is fetching.
-   `loadMore()` — double the result window and re-query.
-   `reset()` — reset to the first page.

Options:

```ts
{
    type?: 'all' | 'thread' | 'document'; // default 'all'
    query?: Ref<string>;                  // optional search filter
}
```

Items merge threads and documents and sort by `updatedAt` descending. The page size starts at `PAGE_SIZE` and doubles on each `loadMore`.

## Usage

```ts
import { usePaginatedSidebarItems } from '~/composables/sidebar/usePaginatedSidebarItems';

const { items, hasMore, loading, loadMore } = usePaginatedSidebarItems({
    type: 'thread',
});
```

## Notes

-   Client-only; Dexie is the data source.
-   Soft-deleted records are filtered out.

## Related

-   `useSidebarSearch` — full-text search over the same datasets.
-   `useThreadSearch` — single-domain search.
