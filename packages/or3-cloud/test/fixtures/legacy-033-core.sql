-- Core schema captured from published or3-provider-sqlite@0.0.30 (OR3 Cloud 0.1.116).
-- SHA-256 of sorted [{name,sql}]: 2a0086226c035a29be7aa0883b2469ed0c41910ef1ba3008255c350ed9f2dfd5
CREATE TABLE "change_log" ("id" text primary key, "workspace_id" text not null, "server_version" integer not null, "table_name" text not null, "pk" text not null, "op" text not null, "payload_json" text, "clock" integer not null, "hlc" text not null, "device_id" text not null, "op_id" text not null, "created_at" integer default (unixepoch()) not null);
CREATE TABLE "device_cursors" ("id" text primary key, "workspace_id" text not null, "device_id" text not null, "last_seen_version" integer default 0 not null, "updated_at" integer default (unixepoch()) not null, "owner_user_id" text);
CREATE TABLE "s_file_meta" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "s_kv" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "s_messages" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "s_notifications" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "s_posts" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "s_projects" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "s_threads" (
            id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            clock INTEGER NOT NULL DEFAULT 0,
            hlc TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()), op_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (workspace_id, id)
        );
CREATE TABLE "server_version_counter" ("workspace_id" text primary key, "value" integer default 0 not null);
CREATE TABLE sync_snapshot_items (
            snapshot_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            pk TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('row', 'tombstone')),
            payload_json TEXT,
            clock INTEGER NOT NULL,
            hlc TEXT NOT NULL,
            op_id TEXT NOT NULL,
            server_deleted_at INTEGER,
            PRIMARY KEY (snapshot_id, table_name, pk, kind),
            FOREIGN KEY (snapshot_id) REFERENCES sync_snapshots(id) ON DELETE CASCADE
        ) WITHOUT ROWID
    ;
CREATE TABLE sync_snapshots (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            high_watermark INTEGER NOT NULL,
            tables_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
CREATE TABLE "tombstones" ("id" text primary key, "workspace_id" text not null, "table_name" text not null, "pk" text not null, "deleted_at" integer not null, "clock" integer not null, "server_version" integer not null, "created_at" integer default (unixepoch()) not null, hlc TEXT NOT NULL DEFAULT '', op_id TEXT NOT NULL DEFAULT '');
