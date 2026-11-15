import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as inspector from '../../../scripts/docker/backup-inspect.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
class OfflineDatabase {
  private db: Database;
  constructor(path: string) { this.db = new Database(path, { readonly: true }); }
  pragma(sql: string, options?: { simple: boolean }) { return options?.simple ? this.db.query(`PRAGMA ${sql}`).values()[0]?.[0] : this.db.exec(`PRAGMA ${sql}`); }
  prepare(sql: string) { return this.db.query(sql); }
  close() { this.db.close(); }
}
const opId = '12345678-1234-4234-8234-123456789abc';
const payload = JSON.stringify({ id: 'private-key', name: 'private-name', value: 'PRIVATE-CONTENT', created_at: 1, updated_at: 1, clock: 1 });
async function fixture(sql = '') {
  const root = await mkdtemp(join(tmpdir(), 'or3-sync-audit-')); roots.push(root);
  const path = join(root, 'sync.sqlite');
  const provider = new URL('../../../node_modules/or3-provider-sqlite/dist/runtime/server/db/', import.meta.url);
  const { initializeSqliteDb, destroySqliteDb } = await import(new URL('kysely.js', provider).href);
  const { runMigrations } = await import(new URL('migrate.js', provider).href);
  try { await runMigrations(await initializeSqliteDb({ path, driver: 'bun' })); }
  finally { await destroySqliteDb(); }
  const db = new Database(path);
  db.query('INSERT INTO server_version_counter(workspace_id,value) VALUES(?,1)').run('workspace');
  db.query('INSERT INTO change_log(id,workspace_id,server_version,table_name,pk,op,payload_json,clock,hlc,device_id,op_id) VALUES(?,?,1,?,?,?, ?,1,?,?,?)')
    .run('log', 'workspace', 'kv', 'private-key', 'put', payload, 'legacy:0', 'device', opId);
  db.query('INSERT INTO s_kv(id,workspace_id,data_json,clock,hlc,device_id,op_id) VALUES(?,?,?,1,?,?,?)')
    .run('private-key', 'workspace', payload, 'legacy:0', 'device', opId);
  db.query('INSERT INTO sync_snapshots(id,workspace_id,high_watermark,tables_json,created_at,expires_at) VALUES(?,?,1,?,1,100)').run('snapshot', 'workspace', '["kv"]');
  db.query('INSERT INTO sync_snapshot_items(snapshot_id,table_name,pk,kind,payload_json,clock,hlc,op_id) VALUES(?,?,?, ?,?,1,?,?)')
    .run('snapshot', 'kv', 'private-key', 'row', payload, 'legacy:0', opId);
  db.query('INSERT INTO tombstones(id,workspace_id,table_name,pk,deleted_at,clock,hlc,op_id,server_version) VALUES(?,?,?,?,1,1,?,?,1)')
    .run('tomb', 'workspace', 'kv', 'removed', 'legacy:0', 'legacy:tombstone:removed');
  if (sql) db.exec(sql);
  expect(db.query('PRAGMA quick_check').values()).toEqual([['ok']]);
  db.close();
  // A real, checksummed compressed archive: SQL faults do not break copying,
  // authentication/checksum layers, or SQLite physical integrity.
  const archive = join(root, 'data.tgz');
  const tar = Bun.spawnSync(['tar', '-czf', archive, '-C', root, 'sync.sqlite']);
  expect(tar.exitCode).toBe(0);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const checksum = hash(await readFile(archive));
  await writeFile(join(root, 'data.sha256'), checksum);
  expect(hash(await readFile(archive))).toBe(await readFile(join(root, 'data.sha256'), 'utf8'));
  return { path, archive, checksum, audit: () => inspector.inspectSyncSemantics(OfflineDatabase, path) };
}

test.each([
  ['invalid UUID', "UPDATE change_log SET op_id='not-a-uuid'", 'change_log', 'invalid_op_id'],
  ['legacy incident UUID', `UPDATE change_log SET op_id='background-tool:${'a'.repeat(64)}'`, 'change_log', 'invalid_op_id'],
  ['invalid JSON', "UPDATE change_log SET payload_json='{PRIVATE-CONTENT'", 'change_log', 'invalid_json'],
  ['invalid payload', "UPDATE change_log SET payload_json='{}'", 'change_log', 'invalid_payload'],
  ['overflow clock', 'UPDATE change_log SET clock=9007199254740992', 'change_log', 'invalid_clock'],
  ['long HLC', "UPDATE change_log SET hlc=replace(hex(zeroblob(257)),'0','a')", 'change_log', 'invalid_hlc'],
  ['empty HLC', "UPDATE change_log SET hlc=''", 'change_log', 'invalid_hlc'],
  ['unknown table', "UPDATE change_log SET table_name='private-table'", 'change_log', 'invalid_table'],
  ['tombstone fault', 'UPDATE tombstones SET deleted_at=-1', 'tombstones', 'invalid_deleted_at'],
  ['orphan snapshot item', 'DELETE FROM sync_snapshots', 'sync_snapshot_items', 'missing_snapshot'],
  ['snapshot beyond watermark', 'UPDATE sync_snapshots SET high_watermark=0', 'sync_snapshot_items', 'snapshot_after_watermark'],
  ['inconsistent counter', 'UPDATE server_version_counter SET value=0', 'server_version_counter', 'counter_below_log'],
  ['materialized poison', "UPDATE s_kv SET data_json='{PRIVATE-CONTENT'", 's_kv', 'invalid_json'],
  ['oversized payload', "UPDATE change_log SET payload_json=hex(zeroblob(524289))", 'change_log', 'row_too_large'],
])('checksum-valid physically healthy archive reports %s without private contents', async (_name, sql, table, reason) => {
  const f = await fixture(sql);
  const result = f.audit();
  expect(result).toMatchObject({ contract: 1, complete: true, healthy: false });
  expect(result.faults).toContainEqual(expect.objectContaining({ table, ...(table === 'sync_snapshot_items' ? { keySha256: expect.stringMatching(/^[a-f0-9]{64}$/) } : { rowid: '1' }), reason }));
  if (table === 'change_log') expect(result.faults).toContainEqual(expect.objectContaining({ serverVersion: '1' }));
  const output = JSON.stringify(result);
  for (const secret of ['PRIVATE-CONTENT', 'private-key', 'private-name', 'private-table', 'background-tool:']) expect(output).not.toContain(secret);
  expect(createHash('sha256').update(await readFile(f.archive)).digest('hex')).toBe(f.checksum);
});

test('clean backup and legitimate historical snapshot revisions pass; audit never mutates bytes', async () => {
  const f = await fixture();
  const before = await readFile(f.path);
  expect(f.audit()).toMatchObject({ healthy: true, complete: true, faults: [] });
  expect(await readFile(f.path)).toEqual(before);
  const db = new Database(f.path);
  // Snapshot items are immutable historical captures, not today's winner.
  db.exec("UPDATE s_kv SET clock=2; UPDATE sync_snapshot_items SET op_id='legacy:kv:private-key:1',hlc='legacy:0'; DELETE FROM kysely_migration WHERE name='033_tool_result_operation_ids'");
  db.close();
  expect(f.audit()).toMatchObject({ healthy: true, complete: true, faults: [] });
});

test('diagnostic output stays bounded while counting all faults', async () => {
  const f = await fixture();
  const db = new Database(f.path);
  db.exec("WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x+1 FROM n WHERE x<150) INSERT INTO change_log(id,workspace_id,server_version,table_name,pk,op,clock,hlc,device_id,op_id) SELECT 'log'||x,'workspace',x,'kv','k','delete',1,'h','d','bad'||x FROM n; UPDATE server_version_counter SET value=150");
  db.close();
  expect(f.audit()).toMatchObject({ healthy: false, complete: true, faultCount: 149, diagnosticsTruncated: true });
  expect(f.audit().faults.length).toBe(100);
});
