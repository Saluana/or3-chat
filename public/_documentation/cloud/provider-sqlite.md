# SQLite Sync Provider (`or3-provider-sqlite`)

Setup and operating guide for the default-stack sync backend.

Managed installations use the fixed profile in [Set up Cloud](/documentation/cloud/setup). The install commands and manual settings below are for editable source deployments; install only the providers your source configuration selects.

## What It Provides

- Gateway-mode sync backend for OR3 sync endpoints.
- Canonical workspace/user storage through provider `AuthWorkspaceStore`.
- Complete admin-store support for local, Bun, and Turso runtimes: workspace
  access/lifecycle, workspace settings, user search, and deployment-admin
  grants.
- Global `server_version` cursor progression per workspace.
- Durable outbox push/pull support with idempotency (`op_id`) and LWW conflict semantics.
- Consistent materialized snapshot pages pinned to one server high-watermark.
- A separate `backupSnapshot` on native SQLite and D1 retains Trash file metadata for workspace archives. Paging is frozen and bound to archive mode; ordinary sync still returns tombstones. Backup reads preserve originals and unfinished uploads.
- A 256 KB serialized payload ceiling per sync operation, shared with the core
  gateway and other providers.

SQLite can also supply durable rate limits independently of the workspace
backend. With SSR auth enabled, `OR3_LIMITS_ENABLED=true` and
`OR3_LIMITS_STORAGE_PROVIDER=sqlite` activate and migrate its store even when
another backend supplies account workspaces. The source wizard includes its
module, runtime settings, and driver dependency in that configuration.

Bounded retained-metadata pages advertise `retainedStorageMetadata: 'v1'` on
native SQLite and D1. They read materialized deleted file rows, preserve unknown
sizes for delete-before-put records, and never infer liveness from sync history.

## Install

The background job provider supports dashboard drain accounting when its built
artifacts expose `getShutdownBlockerCount`. All streaming jobs, parked browser
tools, workflows, and pending admission/history delivery block restart. The
additive history/status index migration keeps polling off stored response blobs.
Database failures cancel restart preparation safely. See
[background execution](/documentation/cloud/background-execution#dashboard-restart-admission).

```bash
bun add or3-provider-sqlite
```

Local sibling package:

```bash
bun add or3-provider-sqlite@link:../or3-provider-sqlite
```

## Native SQLite runtimes

The current local-file configuration remains the default. The source wizard
offers a **SQLite runtime** selector and writes the matching environment values
and dependency plan.

| Runtime | Configuration | Wizard install behavior |
|---|---|---|
| Local Node (default) | `OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite` | Adds `better-sqlite3` |
| Bun | `OR3_SQLITE_DRIVER=bun` plus `OR3_SQLITE_DB_PATH` | Uses Bun's built-in `bun:sqlite` |
| Turso/libSQL | `OR3_SQLITE_DRIVER=turso`, `OR3_SQLITE_TURSO_URL`, `OR3_SQLITE_TURSO_AUTH_TOKEN` | Adds `libsql` |
| Cloudflare D1 | `OR3_SQLITE_DRIVER=d1`, `OR3_SQLITE_D1_BINDING=DB` | Uses the D1 binding already configured in your Worker |

### Existing local setup

```bash
SSR_AUTH_ENABLED=true
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite
OR3_SQLITE_PRAGMA_JOURNAL_MODE=WAL
OR3_SQLITE_PRAGMA_SYNCHRONOUS=NORMAL
OR3_SQLITE_STRICT=true
OR3_SQLITE_ALLOW_IN_MEMORY=false
```

### Bun

```bash
OR3_SQLITE_DRIVER=bun
OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite
```

For editable source development with the Bun driver, `bun run dev` selects
Bun and checks `bun:sqlite` before Nuxt starts. `bun run build` also selects Bun
for this driver; static generation and type-checking use Node. Use the Bun
version pinned in the host's `package.json`. The wrappers load `.env` before
selecting the runtime, and values exported in your shell take precedence.
The package manager alone does not select the server
runtime. For a built server using this driver, run the output with Bun:

```bash
bun .output/server/index.mjs
```

Basic Auth keeps a separate `better-sqlite3` database. The supported native
binding crashes under Bun 1.3.14, so source validation rejects Basic Auth with
Bun SQLite before probing that binding. Keep Basic Auth on Node 24 with
`OR3_SQLITE_DRIVER=better-sqlite3`, or select a Bun-compatible auth provider such
as Clerk for Bun SQLite. Disabling sync transfer does not remove SQLite's role
as the auth workspace store. The managed Cloud image uses Node and the default
`better-sqlite3` driver.

### Turso

```bash
OR3_SQLITE_DRIVER=turso
OR3_SQLITE_TURSO_URL=libsql://your-database.turso.io
OR3_SQLITE_TURSO_AUTH_TOKEN=your-server-only-token
```

### Cloudflare D1

Configure a D1 binding in your Worker (commonly named `DB`), then use:

```bash
OR3_SQLITE_DRIVER=d1
OR3_SQLITE_D1_BINDING=DB
```

D1 initializes and migrates on the first Worker request, because binding I/O
must occur inside Cloudflare's request context.

D1 requires a Cloudflare Workers runtime and Workers-compatible auth and
storage providers. It does not support OR3 Connect persistence, persistent
webhooks, or server-side admin stores. The wizard validates these boundaries;
the default Basic Auth + filesystem stack is therefore not a D1 deployment
profile.

## Invariants To Preserve

- Workspace isolation on materialized sync tables (`workspace_id` scoping).
- Contiguous, monotonic workspace `server_version` allocation for admitted
  changes. Rejected notification races consume no versions, including on D1.
- Idempotent push handling via `op_id`.
- Snapshot items are captured at one high-watermark, ordered by
  `(tableName, primaryKey, kind)`, and served through bounded keyset pages.
- Sync and backup continuation tokens belong to the capturing user and workspace.
  At most four copies per user/workspace are retained across both modes for one
  hour. Superseded, expired, and pre-upgrade tokens return HTTP 410; start a fresh
  capture. Native runtimes prune expiry at startup and every minute; D1 prunes
  on requests at most once per minute. Copied items are deleted with the header.
  Eviction during a D1 page read also returns HTTP 410 rather than an incomplete
  final page.
- Tombstones and change history remain retained while end-to-end snapshot apply
  and replay verification are incomplete.
- One cursor per workspace (not per-table cursors).

## Workspace Files and Trash admission

`or3-provider-sqlite@0.0.13` advertises workspace-item capability v1 for native
synchronous adapters. Writes to posts or projects with catalog, logical Trash,
or file-membership semantics require a current client, even when the incoming
write omits those fields. Admission checks incoming and canonical state inside
the write transaction before allocating versions or changes. Unsupported
clients receive HTTP 426 with `OR3_WORKSPACE_ITEM_UPDATE_REQUIRED`. D1 does not
advertise this transactional capability.

## Operational Notes

In **Operations → Maintenance**, **Clear old sync history** removes old update
history, and **Clear old deletion history** removes old deletion records. Their
descriptions explain the retention period and require active devices to be up to
date. These actions preserve current chats and files and do not empty Trash.
Card descriptions wrap fully, including on narrow screens.

Persistent Projects stores version-1 settings, explicit memories, and source bindings as opaque internal posts with the existing workspace-item marker. Preserve their content, metadata, and all `file_hashes`, including original/extraction history; no separate project database is needed. Workspace capability checks still apply to viewers, old clients, and revoked members.

The project-aware canonical reader returns `project_ownership: resolved | conflict` with explicit or legacy ownership resolved in the authorized SQLite snapshot, and the adapter declares `capabilities.projectOwnership: 'v1'`. The host always refuses server-owned execution for project-bound or conflicting chats. With a declaring provider it also refuses an absent field; with an older provider ordinary chats keep server execution and the host logs once that legacy folder membership is not enforced server-side. This reader change is in the Projects review branch and must be released to enforce legacy membership with a registry provider; normal browser project chat can be tested independently.

- `:memory:` mode is for tests/dev only; production local-file setups should use persistent disk.
- Back up the SQLite file before schema or provider upgrades; use managed
  database backup/export tooling for Turso and D1.
- Monitor push 429 responses and outbox deferrals (`Retry-After` handling).

## Instance signup invitations

The updated provider implements the five atomic signup-invite methods and the optional server-only `findSignupInviteByTokenHash` lookup on the existing AuthWorkspaceStore. Short codes use the existing indexed `token_hash` field with an HMAC hash; lookup returns only a pending invitation’s ID, email, and expiry to the trusted host. No raw code is stored or returned in history. A separate additive signup-invite table keeps email, hashed proof, millisecond timestamps, admin actor, and an identity-bound acceptance receipt. Lists omit token material, paginate at most 100 rows, and derive expired status. Pending receipts expire from retention 90 days after invitation expiry; accepted/revoked receipts are retained 90 days after that transition. Create/list cleanup deletes at most 100 eligible records per call.

Acceptance atomically creates the canonical user, provider mapping, private workspace, recipient-only owner membership, active workspace pointer, and consumed receipt. Same-identity retry returns the committed result without changing active selection or recreating data. Existing canonical accounts cannot redeem a signup invite into another private workspace; use team invites for sharing.

Native SQLite uses one immediate transaction. Cloudflare D1 does not advertise signup-invite support because it cannot provide this transaction; legacy workspace capabilities remain available.

Managed Cloud backup inspection qualifies `or3-provider-sqlite@0.0.24` with filesystem provider `0.0.15` and migration history through `028_user_scoped_device_cursors`. Unknown migrations remain rejected; provider upgrades must requalify backup inspection before releasing an image. Normal deployment updates follow the [Cloud update guide](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-updates.md).

SQLite provider `0.0.24` reports structured validation, authorization, conflict,
and supersession errors for background history. Unknown database failures remain
retryable. This version does not include the unreleased generation migrations.

## Related

- [Choose and wire providers](/documentation/cloud/providers)
- [Sync internals](/documentation/cloud/sync-layer)
- [Basic Auth](/documentation/cloud/provider-basic-auth)
- [Filesystem](/documentation/cloud/provider-fs)

## Verified quota accounting and device ownership

Upload quota admission groups unexpired pending authorizations by hash and
reserves atomically on native SQLite and D1. Migration 027 replaces the
metadata-derived charges from migration 026 with persisted, verified consumed
upload receipts. Client-authored file sizes cannot create retained charges.
Trash, logical deletion and receipt replay expiry do not release verified
charges; restoring the same hash does not double-charge it. A larger upload
reserves the difference above its verified retained size.

Pre-receipt files and raw incomplete uploads are outside this verified ledger;
metadata alone cannot prove their physical size. Existing consumed receipts are
retained and reconciled during upgrade. Physical filesystem/S3 GC remains
disabled. The provider advertises `atomicUploadQuota: 'retained-v1'`; configure
`OR3_STORAGE_WORKSPACE_QUOTA_BYTES` to enforce a quota (the default is unlimited).

Migration 028 namespaces device acknowledgements by workspace, authenticated
user and device ID. Accounts sharing one browser maintain independent monotonic
positions. Existing owned positions remain; legacy unowned rows are ignored by
updates and expire through the normal cursor retention policy. The workspace
change-log version and client cursor protocol remain unchanged.

Migrations 027–028 are forward-only. Keep a pre-upgrade database backup;
rolling back the provider requires restoring that snapshot because the old
adapter expects the previous device-cursor unique key.


### Sync admission and notification recovery

Notification deletes retain the authenticated owner in the canonical change payload so peers receive them before their cursor advances. Operation fingerprints exclude this server-authored owner field on notification deletes, preserving exact retry receipts across older payload forms without weakening canonical owner authorization.

Both native SQLite and D1 check Files/Trash writer capability against canonical existing records. D1 performs this check inside the write batch before mutation: an old writer cannot erase file membership or Trash metadata by omitting it from a replacement. HTTP 426 leaves sibling rows, change logs and workspace versions unchanged.
