# useAdminUserLookup

Search helper for finding users in the admin dashboard. It queries `/api/admin/search-users` and guards against out-of-order responses.

## Purpose

`useAdminUserLookup()` returns:

-   `results` — matching users (`Ref<AdminLookupUser[]>`), where a user is `{ userId, email?, displayName? }`.
-   `isSearching` — `true` while a request is in flight.
-   `hasSearched` — `true` once a non-empty query has been run.
-   `searchUsers(query, options?)` — run a search. Empty queries clear the results.
-   `clearResults()` — reset the result list.

Options for `searchUsers`:

-   `mapResult` — transform each returned user.
-   `onError` — error callback.

A sequence token discards stale responses, so fast typing always shows the latest result.

## Usage

```ts
import { useAdminUserLookup } from '~/composables/admin/useAdminUserLookup';

const { results, isSearching, searchUsers } = useAdminUserLookup();

async function onInput(query: string) {
    await searchUsers(query);
}
```

## Notes

-   Client-side only; sends `credentials: 'include'`.

## Related

-   `useAdminData` — other admin API fetches.
-   `useAdminWorkspaceContext` — selecting the workspace a lookup applies to.
