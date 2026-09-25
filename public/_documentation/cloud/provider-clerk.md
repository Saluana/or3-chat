# Clerk Provider (`or3-provider-clerk`)

Dedicated install and wiring guide for the Clerk auth provider package.

## What It Provides

- SSR auth middleware (`@clerk/nuxt`)
- Server auth provider registration
- Server `ProviderTokenBroker` registration
- Client auth token broker plugin for direct-mode providers
- Client auth UI adapter for the sidebar rail and mobile More sheet

The mobile More sheet requests `layout="more-sheet"`, which renders Account or
Login as the same full-width row used by Connect and the System actions. The
signed-in Account row opens the Clerk user profile; rail usage keeps the compact
avatar trigger.

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
OR3_ALLOWED_ORIGINS=https://chat.example.com
```

Set `OR3_ALLOWED_ORIGINS` to the exact browser origin(s) served by this OR3
deployment, including scheme and port. Managed Cloud writes this value during
installation. A custom production deployment must set it or a valid
`OR3_PUBLIC_DOMAIN`; Clerk authentication fails closed with 503 if neither
defines an authorized party. Do not use another application's origin merely
because it shares the Clerk instance. Local development can use an explicit
origin such as `http://127.0.0.1:3000`.

Each request still verifies its Clerk session token. Verified primary-email
profile data is cached for up to 30 seconds per server process to keep sync
polling from fetching the full Clerk profile every time. Primary-email changes
can therefore take up to 30 seconds to be reflected; revoking the session token
is checked on the next request.

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

### Clerk test keys rejected in production

In production builds, the provider refuses to start with Clerk test keys.
Keys starting with `pk_test_` or `sk_test_` fail validation. Use live keys
for production instances.

### Session rejected despite a valid Clerk login

OR3 requires the Clerk user's primary email address to exist and have
verification status `verified`. An absent or unverified primary email is not
accepted for email-bound workspace provisioning or invitations.

## Related

- [providers](./providers)
- [provider-convex](./provider-convex)
- [auth-system](./auth-system)
- [or3-cloud-config](./or3-cloud-config)
