# Convex Provider (`or3-provider-convex`)

Dedicated install and wiring guide for the Convex sync/storage/backend provider package.

## What It Provides

- Convex sync provider (direct mode)
- Consistent materialized snapshot pages pinned to one server high-watermark
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
CONVEX_SELF_HOSTED_ADMIN_KEY=<server-only-admin-credential>
```

The server-only Convex admin credential is required whenever the Convex
provider backs auth/session resolution, background jobs, notifications,
webhooks, or rate limiting. Keep it out of public runtime config and browser
bundles.

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

## Super Admin Bridge (Deployment Admin Grants)

When using Clerk + Convex, there is an additional bridge used by the admin dashboard:

- Logging into `/admin/login` as super admin and having an active Clerk session can auto-grant that Clerk user deployment admin access.
- The grant is persisted in Convex (`admin_users`) and is not removed by admin logout.
- This is expected bootstrap behavior, not Clerk role assignment.

See the detailed behavior here: [admin-access-bridge](./admin-access-bridge).

## Direct API Authorization Guardrails

Convex functions still enforce authorization even when a caller bypasses the
Nuxt gateway and invokes the deployment directly:

- Identity-mapping and session-resolution functions are internal Convex
  functions, so direct public callers cannot enumerate them. The SSR auth store
  calls them with the Convex admin key and a subject-bound server identity.
- Public invite creation, listing, and revocation require workspace owner
  membership (the Convex enforcement of the `users.manage` capability). The
  inviter is derived from that authenticated membership.
- Invite consumption verifies the authenticated subject's normalized email and
  derives the accepting internal user ID; callers cannot provide either actor
  ID as an authoritative mutation argument.
- Sync reads accept owner, editor, and viewer memberships. Sync writes accept
  owners and editors, keeping viewers read-only.
- Sync GC entry points are internal-only, bounded, and require the verified
  `snapshot-v1` retention contract.
- Gateway object deletion verifies workspace membership, matches any supplied
  storage ID to canonical file metadata, refuses live references, and is a
  successful no-op when retried after deletion.
- Background-job persistence (including status reads and aborts), notification
  persistence, webhook definition/delivery storage, and rate-limit storage are
  internal Convex functions. Their SSR adapters use the admin credential;
  direct callers cannot supply job-owner wildcards, cross-user notification
  subjects, delivery-worker state, or rate-limit keys.
- Generic sync remains public for authenticated workspace members, but
  notification changes are owner-filtered on pull/watch and their `user_id` is
  derived from the authenticated internal user on push.

Trusted SSR provider calls authenticate with the Convex admin key and an
explicit server marker. Client JWTs do not receive that marker.

## Materialized Snapshot Pages

Direct and gateway sync expose the shared `SnapshotRequest` / `SnapshotResponse`
contract. The first page creates an expiring Convex snapshot session and captures
one workspace server-version high-watermark. Continuation tokens are opaque,
workspace- and table-filter-bound, and advance deterministic keyset scans across
the canonical materialized tables and tombstones.

Each request examines a bounded number of logical keys. Applied record
pre-images reconstruct the state at the original watermark if a row changes
between pages, so later writes do not enter the frozen page chain and remain
available to incremental pull strictly after the watermark. Notification rows
remain filtered to their authenticated owner. History retention runs only
through admin-authenticated internal mutations after the snapshot-plus-replay
gate.

## Canonical Storage Pages

The Convex sync gateway pages live materialized `file_meta` rows and reference
edges from `messages.file_hashes` and `posts.file_hashes` with opaque,
filter-bound cursors and a 500-record hard cap. Workspace quota and filesystem
blob lifecycle consume these views directly; retained `change_log` entries are
never used to infer liveness. Active reservation pages are an explicit empty
view until upload-intent persistence is enabled.

## Common Issues

### Provider not loaded

If sync/storage is configured as `convex` but package is missing:

`Configured provider "convex" expects package "or3-provider-convex", but it is not installed.`

Install the package or switch provider IDs.

### Convex URL missing

When Convex sync is enabled, `VITE_CONVEX_URL` is required in strict mode.

### Convex admin credential missing

Internal server persistence cannot be invoked without
`CONVEX_SELF_HOSTED_ADMIN_KEY`. Background jobs, notifications, and webhook
storage fail closed; the rate-limit provider uses its existing in-memory
fallback.

### Clerk not installed for Clerk auth + Convex

If `AUTH_PROVIDER=clerk` and Convex is active, install `or3-provider-clerk` so token broker registration exists.

## Related

- [providers](./providers)
- [provider-clerk](./provider-clerk)
- [admin-access-bridge](./admin-access-bridge)
- [sync-layer](./sync-layer)
- [storage-layer](./storage-layer)
- [or3-cloud-config](./or3-cloud-config)
