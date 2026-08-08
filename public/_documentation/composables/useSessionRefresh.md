# useSessionRefresh

Client-only composable that periodically refreshes the provider session token so it stays valid.

## Purpose

`useSessionRefresh()` returns:

-   `startRefresh(intervalMs?)` — begin a periodic token refresh (default every 5 minutes). No-op if already running.
-   `stopRefresh()` — cancel the interval.

Each tick calls the auth token broker for a fresh provider token (Convex template by default). Failures are logged and do not stop the interval.

## Usage

```ts
import { useSessionRefresh } from '~/composables/auth/useSessionRefresh.client';

const { startRefresh, stopRefresh } = useSessionRefresh();

onMounted(() => startRefresh(10 * 60 * 1000));
onBeforeUnmount(() => stopRefresh());
```

## Notes

-   The interval is cleaned up automatically on unmount.
-   The refresh interval is a good place to align with your provider's token lifetime.

## Related

-   `useAuthTokenBroker` — supplies the actual provider tokens.
-   `useSessionContext` — session data this keeps valid.
