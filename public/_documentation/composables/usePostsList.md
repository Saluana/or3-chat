# usePostsList

Reactive listing of posts by type with a live Dexie query. It filters soft-deleted posts, sorts by timestamp, and parses `meta` from JSON.

## Purpose

`usePostsList(postType, opts?)` returns:

-   `items` — live-updating list of `PostData` (post records with parsed `meta`).
-   `loading` — `true` until the first query resolves.
-   `error` — last query error, if any.
-   `refresh()` — re-run the query.

Options:

```ts
{
    limit?: number;
    sort?: 'updated_at' | 'created_at'; // default 'updated_at'
    sortDir?: 'asc' | 'desc';           // default 'desc'
}
```

## Usage

```ts
import { usePostsList } from '~/composables/posts/usePostsList';

const { items, loading } = usePostsList('doc', { limit: 50 });
```

## Notes

-   Powered by Dexie `liveQuery`, so database changes update the list automatically.
-   SSR-safe: returns a static empty list on the server.

## Related

-   `~/db/posts` — the backing table and helpers.
-   `useDocumentsList` — a similar listing specialized for documents.
