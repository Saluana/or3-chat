# Cloud Providers: Install and Wiring

This guide covers how OR3 discovers provider packages, how to install them, and how the Clerk to Convex token bridge works.

For normal local or VPS operation, use the managed [`@or3/cloud`](/docs/installation)
operator. For editable source or custom providers, use the
[Cloud Source Wizard](./or3-cloud-wizard).

Use the [Environment and Provider Settings Reference](./environment-reference)
as the complete env-var matrix. The provider pages below then add provider-
specific installation and operational details.

## Provider Model

OR3 core is local-first and can run with zero cloud providers installed.

- `SSR_AUTH_ENABLED=false`: intentional local-only mode; no cloud provider packages are required.
- Providers installed: cloud surfaces are enabled by `config.or3cloud.ts` provider IDs.
- Module loading is config-driven: provider IDs map to `or3-provider-<id>/nuxt`. Nuxt resolves the actual import entry, including scoped package names and exports. Missing required server providers stop configuration instead of disabling authentication.

Example mapping:

- `auth.provider = "clerk"` -> `or3-provider-clerk/nuxt`
- `auth.provider = "basic-auth"` -> `or3-provider-basic-auth/nuxt`
- `sync.provider = "convex"` -> `or3-provider-convex/nuxt`
- `sync.provider = "sqlite"` -> `or3-provider-sqlite/nuxt`
- `storage.provider = "convex"` -> `or3-provider-convex/nuxt`
- `storage.provider = "fs"` -> `or3-provider-fs/nuxt`
- `connect.provider = "sqlite"` -> `or3-provider-sqlite/nuxt`
- `connect.provider = "convex"` -> `or3-provider-convex/nuxt`

OR3 Connect defaults to the sync provider through
`OR3_CONNECT_PROVIDER`, so the standard SQLite deployment does not need a
separate cloud database. Relay selection is independent and configured with
`OR3_CONNECT_RELAY_PROVIDER`.

## Install Providers

Install from npm:

```bash
bun add or3-provider-clerk
bun add or3-provider-convex
bun add or3-provider-basic-auth
bun add or3-provider-sqlite
bun add or3-provider-fs
bun add or3-provider-s3
```

### Local provider development

`bun run dev` and `bun run dev:ssr` automatically rebuild available sibling
`or3-provider-*` repositories and use their built Nuxt modules for that dev
process. Each provider prints its version and resolved local path. Restart the
dev command after editing provider source to rebuild it.

A missing sibling or failed build prints a warning and uses the installed
package instead. A failed local build is never selected merely because an old
`dist/` exists. Keep provider dependencies installed in each sibling repository
(`bun install`) so its build can run.

Set `OR3_LOCAL_PROVIDERS=false` to test installed packages only. CI defaults to
installed packages; `OR3_LOCAL_PROVIDERS=true` explicitly enables local builds
there. Direct `nuxt dev` invocations do not perform this preparation: use the
wrapper commands above. Production builds always resolve installed packages.

The wrapper passes `OR3_DEV_PROVIDER_MODULES` internally to its Nuxt child; do
not persist that generated map in `.env`. No dependency pins, lockfiles or
installed packages are rewritten by local provider selection.

## Configure Providers

### Local-only (no providers required)

```bash
SSR_AUTH_ENABLED=false
```

### Clerk auth with sync transfer disabled

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=clerk
OR3_SYNC_PROVIDER=sqlite
OR3_SYNC_ENABLED=false
OR3_STORAGE_ENABLED=false
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
```

SQLite still provides the authentication workspace store in this example;
disabling sync transfer does not remove that dependency.

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

### Default SSR stack (basic-auth + sqlite + fs)

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=basic-auth
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=fs
OR3_BASIC_AUTH_JWT_SECRET=replace-with-random-secret
OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=admin@example.com
OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=replace-with-strong-password
OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite
OR3_STORAGE_FS_ROOT=/srv/or3/.data/storage
OR3_STORAGE_FS_TOKEN_SECRET=replace-with-random-secret
```

The same stack can enable account-bound remote computers with:

```bash
OR3_CONNECT_ENABLED=true
OR3_CONNECT_PROVIDER=sqlite
OR3_CONNECT_RELAY_PROVIDER=cloudflare
```

See [OR3 Connect](./or3-connect) for the remaining relay and encryption values.

## Clerk to Convex Bridge

The bridge is token-broker based and split across provider packages:

1. `or3-provider-clerk` registers a client auth token broker in `runtime/plugins/auth-token-broker.client.ts`.
2. The same package registers a server `ProviderTokenBroker` in `runtime/server/plugins/register.ts`.
3. `or3-provider-convex` registers `runtime/plugins/convex-auth.client.ts`.
4. That plugin calls `useAuthTokenBroker().getProviderToken({ providerId: 'convex', template: 'convex' })`.
5. Convex client auth is set via `client.setAuth(getToken)`, and refreshed on session changes.

Result: Convex direct-mode clients and server gateway flows get provider tokens without hardcoding Clerk calls in core.

## Optional Provider Module List

The wizard writes data-only `or3.providers.generated.json`:

```json
{
  "schemaVersion": 1,
  "modules": ["or3-provider-basic-auth/nuxt", "or3-provider-sqlite/nuxt"]
}
```

The file can be absent or have an empty list: selected provider IDs still add their required modules. Scoped modules such as `@vendor/provider/nuxt` are supported. Put custom cloud modules in this list so static/offline mode can skip them without importing them. Ordinary extensions stay in the extension module list.

### Migrating the generated TypeScript file

Regenerate the list with the cloud source wizard, or copy the literal module IDs from `or3.providers.generated.ts` into the JSON shape above, preserving custom entries. Review the JSON before removing the old file. TypeScript metadata is never executed. An active cloud configuration with only the old file stops with migration instructions; if both exist, JSON wins and the old file is ignored with a warning. Invalid JSON is an error, not an empty provider list.

## Static Generation Boundary

`bun run generate:static` disables SSR auth and cloud provider module loading.
During that build, Nuxt does not read either generated-provider format, resolve
cloud providers, or add those modules to the build. Intentional offline mode also
skips provider discovery. Static generation with server authentication enabled
is rejected; use `bun run generate:static` for static output. This keeps
local-only static output independent from optional auth, database, and storage
runtime dependencies. Ordinary non-provider extension modules remain available.

## Troubleshooting

### Error: required provider entry cannot resolve

A requested server capability requires its actual module entry. A scope directory, sibling package, or package with a missing/unexported Nuxt entry does not count. Install or build the named provider and rebuild, or explicitly choose local-only operation with `bun run dev:offline`. Required module failures stop development and production configuration. Optional extension failures remain warnings.

Authentication also needs the selected sync backend's `AuthWorkspaceStore`, even when `OR3_CLOUD_SYNC_ENABLED=false` disables sync transfer. Install/configure that backend (including its connection URL when applicable). Strict server startup checks actual provider registrations independently of whether their module files resolved.

Configuration is normalized once for modules, feature decisions, and private/public runtime values. Public output includes only selected browser-safe fields; credentials and resolved local module paths stay private.

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
- [provider-basic-auth](./provider-basic-auth)
- [provider-sqlite](./provider-sqlite)
- [provider-fs](./provider-fs)
- [provider-s3](./provider-s3)
- [provider-compatibility-matrix](./provider-compatibility-matrix)
- [migration-default-stack](./migration-default-stack)
- [deployment-operations](./deployment-operations)
- [release-notes-production-readiness](./release-notes-production-readiness)
- [or3-cloud-config](./or3-cloud-config)
- [config-reference](./config-reference)
- [auth-system](./auth-system)
- [sync-layer](./sync-layer)
- [storage-layer](./storage-layer)
