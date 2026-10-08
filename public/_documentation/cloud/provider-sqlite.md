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
- A 256 KB serialized payload ceiling per sync operation, shared with the core
  gateway and other providers.

## Install

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

For editable source development with the Bun driver, `bun run dev:ssr` selects
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
- Monotonic workspace `server_version` allocation.
- Idempotent push handling via `op_id`.
- Snapshot items are captured at one high-watermark, ordered by
  `(tableName, primaryKey, kind)`, and served through bounded keyset pages.
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

Persistent Projects stores version-1 settings, explicit memories, and source bindings as opaque internal posts with the existing workspace-item marker. Preserve their content, metadata, and all `file_hashes`, including original/extraction history; no separate project database is needed. Workspace capability checks still apply to viewers, old clients, and revoked members.

The project-aware canonical reader returns `project_ownership: resolved | conflict` with explicit or legacy ownership resolved in the authorized SQLite snapshot, and the adapter declares `capabilities.projectOwnership: 'v1'`. The host always refuses server-owned execution for project-bound or conflicting chats. With a declaring provider it also refuses an absent field; with an older provider ordinary chats keep server execution and the host logs once that legacy folder membership is not enforced server-side. This reader change is in the Projects review branch and must be released to enforce legacy membership with a registry provider; normal browser project chat can be tested independently.

- `:memory:` mode is for tests/dev only; production local-file setups should use persistent disk.
- Back up the SQLite file before schema or provider upgrades; use managed
  database backup/export tooling for Turso and D1.
- Monitor push 429 responses and outbox deferrals (`Retry-After` handling).

## Related

- [Choose and wire providers](/documentation/cloud/providers)
- [Sync internals](/documentation/cloud/sync-layer)
- [Basic Auth](/documentation/cloud/provider-basic-auth)
- [Filesystem](/documentation/cloud/provider-fs)
