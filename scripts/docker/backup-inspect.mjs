// App-owned offline compatibility contract v1, not a provider runtime export.
// Only trusted image code runs; archived databases are opened without migration.
import { createRequire } from 'node:module';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSPECTION_PROFILE = Object.freeze({ contract: 1, sqlite: '0.0.22', filesystem: '0.0.15' });
export const QUALIFIED_MIGRATIONS = ['001_init', '002_sync_tables', '003_sync_hardening', '004_auth_invites', '005_admin_stores', '006_sync_snapshots', '007_device_cursor_ownership', '008_upload_intents', '009_or3_connect', '010_connect_user_code_hmac', '011_connect_environment_scope_indexes', '012_connect_credential_redelivery', '013_connect_environment_lifecycle', '014_connect_retention_activation', '015_rate_limits', '016_connect_runtime_binding', '017_background_jobs', '018_background_admission_cancels', '019_background_generation_history', '020_background_generation_receipts', '021_background_request_usage', '022_canonical_chat_reader', '023_legacy_chat_seek_index', '024_signup_invites', '025_background_shutdown_accounting', '026_retained_storage_usage', '027_verified_storage_usage', '028_user_scoped_device_cursors'];
const MAX_ENTRIES = 100_000;
const MAX_DATABASE_BYTES = 192 * 1024 * 1024;
// One MiB accommodates the admitted 256 KiB payload and persisted fields.
const MAX_ROW_BYTES = 1024 * 1024;

export function assertInspectionProfile(profile) {
  if (profile?.contract !== 1 || profile.sqlite !== INSPECTION_PROFILE.sqlite || profile.filesystem !== INSPECTION_PROFILE.filesystem) {
    throw new Error(`Unsupported offline backup inspection profile; qualified SQLite ${INSPECTION_PROFILE.sqlite} and FS ${INSPECTION_PROFILE.filesystem} image required`);
  }
}

// The managed image pins BusyBox's verbose tar format. Unsupported/ambiguous
// inventory formats fail closed rather than guessing file names or link types.
export function readBackupInventory(text) {
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
  for (const name of ['sync.sqlite', 'sync.sqlite-wal']) {
    const entry = entries.get(name);
    if (!entry && name.endsWith('-wal')) continue;
    if (!entry || entry.type !== '-') throw new Error('Backup inspection requires regular SQLite database/WAL entries');
    bytes += entry.size;
    selected.push(entry.original);
  }
  if (bytes > MAX_DATABASE_BYTES) throw new Error('Backup inspection database scratch resource limit exceeded');
  return { entries, selected, bytes };
}

export function inspectCanonicalReferences(Database, databasePath, inventory, storageRoot) {
  const root = relative('/data', resolve(storageRoot));
  if (root === '..' || root.startsWith('../') || root.startsWith('/')) throw new Error('Unsupported offline backup storage root outside /data');
  for (const path of [databasePath, `${databasePath}-wal`]) {
    try { if (!lstatSync(path).isFile()) throw new Error('Backup inspection database input must be regular'); }
    catch (error) { if (error.code !== 'ENOENT' || path === databasePath) throw error; }
  }
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  let live = 0;
  let inspected = 0;
  const started = Date.now();
  try {
    db.pragma('trusted_schema=OFF');
    db.pragma('query_only=ON');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Backup inspection SQLite quick_check failed');
    for (const name of ['s_file_meta', 'kysely_migration']) {
      if (db.prepare('SELECT type FROM sqlite_master WHERE name = ?').get(name)?.type !== 'table') throw new Error('Unsupported offline canonical SQLite schema');
    }
    const migrationNames = db.prepare('SELECT name FROM kysely_migration ORDER BY name LIMIT ?').all(QUALIFIED_MIGRATIONS.length + 1).map(row => row.name);
    // Published backups end at 024 or 026; the current package ends at 028.
    // Interrupted upgrades ending at 025 or 027 are not qualified histories.
    const expectedMigrations = [24, 26].includes(migrationNames.length) ? QUALIFIED_MIGRATIONS.slice(0, migrationNames.length) : QUALIFIED_MIGRATIONS;
    if (JSON.stringify(migrationNames) !== JSON.stringify(expectedMigrations)) throw new Error('Unsupported offline canonical SQLite migration history');
    const columns = db.prepare('PRAGMA table_info(s_file_meta)').all();
    for (const [name, type, pk] of [['workspace_id', 'TEXT', 1], ['id', 'TEXT', 2], ['data_json', 'TEXT', 0], ['deleted', 'INTEGER', 0]]) {
      if (!columns.some(column => column.name === name && column.type === type && column.pk === pk)) throw new Error('Unsupported offline canonical SQLite columns');
    }
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
      const name = `${root ? `${root}/` : ''}workspaces/${row.workspace_id}/${algorithm}_${match[2]}`;
      requireEntry(name, size);
      requireEntry(`${name}.meta.json`);
      live++;
    }
    return { contract: 1, inspectedMetadata: inspected, liveAttachments: live, complete: true };
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertInspectionProfile(JSON.parse(readFileSync(new URL('./backup-inspection-profile.json', import.meta.url), 'utf8')));
    const inventory = readBackupInventory(readFileSync('/scratch/inventory', 'utf8'));
    if (process.argv[2] === 'inventory') {
      console.log(JSON.stringify({ selected: inventory.selected, bytes: inventory.bytes }));
    } else if (process.argv[2] === 'references') {
      const Database = createRequire(import.meta.url)('/app/.output/server/node_modules/better-sqlite3');
      console.log(JSON.stringify(inspectCanonicalReferences(Database, '/scratch/sync.sqlite', inventory, process.argv[3])));
    } else throw new Error('Unsupported backup inspection operation');
  } catch (error) {
    // No archived JSON/path values or private record contents enter diagnostics.
    console.error(error instanceof SyntaxError ? 'Invalid canonical backup metadata JSON' : error.message);
    process.exitCode = 1;
  }
}
