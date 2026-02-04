import Database from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'pathe';

let dbInstance: Database | null = null;

function resolveDbPath(): string {
    return process.env.OR3_SQLITE_PATH ?? join('.data', 'or3-sqlite', 'or3.sqlite');
}

function initSchema(db: Database): void {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            provider_user_id TEXT NOT NULL,
            email TEXT,
            display_name TEXT,
            active_workspace_id TEXT,
            created_at INTEGER NOT NULL,
            UNIQUE(provider, provider_user_id)
        );

        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memberships (
            user_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, workspace_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS change_log (
            workspace_id TEXT NOT NULL,
            server_version INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            pk TEXT NOT NULL,
            op TEXT NOT NULL,
            payload_json TEXT,
            stamp_json TEXT NOT NULL,
            op_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(workspace_id, op_id)
        );

        CREATE TABLE IF NOT EXISTS device_cursors (
            workspace_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            last_seen_version INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (workspace_id, device_id)
        );
    `);
}

export function getSqliteDb(): Database {
    if (dbInstance) return dbInstance;
    const path = resolveDbPath();
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    initSchema(db);
    dbInstance = db;
    return dbInstance;
}
