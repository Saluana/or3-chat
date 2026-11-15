import { afterEach, expect, test, setDefaultTimeout } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetHistory, assertHistoryResetProfile } from '../../../scripts/docker/sync-history-reset.mjs';
import { createSandbox, type Sandbox } from './process-harness';
setDefaultTimeout(30_000);
const roots: string[] = []; const sandboxes: Sandbox[] = [];
afterEach(async () => { await Promise.all([...roots.splice(0).map(path => rm(path, { recursive: true, force: true })), ...sandboxes.splice(0).map(s => s.cleanup())]); });
class OfflineDatabase {
    private db: Database;
    constructor(path: string) { this.db = new Database(path); }
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
    await s.configure({ historyResetSupported: false, failures: [{ match: ' stop or3', skip: 1, times: 1, message: 'target stop interrupted' }] });
    const result = await s.cli(['update']); expect(result.exitCode).toBe(1);
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
