# SQLite Sync Provider (`or3-provider-sqlite`)

Setup and operating guide for the default-stack sync backend.

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

## Operational Notes

- `:memory:` mode is for tests/dev only; production local-file setups should use persistent disk.
- Back up the SQLite file before schema or provider upgrades; use managed
  database backup/export tooling for Turso and D1.
- Monitor push 429 responses and outbox deferrals (`Retry-After` handling).

## Related

- [providers](./providers)
- [sync-layer](./sync-layer)
- [provider-basic-auth](./provider-basic-auth)
- [provider-fs](./provider-fs)
