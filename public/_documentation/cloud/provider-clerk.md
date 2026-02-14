# Clerk Provider (`or3-provider-clerk`)

Dedicated install and wiring guide for the Clerk auth provider package.

## What It Provides

- SSR auth middleware (`@clerk/nuxt`)
- Server auth provider registration
- Server `ProviderTokenBroker` registration
- Client auth token broker plugin for direct-mode providers

## Install

From npm:

```bash
bun add or3-provider-clerk
```

Local sibling package:

```bash
bun add or3-provider-clerk@link:../or3-provider-clerk
```

## Required Config

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
```

If you only want auth (no cloud sync/storage):

```bash
OR3_SYNC_ENABLED=false
OR3_STORAGE_ENABLED=false
```

## Runtime Registration

Main entrypoint:

- `or3-provider-clerk/nuxt`

Server registrations happen in:

- `src/runtime/server/plugins/register.ts`

This registers:

- `AuthProvider` for `clerk`
- `ProviderTokenBroker` for `clerk`
- Admin auth adapter

Client token broker plugin:

- `src/runtime/plugins/auth-token-broker.client.ts`

That plugin exposes tokens through `useAuthTokenBroker()` so other providers (for example Convex direct mode) can request template tokens without hardcoding Clerk SDK calls in core.

## Common Issues

### Provider not loaded

If auth is configured as `clerk` but package is missing, you will see:

`Configured provider "clerk" expects package "or3-provider-clerk", but it is not installed.`

Install the package or change `AUTH_PROVIDER`.

### Clerk env vars missing

In strict config mode, auth fails validation when Clerk keys are missing.

Set:

- `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NUXT_CLERK_SECRET_KEY`

## Related

- [providers](./providers)
- [provider-convex](./provider-convex)
- [auth-system](./auth-system)
- [or3-cloud-config](./or3-cloud-config)
