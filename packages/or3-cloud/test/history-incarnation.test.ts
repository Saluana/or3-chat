import { afterEach, expect, test, setDefaultTimeout } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectLegacyHistory } from '../../../scripts/docker/backup-inspect.mjs';
import { QUALIFIED_MIGRATIONS } from '../../../scripts/docker/backup-inspect.mjs';
import { resetHistory, assertHistoryResetProfile } from '../../../scripts/docker/sync-history-reset.mjs';
import { serializeEnv } from '../src/deployment/env';
import { createSandbox, type Sandbox } from './process-harness';
setDefaultTimeout(30_000);
const roots: string[] = []; const sandboxes: Sandbox[] = [];
afterEach(async () => { await Promise.all([...roots.splice(0).map(path => rm(path, { recursive: true, force: true })), ...sandboxes.splice(0).map(s => s.cleanup())]); });
class OfflineDatabase {
    private db: Database;
    constructor(path: string, options?: { readonly?: boolean }) { this.db = new Database(path, options?.readonly ? { readonly: true } : { readwrite: true }); }
    pragma(sql: string, opts?: { simple?: boolean }) { return opts?.simple ? this.db.query(`PRAGMA ${sql}`).values()[0]?.[0] : this.db.exec(`PRAGMA ${sql}`); }
    prepare(sql: string) { return this.db.query(sql); }
    exec(sql: string) { this.db.exec(sql); }
    close() { this.db.close(); }
}
// Native SQLite transaction, deliberately NOT a claim of packed-provider/runtime E2E.
test('P0-5.10 offline rotation invalidates sessions/ACKs, retains evidence and reused numeric positions, and rolls back on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'h5-reset-')); roots.push(root); const path = join(root, 'db.sqlite');
    const db = new Database(path);
    db.exec(`CREATE TABLE kysely_migration(name TEXT); INSERT INTO kysely_migration VALUES('fixture');
        CREATE TABLE sync_history(id INTEGER PRIMARY KEY CHECK(id=1), incarnation TEXT NOT NULL); INSERT INTO sync_history VALUES(1,'I');
        CREATE TABLE sync_snapshots(id TEXT); INSERT INTO sync_snapshots VALUES('old');
        CREATE TABLE sync_snapshot_items(id TEXT); INSERT INTO sync_snapshot_items VALUES('old-item');
        CREATE TABLE device_cursors(version INTEGER); INSERT INTO device_cursors VALUES(120);
        CREATE TABLE sync_unavailable_records(evidence TEXT); INSERT INTO sync_unavailable_records VALUES('evidence-I-81');
        CREATE TABLE server_version_counter(value INTEGER); INSERT INTO server_version_counter VALUES(80);`);
    const j = crypto.randomUUID(); expect(resetHistory(OfflineDatabase, path, j, ['fixture'])).toMatchObject({ historyIncarnation: j, reset: true });
    expect(db.query('SELECT incarnation FROM sync_history').get()).toEqual({ incarnation: j });
    for (const table of ['sync_snapshots', 'sync_snapshot_items', 'device_cursors']) expect(db.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(db.query('SELECT * FROM sync_unavailable_records').all()).toEqual([{ evidence: 'evidence-I-81' }]);
    expect(db.query('SELECT * FROM server_version_counter').get()).toEqual({ value: 80 });
    db.exec("INSERT INTO sync_snapshot_items VALUES('retain')"); db.exec("CREATE TRIGGER no_reset BEFORE DELETE ON sync_snapshot_items BEGIN SELECT RAISE(ABORT,'fault'); END");
    expect(() => resetHistory(OfflineDatabase, path, crypto.randomUUID(), ['fixture'])).toThrow('fault');
    expect(db.query('SELECT incarnation FROM sync_history').get()).toEqual({ incarnation: j });
    db.close();
    expect(() => assertHistoryResetProfile({ contract: 1, sqlite: '0.0.30' })).toThrow(/not qualified/);
});

test('P0-5.7 repeated managed restore journals a fresh token per extraction and retains terminal proof', async () => {
    const s = await createSandbox(); sandboxes.push(s);
    expect((await s.cli(['backup'])).exitCode).toBe(0); const [backup] = await s.backupIds();
    const tokens = new Set<string>();
    for (let i = 0; i < 2; i++) {
        const result = await s.cli(['restore', backup!, '--yes']); expect(result.exitCode, result.output).toBe(0);
        const state = await s.readState(); expect(state.syncHistory?.certification).toBe('certified');
        tokens.add(state.syncHistory!.historyIncarnation!);
        expect(state.pinnedHistoryBackups).toContain(backup!);
    }
    expect(tokens.size).toBe(2);
});

test('P0-5.9 incapable exact target is rejected before any replacement', async () => {
    const s = await createSandbox(); sandboxes.push(s);
    expect((await s.cli(['backup'])).exitCode).toBe(0); const [backup] = await s.backupIds();
    await s.configure({ historyResetSupported: false }); await s.reset();
    const result = await s.cli(['restore', backup!, '--yes']); expect(result.exitCode).toBe(1);
    expect(result.output).toContain('normal restore/rollback refused');
    expect(await s.traceText()).not.toContain('tar xzf');
});

test('P0-5.9 incapable safety recovery preserves bytes but stays stopped and durably degraded', async () => {
    const s = await createSandbox(); sandboxes.push(s);
    expect((await s.cli(['backup'])).exitCode).toBe(0);
    const [backupId] = await s.backupIds();
    const source = await s.readState();
    await s.writeState({ ...source, incompleteOperation: { id: 'interrupted-old-update', operation: 'update', startedAt: source.updatedAt, message: 'legacy ambiguous journal', phase: 'target-mutating', backupId } });
    await s.configure({ historyResetSupported: false }); await s.reset();
    const result = await s.cli(['recover', '--restore', '--yes']); expect(result.exitCode).toBe(1);
    const state = await s.readState();
    expect(state.incompleteOperation?.phase).toBe('history-reset-required');
    expect(state.syncHistory?.certification).toBe('history-reset-required');
    const trace = await s.traceText(); expect(trace).toContain('tar xzf');
    expect(trace.slice(trace.lastIndexOf('tar xzf'))).not.toContain(' up -d');
    const restart = await s.cli(['restart']); expect(restart.exitCode).toBe(1);
    expect((await s.readState()).incompleteOperation?.phase).toBe('history-reset-required');
});

test('P0-5.7 interrupted reset never starts the extracted candidate and safety gets a different attempt', async () => {
    const s = await createSandbox(); sandboxes.push(s);
    expect((await s.cli(['backup'])).exitCode).toBe(0); const [backup] = await s.backupIds(); await s.reset();
    await s.configure({ failures: [{ match: 'sync-history-reset.mjs reset', times: 2, message: 'reset interrupted' }] });
    const result = await s.cli(['restore', backup!, '--yes']); expect(result.exitCode).toBe(1);
    const state = await s.readState(); expect(state.incompleteOperation?.historyReset?.progress).toBe('prepared');
    expect(state.incompleteOperation?.historyReset?.role).toBe('safety');
    const trace = await s.traceText();
    const resets = (await s.traceEntries()).filter(entry => entry.args.includes('reset') && entry.args.some(arg => arg.endsWith('sync-history-reset.mjs')));
    expect(resets).toHaveLength(2);
    const tokens = resets.map(entry => entry.args[entry.args.indexOf('reset') + 2]);
    expect(new Set(tokens).size).toBe(2);
    expect(trace.slice(trace.indexOf('tar xzf'))).not.toContain(' up -d');
    expect((await s.cli(['restart'])).exitCode).toBe(1);
});

test('P0-5.7 ordinary update/restart retain identity, and data rollback rotates despite semantic bypass', async () => {
    const s = await createSandbox(); sandboxes.push(s);
    expect((await s.cli(['backup'])).exitCode).toBe(0); const [backup] = await s.backupIds();
    expect((await s.cli(['restore', backup!, '--yes'])).exitCode).toBe(0);
    const original = (await s.readState()).syncHistory!.historyIncarnation;
    expect((await s.cli(['update'])).exitCode).toBe(0);
    expect((await s.readState()).syncHistory!.historyIncarnation).toBe(original);
    expect((await s.cli(['restart'])).exitCode).toBe(0);
    expect((await s.readState()).syncHistory!.historyIncarnation).toBe(original);
    expect((await s.cli(['rollback', '--yes'])).exitCode).toBe(0);
    expect((await s.readState()).syncHistory).toMatchObject({ certification: 'degraded' });
    expect((await s.readState()).syncHistory!.historyIncarnation).not.toBe(original);
});

// RB-1/11: use real SQLite, preserve bytes and refuse disguised upgraded ledgers.
test('RB-1 legacy offline inspection is read-only and rejects 034-036 residue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-legacy-')); roots.push(root);
    const path = join(root, 'sync.sqlite');
    // The rollback allowlist binds the immutable published .116 schema, not
    // today's migration implementation (whose historical DDL can evolve).
    const db = new Database(path);
    db.exec(await readFile(new URL('./fixtures/legacy-032-core.sql', import.meta.url), 'utf8'));
    db.exec('CREATE TABLE kysely_migration(name TEXT PRIMARY KEY)');
    for (const name of QUALIFIED_MIGRATIONS.slice(0, 32)) db.query('INSERT INTO kysely_migration VALUES(?)').run(name);
    db.exec("INSERT INTO server_version_counter(workspace_id,value) VALUES('original-workspace',80)");
    expect(inspectLegacyHistory(OfflineDatabase, path)).toMatchObject({ policy: 'legacy-032-rollback-v1', ledger: '032', complete: true });
    expect(db.query('SELECT * FROM server_version_counter').all()).toEqual([{ workspace_id:'original-workspace', value:80 }]);
    db.query('INSERT INTO kysely_migration VALUES(?)').run(QUALIFIED_MIGRATIONS[32]);
    expect(() => inspectLegacyHistory(OfflineDatabase, path)).toThrow(/legacy/);
    db.query('DELETE FROM kysely_migration WHERE name=?').run(QUALIFIED_MIGRATIONS[32]);
    for (const sql of ['CREATE TABLE sync_history(id INTEGER, incarnation TEXT)', 'CREATE TABLE sync_unavailable_records(id TEXT)', 'ALTER TABLE change_log ADD COLUMN intent_fingerprint TEXT']) {
        db.exec(sql);
        expect(() => inspectLegacyHistory(OfflineDatabase, path)).toThrow(/legacy|migration history/);
        db.exec(sql.startsWith('CREATE TABLE sync_history') ? 'DROP TABLE sync_history' : sql.startsWith('CREATE TABLE sync_unavailable_records') ? 'DROP TABLE sync_unavailable_records' : 'ALTER TABLE change_log DROP COLUMN intent_fingerprint');
    }
    db.exec('ALTER TABLE s_messages RENAME TO missing_messages');
    expect(() => inspectLegacyHistory(OfflineDatabase, path)).toThrow(/legacy/);
    db.exec('ALTER TABLE missing_messages RENAME TO s_messages');
    db.query('DELETE FROM kysely_migration WHERE name=?').run(QUALIFIED_MIGRATIONS[10]);
    expect(() => inspectLegacyHistory(OfflineDatabase, path)).toThrow(/legacy|migration history/);
    db.close();
});

// Transport-policy proof only: the native/image/browser lanes own source fidelity.
test('RB-4 qualified immediate legacy rollback consumes once, warns after restart and pins both histories', async () => {
    const s = await createSandbox({ version: '0.1.116' }); sandboxes.push(s);
    const digest = 'sha256:f7e6c507f2fb944c91f285e976b69b578ff9a24cdb8ceeaf22db7e22c79de692';
    const image = 'ghcr.io/saluana/or3-chat@' + digest;
    const env = { ...s.env, OR3_IMAGE: image };
    const state = { ...await s.readState(), image, imageDigest: digest };
    await writeFile(join(s.directory,'.env'), serializeEnv(env), { mode: 0o600 });
    await s.writeState(state);
    await s.configure({ runningImage: image }); await s.reset();
    expect((await s.cli(['backup'])).exitCode).toBe(0); const [backupId] = await s.backupIds();
    const currentImage = 'ghcr.io/saluana/or3-chat@sha256:' + 'b'.repeat(64);
    await writeFile(join(s.directory,'.env'), serializeEnv({ ...env, OR3_IMAGE: currentImage }), { mode: 0o600 });
    await s.writeState({ ...state, image: currentImage, imageDigest: 'sha256:'+'b'.repeat(64), syncHistory: { historyIncarnation:'abandoned-I', certification:'certified' },
      rollback: { appVersion:'0.1.116', image, imageDigest:digest, backupId:backupId!, createdAt:state.updatedAt } });
    await s.configure({ runningImage:currentImage, incapableImage:digest, legacyQualified:true }); await s.reset();
    expect((await s.cli(['rollback'])).exitCode).toBe(1);
    expect(await s.traceText()).not.toContain('tar xzf');
    const rolled = await s.cli(['rollback','--yes']); expect(rolled.exitCode,rolled.output).toBe(0);
    expect(rolled.output).toContain('ALL server changes');
    const restored = await s.readState();
    expect(restored.rollback).toBeUndefined();
    expect(restored.syncHistory).toMatchObject({ certification:'legacy-snapshot', historyReplaced:true, abandonedIncarnation:'abandoned-I' });
    expect(restored.syncHistory?.historyIncarnation).toBeUndefined();
    expect(restored.pinnedHistoryBackups?.length).toBeGreaterThanOrEqual(2);
    expect(await s.traceText()).not.toContain('sync-history-reset.mjs reset');
    expect((await s.cli(['restart'])).exitCode).toBe(0);
    expect((await s.readState()).syncHistory).toEqual(restored.syncHistory);
    const doctor = await s.cli(['doctor']); expect(doctor.exitCode,doctor.output).toBe(0);
    expect(doctor.output).toContain('incarnation protection unavailable');
    expect((await s.cli(['backup','prune','--keep','1','--force','--yes'])).exitCode).toBe(0);
    for (const pinned of restored.pinnedHistoryBackups!) expect(await s.backupIds()).toContain(pinned);
    expect((await s.cli(['rollback','--yes'])).exitCode).toBe(1);
    expect((await s.cli(['restore',backupId!,'--yes'])).exitCode).toBe(1);
});
