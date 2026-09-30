# Configure OR3

For a managed deployment, start with [Set up Cloud](/documentation/cloud/setup): the operator creates a coherent configuration and credentials for its fixed Basic Auth + SQLite + filesystem profile. The environment and source configuration described below is for contributors and advanced operators. Selecting other providers is an editable-source path.

## Two configuration objects

| Object | File | Responsibility |
|---|---|---|
| Base configuration | `config.or3.ts` | Branding, themes, UI defaults, feature switches, client limits, extension configuration |
| Cloud configuration | `config.or3cloud.ts` | SSR auth, provider selection, sync, storage, server limits, background execution, security |

Both use validated configuration builders. Read [Configuration reference](/documentation/cloud/config-reference) for every typed setting and [Environment reference](/documentation/cloud/environment-reference) for deployment variables and provider credentials. Those references are the detailed inventories; this page explains how to use them.

## Base settings

For an editable checkout, a small configuration can look like this:

```ts
// config.or3.ts
import { defineOr3Config } from './utils/or3-config';

export const or3Config = defineOr3Config({
    site: { name: 'My Chat', defaultTheme: 'retro' },
    features: { workflows: { enabled: false } },
});
```

Client code reads the resolved base settings through `useOr3Config()`. Theme IDs must exist in the theme registry. A feature flag configures a feature; it does not install its plugin package. Module IDs are build-time entries requiring installed packages, and default enabled-plugin IDs are seeded for new workspaces rather than overwriting existing choices. See [plugins](/documentation/plugins/overview) for package setup.

Base configuration can be delivered to the browser. Do not put secrets into branding, `extensions`, or `runtimeConfig.public`. Private provider credentials belong in server-only configuration.

## Enabling Cloud

SSR auth requires an auth provider **and** the selected sync backend's `AuthWorkspaceStore`. Turning sync transfer off does not remove the workspace-store dependency. Storage also needs its selected adapter. Configuration verifies required module entries, and strict startup checks registrations; missing providers do not silently turn Cloud into local-only mode.

The source wizard recommends Basic Auth + SQLite + filesystem storage, matching the managed profile. Low-level configuration builders retain Clerk/Convex provider-ID defaults for compatibility. These are different layers: an omitted low-level provider ID does not mean a managed deployment uses Clerk.

There is also a difference between typed and environment defaults:

- `defineOr3CloudConfig({})` defaults auth, sync, and storage to disabled; background storage defaults to memory.
- Environment-derived configuration enables sync and storage by default when SSR auth is enabled, unless their feature flags explicitly disable them.
- Environment-derived background storage inherits the sync provider when sync is enabled; otherwise it uses memory. The limits store defaults to Convex only with Convex sync, otherwise memory.

Do not infer an effective deployment from one flag. Review the source wizard's redacted configuration and use its validation/doctor checks.

## Environment precedence

Canonical variables take precedence over legacy aliases when both are set:

| Canonical | Alias |
|---|---|
| `OR3_AUTH_PROVIDER` | `AUTH_PROVIDER` |
| `OR3_CLOUD_SYNC_ENABLED` | `OR3_SYNC_ENABLED` |
| `OR3_CLOUD_STORAGE_ENABLED` | `OR3_STORAGE_ENABLED` |

The wizard may emit both for compatibility. Keep them consistent rather than changing just one. `SSR_AUTH_ENABLED` gates server auth; `OR3_CLOUD_ENABLED` is not a supported master switch.

Basic Auth needs bootstrap email/password as well as its JWT secret. Invite-only registration needs the invitation token secret. Filesystem storage needs a signing secret and a persistent root. Use the [source wizard](/documentation/cloud/or3-cloud-wizard) or complete provider guide instead of treating a partial environment fragment as a ready deployment.

## Build and runtime boundaries

Provider modules and ordinary extension modules are selected during Nuxt configuration. Provider configuration changes can require a rebuild and restart. Static output bakes client values into the build; editing an environment file after generation cannot change that output. Managed updates use the operator workflow and its exact image/assets rather than source rebuild commands.

Use `bun run generate:static` for static output. It disables SSR auth and skips cloud provider discovery and loading. Auth/database server SDKs must stay out of shared and client imports. A `.server.ts` application plugin is not proof that an SDK cannot reach a build through another import.

## Validate a source deployment

Use the [source wizard commands](/documentation/cloud/or3-cloud-wizard#commands) for config validation and doctor checks. Validation checks configuration; doctor additionally checks provider availability, generated metadata, paths, and ports. The managed `npx @or3/cloud doctor` checks the container deployment instead.

Changing auth or sync backends does not transfer existing identities, memberships, records, or blobs. Before any backend migration, retain verified backups, define the identity/data mapping, and prove the migration against an isolated copy. Keep the original backend available until verification is complete.

For permission behavior see [accounts and access](/documentation/cloud/auth-system); for provider selection see [Choose and wire providers](/documentation/cloud/providers).
