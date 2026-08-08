# useClientSessionRecovery

Client-side session recovery registry. Auth providers register a recovery callback (for example a silent refresh) that the session context invokes when `/api/auth/session` reports no session.

## Purpose

-   `registerClientSessionRecovery(recover)` — register a `ClientSessionRecovery` (`() => boolean | Promise<boolean>`). Returns whether recovery succeeded.
-   `recoverClientSession()` — invoke the registered callback. Returns `false` when none is registered.

The registry lives on `globalThis`, so it survives HMR and can be registered from provider plugins that load late.

## Usage

```ts
import { registerClientSessionRecovery } from '~/composables/auth/useClientSessionRecovery';

registerClientSessionRecovery(async () => {
    try {
        await provider.silentRefresh();
        return true;
    } catch {
        return false;
    }
});
```

## Notes

-   Only one recovery callback is stored; later registrations replace earlier ones.
-   `useSessionContext` calls `recoverClientSession()` once and retries the session fetch when it returns `true`.

## Related

-   `useSessionContext` — the caller.
-   `useClientAuthStatus` — reporting provider readiness.
