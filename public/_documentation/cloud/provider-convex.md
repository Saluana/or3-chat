# Convex Provider (`or3-provider-convex`)

Dedicated install and wiring guide for the Convex sync/storage/backend provider package.

## What It Provides

- Convex sync provider (direct mode)
- Convex storage provider
- Server sync gateway adapter
- Server storage gateway adapter
- Server auth workspace store
- Convex-backed rate limiting, background jobs, and notification emitter

## Install

From npm:

```bash
bun add or3-provider-convex
```

Local sibling package:

```bash
bun add or3-provider-convex@link:../or3-provider-convex
```

## Required Config

```bash
SSR_AUTH_ENABLED=true
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=convex
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=convex
VITE_CONVEX_URL=https://<deployment>.convex.cloud
```

For Clerk + Convex, you also need Clerk provider config:

```bash
AUTH_PROVIDER=clerk
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
```

## Convex Backend Init

Copy templates into the host:

```bash
cp -r node_modules/or3-provider-convex/templates/convex ./convex
```

Generate Convex artifacts:

```bash
bunx convex dev --once
```

This creates `convex/_generated/` used by the Convex backend path.

## Runtime Registration

Main entrypoint:

- `or3-provider-convex/nuxt`

Server registrations happen in:

- `src/runtime/server/plugins/register.ts`

Client plugins:

- `src/runtime/plugins/convex-auth.client.ts`
- `src/runtime/plugins/convex-sync.client.ts`
- `src/runtime/plugins/convex-storage.client.ts`

## Clerk ↔ Convex Bridge

Direct Convex auth uses token broker flow:

1. Clerk provider registers a client auth token broker.
2. Convex auth plugin requests `providerId: 'convex', template: 'convex'`.
3. Convex client gets auth via `client.setAuth(getToken)`.

This keeps Clerk-specific token minting out of core sync/storage code.

## Common Issues

### Provider not loaded

If sync/storage is configured as `convex` but package is missing:

`Configured provider "convex" expects package "or3-provider-convex", but it is not installed.`

Install the package or switch provider IDs.

### Convex URL missing

When Convex sync is enabled, `VITE_CONVEX_URL` is required in strict mode.

### Clerk not installed for Clerk auth + Convex

If `AUTH_PROVIDER=clerk` and Convex is active, install `or3-provider-clerk` so token broker registration exists.

## Related

- [providers](./providers)
- [provider-clerk](./provider-clerk)
- [sync-layer](./sync-layer)
- [storage-layer](./storage-layer)
- [or3-cloud-config](./or3-cloud-config)
