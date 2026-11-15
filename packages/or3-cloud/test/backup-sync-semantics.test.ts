import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as inspector from '../../../scripts/docker/backup-inspect.mjs';
import { TABLE_PAYLOAD_SCHEMAS, ChangeStampSchema, SnapshotRevisionSchema, PullResponseSchema } from '../../../shared/sync/schemas';

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
  ...(['s_kv', 'tombstones', 'sync_snapshot_items'] as const).map(table => [
    `legacy incident revision in ${table}`, `UPDATE ${table} SET op_id='background-tool:${'a'.repeat(64)}'`, table, 'invalid_op_id',
  ]),
  ...([['change_log', 'payload_json'], ['s_kv', 'data_json'], ['sync_snapshot_items', 'payload_json']] as const).map(([table, column]) => [
    `embedded incident revision in ${table}`, `UPDATE ${table} SET ${column}=json_set(${column},'$.op_id','background-tool:${'a'.repeat(64)}')`, table, 'invalid_payload_op_id',
  ]),
  ['invalid JSON', "UPDATE change_log SET payload_json='{PRIVATE-CONTENT'", 'change_log', 'invalid_json'],
  ['invalid payload', "UPDATE change_log SET payload_json='{}'", 'change_log', 'invalid_payload'],
  ['overflow clock', 'UPDATE change_log SET clock=9007199254740992', 'change_log', 'invalid_clock'],
  ['long HLC', "UPDATE change_log SET hlc=replace(hex(zeroblob(257)),'0','a')", 'change_log', 'invalid_hlc'],
  ['empty HLC', "UPDATE change_log SET hlc=''", 'change_log', 'invalid_hlc'],
  ['unknown table', "UPDATE change_log SET table_name='private-table'", 'change_log', 'invalid_table'],
  ['tombstone fault', 'UPDATE tombstones SET deleted_at=-1', 'tombstones', 'invalid_deleted_at'],
  ['orphan snapshot item', 'DELETE FROM sync_snapshots', 'sync_snapshot_items', 'missing_snapshot'],
  ['contradictory snapshot item', "INSERT INTO sync_snapshot_items SELECT snapshot_id,table_name,pk,'tombstone',NULL,clock,hlc,op_id,1 FROM sync_snapshot_items", 'sync_snapshot_items', 'duplicate_snapshot_key'],
  ['snapshot beyond watermark', 'UPDATE sync_snapshots SET high_watermark=0', 'sync_snapshot_items', 'snapshot_after_watermark'],
  ['snapshot ahead of counter', 'UPDATE sync_snapshots SET high_watermark=2', 'sync_snapshots', 'snapshot_above_counter'],
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
  db.exec("UPDATE s_kv SET clock=2; UPDATE server_version_counter SET value=2; UPDATE sync_snapshot_items SET op_id='legacy:kv:private-key:1',hlc='legacy:0'; DELETE FROM kysely_migration WHERE name='033_tool_result_operation_ids'");
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

const readerPayload = {
  id: 'private-key', hash: 'private-key', name: 'private-name', status: 'ready',
  thread_id: 'thread', user_id: 'user', role: 'assistant', order_key: 'order',
  title: 'title', content: 'content', post_type: 'document', type: 'info',
  deleted: false, pinned: false, index: 0, created_at: 1, updated_at: 1, clock: 1,
};
test.each([
  ['threads', 'title_source', 'invalid', false],
  ['threads', 'title', 3, false],
  ['threads', 'branch_mode', 'invalid', false],
  ['threads', 'root_thread_id', 3, false],
  ['threads', 'summary_message_id', 3, false],
  ['threads', 'fork_reason', null, false],
  ['posts', 'title_source', null, false],
  ['messages', 'hlc', null, false],
  ['file_meta', 'kind', null, false],
  ['file_meta', 'mime_type', 3, false],
  ['file_meta', 'size_bytes', '3', false],
  ['notifications', 'thread_id', null, false],
  ['notifications', 'document_id', 3, false],
  ['notifications', 'body', null, false],
  ['notifications', 'actions', {}, false],
  ['notifications', 'read_at', '3', false],
  ['notifications', 'deleted_at', null, false],
  ['threads', 'title', null, true],
  ['threads', 'branch_mode', null, true],
  ['threads', 'root_thread_id', null, true],
  ['threads', 'summary_message_id', null, true],
  ['threads', 'forkReason', 'manual', true],
  ['posts', 'titleSource', 'generated', true],
  ['messages', 'hlc', '', true],
  ['notifications', 'actions', [null, { arbitrary: true }], true],
  ['kv', 'clock', -1, true],
  ['kv', 'clock', 0.5, true],
  ['kv', 'clock', 1e20, true],
] as const)('offline payload agrees with reader for %s.%s=%j', async (table, field, value, accepted) => {
  const record = { ...readerPayload, [field]: value };
  expect(TABLE_PAYLOAD_SCHEMAS[table]!.safeParse(record).success).toBe(accepted);
  const f = await fixture();
  const db = new Database(f.path);
  db.query('UPDATE change_log SET table_name=?,payload_json=?').run(table, JSON.stringify(record));
  db.close();
  expect(f.audit()).toMatchObject({ complete: true, healthy: accepted });
});

test('offline revisions preserve exact incremental and legacy reader rules', async () => {
  const f = await fixture();
  const hlc = 'opaque '.repeat(73).slice(0, 512);
  expect(ChangeStampSchema.safeParse({ deviceId: ' device ', opId, hlc, clock: Number.MAX_SAFE_INTEGER }).success).toBe(true);
  expect(SnapshotRevisionSchema.safeParse({ opId: 'legacy:kv:key:1', hlc: hlc + 'x', clock: 1 }).success).toBe(true);
  const db = new Database(f.path);
  db.query('UPDATE change_log SET hlc=?,clock=?,device_id=?').run(hlc, Number.MAX_SAFE_INTEGER, ' device ');
  db.query('UPDATE sync_snapshot_items SET hlc=?,op_id=?').run(hlc + 'x', 'legacy:kv:key:1');
  db.exec("UPDATE s_kv SET hlc='',op_id=''; UPDATE tombstones SET hlc='',op_id=''; DELETE FROM kysely_migration WHERE name='033_tool_result_operation_ids'");
  db.close();
  expect(f.audit()).toMatchObject({ healthy: true, complete: true, faults: [] });
});

test.each([
  ['ffffffff-ffff-ffff-ffff-ffffffffffff', true],
  ['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', false],
  ['00000000-0000-0000-0000-000000000000', true],
  [opId.toUpperCase(), true],
] as const)('offline UUID acceptance agrees with reader for %s', async (opId, accepted) => {
  expect(ChangeStampSchema.safeParse({ deviceId: 'device', opId, hlc: 'opaque', clock: 1 }).success).toBe(accepted);
  const f = await fixture();
  const db = new Database(f.path);
  db.query('UPDATE change_log SET op_id=?').run(opId);
  db.close();
  expect(f.audit()).toMatchObject({ healthy: accepted, complete: true });
});

test.each([['workspace', false], ['other-workspace', true]] as const)('duplicate versions are scoped to %s', async (workspace, healthy) => {
  const change = { serverVersion: 1, tableName: 'kv', pk: 'key', op: 'delete', stamp: { deviceId: 'd', opId, hlc: 'h', clock: 1 } };
  expect(PullResponseSchema.safeParse({ changes: [change, { ...change, stamp: { ...change.stamp, opId: '12345678-1234-4234-8234-123456789abd' } }], nextCursor: 1, hasMore: false, oldestRetainedVersion: 1, requiresSnapshot: false }).success).toBe(false);
  const f = await fixture();
  const db = new Database(f.path);
  db.query('INSERT OR IGNORE INTO server_version_counter VALUES(?,1)').run(workspace);
  db.query("INSERT INTO change_log(id,workspace_id,server_version,table_name,pk,op,clock,hlc,device_id,op_id) VALUES('duplicate',?,1,'kv','key','delete',1,'h','d','12345678-1234-4234-8234-123456789abd')").run(workspace);
  db.close();
  const result = f.audit();
  expect(result).toMatchObject({ complete: true, healthy });
  if (!healthy) expect(result.faults).toContainEqual(expect.objectContaining({ table: 'change_log', reason: 'duplicate_server_version' }));
});

test('large healthy log stops with incomplete certification at the work ceiling', async () => {
  const f = await fixture(`
    WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x+1 FROM n WHERE x<100001)
    INSERT INTO change_log(id,workspace_id,server_version,table_name,pk,op,clock,hlc,device_id,op_id)
    SELECT 'log'||x,'workspace',x,'kv','key','delete',1,'h','d',printf('00000000-0000-4000-8000-%012x',x) FROM n;
    UPDATE server_version_counter SET value=100001;
  `);
  expect(f.audit()).toMatchObject({ complete: false, healthy: false, inspectedRecords: 100001, faultCount: 1,
    faults: [{ table: 'change_log', rowid: '100001', serverVersion: '100001', reason: 'audit_resource_limit' }] });
});

test('numeric-affinity text and binary stamps are diagnosed without exposing their values', async () => {
  const f = await fixture("UPDATE change_log SET server_version='PRIVATE-VERSION',device_id=X'50524956415445'; UPDATE server_version_counter SET value='PRIVATE-COUNTER'");
  const result = f.audit();
  expect(result).toMatchObject({ healthy: false, complete: true });
  expect(result.faults).toContainEqual({ table: 'change_log', rowid: '1', reason: 'invalid_server_version' });
  expect(result.faults).toContainEqual({ table: 'change_log', rowid: '1', reason: 'invalid_device_id' });
  expect(result.faults).toContainEqual({ table: 'server_version_counter', rowid: '1', reason: 'invalid_counter' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
