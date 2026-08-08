# useClientAuthStatus

Client-side auth status resolver registry. Provider packages register a resolver that reports whether their SDK is ready and whether a user session exists.

## Purpose

-   `registerClientAuthStatusResolver(resolver)` — register a `ClientAuthStatusResolver` returning `{ ready: boolean; authenticated: boolean | undefined }` (or a promise of it).
-   `resolveClientAuthStatus()` — call the registered resolver. Returns `{ ready: true, authenticated: undefined }` when none is registered.

The registry lives on `globalThis` so provider plugins can register late and survive HMR.

## Usage

```ts
import { registerClientAuthStatusResolver } from '~/composables/auth/useClientAuthStatus.client';

registerClientAuthStatusResolver(() => ({
    ready: provider.isLoaded(),
    authenticated: provider.isSignedIn() || undefined,
}));
```

## Notes

-   Only one resolver is stored; the last registration wins.
-   `authenticated: undefined` means "unknown" rather than signed out.

## Related

-   `useSessionContext` — the session source of truth.
-   `useAuthTokenBroker` — sibling provider registry for tokens.
