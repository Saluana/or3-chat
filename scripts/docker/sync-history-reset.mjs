import { HISTORY_MIGRATIONS } from './backup-inspect.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** Target-owned offline contract. Publication must qualify exact runtime and migration history together. */
export function assertHistoryResetProfile(profile) {
    if (profile?.historyIncarnation !== 'v1' || !Array.isArray(profile.historyMigrations) || JSON.stringify(profile.historyMigrations) !== JSON.stringify(HISTORY_MIGRATIONS)) {
        throw new Error('Target image is not qualified for history incarnation reset/runtime v1');
    }
}

export function resetHistory(Database, path, incarnation, qualifiedMigrations) {
    if (typeof incarnation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incarnation)) throw new Error('Invalid reset UUID');
    const db = new Database(path, { fileMustExist: true });
    try {
        db.pragma('trusted_schema=OFF');
        if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite quick_check failed');
        const names = db.prepare('SELECT CASE WHEN length(CAST(name AS BLOB))<=128 THEN name ELSE NULL END AS name FROM kysely_migration ORDER BY name LIMIT ?').all(qualifiedMigrations.length + 1).map(row => row.name);
        if (JSON.stringify(names) !== JSON.stringify(qualifiedMigrations)) throw new Error('History reset requires an already qualified schema; offline migration/import required');
        db.exec('BEGIN IMMEDIATE');
        try {
            const rows = db.prepare("SELECT id, CASE WHEN typeof(incarnation)='text' AND length(CAST(incarnation AS BLOB))<=128 THEN incarnation ELSE NULL END AS incarnation FROM sync_history LIMIT 2").all();
            if (rows.length !== 1 || rows[0].id !== 1 || typeof rows[0].incarnation !== 'string' || !/^[\x00-\x7f]{1,128}$/.test(rows[0].incarnation)) throw new Error('Invalid sync history singleton');
            db.prepare('UPDATE sync_history SET incarnation=? WHERE id=1').run(incarnation);
            for (const table of ['sync_snapshot_items', 'sync_snapshots', 'device_cursors']) db.prepare(`DELETE FROM ${table}`).run();
            if (db.prepare('SELECT incarnation FROM sync_history WHERE id=1').get()?.incarnation !== incarnation) throw new Error('History reset verification failed');
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return { contract: 'incarnation-v1', historyIncarnation: incarnation, reset: true };
    } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const profile = JSON.parse(readFileSync(new URL('./backup-inspection-profile.json', import.meta.url), 'utf8'));
        assertHistoryResetProfile(profile);
        if (process.argv[2] === 'capability') console.log(JSON.stringify({ contract: 'incarnation-v1', ...(profile.contract === 1 && profile.healthValidation === 'health-only-v1' ? { validation: 'health-only-v1', profile: 'basic-sqlite-fs' } : {}), ...(profile.legacySnapshotRollback === 'legacy-033-rollback-v1' ? { legacySnapshotRollback: profile.legacySnapshotRollback } : {}) }));
        else if (process.argv[2] === 'reset') {
            const require = createRequire('/app/.output/server/package.json');
            console.log(JSON.stringify(resetHistory(require('better-sqlite3'), process.argv[3], process.argv[4], profile.historyMigrations)));
        } else throw new Error('Unsupported history reset operation');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
