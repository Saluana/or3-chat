import { createHash } from 'node:crypto';
// App-owned offline compatibility contract v1, not a provider runtime export.
// Only trusted image code runs; archived databases are opened without migration.
import { createRequire } from 'node:module';
import { readFileSync, lstatSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSPECTION_PROFILE = Object.freeze({ contract: 1, sqlite: '0.0.31', filesystem: '0.0.18' });
export const HISTORY_SQLITE_VERSION = '0.0.31';
export const S3_INSPECTION_PROFILE = Object.freeze({ contract: 2, sqlite: '0.0.31', s3: '0.0.15' });
export const QUALIFIED_MIGRATIONS = ['001_init', '002_sync_tables', '003_sync_hardening', '004_auth_invites', '005_admin_stores', '006_sync_snapshots', '007_device_cursor_ownership', '008_upload_intents', '009_or3_connect', '010_connect_user_code_hmac', '011_connect_environment_scope_indexes', '012_connect_credential_redelivery', '013_connect_environment_lifecycle', '014_connect_retention_activation', '015_rate_limits', '016_connect_runtime_binding', '017_background_jobs', '018_background_admission_cancels', '019_background_generation_history', '020_background_generation_receipts', '021_background_request_usage', '022_canonical_chat_reader', '023_legacy_chat_seek_index', '024_signup_invites', '025_background_shutdown_accounting', '026_retained_storage_usage', '027_verified_storage_usage', '028_user_scoped_device_cursors', '029_delegation_wait', '030_storage_generations', '031_storage_generation_uploads', '032_sync_observations', '033_tool_result_operation_ids'];
export const HISTORY_MIGRATIONS = [...QUALIFIED_MIGRATIONS, '034_sync_intent_fingerprint', '035_sync_unavailable_records', '036_sync_history_incarnation'];
// Explicitly retain complete published histories when a future migration is added.
const QUALIFIED_MIGRATION_COUNTS = [24, 26, 28, 29, 31, 32, 33, 36];
const MAX_ENTRIES = 100_000;
const MAX_DATABASE_BYTES = 192 * 1024 * 1024;
// One MiB accommodates the admitted 256 KiB payload and persisted fields.
const MAX_ROW_BYTES = 1024 * 1024;

export function assertInspectionProfile(profile) {
  if (profile?.contract !== 1 || profile.sqlite !== INSPECTION_PROFILE.sqlite || profile.filesystem !== INSPECTION_PROFILE.filesystem) {
    throw new Error(`Unsupported offline backup inspection profile; qualified SQLite ${INSPECTION_PROFILE.sqlite} and FS ${INSPECTION_PROFILE.filesystem} image required`);
  }
}

export function assertS3InspectionProfile(profile) {
  if (profile?.contract !== S3_INSPECTION_PROFILE.contract || profile.sqlite !== S3_INSPECTION_PROFILE.sqlite || profile.s3 !== S3_INSPECTION_PROFILE.s3) {
    throw new Error(`Unsupported offline S3 inspection profile; qualified SQLite ${S3_INSPECTION_PROFILE.sqlite} and S3 ${S3_INSPECTION_PROFILE.s3} image required`);
  }
}

export function assertArchiveInspectionProfile(profile) {
  if (profile?.contract === 2) assertS3InspectionProfile(profile);
  else assertInspectionProfile(profile);
}

// The managed image pins BusyBox's verbose tar format. Unsupported/ambiguous
// inventory formats fail closed rather than guessing file names or link types.
export function readBackupInventory(text, legacy = false) {
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Backup inspection inventory resource limit exceeded');
  const entries = new Map();
  for (const line of text.trimEnd().split('\n')) {
    const match = /^([a-z-])[rwxstST-]{9}\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.*)$/.exec(line);
    if (!match) throw new Error('Unsupported backup inventory format');
    // BusyBox appends link targets to verbose names; decode the entry name
    // so a linked storage ancestor cannot hide behind its printed target.
    const separator = match[1] === 'l' ? ' -> ' : match[1] === 'h' ? ' link to ' : undefined;
    if (separator && match[3].split(separator).length !== 2) throw new Error('Unsupported backup link inventory format');
    const original = separator ? match[3].split(separator)[0] : match[3];
    const name = original.replace(/^\.\//, '').replace(/\/$/, '');
    if (original === './' || original === '.') continue;
    if (name.length > 1024 || /[\x00-\x1f\\]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe backup inventory path');
    if (entries.has(name)) throw new Error('Duplicate backup inventory path');
    if (entries.size >= MAX_ENTRIES) throw new Error('Backup inspection inventory resource limit exceeded');
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size)) throw new Error('Invalid backup inventory size');
    entries.set(name, { type: match[1], size, original });
  }
  let bytes = 0;
  const selected = [];
  for (const name of (legacy ? ['sync.sqlite', 'sync.sqlite-wal', 'sync.sqlite-shm', 'auth.sqlite', 'auth.sqlite-wal', 'auth.sqlite-shm'] : ['sync.sqlite', 'sync.sqlite-wal'])) {
    const entry = entries.get(name);
    if (!entry && /-(wal|shm)$/.test(name)) continue;
    if (!entry || entry.type !== '-') throw new Error('Backup inspection requires regular SQLite database/WAL entries');
    bytes += entry.size;
    selected.push(entry.original);
  }
  if (bytes > MAX_DATABASE_BYTES) throw new Error('Backup inspection database scratch resource limit exceeded');
  return { entries, selected, bytes };
}

function openCanonicalDatabase(Database, databasePath) {
  for (const path of [databasePath, `${databasePath}-wal`]) {
    try { if (!lstatSync(path).isFile()) throw new Error('Backup inspection database input must be regular'); }
    catch (error) { if (error.code !== 'ENOENT' || path === databasePath) throw error; }
  }
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('trusted_schema=OFF');
    db.pragma('query_only=ON');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Backup inspection SQLite quick_check failed');
    for (const name of ['s_file_meta', 'kysely_migration']) {
      if (db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(name)?.type !== 'table') throw new Error('Unsupported offline canonical SQLite schema');
    }
    const migrationNames = db.prepare('SELECT CASE WHEN length(CAST(name AS BLOB)) <= 128 THEN name ELSE NULL END AS name FROM kysely_migration ORDER BY name LIMIT ?').all(HISTORY_MIGRATIONS.length + 1).map(row => row.name);
    // Accept previously published histories and the current candidate.
    // Interrupted upgrades remain unsupported.
    const expectedMigrations = HISTORY_MIGRATIONS.slice(0, migrationNames.length);
    if (!QUALIFIED_MIGRATION_COUNTS.includes(migrationNames.length) || JSON.stringify(migrationNames) !== JSON.stringify(expectedMigrations)) throw new Error('Unsupported offline canonical SQLite migration history');
    const columns = db.prepare('PRAGMA table_info(s_file_meta)').all();
    for (const [name, type, pk] of [['workspace_id', 'TEXT', 1], ['id', 'TEXT', 2], ['data_json', 'TEXT', 0], ['deleted', 'INTEGER', 0]]) {
      if (!columns.some(column => column.name === name && column.type === type && column.pk === pk)) throw new Error('Unsupported offline canonical SQLite columns');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Read-only historical policy inspection; never runs provider migrations/reset.
 * Hash files before opening SQLite, which can create/update SHM even read-only. */
export function inspectLegacyHistory(Database, databasePath, authPath) {
  const payloadSha256 = {};
  for (const path of [databasePath, ...(authPath ? [authPath] : [])]) {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = path + suffix;
      let info;
      try { info = lstatSync(file); } catch (error) { if (suffix && error.code === 'ENOENT') { payloadSha256[file.split('/').pop()] = null; continue; } throw error; }
      if (!info.isFile() || info.size > MAX_DATABASE_BYTES) throw new Error('Invalid legacy database payload');
      const hash = createHash('sha256'), chunk = Buffer.alloc(65536), fd = openSync(file, 'r');
      try { for (let n; (n = readSync(fd, chunk, 0, chunk.length, null));) hash.update(chunk.subarray(0,n)); }
      finally { closeSync(fd); }
      payloadSha256[file.split('/').pop()] = hash.digest('hex');
    }
  }
  const db = openCanonicalDatabase(Database, databasePath);
  try {
    const ledger = db.prepare('SELECT name FROM kysely_migration ORDER BY name LIMIT 37').all().map(row => row.name);
    if (JSON.stringify(ledger) !== JSON.stringify(QUALIFIED_MIGRATIONS.slice(0,32))
      || db.prepare("SELECT name FROM sqlite_master WHERE name IN ('sync_history','sync_unavailable_records') LIMIT 1").get()
      || db.prepare('PRAGMA table_info(change_log)').all().some(column => column.name === 'intent_fingerprint')) throw new Error('Unsupported legacy 032 ledger/schema');
    const core = ['change_log','device_cursors','server_version_counter','sync_snapshots','sync_snapshot_items','tombstones',
      's_threads','s_messages','s_projects','s_posts','s_file_meta','s_kv','s_notifications'];
    const schema = db.prepare(`SELECT name,CASE WHEN length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS sql FROM sqlite_master WHERE type='table' AND name IN (${core.map(()=>'?').join(',')}) ORDER BY name`).all(...core);
    // Captured from the exact published 0.1.116 image, not inferred from a
    // package label or ledger rows that could hide missing/modified tables.
    if (createHash('sha256').update(JSON.stringify(schema)).digest('hex') !== '2a0086226c035a29be7aa0883b2469ed0c41910ef1ba3008255c350ed9f2dfd5') throw new Error('Unsupported legacy 032 core schema');
    if (authPath) {
      const auth = new Database(authPath, { readonly: true, fileMustExist: true });
      try { if (auth.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Invalid legacy auth database'); }
      finally { auth.close(); }
    }
    return { policy: 'legacy-032-rollback-v1', ledger: '032', complete: true, payloadSha256 };
  } finally { db.close(); }
}

// Loaded only for semantic inspection; profile preparation and inventory checks
// do not depend on a generated artifact already existing.
const loadReader = () => createRequire(import.meta.url)('./backup-read-classifier.cjs');
const SYNC_TABLES = ['threads', 'messages', 'projects', 'posts', 'file_meta', 'kv', 'notifications'];
const BACKGROUND_TOOL_ID = /^background-tool:[a-f0-9]{64}$/i;
const safe = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0;

/** Read-only, bounded certification; diagnostics contain sanitized locators only. */
export function inspectSyncSemantics(Database, databasePath, { requireHistoryIncarnation = false } = {}) {
  const reader = loadReader();
  const db = openCanonicalDatabase(Database, databasePath);
  const faults = [];
  let inspectedRecords = 0, faultCount = 0, blockingFaultCount = 0, complete = true;
  const started = Date.now();
  const fault = (table, row, reason, recoverable = false) => {
    faultCount++;
    if (!recoverable) blockingFaultCount++;
    if (faults.length < 100) faults.push({ table, ...(row.locator === undefined
      ? { itemOrdinal: row.itemOrdinal, ...(row.oversized ? {} : { keySha256: createHash('sha256').update(JSON.stringify([row.snapshot_id, row.table_name, row.pk, row.kind])).digest('hex') }) }
      : { rowid: row.locator }),
      ...(!/^[-]?[0-9]{1,19}$/.test(row.version_locator ?? '') ? {} : { serverVersion: row.version_locator }), reason });
  };
  // Bound every TEXT transfer, not just JSON. A poisoned key/stamp must not
  // force a large allocation before it can be classified. SQL identifiers here
  // come exclusively from the fixed schema, never archived values.
  const scan = (table, fields, visit, extra = '') => {
    if (!complete) return;
    const selections = fields.map(name => `CASE WHEN length(CAST(t.${name} AS BLOB)) <= ${MAX_ROW_BYTES} THEN t.${name} ELSE NULL END AS ${name}`);
    const oversized = fields.map(name => `length(CAST(t.${name} AS BLOB)) > ${MAX_ROW_BYTES}`).join(' OR ');
    const versions = fields.includes('server_version') ? ",CASE WHEN typeof(t.server_version) IN ('integer','real') THEN CAST(t.server_version AS TEXT) END AS version_locator" : '';
    const locator = table === 'sync_snapshot_items' ? '' : 'CAST(t.rowid AS TEXT) AS locator,';
    const order = table === 'sync_snapshot_items' ? ' ORDER BY snapshot_id,table_name,pk,kind'
      : table === 'change_log' ? ' ORDER BY workspace_id,server_version' : '';
    const rows = db.prepare(`SELECT ${locator}${selections.join(',')},(${oversized}) AS oversized${versions}${extra} FROM ${table} t${order}`).iterate();
    let ordinal = 0;
    for (const row of rows) {
      if (table === 'sync_snapshot_items') row.itemOrdinal = String(++ordinal);
      if (++inspectedRecords > MAX_ENTRIES || Date.now() - started > 60_000) {
        complete = false; fault(table, row, 'audit_resource_limit'); break;
      }
      if (row.oversized) { fault(table, row, 'row_too_large'); continue; }
      visit(row);
    }
  };
  const revision = (table, row, incremental = false, allowEmpty = false) => {
    const schema = incremental ? reader.ChangeStampSchema : reader.SnapshotRevisionSchema;
    if (!schema.shape.clock.safeParse(row.clock).success) fault(table, row, 'invalid_clock', true);
    if (!(allowEmpty && row.hlc === '') && !schema.shape.hlc.safeParse(row.hlc).success) fault(table, row, 'invalid_hlc', true);
    if (BACKGROUND_TOOL_ID.test(row.op_id) || (!(allowEmpty && row.op_id === '') && !schema.shape.opId.safeParse(row.op_id).success)) fault(table, row, 'invalid_op_id', true);
  };
  const identity = (table, row) => {
    if (!reader.isSyncTable(row.table_name)) fault(table, row, 'invalid_table', true);
    if (!reader.SyncRecordIdentifierSchema.safeParse(row.pk).success) fault(table, row, 'invalid_key');
  };
  const json = (table, row, name, required) => {
    if (row[name] === null && !required) return;
    let value;
    try { value = JSON.parse(row[name]); }
    catch { fault(table, row, 'invalid_json', true); return; }
    if (value && typeof value === 'object' && typeof value.op_id === 'string' && BACKGROUND_TOOL_ID.test(value.op_id)) fault(table, row, 'invalid_payload_op_id', true);
    if (!required) return;
    const source = table === 'change_log' ? 'pull' : 'snapshot';
    // Materialized empty legacy stamps receive these fallbacks in snapshots.
    const revision = { clock: row.clock, hlc: row.hlc || 'legacy:0', opId: row.op_id || 'legacy:offline' };
    const record = source === 'pull'
      ? { tableName: row.table_name, pk: row.pk, op: row.op, payload: value, serverVersion: row.server_version,
          stamp: { clock: row.clock, hlc: row.hlc, opId: row.op_id, deviceId: row.device_id } }
      : { tableName: row.table_name, pk: row.pk, kind: 'row', payload: value,
          revision: table === 'sync_snapshot_items' ? { clock: row.clock, hlc: row.hlc, opId: row.op_id } : revision };
    const defect = reader.incomingRecordDefect(source, record);
    // Envelope faults already have precise metadata diagnostics above.
    if (defect && defect !== 'invalid_record_envelope' && defect !== 'unknown_table') fault(table, row, defect, true);
  };
  try {
    if (requireHistoryIncarnation) {
      const ledger = db.prepare('SELECT name FROM kysely_migration ORDER BY name LIMIT 37').all().map(row=>row.name);
      if (JSON.stringify(ledger) !== JSON.stringify(HISTORY_MIGRATIONS)) throw new Error('Incarnation certification requires the complete current ledger');
    }
    for (const table of ['change_log', 'server_version_counter', 'tombstones', 'sync_snapshots', 'sync_snapshot_items', ...SYNC_TABLES.map(name => `s_${name}`)]) {
      if (db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(table)?.type !== 'table') throw new Error('Unsupported offline sync SQLite schema');
    }
    // One SQLite read transaction keeps the inspected head/captures consistent.
    db.prepare('BEGIN').run();
    let previousLogVersion;
    scan('change_log', ['workspace_id', 'server_version', 'table_name', 'pk', 'op', 'payload_json', 'clock', 'hlc', 'device_id', 'op_id'], row => {
      identity('change_log', row); revision('change_log', row, true);
      if (!safe(row.server_version) || row.server_version === 0) fault('change_log', row, 'invalid_server_version');
      if (previousLogVersion?.[0] === row.workspace_id && previousLogVersion[1] === row.server_version) fault('change_log', row, 'duplicate_server_version');
      previousLogVersion = [row.workspace_id, row.server_version];
      if (typeof row.device_id !== 'string' || !text(row.device_id.trim()) || row.device_id.trim().length > 256) fault('change_log', row, 'invalid_device_id');
      if (!text(row.workspace_id)) fault('change_log', row, 'invalid_workspace');
      if (!['put', 'delete'].includes(row.op)) fault('change_log', row, 'invalid_operation');
      json('change_log', row, 'payload_json', row.op === 'put');
      if (!row.has_counter) fault('change_log', row, 'missing_counter');
    }, ',EXISTS(SELECT 1 FROM server_version_counter c WHERE c.workspace_id=t.workspace_id) AS has_counter');
    for (const name of SYNC_TABLES) {
      const table = `s_${name}`;
      scan(table, ['workspace_id', 'id', 'data_json', 'clock', 'hlc', 'op_id', 'deleted'], row => {
        revision(table, row, false, true);
        if (!text(row.workspace_id) || !reader.SyncRecordIdentifierSchema.safeParse(row.id).success) fault(table, row, 'invalid_key');
        if (row.deleted !== 0 && row.deleted !== 1) fault(table, row, 'invalid_deleted');
        // Delete-before-put placeholders do not have a live payload schema.
        json(table, { ...row, table_name: name, pk: row.id }, 'data_json', row.deleted === 0);
      });
    }
    scan('tombstones', ['workspace_id', 'table_name', 'pk', 'clock', 'hlc', 'op_id', 'deleted_at', 'server_version'], row => {
      identity('tombstones', row);
      if (!text(row.workspace_id)) fault('tombstones', row, 'invalid_workspace');
      revision('tombstones', row, false, true);
      if (!safe(row.deleted_at)) fault('tombstones', row, 'invalid_deleted_at');
      if (!safe(row.server_version)) fault('tombstones', row, 'invalid_server_version');
    });
    scan('sync_snapshots', ['workspace_id', 'id', 'high_watermark', 'tables_json', 'created_at', 'expires_at'], row => {
      if (!safe(row.high_watermark) || !safe(row.created_at) || !safe(row.expires_at) || row.expires_at < row.created_at) fault('sync_snapshots', row, 'invalid_snapshot_metadata');
      if (row.high_watermark > (row.counter ?? 0)) fault('sync_snapshots', row, 'snapshot_above_counter');
      let tables;
      try { tables = JSON.parse(row.tables_json); } catch { fault('sync_snapshots', row, 'invalid_json'); return; }
      if (!Array.isArray(tables) || tables.some(name => !SYNC_TABLES.includes(name)) || new Set(tables).size !== tables.length) fault('sync_snapshots', row, 'invalid_table');
    }, ",(SELECT CASE WHEN typeof(c.value) IN ('integer','real') THEN c.value END FROM server_version_counter c WHERE c.workspace_id=t.workspace_id) AS counter");
    let previousSnapshotKey;
    scan('sync_snapshot_items', ['snapshot_id', 'table_name', 'pk', 'kind', 'payload_json', 'clock', 'hlc', 'op_id', 'server_deleted_at'], row => {
      // Primary-key order makes contradictory kinds adjacent. Keep only one
      // tuple, without delimiter ambiguity or a set growing with the database.
      const key = [row.snapshot_id, row.table_name, row.pk];
      if (previousSnapshotKey?.every((part, index) => part === key[index])) fault('sync_snapshot_items', row, 'duplicate_snapshot_key');
      previousSnapshotKey = key;
      identity('sync_snapshot_items', row); revision('sync_snapshot_items', row);
      if (!row.has_snapshot) fault('sync_snapshot_items', row, 'missing_snapshot');
      else if (!row.in_snapshot_tables) fault('sync_snapshot_items', row, 'snapshot_table_mismatch');
      if (row.after_watermark) fault('sync_snapshot_items', row, 'snapshot_after_watermark');
      if (!['row', 'tombstone'].includes(row.kind)) fault('sync_snapshot_items', row, 'invalid_kind');
      if (row.kind === 'tombstone' && (!safe(row.server_deleted_at) || row.payload_json !== null)) fault('sync_snapshot_items', row, 'invalid_tombstone');
      json('sync_snapshot_items', row, 'payload_json', row.kind === 'row');
    }, `,EXISTS(SELECT 1 FROM sync_snapshots s WHERE s.id=t.snapshot_id) AS has_snapshot,
      EXISTS(SELECT 1 FROM sync_snapshots s,json_each(CASE WHEN length(CAST(s.tables_json AS BLOB)) <= ${MAX_ROW_BYTES} THEN CASE WHEN json_valid(s.tables_json) THEN s.tables_json ELSE '[]' END ELSE '[]' END) j WHERE s.id=t.snapshot_id AND j.value=t.table_name) AS in_snapshot_tables,
      EXISTS(SELECT 1 FROM sync_snapshots s JOIN change_log l ON l.workspace_id=s.workspace_id AND l.op_id=t.op_id WHERE s.id=t.snapshot_id AND l.server_version>s.high_watermark) AS after_watermark`);
    scan('server_version_counter', ['workspace_id', 'value'], row => {
      if (!safe(row.value)) fault('server_version_counter', row, 'invalid_counter');
      else if (row.value === Number.MAX_SAFE_INTEGER) fault('server_version_counter', row, 'exhausted_counter');
      if (row.value < row.log_head) fault('server_version_counter', row, 'counter_below_log');
    }, ",(SELECT MAX(CASE WHEN typeof(l.server_version) IN ('integer','real') THEN l.server_version END) FROM change_log l WHERE l.workspace_id=t.workspace_id) AS log_head");
    let historyIncarnation;
    if (requireHistoryIncarnation) {
      const rows = db.prepare("SELECT id, CASE WHEN typeof(incarnation)='text' AND length(CAST(incarnation AS BLOB))<=128 THEN incarnation ELSE NULL END AS incarnation FROM sync_history LIMIT 2").all();
      if (rows.length !== 1 || rows[0].id !== 1 || typeof rows[0].incarnation !== 'string' || !/^[\x00-\x7f]{1,128}$/.test(rows[0].incarnation)) throw new Error('Invalid sync history singleton');
      historyIncarnation = rows[0].incarnation;
    }
    return { ...(historyIncarnation ? { historyIncarnation } : {}), contract: 1, complete, healthy: complete && faultCount === 0, degraded: complete && faultCount > 0 && blockingFaultCount === 0, inspectedRecords, faultCount, faults, diagnosticsTruncated: faultCount > faults.length };
  } finally { db.close(); }
}

export function inspectCanonicalReferences(Database, databasePath, inventory, storageRoot) {
  const root = relative('/data', resolve(storageRoot));
  if (root === '..' || root.startsWith('../') || root.startsWith('/')) throw new Error('Unsupported offline backup storage root outside /data');
  const db = openCanonicalDatabase(Database, databasePath);
  let live = 0;
  let inspected = 0;
  const started = Date.now();
  try {
    const requireEntry = (name, size) => {
      if (inventory.entries.get(name)?.type !== '-') throw new Error('Backup is missing a regular payload or sidecar required by live canonical attachment metadata');
      if (size !== undefined && inventory.entries.get(name).size !== size) throw new Error('Backup canonical attachment size mismatch');
      for (let parent = name.slice(0, name.lastIndexOf('/')); parent; parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '') {
        if (inventory.entries.has(parent) && inventory.entries.get(parent).type !== 'd') throw new Error('Backup attachment ancestor must be a directory');
      }
    };
    // Native iteration bounds memory independently of archive row count. Check
    // JSON size in SQLite before retrieving/parsing any potentially huge row.
    const rows = db.prepare('SELECT workspace_id,id,deleted,length(CAST(data_json AS BLOB)) AS bytes,CASE WHEN length(CAST(data_json AS BLOB)) <= ? THEN data_json ELSE NULL END AS data_json FROM s_file_meta WHERE deleted IS NOT 1').iterate(MAX_ROW_BYTES);
    for (const row of rows) {
      if (++inspected > MAX_ENTRIES || Date.now() - started > 60_000 || row.bytes > MAX_ROW_BYTES) throw new Error('Backup canonical reference inspection resource limit exceeded');
      if (row.deleted !== 0) throw new Error('Invalid canonical attachment deletion state');
      const payload = JSON.parse(row.data_json);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid canonical attachment metadata');
      const size = payload.size_bytes ?? payload.sizeBytes;
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid canonical attachment size');
      const storageId = payload.storage_id ?? payload.storageId;
      if (storageId === undefined || storageId === null || typeof storageId === 'string' && storageId.trim() === '') continue;
      if (typeof storageId !== 'string') throw new Error('Invalid canonical attachment storage ID');
      if (typeof row.workspace_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.workspace_id)) throw new Error('Invalid canonical attachment workspace');
      const hash = typeof row.id === 'string' ? row.id.trim().toLowerCase() : '';
      const match = /^(?:(sha256|md5):)?([a-f0-9]+)$/.exec(hash);
      const algorithm = match?.[1] ?? (match?.[2].length === 64 ? 'sha256' : match?.[2].length === 32 ? 'md5' : undefined);
      if (!match || !algorithm || match[2].length !== (algorithm === 'sha256' ? 64 : 32)) throw new Error('Invalid canonical filesystem hash');
      if (storageId.startsWith('fs-generation-')) {
        const parts = storageId.split(':');
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        if (parts.length !== 5 || parts[0] !== 'fs-generation-v1' || !uuid.test(parts[1]) || !uuid.test(parts[3]) ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(parts[2]) || parts[2] !== row.workspace_id || algorithm !== 'sha256' || parts[4] !== match[2]) {
          throw new Error('Invalid canonical filesystem generation identity');
        }
        const generation = db.prepare('SELECT workspace_id,hash,storage_provider_id,storage_id,size_bytes,state FROM storage_object_generations WHERE generation_id = ?').get(parts[3]);
        if (!generation || generation.workspace_id !== row.workspace_id || generation.storage_provider_id !== 'fs' ||
            generation.storage_id !== storageId || generation.size_bytes !== size || generation.state !== 'verified' ||
            typeof generation.hash !== 'string' || generation.hash.replace(/^sha256:/i, '').toLowerCase() !== match[2]) {
          throw new Error('Invalid canonical filesystem generation binding');
        }
        const base = `${root ? `${root}/` : ''}generations-v1`;
        const slot = `${base}/workspaces/${row.workspace_id}/${parts[3]}`;
        // Inventory proves regular entries and ancestry. Authenticated manifest
        // contents and payload hashes are verified after extraction, before start.
        requireEntry(`${base}/namespace.json`);
        requireEntry(`${slot}/ready.json`);
        requireEntry(`${slot}/payload/blob`, size);
      } else {
        const name = `${root ? `${root}/` : ''}workspaces/${row.workspace_id}/${algorithm}_${match[2]}`;
        requireEntry(name, size);
        requireEntry(`${name}.meta.json`);
      }
      live++;
    }
    return { contract: 1, inspectedMetadata: inspected, liveAttachments: live, complete: true };
  } finally { db.close(); }
}

// This inventory does not certify a backup: it only identifies the objects
// that a complete S3 capture and offline verification must subsequently prove.
export function* iterateS3References(Database, databasePath, { keyPrefix }) {
  if (typeof keyPrefix !== 'string' || keyPrefix.length > 512 || /[\x00-\x1f\\]/.test(keyPrefix) ||
      (keyPrefix && (keyPrefix.startsWith('/') || !keyPrefix.endsWith('/') || keyPrefix.slice(0, -1).split('/').some(part => !part || part === '.' || part === '..')))) {
    throw new Error('Invalid canonical S3 key prefix');
  }
  const db = openCanonicalDatabase(Database, databasePath);
  let started = Date.now();
  const keys = new Set();
  let inspected = 0;
  try {
    const rows = db.prepare('SELECT workspace_id,id,deleted,length(CAST(data_json AS BLOB)) AS bytes,CASE WHEN length(CAST(data_json AS BLOB)) <= ? THEN data_json ELSE NULL END AS data_json FROM s_file_meta WHERE deleted IS NOT 1 ORDER BY workspace_id,id').iterate(MAX_ROW_BYTES);
    for (const row of rows) {
      if (++inspected > MAX_ENTRIES || Date.now() - started > 60_000 || row.bytes > MAX_ROW_BYTES) throw new Error('Backup canonical reference inspection resource limit exceeded');
      if (row.deleted !== 0) throw new Error('Invalid canonical attachment deletion state');
      const payload = JSON.parse(row.data_json);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid canonical attachment metadata');
      const sizeBytes = payload.size_bytes ?? payload.sizeBytes;
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 2 ** 30) throw new Error('Invalid canonical attachment size');
      const storageId = payload.storage_id ?? payload.storageId;
      if (storageId === undefined || storageId === null || typeof storageId === 'string' && storageId.trim() === '') continue;
      if (typeof row.workspace_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.workspace_id)) throw new Error('Invalid canonical attachment workspace');
      const value = typeof row.id === 'string' ? row.id.trim().toLowerCase() : '';
      const match = /^(?:(sha256|md5):)?([a-f0-9]+)$/.exec(value);
      const algorithm = match?.[1] ?? (match?.[2].length === 64 ? 'sha256' : match?.[2].length === 32 ? 'md5' : undefined);
      if (!match || !algorithm || match[2].length !== (algorithm === 'sha256' ? 64 : 32)) throw new Error('Invalid canonical S3 hash');
      const hash = `${algorithm}:${match[2]}`;
      if (storageId !== `${keyPrefix}${row.workspace_id}/${hash}` || keys.has(storageId)) throw new Error('Invalid canonical S3 storage ID');
      keys.add(storageId);
      // Consumers may spend hours transferring this object before requesting
      // the next row. Only active database inspection counts toward the limit.
      const suspendedAt = Date.now();
      yield { workspaceId: row.workspace_id, hash, storageId, sizeBytes };
      started += Math.max(0, Date.now() - suspendedAt);
    }
  } finally { db.close(); }
}

// This is a capacity estimate only, not certification of remote file bytes.
export function summarizeS3References(Database, databasePath, options) {
  let references = 0, payloadBytes = 0;
  for (const ref of iterateS3References(Database, databasePath, options)) {
    references++;
    payloadBytes += ref.sizeBytes;
  }
  return { contract: 2, references, payloadBytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const profile = JSON.parse(readFileSync(new URL('./backup-inspection-profile.json', import.meta.url), 'utf8'));
    if (process.argv[2] === 'legacy') {
      assertInspectionProfile(profile);
      const Database = createRequire(import.meta.url)('/app/.output/server/node_modules/better-sqlite3');
      const root = process.argv[3] ?? '/scratch';
      console.log(JSON.stringify(inspectLegacyHistory(Database, root + '/sync.sqlite', root + '/auth.sqlite')));
    } else if (process.argv[2] === 'sync') {
      assertArchiveInspectionProfile(profile);
      const Database = createRequire(import.meta.url)('/app/.output/server/node_modules/better-sqlite3');
      const result = inspectSyncSemantics(Database, process.argv[3] ?? '/scratch/sync.sqlite', { requireHistoryIncarnation: profile.historyIncarnation === 'v1' });
      console.log(JSON.stringify(result));
      if (!result.healthy) {
        console.error(`Sync semantic certification failed: ${JSON.stringify(result)}`);
        process.exitCode = 1;
      }
    } else if (process.argv[2] === 's3-summary') {
      assertS3InspectionProfile(profile);
      const Database = createRequire(import.meta.url)('/app/.output/server/node_modules/better-sqlite3');
      console.log(JSON.stringify(summarizeS3References(Database, '/scratch/sync.sqlite', { keyPrefix: process.argv[3] })));
    } else {
      if (process.argv[2] === 'inventory') assertArchiveInspectionProfile(profile);
      else assertInspectionProfile(profile);
      const inventory = readBackupInventory(readFileSync('/scratch/inventory', 'utf8'), process.argv[3] === 'legacy');
      if (process.argv[2] === 'inventory') {
        console.log(JSON.stringify({ selected: inventory.selected, bytes: inventory.bytes }));
      } else if (process.argv[2] === 'references') {
        const Database = createRequire(import.meta.url)('/app/.output/server/node_modules/better-sqlite3');
        console.log(JSON.stringify(inspectCanonicalReferences(Database, '/scratch/sync.sqlite', inventory, process.argv[3])));
      } else throw new Error('Unsupported backup inspection operation');
    }
  } catch (error) {
    // No archived JSON/path values or private record contents enter diagnostics.
    console.error(error instanceof SyntaxError ? 'Invalid canonical backup metadata JSON' : error.message);
    process.exitCode = 1;
  }
}
