# SQLite Sync Provider (`or3-provider-sqlite`)

Setup and operating guide for the default-stack sync backend.

## What It Provides

- Gateway-mode sync backend for OR3 sync endpoints.
- Canonical workspace/user storage through provider `AuthWorkspaceStore`.
- Complete admin-store support for workspace access/lifecycle, workspace
  settings, user search, and deployment-admin grants.
- Global `server_version` cursor progression per workspace.
- Durable outbox push/pull support with idempotency (`op_id`) and LWW conflict semantics.
- Consistent materialized snapshot pages pinned to one server high-watermark.

## Install

```bash
bun add or3-provider-sqlite
```

Local sibling package:

```bash
bun add or3-provider-sqlite@link:../or3-provider-sqlite
```

## Required Config

```bash
SSR_AUTH_ENABLED=true
OR3_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_SQLITE_DB_PATH=.data/or3-sync.sqlite
```

Recommended SQLite durability settings:

```bash
OR3_SQLITE_PRAGMA_JOURNAL_MODE=WAL
OR3_SQLITE_PRAGMA_SYNCHRONOUS=NORMAL
OR3_SQLITE_STRICT=true
OR3_SQLITE_ALLOW_IN_MEMORY=false
```

## Invariants To Preserve

- Workspace isolation on materialized sync tables (`workspace_id` scoping).
- Monotonic workspace `server_version` allocation.
- Idempotent push handling via `op_id`.
- Snapshot items are frozen under `BEGIN IMMEDIATE`, ordered by
  `(tableName, primaryKey, kind)`, and served through bounded keyset pages.
- Tombstones and change history remain retained while end-to-end snapshot apply
  and replay verification are incomplete.
- One cursor per workspace (not per-table cursors).

## Operational Notes

- `:memory:` mode is for tests/dev only; production should use persistent disk.
- Backup the SQLite file before schema or provider upgrades.
- Monitor push 429 responses and outbox deferrals (`Retry-After` handling).

## Related

- [providers](./providers)
- [sync-layer](./sync-layer)
- [provider-basic-auth](./provider-basic-auth)
- [provider-fs](./provider-fs)
