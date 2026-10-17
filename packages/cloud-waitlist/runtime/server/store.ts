import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAdminDataDir } from '~~/server/admin/auth/data-paths';

// Extension-owned data: never touches accounts, invitations or workspace tables.
let connection: Database.Database | undefined;
function db() {
    if (connection) return connection;
    const directory = resolveAdminDataDir();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'cloud-waitlist.sqlite');
    const opened = new Database(path);
    try {
        chmodSync(path, 0o600);
        opened.pragma('journal_mode = WAL');
        opened.pragma('busy_timeout = 5000');
        opened.exec(`
            CREATE TABLE IF NOT EXISTS waitlist_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
            );
            INSERT OR IGNORE INTO waitlist_settings (id, enabled) VALUES (1, 0);
            CREATE TABLE IF NOT EXISTS waitlist_emails (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist_emails (created_at DESC, email);
        `);
        connection = opened;
        return opened;
    } catch (error) { opened.close(); throw error; }
}

export function waitlistEnabled(): boolean {
    return (db().prepare('SELECT enabled FROM waitlist_settings WHERE id = 1').get() as { enabled: number }).enabled === 1;
}
export function setWaitlistEnabled(enabled: boolean) {
    db().prepare('UPDATE waitlist_settings SET enabled = ? WHERE id = 1').run(Number(enabled));
}
export function joinWaitlist(email: string): boolean {
    // One transaction serializes admission against an administrator closing the list.
    return db().transaction(() => {
        if (!waitlistEnabled()) return false;
        db().prepare('INSERT OR IGNORE INTO waitlist_emails (email, created_at) VALUES (?, ?)').run(email, Date.now());
        return true;
    }).immediate();
}
export function listWaitlist(page: number) {
    const entries = db().prepare('SELECT email, created_at AS createdAt FROM waitlist_emails ORDER BY created_at DESC, email LIMIT 50 OFFSET ?').all((page - 1) * 50) as { email: string; createdAt: number }[];
    const { total } = db().prepare('SELECT count(*) AS total FROM waitlist_emails').get() as { total: number };
    return { enabled: waitlistEnabled(), entries, total, page, pageSize: 50 };
}
export function closeWaitlist() { connection?.close(); connection = undefined; }
