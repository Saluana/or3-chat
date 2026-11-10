import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createSandbox, sha256 } from './process-harness';
import type { Sandbox } from './process-harness';
import { assertFilesystemPayloadHash } from '../src/backup/restore';
import { writeBackupAuthentication } from '../src/backup/manifests';
import { assertInspectionProfile, inspectCanonicalReferences, QUALIFIED_MIGRATIONS, readBackupInventory } from '../../../scripts/docker/backup-inspect.mjs';

// Each test drives several real CLI processes.
setDefaultTimeout(30_000);

const sandboxes: Sandbox[] = [];
const temporaryRoots: string[] = [];
async function sandbox(options?: Parameters<typeof createSandbox>[0]) {
  const created = await createSandbox(options);
  sandboxes.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((entry) => entry.cleanup()));
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const DESTRUCTIVE = /compose .* (stop|down|restart)\b|compose .* up\b|volume rm|tar xzf|find \/data|chown/;

// A mixed or contradictory auth profile cannot be certified as the supported
// Basic/SQLite/filesystem backup merely because its storage selector is fs.
test('backup refuses an unsupported or inconsistent auth profile before journaling', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  for (const auth of [{ AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk' }, { AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'clerk' }]) {
    const fixture = await sandbox();
    await writeFile(join(fixture.directory, '.env'), serializeEnv({ ...fixture.env, ...auth }), { mode: 0o600 });
    const before = await fixture.readStateText();
    await fixture.reset();
    const result = await fixture.cli(['backup']);
    expect(result.exitCode, result.output).toBe(1);
    expect(result.output).toMatch(/profile/i);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect(await fixture.readStateText()).toBe(before);
    expect(await fixture.backupIds()).toEqual([]);
  }
  const fixture = await sandbox();
  const missing = { ...fixture.env }; delete missing.AUTH_PROVIDER; delete missing.OR3_AUTH_PROVIDER;
  await writeFile(join(fixture.directory, '.env'), serializeEnv(missing), { mode: 0o600 });
  const before = await fixture.readStateText(); await fixture.reset();
  const result = await fixture.cli(['backup']);
  expect(result.exitCode).toBe(1); expect(result.output).toMatch(/profile/i);
  expect(await fixture.readStateText()).toBe(before); expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

// Failures: Nitro/Nuxt runtime overrides or the entrypoint storage selector
// can activate another provider even while the canonical fields say sqlite/fs.
// A disabled provider also makes the intended inspection contract ambiguous.
test('backup refuses effective runtime profile overrides before journaling', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const changes = [
    { NUXT_STORAGE_PROVIDER: 's3' }, { OR3_STORAGE_PROVIDER: 's3' },
    { NUXT_SYNC_PROVIDER: 'convex' }, { NUXT_AUTH_PROVIDER: 'clerk' },
    { NITRO_STORAGE_PROVIDER: 's3' }, { NUXT_STORAGE: '{"provider":"s3"}' },
    { SSR_AUTH_ENABLED: 'false' }, { OR3_CLOUD_SYNC_ENABLED: 'false' }, { OR3_CLOUD_STORAGE_ENABLED: 'false' },
  ];
  for (const change of changes) {
    const fixture = await sandbox();
    await writeFile(join(fixture.directory, '.env'), serializeEnv({ ...fixture.env, ...change }), { mode: 0o600 });
    const before = await fixture.readStateText(); await fixture.reset();
    const result = await fixture.cli(['backup']);
    expect(result.exitCode, JSON.stringify(change)).toBe(1);
    expect(result.output).toMatch(/profile/i);
    expect(await fixture.readStateText()).toBe(before);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect(await fixture.backupIds()).toEqual([]);
  }
});

// The .env may be edited after Compose created the running or stopped
// container. A backup must not certify stale databases or a different volume.
test.each([
    { sourceComposeOverrides: { OR3_SQLITE_DRIVER: 'turso' } },
    { sourceEnvOverrides: { OR3_SQLITE_DRIVER: 'turso' } },
    { sourceEnvOverrides: { OR3_SQLITE_DB_PATH: '/data/older.sqlite' } },
    { sourceEnvOverrides: { NUXT_PUBLIC_SYNC_ENABLED: 'true' } },
    { sourceEnvOverrides: { OR3_STORAGE_FS_ROOT: '/data/other-storage' }, running: false },
    { sourceVolumeOverride: 'foreign-volume' },
    { sourceNestedMount: true },
    { sourceImageOverride: 'fixture-foreign-image' },
    { sourceProjectOverride: 'foreign-project' },
    { sourceVaultVolumeOverride: 'foreign-vault' },
    { sourceVaultComposeOverride: 'foreign-vault' },
    { sourceAppSocketOverride: 'foreign-vault-socket' },
    { sourceVaultMissing: true },
    { sourceEnvOverrides: { NUXT_SECRETS_PROVIDER: 'external-vault' } },
    { sourceEnvOverrides: { NUXT_SECRETS_SOCKET_PATH: '/tmp/elsewhere.sock' } },
    { sourceEnvOverrides: { OR3_MANAGED_VAULT_CONFIG: '/tmp/other-config.json' } },
    { sourceEnvOverrides: { NUXT_SECRETS_NAMESPACE: 'other' } },
    { sourceEnvOverrides: { NITRO_SECRETS_SOCKET_PATH: '/tmp/elsewhere.sock' } },
    { sourceComposeOverrides: { NUXT_SECRETS: 'overridden' } },
    { sourceEnvOverrides: { OR3_ADMIN_DATA_DIR: '/tmp/admin' } },
    { sourceComposeOverrides: { OR3_EXTENSIONS_ROOT: '/tmp/extensions' } },
    { sourceCommandOverride: true },
    { sourceComposeCommandOverride: true },
    { sourceWritableRoot: true },
    { sourceCodeMount: true },
    { sourceVolumeSubpath: true },
    { sourceComposeVolumeSubpath: true },
    { sourceExtraComposeMounts: 'configs' },
    { sourceExtraComposeMounts: 'secrets' },
    { sourceExtraComposeMounts: 'volumes_from' },
    { sourceExtraVaultComposeMounts: 'volumes_from' },
    { sourceTmpfsOverride: true },
    { sourceComposeTmpfsOverride: true },
    { sourceEnvOverrides: { NODE_OPTIONS: '--require /tmp/inject.js' } },
    { sourceComposeOverrides: { NODE_OPTIONS: '--require /tmp/inject.js' } },
    { sourceVaultEnvOverrides: { NODE_OPTIONS: '--require /tmp/inject.js' } },
    { sourceVaultComposeOverrides: { NODE_OPTIONS: '--require /tmp/inject.js' } },
    { sourceContainerMissing: true },
    { sourceContainerIds: 'first second' },
])('backup refuses drifted Compose or existing container before journaling: %j', async (change) => {
  const fixture = await sandbox(); await fixture.configure(change); await fixture.reset();
  const before = await fixture.readStateText();
  const result = await fixture.cli(['backup']);
  expect(result.exitCode, JSON.stringify(change)).toBe(1);
  expect(await fixture.readStateText()).toBe(before);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect(await fixture.backupIds()).toEqual([]);
});

class OfflineDatabase {
  private readonly db: Database;
  constructor(file: string) { this.db = new Database(file, { readonly: true }); }
  pragma(sql: string, options?: { simple: boolean }) { return options?.simple ? this.db.query(`PRAGMA ${sql}`).values()[0]?.[0] : this.db.exec(`PRAGMA ${sql}`); }
  prepare(sql: string) { return this.db.query(sql); }
  close() { this.db.close(); }
}

test('offline canonical inspection detects missing pairs by workspace and preserves legacy, pending and deleted metadata', async () => {
  const fixture = await sandbox();
  const path = join(fixture.root, 'canonical.sqlite');
  const db = new Database(path);
  db.exec('CREATE TABLE kysely_migration(name TEXT PRIMARY KEY); CREATE TABLE s_file_meta(workspace_id TEXT NOT NULL,id TEXT NOT NULL,data_json TEXT NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(workspace_id,id));');
  for (const name of QUALIFIED_MIGRATIONS.slice(0, 24)) db.query('INSERT INTO kysely_migration VALUES(?)').run(name);
  const sha = 'a'.repeat(64);
  const md5 = 'b'.repeat(32);
  const insert = (workspace: string, hash: string, payload: unknown, deleted = 0) => db.query('INSERT OR REPLACE INTO s_file_meta VALUES(?,?,?,?)').run(workspace, hash, JSON.stringify(payload), deleted);
  insert('first', sha, { size_bytes: 3, storage_id: 'legacy-storage-id', extra: 'x'.repeat(108_000) });
  insert('second', `SHA256:${sha}`, { sizeBytes: 3, storageId: 'another-id' });
  insert('first', md5, { sizeBytes: 0, storageId: 'legacy-md5-id' });
  insert('pending', sha, { size_bytes: 12 });
  insert('deleted', sha, { size_bytes: 12, storage_id: 'removed' }, 1);
  const header = '-rw------- nonroot/nonroot 4096 2026-10-11 10:16:23 ./sync.sqlite\n';
  const object = (workspace: string, algorithm: string, hash: string, size: number) => `-rw------- nonroot/nonroot ${size} 2026-10-11 10:16:23 ./storage/workspaces/${workspace}/${algorithm}_${hash}\n-rw------- nonroot/nonroot 2 2026-10-11 10:16:23 ./storage/workspaces/${workspace}/${algorithm}_${hash}.meta.json\n`;
  const first = object('first', 'sha256', sha, 3);
  const second = object('second', 'sha256', sha, 3);
  const legacy = object('first', 'md5', md5, 0);
  // The adapter is exercised against Bun's real SQLite engine. Only the
  // driver's pragma method is adapted; inspection/query logic is production.
  const inspect = (text: string) => inspectCanonicalReferences(OfflineDatabase, path, readBackupInventory(text), '/data/storage');
  expect(inspect(header + first + second + legacy)).toMatchObject({ complete: true, liveAttachments: 3, inspectedMetadata: 4 });
  expect(() => inspect(header + first + legacy)).toThrow('required by live canonical attachment metadata');
  expect(() => inspect(header + second + legacy)).toThrow('required by live canonical attachment metadata');
  expect(() => inspect(header + first + second)).toThrow('required by live canonical attachment metadata');
  expect(() => inspect(header + first + second + legacy + 'lrwxrwxrwx nonroot/nonroot 0 2026-10-11 10:16:23 ./storage -> /outside\n')).toThrow('ancestor must be a directory');
  expect(() => inspectCanonicalReferences(OfflineDatabase, path, readBackupInventory(header + first + second + legacy), '/outside')).toThrow('outside /data');
  insert('first', sha, { size_bytes: 4, storage_id: 'still-live' });
  expect(() => inspect(header + first + second + legacy)).toThrow('size mismatch');
  insert('first', sha, { size_bytes: 3, storage_id: 'still-live' }, 2);
  expect(() => inspect(header + first + second + legacy)).toThrow('deletion state');
  db.query('INSERT INTO kysely_migration VALUES(?)').run('999_unqualified_future_migration');
  expect(() => inspect(header + first + second + legacy)).toThrow('migration history');
  db.query('DELETE FROM kysely_migration WHERE name=?').run('999_unqualified_future_migration');
  db.query('DELETE FROM kysely_migration WHERE name=?').run(QUALIFIED_MIGRATIONS[23]!);
  expect(() => inspect(header + first + second + legacy)).toThrow('migration history');
  db.close();
});

test('offline inspection accepts the installed provider migration history and rejects a partial upgrade', async () => {
  const fixture = await sandbox();
  const path = join(fixture.root, 'migrated.sqlite');
  const providerRoot = new URL('../../../node_modules/or3-provider-sqlite/dist/runtime/server/db/', import.meta.url);
  const { initializeSqliteDb, destroySqliteDb } = await import(new URL('kysely.js', providerRoot).href);
  const { runMigrations } = await import(new URL('migrate.js', providerRoot).href);
  try {
    await runMigrations(await initializeSqliteDb({ path, driver: 'bun' }));
  } finally { await destroySqliteDb(); }
  const inventory = readBackupInventory(`-rw------- nonroot/nonroot ${statSync(path).size} 2026-10-20 20:00:00 ./sync.sqlite\n`);
  expect(inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toMatchObject({ complete: true, liveAttachments: 0 });
  const db = new Database(path);
  try {
    const installed = JSON.parse(await readFile(new URL('../../../node_modules/or3-provider-sqlite/package.json', import.meta.url), 'utf8')) as { version: string };
    const migrationCount = installed.version === '0.0.24' ? 28 : installed.version === '0.0.25' ? 29 : ['0.0.26', '0.0.27'].includes(installed.version) ? 31 : installed.version === '0.0.28' ? 32 : 0;
    expect(migrationCount).toBeGreaterThan(0);
    expect(db.query('SELECT name FROM kysely_migration ORDER BY name').all())
      .toEqual(QUALIFIED_MIGRATIONS.slice(0, migrationCount).map(name => ({ name })));
    if (migrationCount === 32) {
      // The previously published 0.0.27 history (through 031) remains valid for upgrade and rollback inspection.
      db.query('DELETE FROM kysely_migration WHERE name=?').run('032_sync_observations');
      expect(inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toMatchObject({ complete: true });
    }
    if (migrationCount >= 31) {
      db.query('DELETE FROM kysely_migration WHERE name=?').run('031_storage_generation_uploads');
      expect(() => inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toThrow('migration history');
      db.query('DELETE FROM kysely_migration WHERE name=?').run('030_storage_generations');
      expect(inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toMatchObject({ complete: true });
    }
    if (migrationCount >= 29) {
      db.query('DELETE FROM kysely_migration WHERE name=?').run('029_delegation_wait');
      expect(inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toMatchObject({ complete: true });
    }
    db.query('DELETE FROM kysely_migration WHERE name=?').run('028_user_scoped_device_cursors');
    expect(() => inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toThrow('migration history');
    // Published 0.0.20 backups remain valid for upgrade and rollback inspection.
    db.query('DELETE FROM kysely_migration WHERE name=?').run('027_verified_storage_usage');
    expect(inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toMatchObject({ complete: true });
    db.query('DELETE FROM kysely_migration WHERE name=?').run('026_retained_storage_usage');
    expect(() => inspectCanonicalReferences(OfflineDatabase, path, inventory, '/data/storage')).toThrow('migration history');
  } finally { db.close(); }
});

// Generation references use immutable slots, never legacy hash filenames. A
// correct inventory must pass, while wrong canonical bindings or missing/link
// entries must fail before the managed restore can replace the live volume.
test('offline inspection validates immutable generation bindings and their archive paths', async () => {
  const fixture = await sandbox();
  const path = join(fixture.root, 'generations.sqlite');
  const db = new Database(path);
  try {
    db.exec('CREATE TABLE kysely_migration(name TEXT PRIMARY KEY); CREATE TABLE s_file_meta(workspace_id TEXT NOT NULL,id TEXT NOT NULL,data_json TEXT NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(workspace_id,id)); CREATE TABLE storage_object_generations(generation_id TEXT PRIMARY KEY,workspace_id TEXT,hash TEXT,storage_provider_id TEXT,storage_id TEXT,size_bytes INTEGER,state TEXT);');
    for (const name of QUALIFIED_MIGRATIONS) db.query('INSERT INTO kysely_migration VALUES(?)').run(name);
    const namespace = '11111111-1111-4111-8111-111111111111';
    const generation = '22222222-2222-4222-8222-222222222222';
    const digest = 'a'.repeat(64), hash = `sha256:${digest}`;
    const storageId = `fs-generation-v1:${namespace}:workspace:${generation}:${digest}`;
    const metadata = (id: string) => db.query('INSERT OR REPLACE INTO s_file_meta VALUES(?,?,?,0)').run('workspace', hash, JSON.stringify({ size_bytes: 3, storage_id: id }));
    const canonical = (overrides: Record<string, string | number> = {}) => {
      const row = { generation_id: generation, workspace_id: 'workspace', hash: digest, storage_provider_id: 'fs', storage_id: storageId, size_bytes: 3, state: 'verified', ...overrides };
      db.query('DELETE FROM storage_object_generations').run();
      db.query('INSERT INTO storage_object_generations VALUES(?,?,?,?,?,?,?)').run(row.generation_id, row.workspace_id, row.hash, row.storage_provider_id, row.storage_id, row.size_bytes, row.state);
    };
    const base = 'storage/generations-v1', slot = `${base}/workspaces/workspace/${generation}`;
    const entry = (name: string, size = 2, type = '-') => `${type}rw------- nonroot/nonroot ${size} 2026-10-11 10:16:23 ./${name}\n`;
    const header = entry('sync.sqlite', 4096);
    const files = [entry(`${base}/namespace.json`), entry(`${slot}/ready.json`), entry(`${slot}/payload/blob`, 3)];
    const inspect = (text = header + files.join('')) => inspectCanonicalReferences(OfflineDatabase, path, readBackupInventory(text), '/data/storage');
    metadata(storageId); canonical();
    expect(inspect()).toMatchObject({ complete: true, liveAttachments: 1 });
    for (const overrides of [
      { workspace_id: 'other' }, { hash: 'sha256:' + 'b'.repeat(64) }, { size_bytes: 4 },
      { storage_provider_id: 's3' }, { storage_id: storageId.replace(namespace, generation) },
      { state: 'claimed' }, { state: 'deleted' },
    ]) {
      canonical(overrides);
      expect(inspect).toThrow('generation');
    }
    db.query('DELETE FROM storage_object_generations').run();
    expect(inspect).toThrow('generation');
    canonical();
    for (const id of [storageId.replace(':workspace:', ':other:'), storageId.replace(digest, 'b'.repeat(64)), storageId.replace(namespace, '../outside'), storageId + ':extra']) {
      metadata(id);
      expect(inspect).toThrow('generation');
    }
    metadata(storageId);
    for (let missing = 0; missing < files.length; missing++) {
      expect(() => inspect(header + files.filter((_file, index) => index !== missing).join(''))).toThrow('required by live canonical attachment metadata');
    }
    expect(() => inspect(header + files.slice(0, 2).join('') + entry(`${slot}/payload/blob`, 4))).toThrow('size mismatch');
    expect(() => inspect(header + files.join('') + `lrwxrwxrwx nonroot/nonroot 0 2026-10-11 10:16:23 ./${slot}/payload -> /outside\n`)).toThrow('ancestor must be a directory');
    expect(() => inspect(header + files.slice(0, 2).join('') + `hrw------- nonroot/nonroot 3 2026-10-11 10:16:23 ./${slot}/payload/blob link to ./outside\n`)).toThrow('required by live canonical attachment metadata');
  } finally { db.close(); }
});

test('offline inspection refuses unsupported versions, ambiguous archives and scratch exhaustion', () => {
  expect(() => assertInspectionProfile({ contract: 1, sqlite: '0.0.28', filesystem: '0.0.17' })).not.toThrow();
  for (const profile of [{ contract: 2, sqlite: '0.0.28', filesystem: '0.0.17' }, { contract: 1, sqlite: '0.0.27', filesystem: '0.0.17' }, { contract: 1, sqlite: '0.0.28', filesystem: '0.0.16' }]) expect(() => assertInspectionProfile(profile)).toThrow('Unsupported');
  const entry = '-rw------- nonroot/nonroot 4096 2026-10-11 10:16:23 ./sync.sqlite\n';
  expect(() => readBackupInventory(entry + entry)).toThrow('Duplicate');
  expect(() => readBackupInventory(entry.replace('./sync.sqlite', '../sync.sqlite'))).toThrow('Unsafe');
  expect(() => readBackupInventory(entry.replace('4096', String(193 * 1024 * 1024)))).toThrow('scratch resource');
  expect(() => readBackupInventory(entry.replace('-rw-------', 'drwx------'))).toThrow('regular SQLite');
});

test('canonical missing-reference refusal precedes journal and live service mutation and cleans the scratch helper', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  await fixture.reset();
  await fixture.configure({ failures: [{ match: 'backup-inspect.mjs references', message: 'Backup is missing a regular payload or sidecar required by live canonical attachment metadata' }] });
  const before = await fixture.readStateText();
  const refused = await fixture.cli(['restore', id, '--yes']);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain('required by live canonical attachment metadata');
  expect(await fixture.readStateText()).toBe(before);
  const trace = await fixture.traceText();
  expect(trace).not.toMatch(/compose .* (stop|down|restart)\b|compose .* up\b|volume rm|find \/data/);
  expect(trace).toContain('rm --force or3-backup-inspection-');
  expect(trace).toContain('--network none');
});

test('backup refuses an incomplete canonical archive, restarts the original app and removes only its unverified artifact', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'backup-inspect.mjs references', message: 'missing canonical attachment pair' }] });
  const refused = await fixture.cli(['backup']);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain('missing canonical attachment pair');
  expect(refused.stderr).toContain('deeply healthy');
  expect(await readdir(join(fixture.directory, '.or3-cloud/backups'))).toEqual([]);
  expect(await fixture.traceText()).toContain('rm --force or3-backup-inspection-');
});

test('filesystem payload validation hashes real file chunks for SHA-256 and legacy MD5 and refuses changed bytes', async () => {
  const fixture = await sandbox();
  for (const bytes of [Buffer.alloc(0), Buffer.from('synthetic attachment'), Buffer.alloc(150_001, 0x93)]) {
    const path = join(fixture.root, 'payload');
    await writeFile(path, bytes);
    for (const algorithm of ['sha256', 'md5'] as const) {
      const digest = createHash(algorithm).update(bytes).digest('hex');
      const validate = (expected: string) => {
        const fd = openSync(path, 'r');
        const chunk = Buffer.alloc(65_536);
        try {
          return assertFilesystemPayloadHash(expected, () => {
            const count = readSync(fd, chunk, 0, chunk.length, null);
            return count ? chunk.subarray(0, count) : undefined;
          }, createHash);
        } finally { closeSync(fd); }
      };
      expect(() => validate(`${algorithm}_${digest}`)).not.toThrow();
      expect(() => validate(`${algorithm}_${digest.toUpperCase()}`)).not.toThrow();
      expect(() => validate(`${algorithm}_${'0'.repeat(digest.length)}`)).toThrow('Filesystem payload hash mismatch');
      if (bytes.length) {
        const changed = Buffer.from(bytes);
        changed[0] = changed[0]! ^ 0xff;
        await writeFile(path, changed);
        expect(() => validate(`${algorithm}_${digest}`)).toThrow('Filesystem payload hash mismatch');
        await writeFile(path, bytes);
      }
    }
  }
});

test('restore refuses sparse apparent bytes as reclaimable capacity before mutating state or data', async () => {
  const fixture = await sandbox();
  await fixture.configure({ volumeApparentBytes: 128 * 1024 * 1024, volumeAllocatedKiB: 1024, volumeFreeKiB: 96 * 1024 });
  const id = await createBackup(fixture);
  await fixture.reset();
  const before = await fixture.readStateText();
  const refused = await fixture.cli(['restore', id, '--yes']);
  expect(refused.exitCode, refused.output).toBe(1);
  expect(refused.stderr).toContain('Restore needs at least');
  expect(await fixture.readStateText()).toBe(before);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect((await fixture.readState()).incompleteOperation).toBeUndefined();
});

test('restore counts allocated bytes it will reclaim while keeping backup payload sizes apparent', async () => {
  const fixture = await sandbox();
  const target = await createBackup(fixture);
  await fixture.configure({ volumeApparentBytes: 128 * 1024 * 1024, volumeAllocatedKiB: 80 * 1024, volumeFreeKiB: 16 * 1024,
    failures: [{ match: 'du -sk', times: 1, message: 'fixture running probe unavailable' }] });
  await fixture.reset();
  const restored = await fixture.cli(['restore', target, '--yes']);
  expect(restored.exitCode, restored.output).toBe(0);
  const [snapshot] = (await fixture.backupIds()).filter(id => id !== target);
  const manifest = JSON.parse(await readFile(join(fixture.cloud, 'backups', snapshot, 'manifest.json'), 'utf8'));
  expect(manifest.dataBytes).toBe(128 * 1024 * 1024);
  const probes = (await fixture.trace()).filter(args => args.join(' ').includes('du -sk'));
  expect(probes.length).toBeGreaterThan(1);
  expect(probes[1]).toEqual(expect.arrayContaining(['run', '--network', 'none', '--read-only']));
  expect((await fixture.readState()).incompleteOperation).toBeUndefined();
});

async function createBackup(fixture: Sandbox) {
  const before = await fixture.backupIds();
  const result = await fixture.cli(['backup']);
  expect(result.exitCode, result.output).toBe(0);
  const created = (await fixture.backupIds()).filter((entry) => !before.includes(entry));
  expect(created).toHaveLength(1);
  return created[0];
}

// Failure inventory: empty, unchecked safety snapshots, reference-only,
// missing vault/assets, tampered and future-dated backups must not make a
// monitor believe recovery is available.
test('status reports only the newest authenticated full snapshot', async () => {
  const fixture = await sandbox();
  const status = async () => {
    const result = await fixture.cli(['status', '--json']);
    expect(result.exitCode, result.output).toBe(0);
    return JSON.parse(result.stdout).recoveryPoint;
  };
  expect(await status()).toBeNull();
  const id = await createBackup(fixture);
  const dir = join(fixture.cloud, 'backups', id);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  expect(manifest.snapshotKind).toBe('full');
  expect(await status()).toEqual({ backupId: id, createdAt: manifest.createdAt, schemaVersion: 1, remoteKind: 'none' });
  const sign = async () => { const text = JSON.stringify(manifest); await writeFile(join(dir, 'manifest.json'), text); await writeBackupAuthentication(fixture.directory, dir, text); };
  manifest.snapshotKind = 'safety'; await sign();
  expect(await status()).toBeNull();
  delete manifest.snapshotKind; await sign();
  expect(await status()).toBeNull();
  manifest.snapshotKind = 'full'; await sign();
  const vaultSha256 = manifest.vaultSha256;
  expect(vaultSha256).toBeTruthy();
  delete manifest.vaultSha256; await sign();
  expect(await status()).toBeNull();
  manifest.vaultSha256 = vaultSha256; await sign();
  const assets = manifest.managedAssetSha256, assetVersion = manifest.managedAssetInventoryVersion;
  delete manifest.managedAssetSha256; delete manifest.managedAssetInventoryVersion; await sign();
  expect(await status()).toBeNull();
  manifest.managedAssetSha256 = assets; manifest.managedAssetInventoryVersion = assetVersion; await sign();
  const olderDir = join(fixture.cloud, 'backups', 'backup-older');
  await cp(dir, olderDir, { recursive: true });
  const older = { ...manifest, backupId: 'backup-older', createdAt: '2020-01-01T00:00:00.000Z' };
  const olderText = JSON.stringify(older);
  await writeFile(join(olderDir, 'manifest.json'), olderText);
  await writeBackupAuthentication(fixture.directory, olderDir, olderText);
  expect((await status()).backupId).toBe(id);
  await rm(olderDir, { recursive: true });
  const config = `${await readFile(join(dir, 'config.env'), 'utf8')}\nOR3_SYNC_PROVIDER=sqlite\nNUXT_PUBLIC_STORAGE_PROVIDER=s3\nOR3_STORAGE_S3_ENDPOINT=https://storage.example.invalid\nOR3_STORAGE_S3_BUCKET=fixture-bucket\nOR3_STORAGE_S3_KEY_PREFIX=prefix/\n`;
  await writeFile(join(dir, 'config.env'), config);
  const content = 'synthetic remote data';
  manifest.schemaVersion = 2; manifest.storage = 's3'; manifest.configSha256 = sha256(config);
  manifest.remote = { kind: 's3-reference-v1', file: 'remote-inventory.json', sha256: sha256(content), inventorySha256: sha256(content), bytes: Buffer.byteLength(content), objectCount: 0, payloadBytes: 0, source: { endpointOrigin: 'https://storage.example.invalid', bucket: 'fixture-bucket', keyPrefix: 'prefix/' }, providerVersion: '0.0.15' };
  await writeFile(join(dir, manifest.remote.file), content); await sign();
  expect(await status()).toBeNull();
  manifest.remote.kind = 's3-copy-v1'; manifest.remote.file = 'remote-objects.tar';
  await writeFile(join(dir, manifest.remote.file), content); await sign();
  expect(await status()).toBeNull(); // Managed S3 recovery is still disabled.
  manifest.createdAt = '2999-01-01T00:00:00.000Z'; await sign();
  expect(await status()).toBeNull();
  manifest.createdAt = '2026-01-01T00:00:00.000Z'; await sign();
  await appendFile(join(dir, manifest.remote.file), 'tamper');
  expect(await status()).toBeNull();
});

test('restore refuses vault-enabled snapshot without a vault archive before mutation', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const dir = join(fixture.cloud, 'backups', id);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  delete manifest.vaultSha256;
  const contents = JSON.stringify(manifest);
  await writeFile(join(dir, 'manifest.json'), contents);
  await writeBackupAuthentication(fixture.directory, dir, contents);
  await fixture.reset();
  const before = await fixture.readStateText();
  const result = await fixture.cli(['restore', id, '--yes']);
  expect(result.exitCode, result.output).toBe(1);
  expect(result.stderr).toMatch(/vault.*backup|backup.*vault/i);
  expect(await fixture.readStateText()).toBe(before);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

test('retention preserves incomplete snapshots without displacing complete backups', async () => {
  const { planRetention } = await import('../src/backup/retention');
  const base = { appVersion: '1.0.0', path: '/unused', bytes: 1, dataSha256: 'a'.repeat(64), schemaVersion: 1 as const };
  const entries = [
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-complete', createdAt: '2020-01-01T00:00:00Z', recoveryArtifactsComplete: true, snapshotKind: 'full' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-incomplete', createdAt: '2021-01-01T00:00:00Z', recoveryArtifactsComplete: false, snapshotKind: 'full' as const } },
  ];
  expect(planRetention(entries, 1, new Set()).remove).toEqual([]);
});

test('retention bounds safety snapshots without displacing complete backups', async () => {
  const { planRetention } = await import('../src/backup/retention');
  const base = { appVersion: '1.0.0', path: '/unused', bytes: 1, dataSha256: 'a'.repeat(64), schemaVersion: 1 as const, recoveryArtifactsComplete: true };
  const entries = [
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-full', createdAt: '2020-01-01T00:00:00Z', snapshotKind: 'full' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-safety-old', createdAt: '2021-01-01T00:00:00Z', snapshotKind: 'safety' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-safety-new', createdAt: '2022-01-01T00:00:00Z', snapshotKind: 'safety' as const } },
  ];
  expect(planRetention(entries, 1, new Set()).remove).toEqual(['backup-safety-old']);
});

test('retention preserves future-dated backups without displacing a current recovery point', async () => {
  // A corrected clock can leave valid future-dated full and safety snapshots.
  // They must neither be deleted nor consume the usable snapshots' budgets.
  const { planRetention } = await import('../src/backup/retention');
  const base = { appVersion: '1.0.0', path: '/unused', bytes: 1, dataSha256: 'a'.repeat(64), schemaVersion: 1 as const, recoveryArtifactsComplete: true };
  const entries = [
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-full-old', createdAt: '2020-01-01T00:00:00Z', snapshotKind: 'full' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-full-current', createdAt: '2021-01-01T00:00:00Z', snapshotKind: 'full' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-full-future', createdAt: '9999-01-01T00:00:00Z', snapshotKind: 'full' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-safety-current', createdAt: '2021-01-01T00:00:00Z', snapshotKind: 'safety' as const } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-safety-future', createdAt: '9999-01-01T00:00:00Z', snapshotKind: 'safety' as const } },
  ];
  const result = planRetention(entries, 1, new Set());
  expect(result.remove).toEqual(['backup-full-old']);
  expect(result.keep).toContain('backup-full-current');
  expect(result.keep).toContain('backup-full-future');
  expect(result.keep).toContain('backup-safety-current');
  expect(result.keep).toContain('backup-safety-future');
});

test('retention orders valid backup timestamps by time rather than timezone text', async () => {
  const { planRetention } = await import('../src/backup/retention');
  const base = { appVersion: '1.0.0', path: '/unused', bytes: 1, dataSha256: 'a'.repeat(64), schemaVersion: 1 as const, recoveryArtifactsComplete: true, snapshotKind: 'full' as const };
  const entries = [
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-earlier', createdAt: '2021-01-01T00:00:00Z' } },
    { kind: 'verified' as const, backup: { ...base, backupId: 'backup-later', createdAt: '2020-12-31T20:00:00-08:00' } },
  ];
  expect(planRetention(entries, 1, new Set()).remove).toEqual(['backup-earlier']);
});

test('backup list distinguishes full, safety, and incomplete snapshot coverage', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const dir = join(fixture.cloud, 'backups', id);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const sign = async () => { const text = JSON.stringify(manifest); await writeFile(join(dir, 'manifest.json'), text); await writeBackupAuthentication(fixture.directory, dir, text); };
  const listing = async () => JSON.parse((await fixture.cli(['backup', 'list', '--json'])).stdout).backups[0];
  expect(await listing()).toMatchObject({ snapshotKind: 'full', recoveryArtifactsComplete: true });
  manifest.snapshotKind = 'safety'; await sign();
  expect(await listing()).toMatchObject({ snapshotKind: 'safety', recoveryArtifactsComplete: true });
  const text = await fixture.cli(['backup', 'list']);
  expect(text.stdout).toMatch(/safety/i);
  expect(text.stdout).toMatch(/not.*proof.*recover/i);
  delete manifest.snapshotKind; delete manifest.vaultSha256; await sign();
  expect(await listing()).toMatchObject({ snapshotKind: null, recoveryArtifactsComplete: false });
});

test('purge refuses a fresh authenticated snapshot that lacks recovery artifacts', async () => {
  const { assertPurgeHasVerifiedExport } = await import('../src/backup/export');
  const fixture = await sandbox();
  const backup = { backupId: 'backup-incomplete', createdAt: new Date().toISOString(), appVersion: '1.0.0', path: fixture.directory, bytes: 1, dataSha256: 'a'.repeat(64), schemaVersion: 1 as const, recoveryArtifactsComplete: false };
  await expect(assertPurgeHasVerifiedExport(fixture.directory, [backup], Date.now())).rejects.toThrow(/complete recovery/i);
});

test('purge refuses until reconstruction from an export is supported', async () => {
  const fixture = await sandbox();
  const before = await fixture.readStateText();
  const result = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/reconstruction.*not.*supported/i);
  expect(await fixture.readStateText()).toBe(before);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

/** A second filesystem the test may write to, when the host offers one. */
async function otherFilesystem() {
  const candidates = [process.env.OR3_TEST_OTHER_FILESYSTEM, '/dev/shm'].filter((value): value is string => Boolean(value));
  const tmp = (await stat(process.env.TMPDIR || '/tmp')).dev;
  for (const candidate of candidates) {
    try {
      const probe = join(candidate, `or3-fs-probe-${process.pid}`);
      await mkdir(probe, { recursive: true });
      await rm(probe, { recursive: true, force: true });
      if ((await stat(candidate)).dev !== tmp) return candidate;
    } catch {
      // Not writable on this host.
    }
  }
  return undefined;
}
const otherFs = await otherFilesystem();

test('backup creates an authenticated, checksummed snapshot and restarts a running deployment', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const path = join(fixture.cloud, 'backups', id);
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  expect(manifest.backupId).toBe(id);
  expect(manifest.dataSha256).toBe(sha256(await readFile(join(path, 'data.tgz'))));
  expect(manifest.configSha256).toBe(sha256(await readFile(join(path, 'config.env'))));
  expect(manifest.deploymentId).toBe(fixture.env.OR3_DEPLOYMENT_ID);
  expect(manifest.managedAssetSha256['compose.yaml']).toMatch(/^[0-9a-f]{64}$/);
  expect((await readFile(join(path, 'manifest.auth'), 'utf8')).trim()).toMatch(/^[0-9a-f]{64}$/);
  expect(((await stat(path)).mode & 0o777)).toBe(0o700);
  expect(((await stat(join(path, 'data.tgz'))).mode & 0o777)).toBe(0o600);
  const state = await fixture.readState();
  expect(state.incompleteOperation).toBeUndefined();
  const calls = (await fixture.trace()).map((args) => args.join(' '));
  const stopped = calls.findIndex((call) => /compose .* stop or3(?: or3-vault)?$/.test(call));
  const archived = calls.findIndex((call) => call.includes('tar czf'));
  const restarted = calls.findIndex((call) => /compose .* up -d/.test(call));
  expect(stopped).toBeGreaterThan(-1);
  expect(archived).toBeGreaterThan(stopped);
  expect(restarted).toBeGreaterThan(archived);
  const listed = await fixture.cli(['backup', 'list', '--json']);
  const inventory = JSON.parse(listed.stdout);
  expect(inventory.backups.map((entry: { backupId: string; trust: string }) => [entry.backupId, entry.trust])).toEqual([[id, 'verified']]);
  expect(inventory.findings).toEqual([]);
});

test('a stopped deployment is backed up without being started', async () => {
  const fixture = await sandbox();
  await fixture.configure({ running: false });
  await createBackup(fixture);
  expect(await fixture.traceText()).not.toMatch(/compose .* up -d/);
});

test('a failed archive leaves no partial backup and a recoverable journal', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'tar czf', message: 'fixture archive failure' }] });
  const failed = await fixture.cli(['backup']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('fixture archive failure');
  expect(await fixture.backupIds()).toEqual([]);
  const pending = (await fixture.readState()).incompleteOperation;
  expect(pending).toMatchObject({ operation: 'backup', phase: 'prepared', initialAppRunning: true });

  const blocked = await fixture.cli(['start']);
  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toContain('Refusing to start an ambiguous deployment');

  await fixture.configure({ failures: [] });
  const recovered = await fixture.cli(['recover']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  expect(recovered.stdout).toContain('Recovered the incomplete backup operation');
  const state = await fixture.readState();
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.lastError).toBeUndefined();
  expect(existsSync(join(fixture.cloud, 'operations', `${pending!.id}.json`))).toBe(false);
});

test('a corrupt data checksum is reported and refused before any destructive Docker request', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  await appendFile(join(fixture.cloud, 'backups', id, 'data.tgz'), 'tampered');
  const listed = JSON.parse((await fixture.cli(['backup', 'list', '--json'])).stdout);
  expect(listed.backups).toEqual([]);
  expect(listed.findings).toEqual([expect.objectContaining({ entryName: id, kind: 'invalid', code: 'backup-checksum-mismatch' })]);
  await fixture.reset();
  const restore = await fixture.cli(['restore', id, '--yes']);
  expect(restore.exitCode).toBe(1);
  expect(restore.stderr).toContain('Backup checksum mismatch');
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect((await fixture.readState()).incompleteOperation).toBeUndefined();
});

test('a backup with a forged or missing authentication tag is never trusted', async () => {
  const fixture = await sandbox();
  const forged = await createBackup(fixture);
  await writeFile(join(fixture.cloud, 'backups', forged, 'manifest.auth'), `${'00'.repeat(32)}\n`);
  const unsigned = await createBackup(fixture);
  await rm(join(fixture.cloud, 'backups', unsigned, 'manifest.auth'));
  const listed = JSON.parse((await fixture.cli(['backup', 'list', '--json'])).stdout);
  expect(listed.backups).toEqual([]);
  expect(Object.fromEntries(listed.findings.map((entry: { entryName: string; code: string }) => [entry.entryName, entry.code]))).toEqual({
    [forged]: 'backup-authentication-failed',
    [unsigned]: 'backup-unsigned',
  });
  await fixture.reset();
  for (const id of [forged, unsigned]) {
    const restore = await fixture.cli(['restore', id, '--yes']);
    expect(restore.exitCode).toBe(1);
    expect(restore.stderr).toMatch(/authentication/i);
  }
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

// Older safety snapshots could authenticate a database without copying its S3
// objects. Even a valid signature must not make such a snapshot exportable.
test('schema-1 S3 snapshots are never listed or exported as recovery points', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const path = join(fixture.cloud, 'backups', id);
  const config = (await readFile(join(path, 'config.env'), 'utf8')).replace(/^NUXT_PUBLIC_STORAGE_PROVIDER=.*$/m, 'NUXT_PUBLIC_STORAGE_PROVIDER=s3');
  await writeFile(join(path, 'config.env'), config);
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  manifest.configSha256 = sha256(config);
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(path, 'manifest.json'), contents);
  await writeBackupAuthentication(fixture.directory, path, contents);
  const listed = JSON.parse((await fixture.cli(['backup', 'list', '--json'])).stdout);
  expect(listed.backups).toEqual([]);
  expect(listed.findings).toEqual([expect.objectContaining({ entryName: id, kind: 'invalid' })]);
  const destination = join(fixture.root, 'unsafe-export');
  expect((await fixture.cli(['backup', 'export', id, destination])).exitCode).toBe(1);
  expect(existsSync(destination)).toBe(false);
});

// Schema 2 must bind the remote bytes and S3 source to the authenticated
// configuration. Reference-only snapshots cannot become portable exports or
// authorize destruction, and tampering must fail before either operation.
test('schema-2 S3 manifests authenticate remote data and distinguish reference snapshots', async () => {
  const { readManifest, inventoryBackups } = await import('../src/backup/manifests');
  const { exportBackup, assertPurgeHasVerifiedExport } = await import('../src/backup/export');
  const fixture = await sandbox(); const id = await createBackup(fixture);
  const dir = join(fixture.cloud, 'backups', id);
  const configPath = join(dir, 'config.env');
  const config = `${await readFile(configPath, 'utf8')}\nOR3_SYNC_PROVIDER=sqlite\nNUXT_PUBLIC_STORAGE_PROVIDER=s3\nOR3_STORAGE_S3_ENDPOINT=https://storage.example.invalid\nOR3_STORAGE_S3_BUCKET=fixture-bucket\nOR3_STORAGE_S3_KEY_PREFIX=prefix/\n`;
  await writeFile(configPath, config, { mode: 0o600 });
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  manifest.schemaVersion = 2; manifest.storage = 's3'; manifest.configSha256 = sha256(config);
  const payload = 'synthetic remote backup';
  manifest.remote = { kind: 's3-copy-v1', file: 'remote-objects.tar', sha256: sha256(payload), bytes: Buffer.byteLength(payload), inventorySha256: 'a'.repeat(64), objectCount: 1, payloadBytes: 23, source: { endpointOrigin: 'https://storage.example.invalid', bucket: 'fixture-bucket', keyPrefix: 'prefix/' }, providerVersion: '0.0.15' };
  const sign = async () => { const text = `${JSON.stringify(manifest, null, 2)}\n`; await writeFile(join(dir, 'manifest.json'), text, { mode: 0o600 }); await writeBackupAuthentication(fixture.directory, dir, text); };
  await writeFile(join(dir, manifest.remote.file), payload, { mode: 0o600 }); await sign();
  expect((await readManifest(dir, fixture.directory)).schemaVersion).toBe(2);
  const entries = (await inventoryBackups(fixture.directory)).entries;
  expect(entries).toContainEqual(expect.objectContaining({ kind: 'verified', backup: expect.objectContaining({ backupId: id, schemaVersion: 2, remoteKind: 's3-copy-v1' }) }));
  const exported = join(fixture.root, 's3-export'); await exportBackup(fixture.directory, id, exported);
  expect(await readFile(join(exported, 'remote-objects.tar'), 'utf8')).toBe(payload);
  await expect(assertPurgeHasVerifiedExport(fixture.directory, entries.filter(entry => entry.kind === 'verified').map(entry => entry.backup), Date.now())).rejects.toThrow();
  await writeFile(join(dir, 'remote-objects.tar'), 'tampered', { mode: 0o600 });
  await expect(readManifest(dir, fixture.directory)).rejects.toThrow(/checksum|size/i);
  const reference = 'synthetic inventory';
  manifest.remote = { ...manifest.remote, kind: 's3-reference-v1', file: 'remote-inventory.json', sha256: sha256(reference), inventorySha256: sha256(reference), bytes: Buffer.byteLength(reference) };
  await writeFile(join(dir, manifest.remote.file), reference, { mode: 0o600 }); await sign();
  const listed = await fixture.cli(['backup', 'list', '--json']);
  expect(JSON.parse(listed.stdout).backups[0].remoteKind).toBe('s3-reference-v1');
  const { planRetention } = await import('../src/backup/retention');
  const full = entries.find(entry => entry.kind === 'verified')!;
  if (full.kind !== 'verified') throw new Error('expected verified full backup');
  const refEntry = (number: number) => ({ kind: 'verified' as const, backup: { ...full.backup, backupId: `backup-ref-${number}`, createdAt: `2020-01-0${number}T00:00:00.000Z`, snapshotKind: 'safety' as const, remoteKind: 's3-reference-v1' as const } });
  const retention = planRetention([full, refEntry(1), refEntry(2)], 1, new Set());
  expect(retention.keep).toContain(id);
  expect(retention.remove).toContain('backup-ref-1');
  await expect(exportBackup(fixture.directory, id, join(fixture.root, 'reference-export'))).rejects.toThrow(/reference.*export/i);
  manifest.remote.source.bucket = 'foreign'; await sign();
  await expect(readManifest(dir, fixture.directory)).rejects.toThrow(/source|configuration|manifest/i);
});

test('restore requires --yes, an existing authenticated backup, and a clean deployment', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  await fixture.reset();
  const noConfirm = await fixture.cli(['restore', id]);
  expect(noConfirm.exitCode).toBe(1);
  expect(noConfirm.stderr).toContain('Re-run with --yes');
  const missing = await fixture.cli(['restore', 'backup-does-not-exist', '--yes']);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain('was not found');
  const invalid = await fixture.cli(['restore', '../escape', '--yes']);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain('is invalid');
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

// A snapshot contains an encrypted vault backup but the old restore path does
// not import it. Missing custody must be refused before stopping or replacing
// anything, otherwise a fresh empty vault could silently lose saved secrets.
test('restore refuses missing vault custody before recording or mutating anything', async () => {
  const fixture = await sandbox();
  const backup = await fixture.cli(['backup']);
  expect(backup.exitCode, backup.output).toBe(0);
  const [backupId] = await fixture.backupIds();
  const stateBefore = await fixture.readStateText();
  const envBefore = await fixture.readEnvText();
  await fixture.reset();
  await fixture.configure({ failures: [{ match: `volume inspect ${fixture.state.volumeName}-vault-key`, message: 'fixture custody volume missing' }] });
  const result = await fixture.cli(['restore', backupId!, '--yes']);
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(/vault.*custody/i);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect(await fixture.readStateText()).toBe(stateBefore);
  expect(await fixture.readEnvText()).toBe(envBefore);
});

// A surviving marker and key are insufficient: the actual encrypted vault may
// be absent, corrupt or encrypted under another key. Refuse before mutation.
test('restore refuses unreadable vault contents before recording or mutating anything', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const stateBefore = await fixture.readStateText(), envBefore = await fixture.readEnvText();
  await fixture.reset();
  await fixture.configure({ failures: [{ match: '/app/vault/cli.js audit verify', message: 'fixture vault database missing or corrupt' }] });
  const result = await fixture.cli(['restore', id, '--yes']);
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(/vault.*custody/i);
  const trace = await fixture.traceText();
  expect(trace).not.toMatch(DESTRUCTIVE);
  expect(trace).toMatch(/--name or3-vault-inspection-/);
  expect(trace).toMatch(/rm --force or3-vault-inspection-/);
  expect(await fixture.readStateText()).toBe(stateBefore);
  expect(await fixture.readEnvText()).toBe(envBefore);
});

test('restore refuses a different healthy vault before recording or mutating anything', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const stateBefore = await fixture.readStateText(), envBefore = await fixture.readEnvText();
  await fixture.reset(); await fixture.configure({ vaultId: 'b'.repeat(32) });
  const result = await fixture.cli(['restore', id, '--yes']);
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(/vault.*custody/i);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect(await fixture.readStateText()).toBe(stateBefore);
  expect(await fixture.readEnvText()).toBe(envBefore);
});

// A real vault can hold a zero-header rollback journal after a committed write
// under SQLite exclusive locking. Accept that stable state, but never accept a
// damaged database or the wrong key. All custody here is disposable.
test('vault preflight verifies a live exclusive-lock vault without changing its files', async () => {
  const fixture = await sandbox();
  const root = join(fixture.root, 'vault-fixture'); await mkdir(root, { mode: 0o700 });
  const vault = join(root, 'live'), key = join(root, 'master.key'), token = join(root, 'operator.token'), scratch = join(root, 'scratch');
  const cli = new URL('../../../node_modules/@or3/secrets/dist/cli.js', import.meta.url).pathname;
  const init = Bun.spawn([process.execPath, '--no-env-file', cli, 'init', '--vault-dir', vault, '--key-file', key, '--operator-file', token], { stdout: 'ignore', stderr: 'pipe' });
  expect(await init.exited, await new Response(init.stderr).text()).toBe(0);
  const database = join(vault, 'vault.sqlite');
  const locker = Bun.spawn([process.execPath, '-e', `import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1]); db.exec('PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; PRAGMA user_version=1; COMMIT'); console.log('ready'); setInterval(() => {}, 1000);`, database], { stdout: 'pipe', stderr: 'pipe' });
  try {
    const ready = await locker.stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value)).toContain('ready');
    const journal = `${database}-journal`;
    const before = await readFile(journal);
    expect(before.subarray(0, 8).every(byte => byte === 0)).toBe(true);
    const source = await readFile(new URL('../src/backup/vault.ts', import.meta.url), 'utf8');
    const script = source.split('const script = `')[1]!.split('`;')[0]!
      .replaceAll('/scratch', scratch).replaceAll('/vault-data/live', vault).replaceAll('/vault-key/master.key', key)
      .replaceAll('/vault-key/operator.token', token)
      .replaceAll('/app/vault/cli.js', cli).replaceAll('/usr/local/bin/bun', process.execPath)
      .replaceAll('1000n', `${process.getuid!()}n`).replaceAll('1000', String(process.getuid!()));
    const vaultId = (await readFile(join(vault, 'complete'), 'utf8')).trim();
    const verify = async (expectedId = vaultId) => {
      await rm(scratch, { recursive: true, force: true }); await mkdir(scratch, { mode: 0o700 });
      const child = Bun.spawn([process.execPath, '-e', script], { env: { ...process.env, OR3_EXPECTED_VAULT_ID: expectedId }, stdout: 'ignore', stderr: 'ignore' });
      return await child.exited;
    };
    expect(await verify()).toBe(0);
    expect(await verify(vaultId === 'a'.repeat(32) ? 'b'.repeat(32) : 'a'.repeat(32))).not.toBe(0);
    expect(await readFile(journal)).toEqual(before);
    const original = await readFile(key); await writeFile(key, Buffer.alloc(original.length, 7));
    expect(await verify()).not.toBe(0);
    await writeFile(key, original);
    await writeFile(database, Buffer.alloc(4096, 1));
    expect(await verify()).not.toBe(0);
  } finally { locker.kill(); await locker.exited; }
});

// An operator-supplied recovery key is read only from a private, stable file;
// reject links, shared permissions, wrong sizes and relative paths.
test('vault recovery key input requires a private regular 32-byte file', async () => {
  const { readVaultRecoveryKey } = await import('../src/backup/vault');
  const fixture = await sandbox(); const keyPath = join(fixture.root, 'recovery.key');
  const key = Buffer.alloc(32, 9); await writeFile(keyPath, key, { mode: 0o600 });
  const read = await readVaultRecoveryKey(keyPath); expect(read).toEqual(key); read.fill(0);
  await expect(readVaultRecoveryKey('recovery.key')).rejects.toThrow(/absolute/i);
  const link = join(fixture.root, 'link'); await symlink(keyPath, link);
  await expect(readVaultRecoveryKey(link)).rejects.toThrow(/private|regular/i);
  const { chmod } = await import('node:fs/promises'); await chmod(keyPath, 0o644);
  await expect(readVaultRecoveryKey(keyPath)).rejects.toThrow(/private|regular/i);
  await chmod(keyPath, 0o600); await writeFile(keyPath, 'wrong size');
  await expect(readVaultRecoveryKey(keyPath)).rejects.toThrow(/32|private/i);
});

// Exercise the real vault provider and supervisor command on disposable
// private directories: wrong keys and occupied custody must not replace data,
// and successful recovery must retain the vault identity under a new key.
test('vault restore-empty recovers only into empty custody with the matching key', async () => {
  const root = await mkdtemp(join(await realpath('/tmp'), 'or3-vault-test-')); temporaryRoots.push(root);
  const cli = new URL('../../../node_modules/@or3/secrets/dist/cli.js', import.meta.url).pathname;
  const original = join(root, 'original'), oldKey = join(root, 'old.key'), operator = join(root, 'old.token'), backup = join(root, 'source.backup');
  const invoke = async (args: string[], input?: string) => { const child = Bun.spawn([process.execPath, '--no-env-file', cli, ...args], { stdin: input === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' }); if (input !== undefined && child.stdin !== null && typeof child.stdin !== 'number') { child.stdin.write(input); child.stdin.end(); } const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, out, err }; };
  const call = async (args: string[], input?: string) => { const result = await invoke(args, input); expect(result.code, result.err).toBe(0); return JSON.parse(result.out); };
  const initial = await call(['init', '--vault-dir', original, '--key-file', oldKey, '--operator-file', operator]);
  const socketDir = join(root, 'run'); await mkdir(socketDir, { mode: 0o700 }); const socket = join(socketDir, 'api.sock');
  const startVault = async (vault: string, key: string) => {
    const child = Bun.spawn([process.execPath, '--no-env-file', cli, 'serve', '--vault-dir', vault, '--key-file', key, '--socket', socket], { stdout: 'pipe', stderr: 'pipe' });
    const ready = await child.stdout.getReader().read(); expect(JSON.parse(new TextDecoder().decode(ready.value)).vaultId).toBe(initial.vaultId); return child;
  };
  const token = join(root, 'service.token');
  const connection = ['--socket', socket, '--vault-id', initial.vaultId];
  const scope = ['--namespace', 'fixture', '--owner-user-id', 'user', '--workspace-id', 'workspace', '--consumer-id', 'plugin', '--name', 'api'];
  const firstService = await startVault(original, oldKey);
  try {
    await call(['token', 'issue', ...connection, '--token-file', operator, '--kind', 'service', '--namespace', 'fixture', '--capabilities', 'metadata,read,write,delete', '--expires-in', '1h', '--out-file', token]);
    await call(['put', ...connection, '--token-file', token, ...scope, '--expected-revision', '0'], 'synthetic saved secret');
  } finally { firstService.kill(); await firstService.exited; }
  await call(['backup', '--vault-dir', original, '--key-file', oldKey, '--out-file', backup]);
  const savedKey = await readFile(oldKey), encrypted = await readFile(backup);
  const { readAuthenticatedVaultId } = await import('../src/backup/vault');
  expect(await readAuthenticatedVaultId(backup, sha256(encrypted))).toBe(initial.vaultId);
  await expect(readAuthenticatedVaultId(backup, 'a'.repeat(64))).rejects.toThrow(/checksum/i);
  const invalidId = Buffer.from(encrypted); invalidId[8] = invalidId[8]! | 0x80;
  const invalidIdBackup = join(root, 'invalid-id.backup'); await writeFile(invalidIdBackup, invalidId, { mode: 0o600 });
  await expect(readAuthenticatedVaultId(invalidIdBackup, sha256(invalidId))).rejects.toThrow(/header/i);
  const data = join(root, 'data'), custody = join(root, 'key'), tmp = join(root, 'temporary');
  for (const dir of [data, custody, tmp]) await mkdir(dir, { mode: 0o700 });
  const originalScript = await readFile(new URL('../../../scripts/docker/vault-entrypoint.mjs', import.meta.url), 'utf8');
  const script = originalScript.replace('const uid = 1000, appUid = 65532, gid = 65532;', `const uid = ${process.getuid!()}, appUid = ${process.getuid!()}, gid = ${process.getgid!()};`)
    .replaceAll('/tmp/', `${tmp}/`).replaceAll('/vault-data', data).replaceAll('/vault-key', custody)
    .replaceAll('/app/vault/cli.js', cli).replaceAll('/usr/local/bin/bun', process.execPath)
    .replaceAll('process.getuid() !== 0', 'false').replaceAll('process.setgroups([]);', '');
  const restore = async (key: Buffer, race = false, expectedId = initial.vaultId) => {
    const actualScript = race ? script.replace("const fd = openSync(incoming, 'wx', 0o600);", "writeFileSync(incoming, 'foreign', { mode: 0o600 }); const fd = openSync(incoming, 'wx', 0o600);") : script;
    const child = Bun.spawn([process.execPath, '-e', actualScript, 'fixture-entrypoint', 'restore-empty'], { env: { ...process.env, OR3_VAULT_RESTORE_KEY_B64: key.toString('base64'), OR3_VAULT_RESTORE_EXPECTED_ID: expectedId }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    child.stdin.write(encrypted); child.stdin.end();
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(out + err).not.toContain(key.toString('base64'));
    return { code, out, err };
  };
  await writeFile(join(data, 'sentinel'), 'preserve', { mode: 0o600 });
  expect((await restore(savedKey)).code).not.toBe(0);
  expect(await readFile(join(data, 'sentinel'), 'utf8')).toBe('preserve');
  await rm(join(data, 'sentinel'));
  expect((await restore(savedKey, true)).code).not.toBe(0);
  const raced = await readdir(data); expect(raced).toHaveLength(1);
  expect(await readFile(join(data, raced[0]!), 'utf8')).toBe('foreign');
  await rm(join(data, raced[0]!));
  expect((await restore(Buffer.alloc(savedKey.length, 7))).code).not.toBe(0);
  expect(await readdir(data)).toEqual([]); expect(await readdir(custody)).toEqual([]); expect(await readdir(tmp)).toEqual([]);
  expect((await restore(savedKey, false, 'f'.repeat(32))).code).not.toBe(0);
  expect(await readdir(data)).toEqual([]); expect(await readdir(custody)).toEqual([]);
  const recovered = await restore(savedKey);
  expect(recovered.code, recovered.err).toBe(0);
  expect(JSON.parse(recovered.out).vaultId).toBe(initial.vaultId);
  expect(await readFile(join(custody, 'master.key'))).not.toEqual(savedKey);
  expect((await call(['audit', 'verify', '--vault-dir', join(data, 'live'), '--key-file', join(custody, 'master.key')])).vaultId).toBe(initial.vaultId);
  expect(await readdir(tmp)).toEqual([]);
  const restoredService = await startVault(join(data, 'live'), join(custody, 'master.key'));
  try {
    expect((await invoke(['get', ...connection, '--token-file', token, ...scope, '--stdout'])).code).not.toBe(0);
    const newToken = join(root, 'new-service.token');
    await call(['token', 'issue', ...connection, '--token-file', join(custody, 'operator.token'), '--kind', 'service', '--namespace', 'fixture', '--capabilities', 'metadata,read,write,delete', '--expires-in', '1h', '--out-file', newToken]);
    const got = await invoke(['get', ...connection, '--token-file', newToken, ...scope, '--stdout']);
    expect(got.code, got.err).toBe(0); expect(got.out).toBe('synthetic saved secret');
  } finally { restoredService.kill(); await restoredService.exited; }
});

// Key custody must be exported without printing key bytes or replacing any
// existing file; destinations inside the managed deployment are not off-host.
test('vault key export creates a private file and refuses unsafe destinations', async () => {
  const fixture = await sandbox();
  const destination = join(fixture.root, 'master.key');
  const result = await fixture.cli(['vault-key', 'export', '--out', destination]);
  expect(result.exitCode, result.output).toBe(0);
  expect(await readFile(destination)).toEqual(Buffer.alloc(32, 0x31));
  expect((await stat(destination)).mode & 0o777).toBe(0o600);
  expect(result.output).not.toContain('1'.repeat(32));
  const trace = (await fixture.trace()).map(args => args.join(' '));
  const helperRun = trace.find(line => line.startsWith('run ') && line.includes('/vault-key/master.key'))!;
  expect(helperRun).toContain('--log-driver none');
  const helperName = /--name (or3-vault-key-export-[a-f0-9-]+)/.exec(helperRun)?.[1];
  expect(helperName).toBeDefined();
  expect(trace).toContain(`rm --force ${helperName}`);
  expect((await fixture.cli(['vault-key', 'export', '--out', destination])).exitCode).toBe(1);
  expect((await fixture.cli(['vault-key', 'export', '--out', join(fixture.directory, 'master.key')])).exitCode).toBe(1);
  expect(await fixture.traceText()).not.toContain('1'.repeat(32));
  await fixture.reset();
  await fixture.configure({ failures: [{ match: 'rm --force or3-vault-key-export-', message: 'fixture cleanup failure' }] });
  const failedDestination = join(fixture.root, 'cleanup-failed.key');
  const failed = await fixture.cli(['vault-key', 'export', '--out', failedDestination]);
  expect(failed.exitCode).toBe(1);
  expect(failed.output).toMatch(/cleanup/i);
  expect((await stat(failedDestination)).size).toBe(0);
});

test('export copies a verified backup, records a receipt, and refuses unsafe destinations', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const destination = join(fixture.root, 'exported');
  const exported = await fixture.cli(['backup', 'export', id, destination]);
  expect(exported.exitCode, exported.output).toBe(0);
  expect(exported.stdout).toContain('same filesystem as the deployment');
  expect(exported.stdout).toContain('data purge remains disabled');
  for (const file of ['data.tgz', 'config.env', 'manifest.json', 'manifest.auth']) {
    expect(sha256(await readFile(join(destination, file)))).toBe(sha256(await readFile(join(fixture.cloud, 'backups', id, file))));
  }
  const receipt = JSON.parse(await readFile(join(fixture.cloud, 'exports', `${id}.json`), 'utf8'));
  expect(receipt).toMatchObject({
    schemaVersion: 1,
    backupId: id,
    destination,
    destinationDevice: (await stat(destination)).dev,
    dataSha256: sha256(await readFile(join(destination, 'data.tgz'))),
  });

  const existing = await fixture.cli(['backup', 'export', id, destination]);
  expect(existing.exitCode).toBe(1);
  expect(existing.stderr).toContain('already exists');
  const inside = await fixture.cli(['backup', 'export', id, join(fixture.directory, 'inside-export')]);
  expect(inside.exitCode).toBe(1);
  expect(inside.stderr).toContain('must live outside the managed deployment directory');
  expect(existsSync(join(fixture.directory, 'inside-export'))).toBe(false);
  const intoBackup = await fixture.cli(['backup', 'export', id, join(fixture.cloud, 'backups', id, 'nested')]);
  expect(intoBackup.exitCode).toBe(1);
  expect(intoBackup.stderr).toContain('different from the backup itself');
  const missing = await fixture.cli(['backup', 'export', 'backup-nope', join(fixture.root, 'x')]);
  expect(missing.exitCode).toBe(1);
  const usage = await fixture.cli(['backup', 'export', id]);
  expect(usage.stderr).toContain('backup export requires a backup ID and a destination directory');
});

test('retention keeps the newest backups, never prunes the rollback point, and gates --force', async () => {
  const fixture = await sandbox();
  const ids = [];
  for (let index = 0; index < 3; index += 1) {
    ids.push(await createBackup(fixture));
    await Bun.sleep(25);
  }
  const state = await fixture.readState();
  state.rollback = { appVersion: '0.1.73', image: fixture.image, imageDigest: state.imageDigest, backupId: ids[0], createdAt: new Date().toISOString() };
  await fixture.writeState(state);

  const bad = await fixture.cli(['backup', 'prune', '--keep', '0']);
  expect(bad.exitCode).toBe(1);
  expect(bad.stderr).toContain('--keep must be an integer of at least 1');
  const forced = await fixture.cli(['backup', 'prune', '--force']);
  expect(forced.exitCode).toBe(1);
  expect(forced.stderr).toContain('--force may delete backups beyond the retention count');
  const json = await fixture.cli(['backup', 'prune', '--json']);
  expect(json.stderr).toContain('--json is supported only by `backup list`');
  expect(await fixture.backupIds()).toEqual(ids);

  const pruned = await fixture.cli(['backup', 'prune', '--keep', '1']);
  expect(pruned.exitCode, pruned.output).toBe(0);
  expect(await fixture.backupIds()).toEqual([ids[0], ids[2]]);
  expect(pruned.stdout).toContain(`Deleted backup ${ids[1]}`);
});

test('ordinary remove retains volumes, backups, configuration, and state', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  await fixture.reset();
  const removed = await fixture.cli(['remove']);
  expect(removed.exitCode, removed.output).toBe(0);
  expect(removed.stdout).toContain('Data volume, backups, configuration, and managed state are retained');
  const calls = (await fixture.trace()).map((args) => args.join(' '));
  expect(calls.some((call) => /compose .* down$/.test(call))).toBe(true);
  expect(calls.some((call) => call.includes('volume rm'))).toBe(false);
  expect(await fixture.backupIds()).toEqual([id]);
  for (const file of ['.env', '.or3-cloud/state.json', 'compose.yaml']) expect(existsSync(join(fixture.directory, file))).toBe(true);
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);
});

test('remove --purge-data refuses without --yes before touching Docker', async () => {
  const fixture = await sandbox();
  const result = await fixture.cli(['remove', '--purge-data']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/reconstruction.*not.*supported/i);
  expect(await fixture.trace()).toEqual([]);
  expect(existsSync(join(fixture.directory, '.env'))).toBe(true);
});

test('purge eligibility requires a fresh export on a different filesystem', async () => {
  const { assertPurgeHasVerifiedExport } = await import('../src/backup/export');
  const { enumerateBackups } = await import('../src/backup/manifests');
  const fixture = await sandbox();
  await writeFile(join(fixture.directory, 'user-notes.txt'), 'keep me');
  const noBackup = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(noBackup.exitCode).toBe(1);
  expect(noBackup.stderr).toMatch(/reconstruction.*not.*supported/i);
  const check = async () => assertPurgeHasVerifiedExport(fixture.directory, await enumerateBackups(fixture.directory), Date.now());
  await expect(check()).rejects.toThrow(/complete recovery/i);

  const id = await createBackup(fixture);
  await fixture.reset();
  await expect(check()).rejects.toThrow(/verified backup export/i);

  const sameDevice = join(fixture.root, 'same-device-export');
  expect((await fixture.cli(['backup', 'export', id, sameDevice])).exitCode).toBe(0);
  await fixture.reset();
  await expect(check()).rejects.toThrow(/verified backup export/i);

  // A receipt copied by hand cannot manufacture a different device.
  const receiptPath = join(fixture.cloud, 'exports', `${id}.json`);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await writeFile(receiptPath, JSON.stringify({ ...receipt, destinationDevice: receipt.destinationDevice + 1 }));
  await expect(check()).rejects.toThrow(/verified backup export/i);

  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect(await readFile(join(fixture.directory, 'user-notes.txt'), 'utf8')).toBe('keep me');
  for (const file of ['.env', '.or3-cloud/state.json', 'compose.yaml']) expect(existsSync(join(fixture.directory, file))).toBe(true);
});

test('purge refuses while an operation is pending', async () => {
  const fixture = await sandbox();
  const state = await fixture.readState();
  state.incompleteOperation = { id: 'update-1', operation: 'update', startedAt: new Date().toISOString(), message: 'x', phase: 'target-mutating' };
  await fixture.writeState(state);
  const result = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('An incomplete update is recorded');
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

test('a stale backup cannot authorize a purge even with an export', async () => {
  const { assertPurgeHasVerifiedExport } = await import('../src/backup/export');
  const { enumerateBackups } = await import('../src/backup/manifests');
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  // Age the backup past the 24 hour window by re-signing its manifest.
  const path = join(fixture.cloud, 'backups', id);
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  manifest.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  const { createHmac } = await import('node:crypto');
  await writeFile(join(path, 'manifest.json'), contents);
  await writeFile(join(path, 'manifest.auth'), `${createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(contents).digest('hex')}\n`);
  expect((await fixture.cli(['backup', 'export', id, join(fixture.root, 'stale-export')])).exitCode).toBe(0);
  await fixture.reset();
  await expect(assertPurgeHasVerifiedExport(fixture.directory, await enumerateBackups(fixture.directory), Date.now())).rejects.toThrow(/backup newer than 24 hours/i);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

const crossDevice = test.skipIf(!otherFs);

crossDevice('an S3 export on another filesystem cannot authorize purge before managed recovery is qualified', async () => {
  const { exportBackup, assertPurgeHasVerifiedExport } = await import('../src/backup/export');
  const { enumerateBackups } = await import('../src/backup/manifests');
  const fixture = await sandbox(); const id = await createBackup(fixture); const dir = join(fixture.cloud, 'backups', id);
  const config = `${await readFile(join(dir, 'config.env'), 'utf8')}\nOR3_SYNC_PROVIDER=sqlite\nNUXT_PUBLIC_STORAGE_PROVIDER=s3\nOR3_STORAGE_S3_ENDPOINT=https://storage.example.invalid\nOR3_STORAGE_S3_BUCKET=fixture-bucket\nOR3_STORAGE_S3_KEY_PREFIX=prefix/\n`;
  await writeFile(join(dir, 'config.env'), config, { mode: 0o600 });
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); const payload = 'synthetic remote backup';
  manifest.schemaVersion = 2; manifest.storage = 's3'; manifest.configSha256 = sha256(config);
  manifest.remote = { kind: 's3-copy-v1', file: 'remote-objects.tar', sha256: sha256(payload), bytes: Buffer.byteLength(payload), inventorySha256: 'a'.repeat(64), objectCount: 1, payloadBytes: 23, source: { endpointOrigin: 'https://storage.example.invalid', bucket: 'fixture-bucket', keyPrefix: 'prefix/' }, providerVersion: '0.0.15' };
  await writeFile(join(dir, manifest.remote.file), payload, { mode: 0o600 });
  const text = `${JSON.stringify(manifest, null, 2)}\n`; await writeFile(join(dir, 'manifest.json'), text, { mode: 0o600 }); await writeBackupAuthentication(fixture.directory, dir, text);
  const destination = join(otherFs!, `or3-s3-export-${process.pid}-${Date.now()}`);
  try {
    await exportBackup(fixture.directory, id, destination);
    await expect(assertPurgeHasVerifiedExport(fixture.directory, await enumerateBackups(fixture.directory), Date.now())).rejects.toThrow(/complete recovery|verified backup export/i);
  } finally { await rm(destination, { recursive: true, force: true }); }
});

crossDevice.each(['local', 'public'] as const)('purge preserves %s deployment even with an off-host export', async (mode) => {
  const fixture = await sandbox({ mode });
  const id = await createBackup(fixture);
  const destination = join(otherFs!, `or3-export-${mode}-${process.pid}-${Date.now()}`);
  try {
    expect((await fixture.cli(['backup', 'export', id, destination])).exitCode).toBe(0);
    const authKey = await readFile(join(fixture.cloud, 'backup-auth.key'));
    await fixture.reset();
    const purged = await fixture.cli(['remove', '--purge-data', '--yes']);
    expect(purged.exitCode).toBe(1);
    expect(purged.stderr).toMatch(/reconstruction.*not.*supported/i);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect(await readFile(join(fixture.cloud, 'backup-auth.key'))).toEqual(authKey);
    expect(existsSync(join(fixture.directory, '.env'))).toBe(true);
    expect(existsSync(join(destination, 'manifest.json'))).toBe(true);
  } finally { await rm(destination, { recursive: true, force: true }); }
});

crossDevice('a tampered export fails direct purge eligibility verification', async () => {
  const { assertPurgeHasVerifiedExport } = await import('../src/backup/export');
  const { enumerateBackups } = await import('../src/backup/manifests');
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const destination = join(otherFs!, `or3-export-tamper-${process.pid}-${Date.now()}`);
  try {
    expect((await fixture.cli(['backup', 'export', id, destination])).exitCode).toBe(0);
    await appendFile(join(destination, 'data.tgz'), 'tampered');
    await expect(assertPurgeHasVerifiedExport(fixture.directory, await enumerateBackups(fixture.directory), Date.now())).rejects.toThrow(/verified backup export/i);
  } finally { await rm(destination, { recursive: true, force: true }); }
});

// Failure matrix: capture/delete/restart may fail independently; verification
// must use captured bytes after restart; progress/terminal writes must never
// discard a verified artifact or its recovery journal. Exercise the production
// commands with the same fake Docker processes as the CLI cases above.
async function inProcess(fixture: Sandbox, run: () => Promise<unknown>) {
  const previous = process.env.PATH;
  process.env.PATH = `${join(fixture.root, 'bin')}:${previous}`;
  try { return await run(); }
  finally {
    process.env.PATH = previous;
    for (const key of Object.keys(lifecycleFaults)) delete lifecycleFaults[key as keyof typeof lifecycleFaults];
  }
}

// The staged S3 lane exercises future recovery internals while public recovery
// remains gated for legacy state; only this child replaces that one guard.
async function stagedS3Recovery(fixture: Sandbox) {
  const envModule = new URL('../src/deployment/env.ts', import.meta.url).href;
  const command = new URL('../src/commands/recover.ts', import.meta.url).href;
  const script = `import { mock } from 'bun:test'; const original = await import(${JSON.stringify(envModule)}); mock.module(${JSON.stringify(envModule)}, () => ({ ...original, assertLegacyManagedProfile: () => {} })); const { recoverCommand } = await import(${JSON.stringify(command)}); try { await recoverCommand(process.cwd(), {restore:true,yes:true}); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: fixture.directory, env: process.env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, output: stdout + stderr, exitCode };
}

import { createBackup as captureBackup } from '../src/backup/create';
import { backupCommand } from '../src/commands/backup';
import { recoverCommand } from '../src/commands/recover';
import { lifecycleFaults } from '../src/lifecycle-faults';
import { streamCommandToFile, streamFileToCommand } from '../src/runtime/command-runner';
import type { BackupProgress } from '../src/deployment/contracts';

// Incomplete S3 configuration and public managed commands must still refuse
// before mutation while the complete recovery lifecycle is unavailable.
test('safety snapshots refuse incomplete S3 storage before service mutation', async () => {
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    await expect(captureBackup(fixture.directory, fixture.state, { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3' }, { safetySnapshot: true })).rejects.toThrow(/Unsupported offline backup inspection provider profile|Invalid S3 recovery configuration/);
  });
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
  expect(await fixture.backupIds()).toEqual([]);
  const originalState = await fixture.readStateText();
  const modifiedEnv = (await fixture.readEnvText()).replace(/^NUXT_PUBLIC_STORAGE_PROVIDER=.*$/m, 'NUXT_PUBLIC_STORAGE_PROVIDER=s3');
  await writeFile(join(fixture.directory, '.env'), modifiedEnv, { mode: 0o600 });
  await fixture.reset();
  const command = await fixture.cli(['backup']);
  expect(command.exitCode).toBe(1);
  expect(command.output).toContain('Unsupported offline backup inspection provider profile');
  expect(await fixture.readStateText()).toBe(originalState);
  expect(await fixture.readEnvText()).toBe(modifiedEnv);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

test('internal S3 safety snapshot records references offline without sending credentials to helpers', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const fixture = await sandbox();
  const env = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://storage.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'fixture-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(env), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const result = await captureBackup(fixture.directory, fixture.state, env, { restartAfter: false, safetySnapshot: true });
    expect(result.manifest).toMatchObject({ schemaVersion: 2, storage: 's3', remote: { kind: 's3-reference-v1', sha256: sha256('fixture-remote-inventory') } });
    const trace = await fixture.traceText();
    expect(trace).toContain('remote-objects.mjs inventory'); expect(trace).toContain('remote-objects.mjs verify-inventory');
    expect(trace).not.toContain('remote-objects.mjs capture'); expect(trace).not.toContain('OR3_STORAGE_S3_SECRET_ACCESS_KEY'); expect(trace).not.toContain('fixture-secret');
  });
});

// Run the shipped tar/awk validation against real archives: Clerk has no
// Basic Auth database, but SQLite must always exist and unknown profiles fail.
test('archive validation requires the databases of the selected profile', async () => {
  const { validateVolumeArchive } = await import('../src/backup/archive');
  const fixture = await sandbox(); await fixture.configure({ realArchiveValidation: true });
  const contents = join(fixture.root, 'archive-contents'), backup = join(fixture.root, 'archive-validation');
  await mkdir(contents, { mode: 0o700 }); await mkdir(backup, { mode: 0o700 });
  const makeArchive = async () => { const result = Bun.spawnSync(['tar', '-czf', join(backup, 'data.tgz'), '-C', contents, '.'], { stderr: 'pipe' }); expect(result.exitCode, result.stderr.toString()).toBe(0); };
  await writeFile(join(contents, 'sync.sqlite'), 'sync'); await makeArchive();
  const clerk = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 's3' };
  await inProcess(fixture, async () => {
    await expect(validateVolumeArchive(fixture.directory, fixture.state.mode, clerk, backup)).resolves.toBeUndefined();
    await expect(validateVolumeArchive(fixture.directory, fixture.state.mode, fixture.env, backup)).rejects.toThrow();
    await writeFile(join(contents, 'auth.sqlite'), 'auth'); await makeArchive();
    await expect(validateVolumeArchive(fixture.directory, fixture.state.mode, fixture.env, backup)).resolves.toBeUndefined();
    await rm(join(contents, 'sync.sqlite')); await makeArchive();
    await expect(validateVolumeArchive(fixture.directory, fixture.state.mode, clerk, backup)).rejects.toThrow();
    await expect(validateVolumeArchive(fixture.directory, fixture.state.mode, { ...clerk, AUTH_PROVIDER: 'unknown' }, backup)).rejects.toThrow(/profile/i);
  });
});

test('deep health checks only databases belonging to the selected profile', async () => {
  const { HEALTH_SCRIPT } = await import('../src/runtime/health');
  const fixture = await sandbox(); const sync = join(fixture.root, 'sync.sqlite'), auth = join(fixture.root, 'auth.sqlite');
  await writeFile(sync, 'fixture');
  const response = `global.fetch = async () => ({ ok: true, json: async () => process.env.FIXTURE_HEALTH === 'missing' ? { status: 'ok' } : { status: 'ok', providers: { auth: { provider: process.env.FIXTURE_HEALTH === 'wrong' ? 'basic-auth' : process.env.AUTH_PROVIDER }, sync: { provider: 'sqlite' }, storage: { provider: process.env.NUXT_PUBLIC_STORAGE_PROVIDER } } } });`;
  const script = `${response} ${HEALTH_SCRIPT.replace("'/data'", JSON.stringify(fixture.root))}`;
  const check = async (authProvider: string, storage = authProvider === 'clerk' ? 's3' : 'fs', health = 'correct') => { const child = Bun.spawn(['node', '-e', script], { env: { ...process.env, AUTH_PROVIDER: authProvider, OR3_AUTH_PROVIDER: authProvider, NUXT_PUBLIC_STORAGE_PROVIDER: storage, OR3_BASIC_AUTH_DB_PATH: auth, OR3_SQLITE_DB_PATH: sync, FIXTURE_HEALTH: health }, stdout: 'ignore', stderr: 'ignore' }); return await child.exited; };
  expect(await check('clerk')).toBe(0);
  expect(await check('clerk', 's3', 'missing')).not.toBe(0);
  expect(await check('clerk', 's3', 'wrong')).not.toBe(0);
  expect(await check('clerk', 'fs')).not.toBe(0);
  expect(await check('basic-auth')).not.toBe(0);
  expect(await check('unknown')).not.toBe(0);
  await writeFile(auth, 'fixture'); expect(await check('basic-auth')).toBe(0);
  await rm(sync); expect(await check('clerk')).not.toBe(0);
  await writeFile(sync, 'fixture'); await rm(auth);
  const compose = await readFile(new URL('../assets/compose.yaml', import.meta.url), 'utf8');
  const probes = [...compose.matchAll(/exec (?:\/nodejs\/bin\/node|\/usr\/local\/bin\/node) -e "([^"]+)"/g)];
  expect(probes).toHaveLength(2);
  for (const [, probe] of probes) {
    const code = `${response} ${probe!.replace("'/data'", JSON.stringify(fixture.root))}`;
    const run = async (provider: string, storage = provider === 'clerk' ? 's3' : 'fs', health = 'correct') => { const child = Bun.spawn(['node', '-e', code], { env: { ...process.env, AUTH_PROVIDER: provider, OR3_AUTH_PROVIDER: provider, NUXT_PUBLIC_STORAGE_PROVIDER: storage, OR3_BASIC_AUTH_DB_PATH: auth, OR3_SQLITE_DB_PATH: sync, FIXTURE_HEALTH: health }, stdout: 'ignore', stderr: 'ignore' }); return await child.exited; };
    expect(await run('clerk')).toBe(0); expect(await run('basic-auth')).not.toBe(0); expect(await run('unknown')).not.toBe(0);
    expect(await run('clerk', 's3', 'missing')).not.toBe(0); expect(await run('clerk', 's3', 'wrong')).not.toBe(0);
    expect(await run('clerk', 'fs')).not.toBe(0);
  }
});

test('restored database verification checks the selected profile with real SQLite files', async () => {
  const { VERIFY_DATABASES_SCRIPT } = await import('../src/runtime/health');
  const fixture = await sandbox(); const sync = join(fixture.root, 'sync.sqlite'), auth = join(fixture.root, 'auth.sqlite');
  const create = (path: string) => { const db = new Database(path); db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY)'); db.close(); };
  create(sync);
  const native = new URL('../../../node_modules/better-sqlite3', import.meta.url).pathname;
  const source = await readFile(new URL('../src/backup/restore.ts', import.meta.url), 'utf8');
  const restored = source.split('const VERIFY_RESTORED_DATA_SCRIPT = `')[1]!.split('`;')[0]!
    .replace('${assertFilesystemPayloadHash.toString()}', assertFilesystemPayloadHash.toString());
  const prepare = (script: string) => script.replaceAll('/app/.output/server/node_modules/better-sqlite3', native)
    .replace('info.uid !== 65532 || info.gid !== 65532', `info.uid !== ${process.getuid!()} || info.gid !== ${process.getgid!()}`);
  const run = async (script: string, provider: string) => { const child = Bun.spawn(['node', '-e', prepare(script)], { env: { ...process.env, AUTH_PROVIDER: provider, OR3_AUTH_PROVIDER: provider, NUXT_PUBLIC_STORAGE_PROVIDER: provider === 'clerk' ? 's3' : 'fs', OR3_BASIC_AUTH_DB_PATH: auth, OR3_SQLITE_DB_PATH: sync, OR3_STORAGE_FS_ROOT: join(fixture.root, 'no-storage') }, stdout: 'ignore', stderr: 'ignore' }); return await child.exited; };
  for (const script of [VERIFY_DATABASES_SCRIPT, restored]) {
    expect(await run(script, 'clerk')).toBe(0);
    expect(await run(script, 'basic-auth')).not.toBe(0);
    expect(await run(script, 'unknown')).not.toBe(0);
    create(auth); expect(await run(script, 'basic-auth')).toBe(0); await rm(auth);
  }
});

// Internal capture must restart before downloading remote bytes and only
// authenticate a schema-2 backup after offline verification. Public managed
// commands remain gated until restore and rollback are integrated.
test('internal S3 capture restarts before transfer and removes failed artifacts', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const fixture = await sandbox();
  const env = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://storage.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'fixture-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(env), { mode: 0o600 });
  const stages: string[] = [];
  await inProcess(fixture, async () => {
    const result = await captureBackup(fixture.directory, fixture.state, env, { onProgress: progress => { stages.push(progress.stage); } });
    expect(result.manifest).toMatchObject({ schemaVersion: 2, storage: 's3', remote: { kind: 's3-copy-v1', sha256: sha256('fixture-remote-archive') } });
    const trace = await fixture.traceText();
    expect(trace.indexOf(' stop or3')).toBeGreaterThan(-1);
    expect(trace.indexOf(' stop or3')).toBeLessThan(trace.lastIndexOf(' up -d'));
    expect(trace.lastIndexOf(' up -d')).toBeLessThan(trace.indexOf('remote-objects.mjs capture'));
    expect(trace.indexOf('remote-objects.mjs capture')).toBeLessThan(trace.indexOf('remote-objects.mjs verify'));
    expect(stages).toContain('remote-capture'); expect(trace).not.toContain('fixture-secret');
    await fixture.reset(); await fixture.configure({ failures: [{ match: 'remote-objects.mjs capture', message: 'fixture object read failure' }] });
    await expect(captureBackup(fixture.directory, fixture.state, env)).rejects.toThrow(/object read failure/i);
    expect(await fixture.backupIds()).toEqual([result.backupId]);
    const failedTrace = await fixture.traceText();
    expect(failedTrace.lastIndexOf(' up -d')).toBeLessThan(failedTrace.indexOf('remote-objects.mjs capture'));
    await fixture.reset(); await fixture.configure({ failures: [{ match: ' up -d', message: 'fixture restart failure' }] });
    await expect(captureBackup(fixture.directory, fixture.state, env)).rejects.toThrow(/restart failure/i);
    expect(await fixture.traceText()).not.toContain('remote-objects.mjs capture');
    expect(await fixture.backupIds()).toEqual([result.backupId]);
  });
});

// S3 restore must check the restored bucket before replacement and after
// startup. A missing target object must not stop the application or alter data.
// The public restore command remains gated until its complete journal path is
// integrated and qualified; this exercises the shared restore operation only.
test('internal S3 restore requires remote objects before and after startup', async () => {
  const { serializeEnv, parseEnv } = await import('../src/deployment/env');
  const { restoreBackupData } = await import('../src/backup/restore');
  const fixture = await sandbox();
  const source = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://source.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'source-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  const target = { ...source, OR3_STORAGE_S3_ENDPOINT: 'https://target.example.invalid', OR3_STORAGE_S3_BUCKET: 'target-bucket' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(source), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const captured = await captureBackup(fixture.directory, fixture.state, source);
    await writeFile(join(fixture.directory, '.env'), serializeEnv(target), { mode: 0o600 });
    await fixture.reset();
    await fixture.configure({ s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] } });
    await expect(restoreBackupData(fixture.directory, fixture.state, target, captured.backupDir, { beforeStart: async () => {} })).rejects.toThrow(/missing|mismatch/i);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect(parseEnv(await fixture.readEnvText()).OR3_STORAGE_S3_BUCKET).toBe('target-bucket');
    await fixture.reset();
    await fixture.configure({ s3Check: { checked: 1, missing: [], mismatched: [] } });
    let beforeStart = false;
    await restoreBackupData(fixture.directory, fixture.state, target, captured.backupDir, { beforeStart: async () => { beforeStart = true; } });
    const trace = await fixture.traceText();
    const checks = trace.split('\n').filter(line => line.includes('remote-objects.mjs check-copy'));
    expect(checks).toHaveLength(2);
    expect(trace.indexOf('remote-objects.mjs check-copy')).toBeLessThan(trace.indexOf(' stop or3'));
    expect(trace.lastIndexOf('remote-objects.mjs check-copy')).toBeGreaterThan(trace.lastIndexOf(' up -d'));
    expect(beforeStart).toBe(true);
    expect(parseEnv(await fixture.readEnvText()).OR3_STORAGE_S3_BUCKET).toBe('target-bucket');
    expect(trace).not.toContain('fixture-secret');
    // A remote change during startup must be reported after the caller's
    // journal transition; automatic pre-start rollback is no longer safe.
    await fixture.reset();
    let startupJournaled = false;
    await expect(restoreBackupData(fixture.directory, fixture.state, target, captured.backupDir, {
      beforeStart: async () => {
        startupJournaled = true;
        await fixture.configure({ s3Check: { checked: 1, missing: [], mismatched: ['prefix/workspace/hash'] } });
      },
    })).rejects.toThrow(/after startup/i);
    expect(startupJournaled).toBe(true);
    const afterStartup = await fixture.traceText();
    expect(afterStartup.lastIndexOf('remote-objects.mjs check-copy')).toBeGreaterThan(afterStartup.lastIndexOf(' up -d'));
  });
});

// Rollback references depend on the original bucket. A normal rollback must
// refuse missing objects; restoring a pre-mutation byte-preservation snapshot
// must warn about known missing objects instead of abandoning local recovery.
test('internal S3 reference restore checks original bucket and distinguishes safety recovery', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const { restoreBackupData, restorePreMutationSnapshot } = await import('../src/backup/restore');
  const fixture = await sandbox();
  const env = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://source.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'source-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(env), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const captured = await captureBackup(fixture.directory, fixture.state, env, { safetySnapshot: true });
    await fixture.reset();
    await fixture.configure({ s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] } });
    await expect(restoreBackupData(fixture.directory, fixture.state, env, captured.backupDir, { previousSafetySnapshot: true, beforeStart: async () => {} })).rejects.toThrow(/missing|mismatch/i);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    await fixture.reset();
    await expect(restoreBackupData(fixture.directory, fixture.state, { ...env, OR3_STORAGE_S3_BUCKET: 'foreign-bucket' }, captured.backupDir, { previousSafetySnapshot: true, remoteReferencePolicy: 'warn' })).rejects.toThrow(/source|target/i);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    await fixture.reset();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values) => warnings.push(values.join(' '));
    try { await restoreBackupData(fixture.directory, fixture.state, env, captured.backupDir, { previousSafetySnapshot: true, remoteReferencePolicy: 'warn' }); }
    finally { console.warn = originalWarn; }
    expect(warnings.join('\n')).toMatch(/missing|mismatch/i);
    const trace = await fixture.traceText();
    expect(trace).toContain('remote-objects.mjs check');
    expect(trace).not.toContain('remote-objects.mjs reconcile');
    expect(trace).toContain(' up -d');
    expect(trace).not.toContain('fixture-secret');
    await fixture.reset();
    await fixture.configure({ s3Check: { checked: 1, missing: [], mismatched: [] } });
    await restoreBackupData(fixture.directory, fixture.state, env, captured.backupDir, { previousSafetySnapshot: true, beforeStart: async () => {} });
    const complete = await fixture.traceText();
    const checks = complete.split('\n').filter(line => line.includes('remote-objects.mjs check'));
    expect(checks).toHaveLength(2);
    expect(complete.indexOf('remote-objects.mjs check')).toBeLessThan(complete.indexOf(' stop or3'));
    expect(complete.lastIndexOf('remote-objects.mjs check')).toBeGreaterThan(complete.lastIndexOf(' up -d'));
    // Exercise the actual interrupted-update recovery owner, including its
    // persisted phase, rather than only calling the shared restore directly.
    await fixture.configure({ s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] } });
    const recoveryState = { ...fixture.state, incompleteOperation: {
      id: 'update-test-recovery', operation: 'update' as const, startedAt: new Date().toISOString(), message: 'interrupted update',
      backupId: captured.backupId, backupPath: captured.backupDir,
      backupDataSha256: captured.manifest.dataSha256, backupConfigSha256: captured.manifest.configSha256,
    } };
    await fixture.writeState(recoveryState);
    console.warn = (...values) => warnings.push(values.join(' '));
    try { await restorePreMutationSnapshot(fixture.directory, recoveryState, env); }
    finally { console.warn = originalWarn; }
    expect((await fixture.readState()).incompleteOperation?.phase).toBe('restoring-previous');
    expect(warnings.join('\n')).toMatch(/missing/i);
  });
});

// Remote preflight runs before the restore journal: copied snapshots reconcile
// additively; reference snapshots only check their original bucket. Neither
// path may stop the app, and a failed check must leave the journal untouched.
test('S3 restore preflight reconciles copies and refuses incomplete references before journaling', async () => {
  const { preflightRemoteRestore } = await import('../src/backup/remote');
  const { serializeEnv } = await import('../src/deployment/env');
  const fixture = await sandbox();
  const source = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://source.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'source-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  const target = { ...source, OR3_STORAGE_S3_ENDPOINT: 'https://target.example.invalid', OR3_STORAGE_S3_BUCKET: 'target-bucket' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(source), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const full = await captureBackup(fixture.directory, fixture.state, source);
    const ref = await captureBackup(fixture.directory, fixture.state, source, { safetySnapshot: true });
    if (full.manifest.schemaVersion !== 2 || ref.manifest.schemaVersion !== 2) throw new Error('expected S3 manifests');
    const prior = await fixture.readStateText();
    await fixture.reset();
    await expect(preflightRemoteRestore(fixture.directory, full.manifest, { ...target, OR3_STORAGE_S3_KEY_PREFIX: 'wrong/' }, full.backupDir)).rejects.toThrow(/prefix/i);
    expect(await fixture.traceText()).not.toContain('remote-objects.mjs reconcile');
    expect(await preflightRemoteRestore(fixture.directory, full.manifest, target, full.backupDir)).toEqual({ uploaded: 1, markersCreated: 1 });
    let trace = await fixture.traceText();
    expect(trace.indexOf('remote-objects.mjs verify')).toBeLessThan(trace.indexOf('remote-objects.mjs reconcile'));
    expect(trace).not.toMatch(DESTRUCTIVE);
    expect(trace).not.toContain('fixture-secret');
    await fixture.reset();
    await fixture.configure({ failures: [{ match: 'remote-objects.mjs reconcile', message: 'fixture transfer failure' }] });
    await expect(preflightRemoteRestore(fixture.directory, full.manifest, target, full.backupDir)).rejects.toThrow(/may remain/i);
    expect(await fixture.readStateText()).toBe(prior);
    await fixture.reset();
    await fixture.configure({ failures: [], s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] } });
    await expect(preflightRemoteRestore(fixture.directory, ref.manifest, source, ref.backupDir)).rejects.toThrow(/missing|mismatch/i);
    trace = await fixture.traceText();
    expect(trace).not.toContain('remote-objects.mjs reconcile');
    expect(trace).not.toMatch(DESTRUCTIVE);
    expect(await fixture.readStateText()).toBe(prior);
  });
});

// Exercise the actual command and journal without exposing an unqualified CLI
// switch: the child mocks the temporary public profile and source gates. All other
// source, backup, Docker and state behavior follows the process harness.
test('staged S3 restore records additive counts and preserves the journal after startup failure', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const fixture = await sandbox();
  const source = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://source.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'source-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  const target = { ...source, OR3_STORAGE_S3_ENDPOINT: 'https://target.example.invalid', OR3_STORAGE_S3_BUCKET: 'target-bucket' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(source), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const backup = await captureBackup(fixture.directory, fixture.state, source);
    await writeFile(join(fixture.directory, '.env'), serializeEnv(target), { mode: 0o600 });
    const refs = new URL('../src/backup/references.ts', import.meta.url).href;
    const command = new URL('../src/commands/restore.ts', import.meta.url).href;
    const script = `import { mock } from 'bun:test'; const original = await import(${JSON.stringify(refs)}); mock.module(${JSON.stringify(refs)}, () => ({ ...original, assertSupportedBackupProfile: () => {}, assertBackupSourceProfile: async () => {} })); const { restoreCommand } = await import(${JSON.stringify(command)}); try { await restoreCommand(process.cwd(), {yes:true}, [${JSON.stringify(backup.backupId)}]); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
    const invoke = async () => {
      const child = Bun.spawn([process.execPath, '-e', script], { cwd: fixture.directory, env: process.env, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    };
    const before = await fixture.readStateText();
    await fixture.reset();
    await fixture.configure({ failures: [{ match: 'remote-objects.mjs reconcile', message: 'fixture transfer failure' }] });
    const failedPreflight = await invoke();
    expect(failedPreflight.exitCode).not.toBe(0);
    expect(failedPreflight.stderr).toMatch(/may remain/i);
    expect(await fixture.readStateText()).toBe(before);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    await fixture.reset();
    await fixture.configure({ failures: [{ match: 'remote-objects.mjs check-copy', skip: 1, times: 1, message: 'fixture post-start check failure' }] });
    const interrupted = await invoke();
    expect(interrupted.exitCode).not.toBe(0);
    expect(interrupted.stderr).toMatch(/writes may have been accepted/i);
    expect(interrupted.stdout).toMatch(/added 1 objects and 1 markers/i);
    expect(interrupted.stdout + interrupted.stderr).not.toContain('fixture-secret');
    const state = await fixture.readState();
    expect(state.incompleteOperation).toMatchObject({ operation: 'restore', phase: 'starting-target', remoteReconcile: { uploaded: 1, markersCreated: 1 } });
    const trace = await fixture.traceText();
    expect(trace.indexOf('remote-objects.mjs reconcile')).toBeLessThan(trace.indexOf(' stop or3'));
    expect(trace.lastIndexOf('remote-objects.mjs check-copy')).toBeGreaterThan(trace.lastIndexOf(' up -d'));
    await fixture.configure({ failures: [], s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] } });
    await fixture.reset();
    const refused = await fixture.cli(['recover']);
    expect(refused.exitCode).not.toBe(0);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    const gatedRecovery = await fixture.cli(['recover', '--restore', '--yes']);
    expect(gatedRecovery.exitCode).not.toBe(0);
    expect((await fixture.readState()).incompleteOperation).toBeDefined();
    const recovered = await stagedS3Recovery(fixture);
    expect(recovered.exitCode, recovered.output).toBe(0);
    expect(recovered.output).toMatch(/missing.*S3 objects/i);
    expect((await fixture.readState()).incompleteOperation).toBeUndefined();
  });
});

test('staged S3 rollback refuses missing references and preserves post-start failure for recovery', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const fixture = await sandbox();
  const env = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://source.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'source-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(env), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const point = await captureBackup(fixture.directory, fixture.state, env, { safetySnapshot: true });
    const state = { ...fixture.state, rollback: { appVersion: point.manifest.appVersion, image: point.manifest.image, imageDigest: point.manifest.imageDigest, backupId: point.backupId, createdAt: point.manifest.createdAt } };
    await fixture.writeState(state);
    await fixture.reset();
    const gated = await fixture.cli(['rollback', '--yes']);
    expect(gated.exitCode).not.toBe(0);
    expect(gated.stderr).toContain('Unsupported offline backup inspection provider profile');
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    const refs = new URL('../src/backup/references.ts', import.meta.url).href;
    const command = new URL('../src/commands/rollback.ts', import.meta.url).href;
    const script = `import { mock } from 'bun:test'; const original = await import(${JSON.stringify(refs)}); mock.module(${JSON.stringify(refs)}, () => ({ ...original, assertSupportedBackupProfile: () => {}, assertBackupSourceProfile: async () => {} })); const { rollbackCommand } = await import(${JSON.stringify(command)}); try { await rollbackCommand(process.cwd(), {yes:true}); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
    const invoke = async () => {
      const child = Bun.spawn([process.execPath, '-e', script], { cwd: fixture.directory, env: process.env, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    };
    const before = await fixture.readStateText();
    await fixture.reset(); await fixture.configure({ s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] } });
    const missing = await invoke();
    expect(missing.exitCode).not.toBe(0); expect(missing.stderr).toMatch(/missing|mismatch/i);
    expect(await fixture.readStateText()).toBe(before); expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    await fixture.reset();
    await fixture.configure({ s3Check: { checked: 1, missing: [], mismatched: [] }, failures: [{ match: 'remote-objects.mjs check', skip: 2, times: 1, message: 'fixture post-start reference failure' }] });
    const interrupted = await invoke();
    expect(interrupted.exitCode).not.toBe(0);
    expect(interrupted.stderr).toMatch(/writes may have been accepted/i);
    expect((await fixture.readState()).incompleteOperation).toMatchObject({ operation: 'rollback', phase: 'starting-target' });
    const trace = await fixture.traceText();
    expect(trace.lastIndexOf('remote-objects.mjs check')).toBeGreaterThan(trace.lastIndexOf(' up -d'));
    await fixture.configure({ failures: [] });
    expect((await fixture.cli(['recover', '--restore', '--yes'])).exitCode).not.toBe(0);
    expect((await stagedS3Recovery(fixture)).exitCode).toBe(0);
    expect((await fixture.readState()).incompleteOperation).toBeUndefined();
  });
});

test('staged S3 update restores its safety snapshot with a warning after a pre-start failure', async () => {
  const { serializeEnv } = await import('../src/deployment/env');
  const fixture = await sandbox();
  const env = { ...fixture.env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://source.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'source-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(env), { mode: 0o600 });
  await inProcess(fixture, async () => {
    const refs = new URL('../src/backup/references.ts', import.meta.url).href;
    const command = new URL('../src/commands/update.ts', import.meta.url).href;
    const script = `import { mock } from 'bun:test'; const original = await import(${JSON.stringify(refs)}); mock.module(${JSON.stringify(refs)}, () => ({ ...original, assertSupportedBackupProfile: () => {}, assertBackupSourceProfile: async () => {} })); const { updateCommand } = await import(${JSON.stringify(command)}); try { await updateCommand(process.cwd(), {}); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
    await fixture.configure({ s3Check: { checked: 1, missing: ['prefix/workspace/hash'], mismatched: [] }, failures: [{ match: ' stop or3', skip: 1, times: 1, message: 'fixture replacement failure' }] });
    const child = Bun.spawn([process.execPath, '-e', script], { cwd: fixture.directory, env: process.env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('failed and was restored');
    expect(stderr).toMatch(/missing.*S3 objects/i);
    expect(stdout + stderr).not.toContain('fixture-secret');
    expect((await fixture.readState()).incompleteOperation?.phase).toBe('restoring-previous');
    const trace = await fixture.traceText();
    expect(trace).toContain('remote-objects.mjs verify-inventory');
    expect(trace).toContain('remote-objects.mjs check');
    expect(trace).not.toContain('remote-objects.mjs reconcile');
    await fixture.configure({ failures: [] });
    expect((await fixture.cli(['recover', '--restore', '--yes'])).exitCode).not.toBe(0);
    expect((await stagedS3Recovery(fixture)).exitCode).toBe(0);
    expect((await fixture.readState()).incompleteOperation).toBeUndefined();
  });
});

// Streamed helper processes need private credentials without putting values in
// command arguments. Missing environment or unredacted stderr must fail closed.
test('archive streams pass an explicit environment and redact helper failures', async () => {
  const fixture = await sandbox();
  const secret = 'fixture-stream-secret-7421';
  const environment = { ...process.env, OR3_TEST_STREAM_SECRET: secret };
  const archive = join(fixture.root, 'stream-test');
  await streamCommandToFile(process.execPath, ['-e', 'process.stdout.write(process.env.OR3_TEST_STREAM_SECRET || "missing")'], archive, undefined, [secret], environment);
  expect(await readFile(archive, 'utf8')).toBe(secret);
  await streamFileToCommand(process.execPath, ['-e', 'let s=""; process.stdin.on("data", x => s += x); process.stdin.on("end", () => { if (s !== process.env.OR3_TEST_STREAM_SECRET) process.exit(2); });'], archive, undefined, [secret], environment);
  let failure = '';
  try {
    await streamFileToCommand(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("end", () => { console.error(process.env.OR3_TEST_STREAM_SECRET); process.exit(1); });'], archive, undefined, [secret], environment);
  } catch (error) { failure = String(error); }
  expect(failure).toContain('[REDACTED]');
  expect(failure).not.toContain(secret);
});

// Remote copies may run for hours, while a stalled helper must still be killed
// by its caller's bounded deadline and must not leave a completed archive.
test('archive streams enforce the caller-provided deadline', async () => {
  const fixture = await sandbox();
  const archive = join(fixture.root, 'deadline-stream');
  await expect(streamCommandToFile(process.execPath, ['-e', 'process.stdout.write("partial"); setTimeout(() => process.exit(0), 1500)'], archive, undefined, [], undefined, 250)).rejects.toThrow();
  expect(existsSync(archive)).toBe(false);
  const input = join(fixture.root, 'deadline-input');
  await writeFile(input, 'test');
  await expect(streamFileToCommand(process.execPath, ['-e', 'process.stdin.resume(); setTimeout(() => process.exit(0), 1500)'], input, undefined, [], undefined, 250)).rejects.toThrow();
  await expect(streamCommandToFile(process.execPath, ['-e', 'process.stdout.write("ok")'], archive, undefined, [], undefined, 5000)).resolves.toBeUndefined();
  expect(await readFile(archive, 'utf8')).toBe('ok');
});

test('backup helper passes only named S3 credentials through the process environment', async () => {
  const { withBackupHelper } = await import('../src/backup/helper');
  const fixture = await sandbox();
  const secret = 'fixture-helper-private-7421';
  await inProcess(fixture, async () => {
    const observed = await withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, { ...fixture.env, OR3_STORAGE_S3_SECRET_ACCESS_KEY: secret },
      { network: 'egress', passEnv: ['OR3_STORAGE_S3_SECRET_ACCESS_KEY'] }, async helper => helper.exec(['__probe_env__']));
    expect(observed).toBe(`sha256:${sha256(secret)}`);
    const trace = await fixture.traceText();
    expect(trace).toContain('--env OR3_STORAGE_S3_SECRET_ACCESS_KEY');
    expect(trace).not.toContain(secret);
  });
});

test('offline backup helpers can receive source identity but never S3 credentials', async () => {
  const { withBackupHelper } = await import('../src/backup/helper');
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    const env = { ...fixture.env, OR3_STORAGE_S3_ENDPOINT: 'https://storage.example.invalid', OR3_STORAGE_S3_BUCKET: 'fixture-bucket', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
    const observed = await withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, env, { network: 'none', passEnv: ['OR3_STORAGE_S3_ENDPOINT', 'OR3_STORAGE_S3_BUCKET'] }, async helper => helper.exec(['__probe_env__']));
    expect(observed).toBe(`sha256:${sha256('')}`);
    const trace = await fixture.traceText();
    expect(trace).toContain('--network none');
    expect(trace).toContain('--env OR3_STORAGE_S3_ENDPOINT');
    expect(trace).not.toContain('fixture-secret');
    await expect(withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, env, { network: 'none', passEnv: ['OR3_STORAGE_S3_SECRET_ACCESS_KEY'] }, async () => {})).rejects.toThrow('Invalid backup helper environment');
  });
});

// A large recovery archive is mounted read-only for repeatable bounded reads.
// Missing, linked or ambiguous host paths must be refused before Docker runs.
test('backup helper mounts only a regular recovery archive read-only', async () => {
  const { withBackupHelper } = await import('../src/backup/helper');
  const fixture = await sandbox();
  const archive = join(fixture.root, 'remote-objects.tar');
  await writeFile(archive, 'fixture', { mode: 0o600 });
  await inProcess(fixture, async () => {
    await withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, fixture.env, { network: 'egress', archiveFile: archive }, async helper => helper.exec(['__probe_env__']));
    const trace = await fixture.traceText();
    expect(trace).toContain(`type=bind,src=${archive},dst=/or3-backup.tar,readonly`);
    expect(trace).toContain(`--user ${process.getuid!()}:${process.getgid!()}`);
    await fixture.reset();
    const linked = join(fixture.root, 'link.tar'); await symlink(archive, linked);
    await expect(withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, fixture.env, { network: 'egress', archiveFile: linked }, async () => {})).rejects.toThrow();
    await expect(withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, fixture.env, { network: 'egress', archiveFile: `${archive},unsafe` }, async () => {})).rejects.toThrow();
    const publicFile = join(fixture.root, 'public.tar'); await writeFile(publicFile, 'fixture', { mode: 0o644 });
    await expect(withBackupHelper(fixture.directory, fixture.env.OR3_IMAGE!, fixture.env, { network: 'egress', archiveFile: publicFile }, async () => {})).rejects.toThrow();
    expect(await fixture.traceText()).not.toMatch(/^run /m);
  });
});

// The managed capture must preflight space before network transfer, validate
// the copied bytes offline, and keep credentials out of the command trace.
test('S3 backup capture orders summary, transfer and offline verification', async () => {
  const { captureRemoteSnapshot } = await import('../src/backup/remote');
  const fixture = await sandbox();
  const dir = join(fixture.root, 'remote-backup'); await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
  const env = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://storage.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'fixture-bucket', OR3_STORAGE_S3_KEY_PREFIX: '/prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await inProcess(fixture, async () => {
    const result = await captureRemoteSnapshot(fixture.directory, fixture.state, env, dir);
    expect(result).toMatchObject({ kind: 's3-copy-v1', file: 'remote-objects.tar', objectCount: 1, payloadBytes: 23, inventorySha256: 'c'.repeat(64), source: { endpointOrigin: 'https://storage.example.invalid', bucket: 'fixture-bucket', keyPrefix: 'prefix/' } });
    expect(result.sha256).toBe(sha256('fixture-remote-archive'));
    expect(result.bytes).toBe(Buffer.byteLength('fixture-remote-archive'));
    const trace = await fixture.traceText();
    expect(trace.indexOf('backup-inspect.mjs s3-summary')).toBeLessThan(trace.indexOf('remote-objects.mjs capture'));
    expect(trace.indexOf('remote-objects.mjs capture')).toBeLessThan(trace.indexOf('remote-objects.mjs verify'));
    expect(trace).toContain('--network none');
    expect(trace).toContain('--network bridge');
    const calls = trace.split('\n');
    const verifyIndex = calls.findIndex(line => line.includes('remote-objects.mjs verify'));
    const verifyHelper = calls.slice(0, verifyIndex).findLast(line => line.startsWith('run '))!;
    expect(verifyHelper).toContain('--network none');
    expect(verifyHelper).toContain('sleep 14400');
    expect((await readdir(dir)).some(name => name.startsWith('.s3-verification-'))).toBe(false);
    expect(trace).not.toContain('fixture-secret');
    expect(trace).not.toContain('fixture-id');
    await fixture.configure({ s3Verification: { contract: 2, kind: 's3-copy-v1', objectCount: 0, payloadBytes: 23, inventorySha256: 'c'.repeat(64) } });
    const mismatchDir = join(fixture.root, 'remote-mismatch'); await mkdir(mismatchDir, { mode: 0o700 });
    await writeFile(join(mismatchDir, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
    await expect(captureRemoteSnapshot(fixture.directory, fixture.state, env, mismatchDir)).rejects.toThrow('did not match');
  });
});

// Safety inventories must be derived and verified without reaching S3 or
// receiving credentials; they are not exportable recovery copies.
test('S3 safety snapshot derives and verifies an offline reference inventory', async () => {
  const { captureRemoteInventory } = await import('../src/backup/remote');
  const fixture = await sandbox();
  const dir = join(fixture.root, 'remote-inventory'); await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
  const env = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://storage.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'fixture-bucket', OR3_STORAGE_S3_KEY_PREFIX: '/prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await inProcess(fixture, async () => {
    const result = await captureRemoteInventory(fixture.directory, fixture.state, env, dir);
    expect(result).toMatchObject({ kind: 's3-reference-v1', file: 'remote-inventory.json', objectCount: 1, payloadBytes: 23, inventorySha256: sha256('fixture-remote-inventory') });
    expect(result.sha256).toBe(sha256('fixture-remote-inventory'));
    const trace = await fixture.traceText();
    expect(trace.indexOf('remote-objects.mjs inventory')).toBeLessThan(trace.indexOf('remote-objects.mjs verify-inventory'));
    expect(trace).not.toContain('fixture-secret');
    expect(trace).not.toContain('fixture-id');
    expect(trace).not.toContain('OR3_STORAGE_S3_SECRET_ACCESS_KEY');
    expect(trace).not.toContain('remote-objects.mjs capture');
    await fixture.configure({ s3InventoryVerification: { contract: 2, kind: 's3-reference-v1', objectCount: 0, payloadBytes: 23, inventorySha256: 'c'.repeat(64) } });
    const invalid = join(fixture.root, 'invalid-inventory'); await mkdir(invalid, { mode: 0o700 });
    await writeFile(join(invalid, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
    await expect(captureRemoteInventory(fixture.directory, fixture.state, env, invalid)).rejects.toThrow('did not match');
    await fixture.configure({ s3InventoryVerification: { contract: 2, kind: 's3-reference-v1', objectCount: 1, payloadBytes: 23, inventorySha256: 'c'.repeat(64) } });
    const altered = join(fixture.root, 'altered-inventory'); await mkdir(altered, { mode: 0o700 });
    await writeFile(join(altered, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
    await expect(captureRemoteInventory(fixture.directory, fixture.state, env, altered)).rejects.toThrow('did not match');
  });
});

// The restore helpers must verify the complete authenticated archive before
// any target writes, preserve the destination credentials and refuse a prefix
// mismatch without starting a networked helper.
test('S3 restore verifies offline before reconciling a separate target', async () => {
  const { verifyRemoteSnapshot, reconcileRemoteTarget } = await import('../src/backup/remote');
  const fixture = await sandbox(); const dir = join(fixture.root, 'remote-restore'); await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
  const bytes = 'fixture-remote-archive'; await writeFile(join(dir, 'remote-objects.tar'), bytes, { mode: 0o600 });
  const remote = { kind: 's3-copy-v1' as const, file: 'remote-objects.tar' as const, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), inventorySha256: 'c'.repeat(64), objectCount: 1, payloadBytes: 23, source: { endpointOrigin: 'https://source.example.invalid', bucket: 'source-bucket', keyPrefix: 'prefix/' }, providerVersion: '0.0.15' };
  const target = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://target.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'target-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await inProcess(fixture, async () => {
    await expect(reconcileRemoteTarget(fixture.directory, fixture.state, { ...target, OR3_STORAGE_S3_KEY_PREFIX: 'wrong/' }, dir, remote)).rejects.toThrow(/prefix/i);
    expect(await fixture.traceText()).not.toContain('remote-objects.mjs reconcile');
    await verifyRemoteSnapshot(fixture.directory, fixture.state, dir, remote);
    expect(await reconcileRemoteTarget(fixture.directory, fixture.state, target, dir, remote)).toMatchObject({ uploaded: 1, markersCreated: 1 });
    const trace = await fixture.traceText();
    expect(trace.indexOf('remote-objects.mjs verify')).toBeLessThan(trace.indexOf('remote-objects.mjs reconcile'));
    expect(trace).toContain('OR3_BACKUP_ARCHIVE_SHA256');
    expect(trace).not.toContain('fixture-secret'); expect(trace).not.toContain('fixture-id');
    expect(trace).not.toContain(remote.sha256);
    await writeFile(join(dir, 'remote-objects.tar'), 'tampered', { mode: 0o600 });
    await expect(verifyRemoteSnapshot(fixture.directory, fixture.state, dir, remote)).rejects.toThrow(/checksum|size/i);
  });
});

// A copied archive must be authenticated again before read-only target checks;
// post-start mismatch is reported to the lifecycle caller, never repaired here.
test('S3 copied snapshot checks the target without writing after offline verification', async () => {
  const { checkRemoteCopyTarget } = await import('../src/backup/remote');
  const fixture = await sandbox(); const dir = join(fixture.root, 'remote-check-copy'); await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
  const bytes = 'fixture-remote-archive'; await writeFile(join(dir, 'remote-objects.tar'), bytes, { mode: 0o600 });
  const remote = { kind: 's3-copy-v1' as const, file: 'remote-objects.tar' as const, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), inventorySha256: 'c'.repeat(64), objectCount: 1, payloadBytes: 23, source: { endpointOrigin: 'https://source.example.invalid', bucket: 'source-bucket', keyPrefix: 'prefix/' }, providerVersion: '0.0.15' };
  const target = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: 'https://target.example.invalid', OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'target-bucket', OR3_STORAGE_S3_KEY_PREFIX: 'prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await inProcess(fixture, async () => {
    await expect(checkRemoteCopyTarget(fixture.directory, fixture.state, { ...target, OR3_STORAGE_S3_KEY_PREFIX: 'wrong/' }, dir, remote)).rejects.toThrow(/prefix/i);
    expect(await fixture.traceText()).not.toContain('remote-objects.mjs check-copy');
    expect(await checkRemoteCopyTarget(fixture.directory, fixture.state, target, dir, remote)).toEqual({ checked: 1, missing: 0, mismatched: 0 });
    await fixture.configure({ s3Check: { checked: 1, missing: [], mismatched: ['prefix/workspace/sha256:abc'] } });
    expect(await checkRemoteCopyTarget(fixture.directory, fixture.state, target, dir, remote)).toEqual({ checked: 1, missing: 0, mismatched: 1 });
    const trace = await fixture.traceText();
    expect(trace.indexOf('remote-objects.mjs verify')).toBeLessThan(trace.indexOf('remote-objects.mjs check-copy'));
    expect(trace).not.toContain('fixture-secret'); expect(trace).not.toContain('fixture-id');
  });
});

// A reference-only rollback snapshot is useful solely with its original
// bucket. It must report missing/mismatched objects without writing anything.
test('S3 reference checks refuse foreign targets and report missing objects', async () => {
  const { checkRemoteTarget } = await import('../src/backup/remote');
  const fixture = await sandbox(); const dir = join(fixture.root, 'reference-check'); await mkdir(dir, { mode: 0o700 });
  await writeFile(join(dir, 'data.tgz'), 'fixture-local-archive', { mode: 0o600 });
  const bytes = 'fixture-remote-inventory'; await writeFile(join(dir, 'remote-inventory.json'), bytes, { mode: 0o600 });
  const remote = { kind: 's3-reference-v1' as const, file: 'remote-inventory.json' as const, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), inventorySha256: sha256(bytes), objectCount: 1, payloadBytes: 23, source: { endpointOrigin: 'https://source.example.invalid', bucket: 'source-bucket', keyPrefix: 'prefix/' }, providerVersion: '0.0.15' };
  const target = { ...fixture.env, NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_ENDPOINT: remote.source.endpointOrigin, OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: remote.source.bucket, OR3_STORAGE_S3_KEY_PREFIX: remote.source.keyPrefix, OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture-id', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
  await inProcess(fixture, async () => {
    await expect(checkRemoteTarget(fixture.directory, fixture.state, { ...target, OR3_STORAGE_S3_BUCKET: 'other' }, dir, remote)).rejects.toThrow(/source|target/i);
    expect(await fixture.traceText()).not.toContain('remote-objects.mjs check');
    expect(await checkRemoteTarget(fixture.directory, fixture.state, target, dir, remote)).toEqual({ checked: 1, missing: 0, mismatched: 0 });
    await fixture.configure({ s3Check: { checked: 1, missing: ['prefix/workspace/sha256:abc'], mismatched: [] } });
    expect(await checkRemoteTarget(fixture.directory, fixture.state, target, dir, remote)).toEqual({ checked: 1, missing: 1, mismatched: 0 });
    const trace = await fixture.traceText();
    expect(trace).toContain('remote-objects.mjs verify-inventory');
    expect(trace).toContain('remote-objects.mjs check');
    expect(trace).not.toContain('remote-objects.mjs reconcile');
    expect(trace).not.toContain('fixture-secret');
  });
});

for (const restartFails of [false, true]) test(`capture and cleanup errors survive${restartFails ? ' alongside restart failure' : ' service recovery'}`, async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [
    { match: 'tar czf', message: 'fixture capture failure' },
    ...(restartFails ? [{ match: 'up -d', message: 'fixture restart failure' }] : []),
  ] });
  await inProcess(fixture, async () => {
    lifecycleFaults.beforeArtifactDelete = () => { throw new Error('fixture cleanup failure'); };
    await expect(backupCommand(fixture.directory, [], {})).rejects.toThrow('fixture capture failure');
    const state = await fixture.readState();
    expect(state.lastError).toContain('fixture cleanup failure');
    expect(state.lastError).toContain('Still present:');
    expect(state.lastError).not.toContain('was removed');
    expect(state.incompleteOperation?.backupProgress).toMatchObject({ stage: 'failed', artifact: 'unknown', service: restartFails ? 'unknown' : 'healthy' });
    if (restartFails) expect(state.lastError).toContain('fixture restart failure');
    expect(await fixture.backupIds()).toHaveLength(1);
  });
});

test('cleanup distinguishes a removed backup from an export receipt still present', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'tar czf', message: 'fixture capture failure' }] });
  await inProcess(fixture, async () => {
    lifecycleFaults.beforeArtifactDelete = async () => {
      const [id] = await fixture.backupIds();
      await rm(join(fixture.cloud, 'backups', id), { recursive: true });
      await mkdir(join(fixture.cloud, 'exports'), { recursive: true });
      await writeFile(join(fixture.cloud, 'exports', `${id}.json`), 'receipt');
      throw new Error('fixture receipt cleanup failure');
    };
    await expect(backupCommand(fixture.directory, [], {})).rejects.toThrow('fixture receipt cleanup failure');
    const state = await fixture.readState();
    expect(state.lastError).toContain('Confirmed absent:');
    expect(state.lastError).toContain('Still present:');
    expect(state.lastError).toContain('.json');
    expect(state.incompleteOperation?.backupProgress?.artifact).toBe('unknown');
  });
});

for (const restartAfter of [true, false]) test(`verification observes ${restartAfter ? 'restarted' : 'stopped pre-mutation'} service`, async () => {
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    let verified = false;
    lifecycleFaults.beforeArchiveRead = async () => {
      verified = true;
      expect(/compose .* up -d/.test(await fixture.traceText())).toBe(restartAfter);
    };
    const phases: BackupProgress[] = [];
    await captureBackup(fixture.directory, fixture.state, fixture.env, { restartAfter, onProgress: (progress) => { phases.push(progress); } });
    expect(verified).toBe(true);
    expect(phases.at(-1)).toMatchObject({ stage: 'complete', artifact: 'verified', service: restartAfter ? 'healthy' : 'stopped' });
    if (restartAfter) expect(phases.at(-1)!.downtimeMs).toBeGreaterThanOrEqual(0);
  });
});

test('verification failure happens after restart and leaves no usable backup', async () => {
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    lifecycleFaults.beforeArchiveRead = async () => {
      expect(await fixture.traceText()).toMatch(/compose .* up -d/);
      throw new Error('fixture verification failure');
    };
    await expect(backupCommand(fixture.directory, [], {})).rejects.toThrow('fixture verification failure');
    expect(await fixture.backupIds()).toEqual([]);
    expect((await fixture.readState()).incompleteOperation?.backupProgress).toMatchObject({ service: 'healthy', artifact: 'removed', stage: 'failed' });
  });
});

test('restart failure retains the verified backup and recovery preserves it', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'up -d', message: 'fixture restart failure' }] });
  await inProcess(fixture, async () => {
    await expect(backupCommand(fixture.directory, [], {})).rejects.toThrow('Verified backup retained');
    expect((await fixture.readState()).incompleteOperation?.backupProgress).toMatchObject({ service: 'unknown', artifact: 'verified' });
  });
  const ids = await fixture.backupIds();
  await fixture.configure({ failures: [] });
  const result = await fixture.cli(['recover']);
  expect(result.exitCode, result.output).toBe(0);
  expect(await fixture.backupIds()).toEqual(ids);
});

test('recovery attempts restart even when partial artifact cleanup fails', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'tar czf', message: 'fixture archive failure' }] });
  await fixture.cli(['backup']);
  await fixture.configure({ failures: [] });
  await fixture.reset();
  await inProcess(fixture, async () => {
    lifecycleFaults.beforeArtifactDelete = () => { throw new Error('fixture recovery cleanup failure'); };
    await expect(recoverCommand(fixture.directory)).rejects.toThrow('fixture recovery cleanup failure');
    expect(await fixture.traceText()).toMatch(/compose .* up -d/);
    expect((await fixture.readState()).incompleteOperation?.backupProgress).toMatchObject({ service: 'healthy', stage: 'failed' });
  });
});

test('stream cleanup retains producer failure and identifies the remaining temporary archive', async () => {
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    lifecycleFaults.beforeTemporaryArchiveDelete = () => { throw new Error('fixture temp deletion failure'); };
    await expect(streamCommandToFile(process.execPath, ['-e', 'console.error("fixture producer failure"); process.exit(1)'], join(fixture.root, 'archive.tgz'))).rejects.toThrow('fixture temp deletion failure');
    expect((await readdir(fixture.root)).some((name) => name.endsWith('.partial'))).toBe(true);
  });
});

test('verification uses captured configuration and assets even after live files change on restart', async () => {
  const fixture = await sandbox();
  const originalEnv = await fixture.readEnvText();
  const originalCompose = await readFile(join(fixture.directory, 'compose.yaml'), 'utf8');
  await inProcess(fixture, async () => {
    const result = await captureBackup(fixture.directory, fixture.state, fixture.env, { onProgress: async (progress) => {
      if (progress.stage === 'restarting') {
        await writeFile(join(fixture.directory, '.env'), `${originalEnv}\n# changed after capture\n`);
        await writeFile(join(fixture.directory, 'compose.yaml'), `${originalCompose}\n# changed after capture\n`);
      }
    } });
    expect(result.manifest.configSha256).toBe(sha256(originalEnv));
    expect(result.manifest.managedAssetSha256?.['compose.yaml']).toBe(sha256(originalCompose));
  });
});

test('completion progress failure retains a verified artifact and recovery context', async () => {
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    await expect(captureBackup(fixture.directory, fixture.state, fixture.env, { onProgress: (progress) => {
      if (progress.stage === 'complete') throw new Error('fixture completion failure');
    } })).rejects.toThrow('Verified backup retained');
    expect(await fixture.backupIds()).toHaveLength(1);
  });
});

test('an existing backup ID is never overwritten or cleaned up', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const manifest = await readFile(join(fixture.cloud, 'backups', id, 'manifest.json'), 'utf8');
  await fixture.reset();
  await inProcess(fixture, async () => {
    await expect(captureBackup(fixture.directory, fixture.state, fixture.env, { backupId: id })).rejects.toThrow('EEXIST');
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect(await readFile(join(fixture.cloud, 'backups', id, 'manifest.json'), 'utf8')).toBe(manifest);
  });
});

test('failed terminal state write preserves the verified artifact and backup recovery journal', async () => {
  const fixture = await sandbox();
  await inProcess(fixture, async () => {
    lifecycleFaults.beforeStateWrite = async () => {
      const state = await fixture.readState();
      if (state.incompleteOperation?.backupProgress?.stage === 'complete') {
        delete lifecycleFaults.beforeStateWrite;
        throw new Error('fixture terminal write failure');
      }
    };
    await expect(backupCommand(fixture.directory, [], {})).rejects.toThrow('Completion recording failed');
    expect((await fixture.readState()).incompleteOperation?.backupProgress).toMatchObject({ stage: 'failed', artifact: 'verified' });
    expect(await fixture.backupIds()).toHaveLength(1);
  });
  const recovered = await fixture.cli(['recover']);
  expect(recovered.exitCode, recovered.output).toBe(0);
});

// A crash after exclusive mkdir but before the maintenance milestone leaves
// the same journal as a name collision. Recovery may inspect, never delete.
async function recordUnclaimedBackup(fixture: Sandbox, backupId: string, milestoneRecorded = true) {
  const state = await fixture.readState();
  state.incompleteOperation = {
    id: 'backup-operation-fixture', operation: 'backup', startedAt: state.updatedAt,
    message: 'Preflight: preparing a stopped-volume backup', phase: 'prepared',
    backupId, backupPath: join(fixture.cloud, 'backups', backupId), initialAppRunning: true,
    ...(milestoneRecorded ? { backupProgress: { stage: 'preflight' as const, service: 'running' as const, artifact: 'not-created' as const, message: 'Preflight' } } : {}),
  };
  await fixture.writeState(state);
}

test.each([true, false])('recovery preserves unowned artifacts before the first ownership milestone (preflight recorded=%s)', async (milestoneRecorded) => {
  const fixture = await sandbox();
  const id = 'backup-crash-window';
  const path = join(fixture.cloud, 'backups', id);
  await recordUnclaimedBackup(fixture, id, milestoneRecorded);
  await mkdir(path, { mode: 0o700 });
  const recovered = await fixture.cli(['recover', '--json']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  const result = JSON.parse(recovered.stdout).outcome;
  expect(result.kind).toBe('recovered');
  expect(result.detail).toContain('Maintenance warning: backup artifact ownership was not recorded.');
  expect(result.detail).toContain(`Still present: ${path}.`);
  expect(result.detail).toContain(`Confirmed absent: ${join(fixture.cloud, 'exports', `${id}.json`)}.`);
  expect(await readdir(path)).toEqual([]);
  expect((await fixture.readState()).incompleteOperation).toBeUndefined();
  const inventory = JSON.parse((await fixture.cli(['backup', 'list', '--json'])).stdout);
  expect(inventory.backups).toEqual([]);
  expect(inventory.findings).toEqual([expect.objectContaining({ entryName: id, code: 'backup-unsigned' })]);
});

test('unclaimed collision artifacts remain untouched through failed and successful recovery', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const manifestPath = join(fixture.cloud, 'backups', id, 'manifest.json');
  const manifest = await readFile(manifestPath, 'utf8');
  const receiptPath = join(fixture.cloud, 'exports', `${id}.json`);
  await mkdir(join(fixture.cloud, 'exports'), { recursive: true });
  await writeFile(receiptPath, 'pre-existing receipt');
  await recordUnclaimedBackup(fixture, id);
  await fixture.configure({ failures: [{ match: 'up -d', message: 'fixture restart failure' }] });
  const failed = await fixture.cli(['recover']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('fixture restart failure');
  expect(failed.stderr).toContain(`Still present: ${receiptPath}.`);
  expect((await fixture.readState()).incompleteOperation?.backupProgress?.artifact).toBe('not-created');
  await fixture.configure({ failures: [] });
  const recovered = await fixture.cli(['recover', '--json']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  expect(JSON.parse(recovered.stdout).outcome.detail).toContain(`Still present: ${receiptPath}.`);
  expect(await readFile(manifestPath, 'utf8')).toBe(manifest);
  expect(await readFile(receiptPath, 'utf8')).toBe('pre-existing receipt');
});

test('unclaimed recovery distinguishes absent paths from uninspectable export receipts', async () => {
  const fixture = await sandbox();
  const id = 'backup-unclaimed';
  await recordUnclaimedBackup(fixture, id);
  const absent = await fixture.cli(['recover', '--json']);
  expect(absent.exitCode, absent.output).toBe(0);
  expect(JSON.parse(absent.stdout).outcome.detail).toContain('Confirmed absent:');
  expect(JSON.parse(absent.stdout).outcome.detail).not.toContain('Maintenance warning:');
  await writeFile(join(fixture.cloud, 'exports'), 'not a directory');
  await recordUnclaimedBackup(fixture, id);
  const uninspectable = await fixture.cli(['recover', '--json']);
  expect(uninspectable.exitCode, uninspectable.output).toBe(0);
  expect(JSON.parse(uninspectable.stdout).outcome.detail).toContain(`Could not inspect ${join(fixture.cloud, 'exports', `${id}.json`)}:`);
  expect(JSON.parse(uninspectable.stdout).outcome.detail).toContain('Maintenance warning:');
  expect(await readFile(join(fixture.cloud, 'exports'), 'utf8')).toBe('not a directory');
});
