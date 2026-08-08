# useSessionContext

Workspace-aware session context. It fetches the full session payload from `/api/auth/session` and exposes reactive state plus a refresh action.

## Purpose

`useSessionContext()` returns:

-   `data` — computed `SessionPayload | null` where the payload is `{ session, appAccessAllowed }`.
-   `pending` — `true` while a refresh is in flight.
-   `error` — last error, if any.
-   `refresh()` — fetch the session again and return the payload.

Behavior:

-   When SSR auth is disabled, it returns static unauthenticated state and never hits the network.
-   On the server it hydrates via `useFetch`; on the client it uses `$fetch` with `cache: 'no-store'`.
-   Client refreshes are generation-guarded, so late responses never overwrite newer ones.
-   If the session is unauthenticated, `refresh()` asks the registered provider to recover (silent refresh) once and retries.

Module helpers:

-   `getCachedSessionContext()` — read the cached session without a network request. Safe from non-component utilities.
-   `refreshCachedSessionContext()` — refresh from non-component code.

## Usage

```ts
import { useSessionContext } from '~/composables/auth/useSessionContext';

const { data, pending, refresh } = useSessionContext();

async function afterLogin() {
    await refresh();
    const workspaceId = data.value?.session?.workspace?.id;
}
```

## Notes

-   This is the single source of truth for the active workspace id.
-   `useWorkspaceManager` watches it to switch the active Dexie database.

## Related

-   `useOr3Session` — a simpler projection of this state.
-   `useClientSessionRecovery` — provider recovery hook.
-   `useWorkspaceManager` — workspace switching on session change.
