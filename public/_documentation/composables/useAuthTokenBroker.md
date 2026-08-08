# useAuthTokenBroker

Client-side token broker registry. Auth providers register a factory that can mint provider-specific tokens (for example Convex JWTs), and app code requests them by provider id.

## Purpose

-   `registerAuthTokenBroker(factory)` — register an `AuthTokenBrokerFactory`. Provider packages call this during Nuxt plugin setup.
-   `useAuthTokenBroker()` — returns an `AuthTokenBroker` with `getProviderToken({ providerId, template? })`.

`AuthTokenBroker`:

```ts
interface AuthTokenBroker {
    getProviderToken(input: ProviderTokenRequest): Promise<string | null>;
}
```

Behavior:

-   Returns `null` when SSR auth is disabled.
-   Resolves the broker lazily, so late-registered providers are honored.
-   Falls back to a default broker returning `null` when no factory is registered.
-   Catches and logs errors, returning `null`.

## Usage

```ts
import { useAuthTokenBroker } from '~/composables/auth/useAuthTokenBroker.client';

const broker = useAuthTokenBroker();
const token = await broker.getProviderToken({
    providerId: 'convex',
    template: 'or3-jwt',
});
```

## Notes

-   Registration happens once per provider package; the registry lives on `globalThis`.
-   `useSessionRefresh` uses this broker to keep tokens fresh.

## Related

-   `useSessionRefresh` — periodic token refresh consumer.
-   `useClientAuthStatus` — sibling provider registry.
