# useSession

Client-side session state composable (exported as `useOr3Session`). It exposes a small, stable session surface regardless of whether SSR auth is enabled.

## Purpose

`useOr3Session()` returns:

-   `isSignedIn` — `true` when the session is authenticated.
-   `isLoaded` — `false` while the session is still loading.
-   `userId` — the internal user id, or `null`.
-   `sessionId` — always `null` today (not surfaced by the API).

When SSR auth is disabled, it returns static unauthenticated state and never touches the network.

## Usage

```ts
import { useOr3Session } from '~/composables/auth/useSession';

const { isSignedIn, isLoaded, userId } = useOr3Session();

watchEffect(() => {
    if (isLoaded.value) {
        console.log('User', userId.value, isSignedIn.value ? 'signed in' : 'guest');
    }
});
```

## Notes

-   Named `useOr3Session` to avoid colliding with Clerk's `useSession`.
-   Backed by `useSessionContext`; the module-level static refs are reused when auth is off.

## Related

-   `useSessionContext` — the full session payload with workspace info.
