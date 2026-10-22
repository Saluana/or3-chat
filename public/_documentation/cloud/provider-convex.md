# Convex Provider (`or3-provider-convex`)

Dedicated install and wiring guide for the Convex sync/storage/backend provider package.

Managed installations use the fixed profile in [Set up Cloud](/documentation/cloud/setup). The install commands and manual settings below are for editable source deployments; install only the providers your source configuration selects.

## What It Provides

Dashboard restarts support Convex background jobs when both the provider artifact
and its deployed backend include `getShutdownBlockerCount`. Its internal query
includes parked work and pending history delivery, uses indexed existence checks
without loading full pages of response snapshots,
and never treats a failed lookup as idle. Keep the generated backend and provider
contract together; a dashboard restart does not deploy backend changes. See
[background execution](/documentation/cloud/background-execution#dashboard-restart-admission).

History delivery and cleanup batches are bounded by bytes as well as rows, so
large retained snapshots do not prevent recovery. Source scaffolds require
Convex SDK 1.31.7 or newer for the size-accounting helper.

- Convex sync provider (direct mode)
- Consistent materialized snapshot pages pinned to one server high-watermark
- Convex storage provider
- Server sync gateway adapter
- Server storage gateway adapter
- Server auth workspace store
- Convex-backed rate limiting, background jobs, notification emitter, and webhook store
- OR3 Connect persistence store (when Connect uses the Convex provider)
- Deployment admin checker (verifies `admin_users` grants in Convex)
- Private workspace host settings with atomic compare-and-set (plugin
  enablement, consent, access policy, setup revisions, AI spend ledger)
- Private plugin connection credentials and revision-bound test evidence

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

For a local/self-hosted Convex endpoint, set
`OR3_CONVEX_ALLOW_INSECURE_HTTP=true` only when the URL is intentionally
`http://`. Production Convex URLs must use HTTPS. If using the wizard, Convex
backend-only values such as `CLERK_ISSUER_URL` and the shared
`OR3_ADMIN_JWT_SECRET` are written with `bunx convex env set`.

The server-only Convex admin credential is required whenever the Convex
provider backs auth/session resolution, storage, plugin connections, background
jobs, notifications, webhooks, or rate limiting. Keep it out of public runtime
config and browser bundles.

For Clerk + Convex, you also need Clerk provider config:

```bash
AUTH_PROVIDER=clerk
NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
NUXT_CLERK_SECRET_KEY=sk_...
```

## Convex Backend Init

The supported scaffold command (used by the wizard and `doctor` preflight) is:

```bash
bunx or3-provider-convex init
```

It installs the provider-owned templates into `./convex` and records their
hashes in `.or3/convex-templates.json`. Custom functions and generated
declarations are kept separate from provider ownership.

Generate Convex artifacts:

```bash
bunx convex dev --once
```

This creates `convex/_generated/` used by the Convex backend path. Keep the scaffolded `convex/tsconfig.json`; it ensures `convex dev --typecheck enable` actually checks the Convex functions.

### Automatic source updates

After updating the source and its installed dependencies, start OR3 normally:

```bash
bun run dev
# Or, after an offline production build:
bun run preview
```

These source launchers verify the live Convex backend before starting OR3. If
its bundled backend changed, the launcher updates untouched scaffold files,
deploys them, and verifies the actual backend code digest. Later starts skip
deployment. Builds, typechecks and static generation never deploy remotely.

Configure a server-only deployment credential once: `CONVEX_DEPLOY_KEY` for
this exact Convex Cloud deployment, or `CONVEX_SELF_HOSTED_ADMIN_KEY` for
self-hosting. The app URL, `VITE_CONVEX_URL`, is the explicit target. If
`CONVEX_SELF_HOSTED_URL` is present, it must match. CLI login state cannot
silently select another project. Deployment-side environment variables such as
`CLERK_ISSUER_URL` remain unchanged. Keep credentials out of public config.

Untouched `or3-provider-convex@0.0.12` scaffolds are adopted automatically.
Subsequent upgrades use the recorded file hashes. A customized or locally
deleted provider file stops the update before any files change, with a list to
merge deliberately. Custom functions and `convex/_generated/` are preserved.
Previous source is saved under `.or3/convex-backups/`; keep it until acceptance.
This source backup does not back up the remote database.

A failed deploy prevents app startup. Retry after correcting the error; the
launcher checks the live backend again. An older checkout never automatically
pushes older backend code over a newer incompatible deployment. A checkout
lease prevents concurrent updates and recovers a dead owner. For a backend
shared by multiple hosts, designate one updater.

The provider also verifies its backend at Nitro startup before registering
persistence services. Custom process managers must run the installed provider
command `or3-provider-convex deploy` with the deployment environment loaded
before starting Nitro. The normal source launchers do this for you. A bare
Nitro restart checks compatibility and never performs a deployment.

`or3Backend:version` is a public query returning only the provider version and
backend code digest. It exposes no records or credentials. Rollback of the app
does not roll back Convex data or code automatically; select a compatible app
version and review an intentional backend rollback separately.

### Older or customized backends

Earlier templates may require a deliberate merge of schema, sync, storage,
workspace cleanup and host-settings changes. `init --update` refuses conflicts
before changing anything. Merge the provider-owned files before using the
source launcher; do not use a force reset as an upgrade shortcut.

## Private Host Settings

Marketplace enforcement state (`plugins.enabled`, `plugins.grants.*`,
`plugins.settings.*`, `plugins.stateVersion.*`, `plugins.ai-budget.*`, and
`admin.guest_access.enabled`) lives in the private `host_settings` table, not
the client-syncable `kv` table. It is excluded from sync push/pull, snapshots,
and `change_log`, and Convex sync rejects writes to those reserved key families
in `kv`.

The Convex `hostSettings` functions are deployment-internal and accept only a
trusted host-server identity (admin key plus the `or3_server` marker), so a
workspace editor's own token can never mutate enforcement state. The OR3 host
route stays the business authorization boundary: normal workspace owners and
editors use plugins without deployment-admin membership.

Legacy migration is explicit. `getLegacyWorkspaceSetting` exposes old `kv`
values, and the host policy copies only user setup values and the AI spend
ledger (byte-for-byte, preserving an active window). Plugin authority, consent
reviews, access policy, migration state, and guest access are never copied and
require fresh trusted writes/approval. See
[Plugin access policy](/documentation/cloud/plugin-access-gating) for the consent model.

## Persistent provider services

Plugin connections use private Convex tables for encrypted credential records,
revision compare-and-set updates, and revision-bound test evidence. Only trusted
host-server calls can use these internal functions; browser tokens cannot read
credentials. Workspace removal clears its connection records and evidence.
Deploy the matching schema and `pluginConnections.ts` with the rebuilt provider.

Rate limits and background jobs can select Convex independently of workspace
sync or storage. Selecting either activates URL and backend compatibility checks.
Configured Convex rate limits require the admin credential and backend; failures
return an error rather than granting requests through process-local counters.
Background admission recovery uses a user-bound idempotency-key lookup.

Bounded retained-metadata queries advertise `retainedStorageMetadata: 'v1'` and
read deleted materialized file rows for accounting; unknown sizes stay unknown.
This contract does not authorize physical cleanup for external storage.

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

See the detailed behavior here: [Deployment administration](/documentation/cloud/auth-system#deployment-administration).

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
- Direct and gateway sync writes enforce the shared 256 KB serialized payload
  ceiling for each operation.
- Sync GC entry points are internal-only, bounded, and require the verified
  `snapshot-v1` retention contract.
- Native storage signing, commit, cancellation, deletion, and GC are
  internal-only. The browser uses the host storage gateway, which enforces
  file admission, quota configuration, and admin-only GC before dispatch.
  Update the matching backend functions with the provider package.
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

When available, **Operations → Maintenance** names these tools **Clear old sync
history** and **Clear old deletion history**. Their descriptions explain the
retention period and device requirements; neither empties Trash or removes stored
files. **Remove unused files** describes the separate permanent file cleanup
action. Card descriptions wrap fully on narrow screens.

## Canonical Storage Pages

The Convex sync gateway pages live materialized `file_meta` rows and reference
edges from `messages.file_hashes` and `posts.file_hashes` with opaque,
filter-bound cursors and a 500-record hard cap. Workspace quota, filesystem
garbage collection, and blob lifecycle consume these views directly; retained
`change_log` entries are never used to infer liveness. Active reservation pages
read persisted, unexpired upload intents. Gateway clients advertise the typed
file-kind `v1` capability; the host returns HTTP
426 with update guidance before a generic file record crosses an older reader
or writer boundary.

Convex download URLs are issued only for a workspace member whose canonical
`file_meta` row is live and has a storage ID. Soft-deleted or pending metadata
returns no URL, including when an older bare SHA-256 hash form is requested.
Downloads stream through an authenticated host route with user-bound signed
URLs (five-minute default, fifteen-minute maximum). Each request rechecks the
session, workspace membership, and canonical file identity, and applies the
canonical MIME, disposition, sanitized filename, and private/no-store headers.
Downloads require the server-only admin credential. Deploy the matching
`storage.ts` backend: `storage:getFileUrl` is now internal-only, and permanent
native Convex URLs are never returned to the browser.

Workspace backups use separate server-only `sync:backupSnapshot` and
`storage:getBackupFileUrl` functions to include retained Trash originals.
Backup continuations are bound to their frozen watermark and mode; normal
sync continues to return tombstones. Each original read checks current
membership and the exact snapshot workspace/hash/storage ID, including after
opening the stream. Missing or replaced bytes fail the archive. Backup reads
never mutate or delete source files or unfinished uploads. Upgrade the provider
artifact and deploy its matching schema, sync, storage and snapshot templates;
older runtimes/backends fail closed. No extra dashboard setting is needed.
Native writes advance past existing record and retained tombstone revisions.
Frozen backups keep their prior metadata, while fresh backups select the latest
committed original after synced edits or repeated uploads.

Native URLs issued by older provider builds remain usable until the stored file
is deleted; upgrading the provider does not revoke those historical links. See
[Convex's file storage security model](https://docs.convex.dev/file-storage/overview).

## Workspace Files, Trash, and storage deletion

`or3-provider-convex@0.0.10` adds workspace-item capability v1 to direct and
gateway sync. Upgrade the provider and merge the matching scaffold using
`init --update`; deploy the schema, sync, storage, workspace cleanup,
`workspaceItemCapability.ts`, and `storageDeletion.ts` together before running
the updated client. Older argument validators reject the new capability field.
Legacy clients receive update guidance when workspace-item semantics cross the
sync boundary.

Native storage writes and cleanup require an owner or editor. Deletion and GC
retain a private hash claim until a verified re-upload; sync refuses to restore
references to collected bytes or stale native storage IDs, including legacy
metadata without a storage provider ID. The gateway refuses cleanup when the
backend does not advertise deletion coordination. Filesystem storage paired
with Convex sync cannot join this transaction and remains fail closed for
coordinated cleanup.

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
storage and rate-limit enforcement fail closed. Select the `memory` limits
provider explicitly when process-local counters are intended.

### Clerk not installed for Clerk auth + Convex

If `AUTH_PROVIDER=clerk` and Convex is active, install `or3-provider-clerk` so token broker registration exists.

## Instance signup invitations

The updated provider implements the five atomic signup-invite methods and the optional server-only `findSignupInviteByTokenHash` lookup on the existing AuthWorkspaceStore. Short codes use the existing indexed `token_hash` field with an HMAC hash; lookup returns only a pending invitation’s ID, email, and expiry to the trusted host. No raw code is stored or returned in history. A separate additive signup-invite table keeps email, hashed proof, millisecond timestamps, admin actor, and an identity-bound acceptance receipt. Lists omit token material, paginate at most 100 rows, and derive expired status. Pending receipts expire from retention 90 days after invitation expiry; accepted/revoked receipts are retained 90 days after that transition. Create/list cleanup deletes at most 100 eligible records per call.

An invalid history cursor returns HTTP 400 (`Invalid invite cursor`). Restart pagination without a cursor to fetch the first page. Other backend failures remain server/service errors.

Acceptance atomically creates the canonical user, provider mapping, private workspace, recipient-only owner membership, active workspace pointer, and consumed receipt. Same-identity retry returns the committed result without changing active selection or recreating data. Existing canonical accounts cannot redeem a signup invite into another private workspace; use team invites for sharing.

Convex uses one trusted internal mutation through the existing SSR bridge. Deploy the matching updated backend functions with the rebuilt provider; missing signup functions return an explicit unavailable response. Do not bypass backend digest/version upgrade checks. Qualification uses a disposable backend, not a production deployment.

Email uniqueness uses the `users.normalized_email` index. The SSR provider backfills legacy rows in transactions of at most 100 users before creating, validating, or accepting a signup invitation. Progress persists across interruptions; the first call on a large installation can take longer and retries resume completed work. Acceptance refuses until all legacy rows are indexed, so mixed-case addresses cannot bypass uniqueness during migration. Built-in user creation maintains the index; custom writers must store the trimmed lowercase email, or an empty string when no email is available. The disposable signup qualification covers 33,000 legacy users and a duplicate near the end of the backfill.

This feature requires provider artifacts built from the updated source. Normal deployment updates follow the [Cloud update guide](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-updates.md).

## Related

- [Choose and wire providers](/documentation/cloud/providers)
- [Clerk](/documentation/cloud/provider-clerk)
- [Deployment administration](/documentation/cloud/auth-system#deployment-administration)
- [Sync internals](/documentation/cloud/sync-layer)
- [Storage internals](/documentation/cloud/storage-layer)
- [Configure OR3](/documentation/cloud/configure)

## Provider template development

Persistent Projects reuses opaque internal posts and workspace-scoped original/extraction references. The project-aware `readChatHistory` scaffold resolves explicit and legacy folder membership inside its authorized transaction and returns `project_ownership: resolved | conflict`; the adapter declares `capabilities.projectOwnership: 'v1'`. The host refuses server-owned execution for project or conflicting chats, and for unresolved ownership when the provider declares the contract. Older providers keep ordinary-chat server execution with a one-time warning that legacy membership is not enforced. Deploy the updated scaffold when upgrading the provider; changing only the host cannot add the server ownership check. This change is in the Projects review branch and is not a published provider version yet.

In the provider repository, `bun run type-check` checks every bundled Convex template against its schema-derived generated declarations, as well as the provider source. Development checks use the sibling `or3-chat` checkout for host contracts. After editing templates or their declarations, run `bun run build:templates` to refresh the distributable pack. The installed project's Convex codegen regenerates its own `_generated` files.

## Enrollment and native object ownership

The host admits new canonical accounts after enforcing registration policy.
Public `workspaces.ensure` may maintain an already admitted account, but only
the trusted server bridge can create its user/auth-account mapping and supply
its verified email. Public `workspaces.create` requires an existing mapping.
A direct Convex identity token alone cannot enroll a new account.

Native object ownership comes from the persisted consumed upload receipt,
scoped to the workspace and normalized content hash. Sync cannot introduce
another workspace's native storage ID, including in deleted metadata. Commit
refuses an ID already owned or referenced by another workspace. Physical
single-object deletion and GC require that same receipt; expired authorization
windows do not erase ownership. Legacy originals without a receipt remain
readable but cannot be physically collected or republished through sync with
that ID; re-upload through the normal host gateway to establish a verified
receipt. No automatic metadata-based ownership backfill is performed.

Deploy the matching backend templates, including the storage-ID indexes on
`file_meta` and `upload_intents`, with the rebuilt provider. Host-only changes
do not secure the public functions of an older deployed backend.
