# Cloud Providers: Install and Wiring

This guide covers how OR3 discovers provider packages, how to install them, and how the Clerk to Convex token bridge works.

## Provider Model

OR3 core is local-first and can run with zero cloud providers installed.

- No providers installed: local-only mode (no SSR auth, sync, or cloud storage).
- Providers installed: cloud surfaces are enabled by `config.or3cloud.ts` provider IDs.
- Module loading is config-driven: Nuxt maps provider IDs to `or3-provider-<id>/nuxt` and only loads installed packages.

Example mapping:

- `auth.provider = "clerk"` -> `or3-provider-clerk/nuxt`
- `sync.provider = "convex"` -> `or3-provider-convex/nuxt`
- `storage.provider = "convex"` -> `or3-provider-convex/nuxt`

## Install Providers

Install from npm:

```bash
bun add or3-provider-clerk
bun add or3-provider-convex
```

Or local sibling packages during development:

```bash
bun add or3-provider-clerk@link:../or3-provider-clerk
bun add or3-provider-convex@link:../or3-provider-convex
```

## Configure Providers

### Local-only (no providers required)

```bash
SSR_AUTH_ENABLED=false
```

### Clerk auth only

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
OR3_SYNC_ENABLED=false
OR3_STORAGE_ENABLED=false
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
```

### Clerk + Convex (full cloud path)

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=convex
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=convex
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
VITE_CONVEX_URL=https://<deployment>.convex.cloud
```

Then run:

```bash
bun run type-check
```

## Clerk to Convex Bridge

The bridge is token-broker based and split across provider packages:

1. `or3-provider-clerk` registers a client auth token broker in `runtime/plugins/auth-token-broker.client.ts`.
2. The same package registers a server `ProviderTokenBroker` in `runtime/server/plugins/register.ts`.
3. `or3-provider-convex` registers `runtime/plugins/convex-auth.client.ts`.
4. That plugin calls `useAuthTokenBroker().getProviderToken({ providerId: 'convex', template: 'convex' })`.
5. Convex client auth is set via `client.setAuth(getToken)`, and refreshed on session changes.

Result: Convex direct-mode clients and server gateway flows get provider tokens without hardcoding Clerk calls in core.

## Optional Manual Module List

`or3.providers.generated.ts` is still supported and can be used to force specific Nuxt modules.

- Default can be empty.
- Config-driven discovery still auto-adds installed providers based on selected IDs.

## Troubleshooting

### Warning: provider package not installed

If config selects a provider but the package is missing, Nuxt logs a warning like:

`Configured provider "clerk" expects package "or3-provider-clerk", but it is not installed.`

Install the package or change provider IDs in cloud config/env.

### Auth enabled but no auth provider package

- Set `SSR_AUTH_ENABLED=false` for local-only mode, or
- Install the selected auth provider package.

### Convex selected but sync/storage fail

- Confirm `VITE_CONVEX_URL` is set.
- Confirm `or3-provider-convex` is installed.
- Confirm `or3-provider-clerk` is installed when using Clerk auth with Convex token templates.

## Related

- [provider-clerk](./provider-clerk)
- [provider-convex](./provider-convex)
- [or3-cloud-config](./or3-cloud-config)
- [config-reference](./config-reference)
- [auth-system](./auth-system)
- [sync-layer](./sync-layer)
- [storage-layer](./storage-layer)
