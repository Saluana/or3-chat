import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  STATE_SCHEMA_COMPATIBILITY,
  assertCommandFlags,
  assertCommandPositionals,
  assertDashboardOperatorMounts,
  assertEnoughFreeSpace,
  assertImageReleaseLabels,
  assertKnownStateSchema,
  assertPurgeBackupFreshness,
  assertRemovableArtifactName,
  assertSupportedSource,
  assertSupportedSourceCompose,
  assertBackupMatchesDeployment,
  assertPhaseAllowsCommand,
  assertStateSchemaWritable,
  assertSupportedArchitecture,
  assertVerificationGrant,
  assessUpdate,
  publicStateProjection,
  writeStateSchema,
  buildCredentialsResetScript,
  buildEnv,
  checkResolvedLoopbackBinding,
  copyAssets,
  decideRecoveryAction,
  stateFingerprint,
  verifyIsReadOnly,
  dashboardOperatorHandoffArgs,
  enumerateBackups,
  inventoryBackups,
  isVersion,
  lifecycleFaults,
  parseEnv,
  parseFlags,
  planRetention,
  purgeVolumesFromState,
  redact,
  recordedBackupPath,
  requiredArchiveSpace,
  restoreManagedAssets,
  restoreRequiresVolumeRecreation,
  selectPruneTargets,
  sameOriginVerificationUrl,
  serializeInitialCredentials,
  serializeEnv,
  snapshotManagedAssets,
  stateFromEnv,
  supportedImageArchitectures,
  updateRequiresVolumeRecreation,
  validateVerificationHealth,
  validatePassword,
  withoutProvisioningCredentials,
} from '../src/cli';
import type { ManagedState } from '../src/cli';
import { ADMIN_PASSWORD_POLICY_VECTORS } from '../../../shared/cloud/wizard/admin-password-policy-vectors';
import { MANAGED_PROFILE_SHARED_ENV } from '../../../shared/cloud/wizard/managed-profile-contract';

async function authenticatedBackupFixture(directory: string, backupId: string) {
  const path = join(directory, '.or3-cloud', 'backups', backupId);
  await mkdir(path, { recursive: true });
  await copyAssets(directory, 'local');
  const key = 'ab'.repeat(32);
  await writeFile(join(directory, '.or3-cloud', 'backup-auth.key'), key);
  const data = 'snapshot data';
  const config = 'OR3_VERSION=0.1.63\n';
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const manifest = {
    schemaVersion: 1,
    backupId,
    createdAt: '2026-09-15T00:00:00.000Z',
    appVersion: '0.1.63',
    image: `ghcr.io/saluana/or3-chat@sha256:${'a'.repeat(64)}`,
    imageDigest: `sha256:${'a'.repeat(64)}`,
    mode: 'local',
    dataSha256: hash(data),
    configSha256: hash(config),
    managedAssetInventoryVersion: 3,
    managedAssetSha256: await snapshotManagedAssets(directory, 'local', path),
  };
  const contents = JSON.stringify(manifest);
  await writeFile(join(path, 'data.tgz'), data);
  await writeFile(join(path, 'config.env'), config);
  await writeFile(join(path, 'manifest.json'), contents);
  await writeFile(join(path, 'manifest.auth'), createHmac('sha256', Buffer.from(key, 'hex')).update(contents).digest('hex'));
  return { path, manifest };
}

test('update recovery resolves and authenticates its own backup fields, including ID-only journals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-update-recovery-'));
  try {
    const { path, manifest } = await authenticatedBackupFixture(directory, 'backup-pre-update');
    const pending: NonNullable<ManagedState['incompleteOperation']> = {
      id: 'update-interrupted', operation: 'update', startedAt: manifest.createdAt,
      message: 'Interrupted update', phase: 'target-mutating',
      backupId: manifest.backupId, backupPath: path,
      backupDataSha256: manifest.dataSha256, backupConfigSha256: manifest.configSha256,
      previousBackupPath: join(directory, 'wrong-restore-only-field'),
    };
    expect((await recordedBackupPath(directory, pending)).path).toBe(path);
    expect((await recordedBackupPath(directory, { ...pending, backupPath: undefined })).path).toBe(path);
    await expect(recordedBackupPath(directory, { ...pending, backupDataSha256: 'b'.repeat(64) })).rejects.toThrow('expected data checksum');
    await expect(recordedBackupPath(directory, { ...pending, backupConfigSha256: 'b'.repeat(64) })).rejects.toThrow('expected configuration checksum');
    await writeFile(join(path, 'manifest.auth'), '00'.repeat(32));
    await expect(recordedBackupPath(directory, pending)).rejects.toThrow('Backup authentication failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restore and rollback recovery still require their separate pre-mutation snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-restore-recovery-'));
  try {
    const { path, manifest } = await authenticatedBackupFixture(directory, 'backup-before-restore');
    for (const operation of ['restore', 'rollback'] as const) {
      const pending = {
        id: 'restore-interrupted', operation, startedAt: manifest.createdAt, message: 'Interrupted restore',
        backupPath: join(directory, 'requested-target'), previousBackupId: manifest.backupId,
      };
      expect((await recordedBackupPath(directory, pending)).path).toBe(path);
      await expect(recordedBackupPath(directory, { ...pending, previousBackupId: undefined, backupPath: path })).rejects.toThrow('no readable pre-mutation');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention preserves legacy adoption directories without trusting them as backups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-legacy-retention-'));
  try {
    const { manifest } = await authenticatedBackupFixture(directory, 'backup-current');
    const root = join(directory, '.or3-cloud', 'backups');
    const legacy = join(root, 'adopt-source-2026-08-07T10-30-00-000Z-a1b2c3d4');
    await mkdir(legacy);
    await writeFile(join(legacy, 'data.tgz'), 'legacy archive retained');
    let inventory = await inventoryBackups(directory);
    expect((await enumerateBackups(directory)).map((backup) => backup.backupId)).toEqual([manifest.backupId]);
    expect(inventory.entries.find((entry) => entry.kind !== 'verified' && entry.entryName === basename(legacy)))
      .toMatchObject({ kind: 'legacy-adoption' });
    expect(await readFile(join(legacy, 'data.tgz'), 'utf8')).toBe('legacy archive retained');
    await symlink(legacy, join(root, 'adopt-source-symlink'));
    inventory = await inventoryBackups(directory);
    expect(inventory.entries.find((entry) => entry.kind !== 'verified' && entry.entryName === 'adopt-source-symlink'))
      .toMatchObject({ kind: 'invalid', code: 'backup-entry-not-directory' });
    expect(await readFile(join(legacy, 'data.tgz'), 'utf8')).toBe('legacy archive retained');
    await rm(join(root, 'adopt-source-symlink'));
    await writeFile(join(root, 'unexpected-file'), 'unknown');
    await mkdir(join(root, 'unexpected-directory'));
    inventory = await inventoryBackups(directory);
    expect(inventory.entries.find((entry) => entry.kind !== 'verified' && entry.entryName === 'unexpected-file'))
      .toMatchObject({ kind: 'invalid', code: 'backup-entry-not-directory' });
    expect(inventory.entries.find((entry) => entry.kind !== 'verified' && entry.entryName === 'unexpected-directory'))
      .toMatchObject({ kind: 'invalid', code: 'backup-entry-unexpected' });
    expect((await enumerateBackups(directory)).map((backup) => backup.backupId)).toEqual([manifest.backupId]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention skips pre-auth backups but explicit recovery still refuses to trust them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-pre-auth-retention-'));
  try {
    const current = await authenticatedBackupFixture(directory, 'backup-current');
    const legacy = await authenticatedBackupFixture(directory, 'backup-2026-08-12T02-34-07-685Z-fed812c8');
    await rm(join(legacy.path, 'manifest.auth'));
    expect((await enumerateBackups(directory)).map((backup) => backup.backupId)).toEqual([current.manifest.backupId]);
    expect(await readFile(join(legacy.path, 'data.tgz'), 'utf8')).toBe('snapshot data');
    expect(await readFile(join(legacy.path, 'manifest.json'), 'utf8')).toBe(JSON.stringify(legacy.manifest));
    await expect(recordedBackupPath(directory, {
      id: 'update-interrupted', operation: 'update', startedAt: legacy.manifest.createdAt,
      message: 'Cannot recover from an unauthenticated backup', backupPath: legacy.path,
    })).rejects.toThrow('no valid deployment authentication tag');
    await rm(current.path, { recursive: true });
    expect(await enumerateBackups(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention classifies invalid authentication tags and corrupted signed backup data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-invalid-backup-retention-'));
  try {
    const backup = await authenticatedBackupFixture(directory, 'backup-current');
    const authPath = join(backup.path, 'manifest.auth');
    const auth = await readFile(authPath);
    for (const invalid of ['', 'invalid', '00'.repeat(32)]) {
      await writeFile(authPath, invalid);
      const entry = (await inventoryBackups(directory)).entries.find((candidate) => candidate.kind !== 'verified');
      expect(entry?.kind).toBe('invalid');
      expect(entry && entry.kind !== 'verified' ? entry.code : undefined).toBe('backup-authentication-failed');
      expect(await enumerateBackups(directory)).toEqual([]);
    }
    await rm(authPath);
    await symlink(join(directory, 'missing-auth-target'), authPath);
    const symlinked = (await inventoryBackups(directory)).entries.find((candidate) => candidate.kind !== 'verified');
    expect(symlinked?.kind).toMatch(/invalid|unreadable/);
    await rm(authPath);
    await writeFile(authPath, auth);
    await writeFile(join(backup.path, 'data.tgz'), 'tampered');
    const tampered = (await inventoryBackups(directory)).entries.find((candidate) => candidate.kind !== 'verified');
    expect(tampered).toMatchObject({ kind: 'invalid', code: 'backup-checksum-mismatch' });
    expect(await enumerateBackups(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('inventory classifies future manifests as unsupported and never follows symlinked entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-inventory-formats-'));
  try {
    const { path: verifiedPath } = await authenticatedBackupFixture(directory, 'backup-current');
    const root = join(directory, '.or3-cloud', 'backups');
    const future = join(root, 'backup-2099-01-01T00-00-00-000Z-future');
    await mkdir(future);
    await writeFile(join(future, 'manifest.json'), JSON.stringify({ schemaVersion: 3, backupId: basename(future) }));
    await writeFile(join(future, 'manifest.auth'), '00'.repeat(32));
    const inventory = await inventoryBackups(directory);
    expect(inventory.storeErrors).toEqual([]);
    expect(inventory.entries.find((entry) => entry.kind !== 'verified' && entry.entryName === basename(future)))
      .toMatchObject({ kind: 'unsupported', code: 'backup-format-unsupported' });
    expect((await enumerateBackups(directory)).map((backup) => backup.path)).toEqual([verifiedPath]);
    expect(inventory.entries[0]).toMatchObject({ kind: 'verified' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('planRetention preserves protected recovery sources and defers on suspect entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-plan-retention-'));
  try {
    await authenticatedBackupFixture(directory, 'backup-current');
    const root = join(directory, '.or3-cloud', 'backups');
    const legacy = join(root, 'backup-2020-01-01T00-00-00-000Z-legacy');
    await mkdir(legacy);
    const suspect = join(root, 'backup-2021-01-01T00-00-00-000Z-suspect');
    await mkdir(suspect);
    await writeFile(join(suspect, 'manifest.json'), JSON.stringify({ schemaVersion: 1, backupId: basename(suspect) }));
    await writeFile(join(suspect, 'manifest.auth'), 'invalid');
    const inventory = await inventoryBackups(directory);
    const automatic = planRetention(inventory.entries, 1, new Set(['backup-current']), { automatic: true });
    expect(automatic.remove).toEqual([]);
    expect(automatic.canPrune).toBe(false);
    expect(automatic.preserve.map((entry) => entry.entryName)).toContain(basename(legacy));
    expect(automatic.warnings.some((warning) => warning.code === 'backup-authentication-failed')).toBe(true);
    // An explicit prune bypasses suspect deferral but never protected IDs.
    const forced = planRetention(inventory.entries, 1, new Set(['backup-current']), { automatic: false });
    expect(forced.canPrune).toBe(true);
    expect(forced.remove).toEqual([]);
    expect(() => planRetention(inventory.entries, 0, new Set())).toThrow('at least 1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('state schema compatibility table documents the bridge transition', () => {
  expect(STATE_SCHEMA_COMPATIBILITY[1].readers).toContain('bridge');
  expect(STATE_SCHEMA_COMPATIBILITY[1].mutable).toBe(false);
  expect(STATE_SCHEMA_COMPATIBILITY[2].mutable).toBe(true);
  expect(() => assertKnownStateSchema(1)).not.toThrow();
  expect(() => assertKnownStateSchema(2)).not.toThrow();
  expect(() => assertKnownStateSchema(3)).toThrow('Unsupported managed state schema');
  expect(() => assertKnownStateSchema(undefined)).toThrow('Unsupported managed state schema');
});

test('lifecycle fault seams are inert by default and settable by tests', () => {
  expect(lifecycleFaults.beforeStateWrite).toBeUndefined();
  const before = () => {};
  lifecycleFaults.beforeStateWrite = before;
  expect(lifecycleFaults.beforeStateWrite).toBe(before);
  delete lifecycleFaults.beforeStateWrite;
  expect(lifecycleFaults.beforeArtifactDelete).toBeUndefined();
});

test('doctor accepts the deployment mount in the shipped operator overlay and rejects missing mounts', async () => {
  const directory = '/srv/or3-managed';
  const overlay = Bun.YAML.parse(await readFile(join(import.meta.dir, '../assets/compose.operator.yaml'), 'utf8')) as {
    services: { 'or3-operator': { volumes: Array<{ target: string }> } };
  };
  const mounts = overlay.services['or3-operator'].volumes.map(({ target }) => ({
    Destination: target.replace('${OR3_DEPLOYMENT_DIR}', directory),
  }));
  expect(() => assertDashboardOperatorMounts(mounts, directory)).not.toThrow();
  for (const destination of ['/var/run/docker.sock', directory, '/run/or3-operator']) {
    expect(() => assertDashboardOperatorMounts(mounts.filter((mount) => mount.Destination !== destination), directory)).toThrow(`required ${destination} mount`);
  }
  expect(() => assertDashboardOperatorMounts(mounts.map((mount) => ({ Destination: mount.Destination === directory ? '/deployment' : mount.Destination })), directory)).toThrow(`required ${directory} mount`);
});

test('release image labels match the authenticated package source revision', () => {
  const labels = {
    'org.opencontainers.image.source': 'https://github.com/Saluana/or3-chat',
    'org.opencontainers.image.version': '0.1.39',
    'org.opencontainers.image.revision': 'a'.repeat(40),
  };
  expect(() => assertImageReleaseLabels('or3', labels, '0.1.39', 'a'.repeat(40))).not.toThrow();
  expect(() => assertImageReleaseLabels('or3', labels, '0.1.39', 'b'.repeat(40))).toThrow('expected source/version release labels');
});

test('dashboard handoff runs in a separate least-privilege helper container', () => {
  const directory = '/srv/or3';
  const jobId = '123e4567-e89b-42d3-a456-426614174000';
  const args = dashboardOperatorHandoffArgs(directory, {
    OR3_COMPOSE_PROJECT: 'or3-cloud',
    OR3_OPERATOR_UID: '1000',
    OR3_OPERATOR_GID: '1000',
    OR3_DOCKER_GID: '999',
    OR3_DOCKER_SOCKET: '/var/run/docker.sock',
    OR3_OPERATOR_IMAGE: `ghcr.io/saluana/or3-chat@sha256:${'a'.repeat(64)}`,
  }, jobId);
  expect(args).toContain('--detach');
  expect(args).toContain('--rm');
  expect(args).toContain('none');
  expect(args).toContain('no-new-privileges:true');
  expect(args).toContain('ALL');
  expect(args).toContain('/usr/local/bin/node');
  expect(args).toContain(join(directory, 'dashboard-operator.mjs'));
  expect(args.slice(-3)).toEqual(['--complete-handoff', jobId, 'or3-cloud']);
  expect(() => dashboardOperatorHandoffArgs(directory, {
    OR3_COMPOSE_PROJECT: 'or3-cloud; docker system prune',
  }, jobId)).toThrow('invalid dashboard operator handoff');
});

test('recreates only legacy data volumes when adding deployment identity labels', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.38',
    directory: '/tmp/or3-cloud-volume-label-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  const state = stateFromEnv('/tmp/or3-cloud-volume-label-test', env, 'local', 'init', 'sha256:test');
  expect(updateRequiresVolumeRecreation(state, env)).toBe(false);
  delete env.OR3_DEPLOYMENT_ID;
  delete state.deploymentId;
  expect(updateRequiresVolumeRecreation(state, env)).toBe(true);
});

test('recreates data volumes when restoring across deployment identity boundaries', () => {
  const legacy = { OR3_VERSION: '0.1.38' };
  const managed = { OR3_VERSION: '0.1.46', OR3_DEPLOYMENT_ID: 'deployment-1' };
  expect(restoreRequiresVolumeRecreation(managed, legacy)).toBe(true);
  expect(restoreRequiresVolumeRecreation(legacy, managed)).toBe(true);
  expect(restoreRequiresVolumeRecreation(managed, { ...managed })).toBe(false);
  expect(restoreRequiresVolumeRecreation(legacy, { ...legacy })).toBe(false);
});

test('provisioned passwords are removed from persistent deployment metadata', () => {
  const runtime = withoutProvisioningCredentials({
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'owner@example.com',
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'owner-secret',
    OR3_ADMIN_PASSWORD: 'admin-secret',
    OR3_MANAGED_OWNER_EMAIL: 'owner@example.com',
    OR3_ADMIN_USERNAME: 'owner@example.com',
  });
  expect(runtime).toEqual({
    OR3_MANAGED_OWNER_EMAIL: 'owner@example.com',
    OR3_ADMIN_USERNAME: 'owner@example.com',
  });
});

test('snapshots and restores checksummed managed deployment assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-cloud-assets-'));
  const backup = join(directory, 'backup');
  try {
    await copyAssets(directory, 'public');
    const originalCompose = await readFile(join(directory, 'compose.yaml'), 'utf8');
    const managedAssetSha256 = await snapshotManagedAssets(directory, 'public', backup);
    const manifest = {
      schemaVersion: 1 as const,
      backupId: 'backup-assets-test',
      createdAt: new Date().toISOString(),
      appVersion: '0.1.38',
      image: 'ghcr.io/saluana/or3-chat:0.1.38',
      imageDigest: `sha256:${'a'.repeat(64)}`,
      dataSha256: 'b'.repeat(64),
      managedAssetSha256,
      managedAssetInventoryVersion: 3 as const,
      mode: 'public' as const,
    };

    await writeFile(join(directory, 'compose.yaml'), 'stale compose\n');
    expect(await restoreManagedAssets(directory, backup, manifest)).toBe(true);
    expect(await readFile(join(directory, 'compose.yaml'), 'utf8')).toBe(originalCompose);
    expect((await stat(join(directory, 'compose.yaml'))).mode & 0o777).toBe(0o644);

    const incompleteManifest = {
      ...manifest,
      managedAssetSha256: Object.fromEntries(
        Object.entries(managedAssetSha256).filter(([name]) => name !== 'dashboard-operator.mjs'),
      ),
    };
    await expect(restoreManagedAssets(directory, backup, incompleteManifest)).rejects.toThrow(
      'invalid managed asset inventory',
    );

    await writeFile(join(backup, 'managed-assets', 'compose.yaml'), 'tampered\n');
    await expect(restoreManagedAssets(directory, backup, manifest)).rejects.toThrow(
      'managed asset checksum mismatch',
    );
    expect(await readFile(join(directory, 'compose.yaml'), 'utf8')).toBe(originalCompose);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('first dashboard update can snapshot and restore a pre-operator deployment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-cloud-legacy-assets-'));
  const backup = join(directory, 'backup');
  try {
    await copyAssets(directory, 'public');
    await rm(join(directory, 'dashboard-operator.mjs'));
    await rm(join(directory, 'compose.operator.yaml'));
    const managedAssetSha256 = await snapshotManagedAssets(directory, 'public', backup);
    expect(managedAssetSha256['dashboard-operator.mjs']).toBeUndefined();
    const manifest = {
      schemaVersion: 1 as const,
      backupId: 'backup-legacy-assets-test',
      createdAt: new Date().toISOString(),
      appVersion: '0.1.38',
      image: 'ghcr.io/saluana/or3-chat:0.1.38',
      imageDigest: `sha256:${'a'.repeat(64)}`,
      dataSha256: 'b'.repeat(64),
      managedAssetSha256,
      mode: 'public' as const,
    };
    await writeFile(join(directory, 'compose.yaml'), 'stale compose\n');
    await writeFile(join(directory, 'dashboard-operator.mjs'), 'new release operator\n');
    await writeFile(join(directory, 'compose.operator.yaml'), 'new release operator overlay\n');
    expect(await restoreManagedAssets(directory, backup, manifest)).toBe(true);
    expect(await readFile(join(directory, 'compose.yaml'), 'utf8')).toContain('services:');
    await expect(stat(join(directory, 'dashboard-operator.mjs'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(directory, 'compose.operator.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses assetless legacy restores instead of mixing release assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-cloud-assetless-'));
  try {
    await expect(restoreManagedAssets(directory, join(directory, 'backup'), {
      schemaVersion: 1,
      backupId: 'backup-assetless-test',
      createdAt: new Date().toISOString(),
      appVersion: '0.1.1',
      image: 'ghcr.io/saluana/or3-chat:0.1.1',
      imageDigest: `sha256:${'a'.repeat(64)}`,
      dataSha256: 'b'.repeat(64),
      mode: 'local',
    })).rejects.toThrow('predates authenticated managed-asset snapshots');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('round trips the generated env format without losing values', () => {
  const source = {
    OR3_VERSION: '0.1.12',
    OR3_ALLOWED_ORIGINS: 'https://cloud.example.com,http://127.0.0.1:3000',
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'A secret with no newline',
  };
  expect(parseEnv(serializeEnv(source))).toEqual(source);
});

test('serializes first-run credentials as documented KEY=value lines', () => {
  expect(serializeInitialCredentials({
    bootstrapEmail: 'admin@example.com',
    bootstrapPassword: 'GeneratedPassword123',
    adminUsername: 'admin@example.com',
    adminPassword: 'GeneratedPassword123',
  })).toBe(
    '# OR3 first-run credentials — move to a password manager, then delete this file.\n' +
      'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=admin@example.com\n' +
      'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=GeneratedPassword123\n' +
      'OR3_ADMIN_USERNAME=admin@example.com\n' +
      'OR3_ADMIN_PASSWORD=GeneratedPassword123\n',
  );
});

test('serializes special credential values safely and rejects line injection', () => {
  const password = "A$word with \\slashes and 'quotes' 123";
  expect(parseEnv(serializeInitialCredentials({
    bootstrapEmail: 'admin@example.com',
    bootstrapPassword: password,
    adminUsername: 'admin@example.com',
    adminPassword: password,
  }))).toMatchObject({
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: password,
    OR3_ADMIN_PASSWORD: password,
  });
  expect(() => serializeInitialCredentials({
    bootstrapEmail: 'admin@example.com',
    bootstrapPassword: 'AValidPassword123\nOR3_ADMIN_PASSWORD=injected',
    adminUsername: 'admin@example.com',
    adminPassword: 'AValidPassword123',
  })).toThrow('newline');
});

test('rejects newline-bearing passwords before lifecycle side effects', () => {
  expect(() => validatePassword('AValidPassword123\nOR3_IMAGE=attacker')).toThrow('NUL or newline');
});

test('uses the canonical administrator password policy vectors', () => {
  for (const vector of ADMIN_PASSWORD_POLICY_VECTORS) {
    if (vector.valid) {
      expect(() => validatePassword(vector.value)).not.toThrow();
    } else {
      expect(() => validatePassword(vector.value)).toThrow();
    }
  }
});

test('serializes Compose-sensitive values literally and rejects newlines', () => {
  const source = { OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: "A$word with \\slashes and 'quotes' 123" };
  expect(parseEnv(serializeEnv(source))).toEqual(source);
  expect(() => serializeEnv({ SECRET: 'bad\nvalue' })).toThrow('newline');
});

test('builds the fixed local cloud profile with persistent paths', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  for (const [key, value] of Object.entries(MANAGED_PROFILE_SHARED_ENV)) {
    expect(env[key]).toBe(value);
  }
  expect(env.OR3_BASIC_AUTH_DB_PATH).toBe('/data/auth.sqlite');
  expect(env.OR3_SQLITE_DB_PATH).toBe('/data/sync.sqlite');
  expect(env.OR3_STORAGE_FS_ROOT).toBe('/data/storage');
  expect(env.OR3_ADMIN_USERNAME).toBe('admin@example.com');
  expect(env.OR3_ADMIN_PASSWORD).toBe('AValidPassword123');
  expect(env.OR3_FORCE_HTTPS).toBe('false');
  expect(env.OR3_TRUST_PROXY).toBe('false');
});

test('adds the dashboard operator only with an explicitly resolved local socket', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.39',
    directory: '/srv/or3-cloud',
    email: 'admin@example.com',
    password: 'SafePassword123',
    port: 3000,
    dashboardOperator: {
      OR3_DASHBOARD_UPDATES_ENABLED: 'true',
      OR3_OPERATOR_IMAGE: 'ghcr.io/saluana/or3-chat:0.1.39',
      OR3_DEPLOYMENT_DIR: '/srv/or3-cloud',
      OR3_OPERATOR_UID: '1000',
      OR3_OPERATOR_GID: '1000',
      OR3_DOCKER_SOCKET: '/var/run/docker.sock',
      OR3_DOCKER_GID: '999',
    },
  });
  expect(env).toMatchObject({
    OR3_DASHBOARD_UPDATES_ENABLED: 'true',
    OR3_DOCKER_SOCKET: '/var/run/docker.sock',
  });
});

test('builds public origin settings without exposing secrets in the origin', () => {
  const env = buildEnv({
    mode: 'public',
    version: '0.1.12',
    directory: '/tmp/cloud.example.com',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    domain: 'cloud.example.com',
    port: 3000,
  });
  expect(env.OR3_PUBLIC_DOMAIN).toBe('cloud.example.com');
  expect(env.OR3_ALLOWED_ORIGINS).toBe('https://cloud.example.com');
  expect(env.OR3_FORCE_HTTPS).toBe('true');
  expect(env.OR3_TRUST_PROXY).toBe('true');
  expect(env.OR3_ALLOWED_ORIGINS).not.toContain(env.OR3_BASIC_AUTH_JWT_SECRET);
});

test('locks every managed profile to invite-only registration with guests off', () => {
  for (const mode of ['local', 'public'] as const) {
    const env = buildEnv({
      mode,
      version: '0.1.12',
      directory: '/tmp/cloud-registration-test',
      email: 'admin@example.com',
      password: 'AValidPassword123',
      domain: 'cloud.example.com',
      port: 3000,
    });
    expect(env.OR3_AUTH_REGISTRATION_MODE).toBe('invite_only');
    expect(env.OR3_AUTH_AUTO_PROVISION).toBe('false');
    expect(env.OR3_GUEST_ACCESS_ENABLED).toBe('false');
    expect(env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL).toBe('admin@example.com');
    expect(env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD).toBe('AValidPassword123');
    expect(env.OR3_AUTH_INVITE_TOKEN_SECRET).toBeTruthy();
    expect(env.OR3_AUTH_INVITE_TOKEN_SECRET).not.toBe('AValidPassword123');
  }
});

test('keeps custom extension install and rebuild off in every managed profile', () => {
  for (const mode of ['local', 'public'] as const) {
    const env = buildEnv({
      mode,
      version: '0.1.12',
      directory: '/tmp/cloud-extensions-test',
      email: 'admin@example.com',
      password: 'AValidPassword123',
      domain: 'cloud.example.com',
      port: 3000,
    });
    expect(env.OR3_PLUGIN_ZIP_INSTALL_ENABLED).toBe('false');
    expect(env.OR3_ADMIN_ALLOW_REBUILD).toBe('false');
  }
});

test('parses exact flags and accepts only complete release versions', () => {
  expect(parseFlags(['target', '--local', '--port=3100', '--admin-email', 'admin@example.com'])).toEqual({
    positionals: ['target'],
    flags: { local: true, port: '3100', 'admin-email': 'admin@example.com' },
  });
  expect(isVersion('0.1.12')).toBe(true);
  expect(isVersion('0.1')).toBe(false);
  expect(isVersion('latest')).toBe(false);
});

test('rejects unknown command flags before a deployment can start', () => {
  expect(() => assertCommandFlags('init', { local: true, prot: '3100' })).toThrow(
    'Unknown option for init: --prot',
  );
  expect(() => assertCommandFlags('update', { to: '0.1.13', yes: true })).toThrow(
    'Unknown option for update: --yes',
  );
  expect(() => assertCommandFlags('verify', { public: true })).not.toThrow();
});

test('rejects unexpected positional targets before dispatch', () => {
  expect(() => assertCommandPositionals('update', ['../staging'])).toThrow('accepts no positional arguments');
  expect(() => assertCommandPositionals('remove', ['../staging'])).toThrow('accepts no positional arguments');
  expect(() => assertCommandPositionals('restore', [])).toThrow('requires exactly one backup');
  expect(() => assertCommandPositionals('restore', ['backup-one', 'backup-two'])).toThrow('requires exactly one backup');
  expect(() => assertCommandPositionals('init', ['target'])).not.toThrow();
  expect(() => assertCommandPositionals('adopt', ['target'])).not.toThrow();
});

test('accepts only the fixed managed provider profile during production verification', () => {
  const health = {
    status: 'ok',
    providers: {
      auth: { provider: 'basic-auth' },
      sync: { provider: 'sqlite' },
      storage: { provider: 'fs' },
    },
  };
  expect(validateVerificationHealth(health)).toEqual(health);
  expect(() => validateVerificationHealth({
    ...health,
    providers: { ...health.providers, sync: { provider: 'convex' } },
  })).toThrow('Basic Auth + SQLite + filesystem');
  expect(() => validateVerificationHealth({ status: 'degraded', providers: health.providers })).toThrow(
    'Basic Auth + SQLite + filesystem',
  );
});

test('verification keeps authenticated storage grants same-origin and fixed-profile', () => {
  const base = new URL('https://chat.example.com');
  expect(sameOriginVerificationUrl(base, '/api/storage/fs/upload?token=one', 'upload').origin).toBe(base.origin);
  expect(() => sameOriginVerificationUrl(base, 'https://attacker.example/upload', 'upload')).toThrow('cross-origin');
  expect(() => assertVerificationGrant({ method: 'PUT' }, 'PUT', 'upload')).not.toThrow();
  expect(() => assertVerificationGrant({ method: 'POST' }, 'PUT', 'upload')).toThrow('unexpected upload method');
  expect(() => assertVerificationGrant({ method: 'GET', headers: { authorization: 'leak' } }, 'GET', 'download')).toThrow('unexpected download headers');
});

test('redacts known values and secret-shaped environment output', () => {
  expect(redact('OR3_BASIC_AUTH_JWT_SECRET=abc123 password=hidden', ['abc123'])).toBe(
    'OR3_BASIC_AUTH_JWT_SECRET=[REDACTED] password=[REDACTED]',
  );
  expect(redact('OR3_ADMIN_PASSWORD=A secret with spaces & punctuation!\nnext=visible')).toBe(
    'OR3_ADMIN_PASSWORD=[REDACTED]\nnext=visible',
  );
});

test('records immutable state metadata', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-state-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  expect(stateFromEnv('/tmp/or3-cloud-state-test', env, 'local', 'init', 'sha256:test')).toMatchObject({
    appVersion: '0.1.12',
    image: env.OR3_IMAGE,
    imageDigest: 'sha256:test',
    volumeName: env.OR3_VOLUME_NAME,
  });
});

test('rejects any resolved Compose binding that exposes OR3 beyond loopback', () => {
  const safe = JSON.stringify({ services: { or3: { ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }] } } });
  const unsafe = JSON.stringify({ services: { or3: { ports: [
    { target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' },
    { target: 3000, published: 3999, host_ip: '0.0.0.0', protocol: 'tcp' },
  ] } } });
  expect(checkResolvedLoopbackBinding(safe, 3000)).toBe(true);
  expect(checkResolvedLoopbackBinding(unsafe, 3000)).toBe(false);
  const hostNetwork = JSON.stringify({ services: { or3: { network_mode: 'host', ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }] } } });
  expect(checkResolvedLoopbackBinding(hostNetwork, 3000)).toBe(false);
});

test('accepts only the fixed V1 Compose data layout', () => {
  const config = JSON.stringify({
    services: {
      or3: {
        environment: {
          OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
          OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
          OR3_STORAGE_FS_ROOT: '/data/storage',
        },
        ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }],
        volumes: [{ type: 'volume', source: 'or3-data', target: '/data' }],
      },
    },
    volumes: { 'or3-data': { name: 'source-data' } },
  });
  expect(() => assertSupportedSourceCompose(config, 'source-data', 3000)).not.toThrow();
  expect(() => assertSupportedSourceCompose(config.replace('/data/storage', '/tmp/storage'), 'source-data', 3000)).toThrow('custom data layouts');
});

test('refuses a backup whose deployment identity does not match the live volume', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-identity-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  const state = stateFromEnv('/tmp/or3-cloud-identity-test', env, 'local', 'init', 'sha256:test');
  const backupEnv = { ...env, OR3_VOLUME_NAME: 'another-deployment-data' };
  expect(() => assertBackupMatchesDeployment({
    schemaVersion: 1,
    backupId: 'backup-test',
    createdAt: new Date().toISOString(),
    appVersion: state.appVersion,
    image: state.image,
    imageDigest: state.imageDigest,
    dataSha256: 'sha256:test',
    mode: 'local',
  }, backupEnv, state, env)).toThrow('different deployment identity');
});

test('permits only a journaled target environment while recovery is pending', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-pending-target-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  const state = stateFromEnv('/tmp/or3-cloud-pending-target-test', env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
  delete state.deploymentId;
  delete env.OR3_DEPLOYMENT_ID;
  const targetDigest = `sha256:${'b'.repeat(64)}`;
  const targetDeploymentId = 'deployment-pending-target';
  state.incompleteOperation = {
    id: 'update-pending',
    operation: 'update',
    startedAt: new Date().toISOString(),
    message: 'test',
    targetVersion: '0.1.13',
    targetImage: 'ghcr.io/saluana/or3-chat:0.1.13',
    targetImageDigest: targetDigest,
    targetDeploymentId,
  };
  const targetEnv = {
    ...env,
    OR3_VERSION: '0.1.13',
    OR3_IMAGE: `ghcr.io/saluana/or3-chat@${targetDigest}`,
    OR3_DEPLOYMENT_ID: targetDeploymentId,
  };
  const manifest = {
    schemaVersion: 1 as const,
    backupId: 'backup-pending-target',
    createdAt: new Date().toISOString(),
    appVersion: state.appVersion,
    image: state.image,
    imageDigest: state.imageDigest,
    dataSha256: 'c'.repeat(64),
    mode: 'local' as const,
    deploymentId: state.deploymentId,
  };
  expect(() => assertBackupMatchesDeployment(manifest, env, state, targetEnv)).not.toThrow();
  expect(() => assertBackupMatchesDeployment(manifest, env, state, { ...targetEnv, OR3_IMAGE: 'attacker/image:latest' })).toThrow(
    'Managed state does not match',
  );
  const upgradedState = {
    ...state,
    appVersion: '0.1.13',
    image: targetEnv.OR3_IMAGE,
    imageDigest: targetDigest,
    deploymentId: targetDeploymentId,
    incompleteOperation: undefined,
  };
  expect(() => assertBackupMatchesDeployment(manifest, env, upgradedState, targetEnv)).not.toThrow();
});

test('refuses unsupported V1 provider modules before adoption', () => {
  expect(() => assertSupportedSource('/tmp/v1', {
    AUTH_PROVIDER: 'basic-auth',
    OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false',
    OR3_SYNC_PROVIDER: 'sqlite',
    OR3_STORAGE_FS_ROOT: '/data/storage',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'admin@example.com',
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'AValidPassword123',
  }, 'or3-provider-basic-auth/nuxt\nor3-provider-sqlite/nuxt\nor3-provider-s3/nuxt')).toThrow(
    'V1 provider modules are unsupported',
  );
});

test('requires archive space plus reserve headroom before destructive ops', () => {
  const required = 100 * 1024 * 1024;
  const headroom = Math.max(required / 2, 64 * 1024 * 1024);
  expect(requiredArchiveSpace(required)).toBe(required + headroom);
  expect(() => assertEnoughFreeSpace(requiredArchiveSpace(required), required, 'Backup')).not.toThrow();
  expect(() => assertEnoughFreeSpace(requiredArchiveSpace(required) - 1, required, 'Backup')).toThrow(
    'Backup needs at least',
  );
  expect(() => assertEnoughFreeSpace(1024 * 1024, required, 'Restore')).toThrow('free space');
});

test('guard permits only an OR3-generated backup ID for artifact cleanup', () => {
  expect(assertRemovableArtifactName('backup-2026-08-07T10-30-00-000Z-a1b2c3d4')).toBe(
    'backup-2026-08-07T10-30-00-000Z-a1b2c3d4',
  );
  for (const name of ['../../etc/shadow', 'backup-../other', 'notabackup', 'other-2026-01-01', ''] ) {
    expect(() => assertRemovableArtifactName(name)).toThrow('Refusing to remove a backup artifact');
  }
});

test('prunes newest-first retention while protecting rollback and pending backups', () => {
  const backups = [
    { backupId: 'backup-oldest', createdAt: '2026-01-01T00:00:00.000Z' },
    { backupId: 'backup-middle', createdAt: '2026-02-01T00:00:00.000Z' },
    { backupId: 'backup-newest', createdAt: '2026-03-01T00:00:00.000Z' },
  ];
  expect(selectPruneTargets(backups, 2, new Set())).toEqual(['backup-oldest']);
  expect(selectPruneTargets(backups, 5, new Set())).toEqual([]);
  expect(selectPruneTargets(backups, 2, new Set(['backup-oldest']))).toEqual([]);
  expect(selectPruneTargets(backups, 1, new Set(['backup-middle']))).toEqual(['backup-oldest']);
  expect(selectPruneTargets(backups, 1, new Set(['backup-middle']), true)).toEqual(['backup-middle', 'backup-oldest']);
  expect(() => selectPruneTargets(backups, 0, new Set())).toThrow('at least 1');
  expect(() => selectPruneTargets(backups, 1.5, new Set())).toThrow('at least 1');
});

test('purge targets derive only from validated state and refuse without a recent backup', () => {
  const localEnv = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-purge-local',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  const localState = stateFromEnv('/tmp/or3-cloud-purge-local', localEnv, 'local', 'init', 'sha256:test');
  expect(purgeVolumesFromState(localState)).toEqual([localState.volumeName]);

  const publicEnv = buildEnv({
    mode: 'public',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-purge-public',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    domain: 'cloud.example.com',
    port: 3000,
  });
  const publicState = stateFromEnv('/tmp/or3-cloud-purge-public', publicEnv, 'public', 'init', 'sha256:test');
  expect(purgeVolumesFromState(publicState)).toEqual([
    publicState.volumeName,
    publicState.caddyDataVolume as string,
    publicState.caddyConfigVolume as string,
  ]);

  const now = Date.now();
  expect(() => assertPurgeBackupFreshness([], now)).toThrow('backup newer than 24 hours');
  expect(() => assertPurgeBackupFreshness(
    [{ backupId: 'backup-stale', createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }],
    now,
  )).toThrow('backup newer than 24 hours');
  expect(() => assertPurgeBackupFreshness(
    [{ backupId: 'backup-fresh', createdAt: new Date(now - 60 * 60 * 1000).toISOString() }],
    now,
  )).not.toThrow();
});

test('credentials reset script rewrites the owner hash, revokes sessions, and rotates admin credentials', () => {
  const script = buildCredentialsResetScript({
    ownerEmail: 'admin@example.com',
    ownerPassword: 'ANewOwnerPassword123',
    adminUsername: 'admin@example.com',
    adminPassword: 'ANewAdminPassword123',
  });
  expect(script).toContain('better-sqlite3');
  expect(script).toContain('bcryptjs/index.js');
  expect(script).toContain("UPDATE basic_auth_accounts SET password_hash = ?, token_version = token_version + 1, updated_at = ?");
  expect(script).toContain('WHERE account_id = ?');
  expect(script).toContain('SELECT id FROM basic_auth_accounts WHERE email = ?');
  expect(script).toContain('basic_auth_sessions');
  expect(script).toContain('/data/auth.sqlite');
  expect(script).toContain('admin-credentials.json');
  expect(script).toContain('fs.fsyncSync(descriptor)');
  expect(script).toContain('fs.renameSync(temporary, target)');
  expect(script).toContain('process.exit(1)');
  expect(script).not.toContain('ANewOwnerPassword123');
  expect(script).not.toContain('ANewAdminPassword123');
});

test('accepts only the new operator flags and rejects typos before dispatch', () => {
  expect(() => assertCommandFlags('remove', { 'purge-data': true, yes: true })).not.toThrow();
  expect(() => assertCommandFlags('remove', { purge: true })).toThrow('Unknown option for remove: --purge');
  expect(() => assertCommandFlags('credentials', { yes: true, 'owner-password': 'x', 'admin-password': 'y' })).not.toThrow();
  expect(() => assertCommandFlags('credentials', { yes: true, 'owner-password-file': '/owner', 'admin-password-file': '/admin' })).not.toThrow();
  expect(() => assertCommandFlags('verify', { public: true, 'verification-email': 'owner@example.com', 'verification-password-file': '/owner' })).not.toThrow();
  expect(() => assertCommandFlags('credentials', { force: true })).toThrow('Unknown option for credentials: --force');
  expect(() => assertCommandFlags('backup', { keep: '3' })).not.toThrow();
  expect(() => assertCommandFlags('logs', { tail: '50' })).not.toThrow();
  expect(() => assertCommandFlags('status', { yes: true })).toThrow('Unknown option for status: --yes');
});

test('accepts a manifest list that publishes both amd64 and arm64', () => {
  const manifest = {
    mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
    manifests: [
      { platform: { os: 'linux', architecture: 'amd64' } },
      { platform: { os: 'linux', architecture: 'arm64' } },
    ],
  };
  expect(supportedImageArchitectures(manifest)).toEqual(['amd64', 'arm64']);
  expect(() => assertSupportedArchitecture(manifest, 'amd64')).not.toThrow();
  expect(() => assertSupportedArchitecture(manifest, 'arm64')).not.toThrow();
});

test('rejects an arm64 host when the manifest list publishes amd64 only', () => {
  const manifest = {
    mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
    manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }],
  };
  expect(() => assertSupportedArchitecture(manifest, 'amd64')).not.toThrow();
  expect(() => assertSupportedArchitecture(manifest, 'arm64')).toThrow(
    'OR3 does not publish a arm64 image for this version yet. Supported architectures: amd64. Install on a supported machine or wait for the next release.',
  );
});

test('accepts a single-arch manifest for its own architecture and rejects others', () => {
  const manifest = { mediaType: 'application/vnd.docker.distribution.manifest.v2+json', architecture: 'arm64' };
  expect(supportedImageArchitectures(manifest)).toEqual(['arm64']);
  expect(() => assertSupportedArchitecture(manifest, 'arm64')).not.toThrow();
  expect(() => assertSupportedArchitecture(manifest, 'amd64')).toThrow(
    'OR3 does not publish a amd64 image for this version yet. Supported architectures: arm64.',
  );
});

test('fails closed on malformed or empty manifests', () => {
  for (const manifest of [{}, { manifests: [] }, { manifests: [{ platform: {} }] }, null, undefined]) {
    expect(() => assertSupportedArchitecture(manifest as never, 'amd64')).toThrow(
      'no recognizable architecture list',
    );
  }
});

test('this bridge release writes schema 1 while reading both formats', () => {
  expect(writeStateSchema()).toBe(1);
  const env = buildEnv({ mode: 'local', version: '0.1.12', directory: '/tmp/or3-schema-bridge', email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
  expect(stateFromEnv('/tmp/or3-schema-bridge', env, 'local', 'init', `sha256:${'a'.repeat(64)}`).schemaVersion).toBe(1);
});

test('a bridge writer refuses to mutate newer-schema state', () => {
  const env = buildEnv({ mode: 'local', version: '0.1.12', directory: '/tmp/or3-schema-writable', email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
  const state = stateFromEnv('/tmp/or3-schema-writable', env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
  expect(() => assertStateSchemaWritable(state)).not.toThrow();
  expect(() => assertStateSchemaWritable({ ...state, schemaVersion: 2 })).toThrow('qualified to write schema 1');
});

test('status projection never exposes credential-reset secrets or raw configuration', () => {
  const env = buildEnv({ mode: 'local', version: '0.1.12', directory: '/tmp/or3-projection', email: 'admin@example.com', password: 'OwnerSecretPassword123', port: 3000 });
  const state = stateFromEnv('/tmp/or3-projection', env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
  state.incompleteOperation = {
    id: 'credentials-reset-1', operation: 'credentials-reset', startedAt: new Date().toISOString(),
    message: 'resetting', credentialReset: { nextEnv: { OR3_ADMIN_PASSWORD: 'AdminSecretPassword123', OR3_BASIC_AUTH_JWT_SECRET: 'jwt-secret-value', OR3_STORAGE_FS_TOKEN_SECRET: 'storage-secret' } },
  };
  state.lastError = 'OR3_ADMIN_PASSWORD=leaked-in-error';
  const serialized = JSON.stringify(publicStateProjection(state));
  expect(serialized).not.toContain('AdminSecretPassword123');
  expect(serialized).not.toContain('jwt-secret-value');
  expect(serialized).not.toContain('storage-secret');
  expect(serialized).not.toContain('leaked-in-error');
  expect(serialized).toContain('credentials-reset-1');
  expect(serialized).toContain('credentials-reset');
});

test('lifecycle phase policy blocks start/restart but allows stop during a pending operation', () => {
  const env = buildEnv({ mode: 'local', version: '0.1.12', directory: '/tmp/or3-phase-policy', email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
  const clean = stateFromEnv('/tmp/or3-phase-policy', env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
  expect(() => assertPhaseAllowsCommand('start', clean)).not.toThrow();
  const pending = { ...clean, incompleteOperation: { id: 'update-1', operation: 'update' as const, startedAt: new Date().toISOString(), message: 'x', phase: 'starting-target' as const } };
  expect(() => assertPhaseAllowsCommand('start', pending)).toThrow('Refusing to start');
  expect(() => assertPhaseAllowsCommand('restart', pending)).toThrow('Refusing to restart');
  expect(() => assertPhaseAllowsCommand('stop', pending)).not.toThrow();
});

test('read-only invocation policy bypasses the mutation lease', () => {
  expect(verifyIsReadOnly({ 'read-only': true })).toBe(true);
  expect(verifyIsReadOnly({ public: true })).toBe(false);
  expect(verifyIsReadOnly({})).toBe(false);
});

test('recovery decision distinguishes finish, resume, and explicit restore', () => {
  const base = stateFromEnv('/tmp/or3-recovery-decision', buildEnv({
    mode: 'local', version: '0.1.12', directory: '/tmp/or3-recovery-decision',
    email: 'admin@example.com', password: 'AValidPassword123', port: 3000,
  }), 'local', 'init', `sha256:${'a'.repeat(64)}`);
  expect(decideRecoveryAction(base)).toEqual({ action: 'none', detail: expect.any(String) });

  const prepared = { ...base, incompleteOperation: { id: 'update-1', operation: 'update' as const, startedAt: new Date().toISOString(), message: 'x', phase: 'prepared' as const } };
  expect(decideRecoveryAction(prepared).action).toBe('resume');

  const targetReady = {
    ...base,
    incompleteOperation: {
      id: 'update-2', operation: 'update' as const, startedAt: new Date().toISOString(), message: 'x',
      phase: 'target-ready' as const, targetVersion: '0.1.13', targetImage: 'ghcr.io/saluana/or3-chat:0.1.13', targetImageDigest: `sha256:${'b'.repeat(64)}`,
      evidence: { checkedAt: new Date().toISOString(), deploymentId: 'd1', deploymentRoot: '/tmp/x', imageDigest: `sha256:${'b'.repeat(64)}`, configurationSha256: 'c'.repeat(64), managedAssetSha256: {}, dataReplacementCompleted: true as const, checks: [] },
    },
  };
  expect(decideRecoveryAction(targetReady).action).toBe('finish');

  const mutating = { ...base, incompleteOperation: { id: 'update-3', operation: 'update' as const, startedAt: new Date().toISOString(), message: 'x', phase: 'target-mutating' as const, backupId: 'backup-pre' } };
  expect(decideRecoveryAction(mutating)).toMatchObject({ action: 'require-explicit-restore', snapshotId: 'backup-pre' });

  // Legacy/partial journals without durable completion proof never finish,
  // even when the phase name looks advanced.
  const legacyTargetReady = { ...base, incompleteOperation: { id: 'update-4', operation: 'update' as const, startedAt: new Date().toISOString(), message: 'x', phase: 'target-ready' as const, backupId: 'backup-legacy' } };
  expect(decideRecoveryAction(legacyTargetReady).action).toBe('require-explicit-restore');

  // A completed commit whose privileged handoff is unfinished reconciles only
  // the handoff.
  const handoffPending = { ...base, lastReceipt: { ...base.lastReceipt!, operatorHandoff: 'pending' as const } };
  expect(decideRecoveryAction(handoffPending).action).toBe('reconcile-handoff');
  const handoffAttention = { ...base, lastReceipt: { ...base.lastReceipt!, operatorHandoff: 'needs-attention' as const } };
  expect(decideRecoveryAction(handoffAttention).action).toBe('reconcile-handoff');
  const handoffVerified = { ...base, lastReceipt: { ...base.lastReceipt!, operatorHandoff: 'verified' as const } };
  expect(decideRecoveryAction(handoffVerified).action).toBe('none');
});

test('state fingerprint changes with identity and pending operation', () => {
  const env = buildEnv({ mode: 'local', version: '0.1.12', directory: '/tmp/or3-fingerprint', email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
  const state = stateFromEnv('/tmp/or3-fingerprint', env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
  const fingerprint = stateFingerprint(state);
  expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
  expect(stateFingerprint({ ...state })).toBe(fingerprint);
  expect(stateFingerprint({ ...state, appVersion: '0.1.13' })).not.toBe(fingerprint);
  expect(stateFingerprint({ ...state, incompleteOperation: { id: 'op', operation: 'update', startedAt: new Date().toISOString(), message: 'x' } })).not.toBe(fingerprint);
});

test('update assessment previews a settled deployment without mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-assess-'));
  try {
    const env = buildEnv({ mode: 'local', version: '0.1.12', directory, email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
    await copyAssets(directory, 'local');
    await mkdir(join(directory, '.or3-cloud', 'backups'), { recursive: true });
    const state = stateFromEnv(directory, env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
    await writeFile(join(directory, '.env'), serializeEnv(env));
    await writeFile(join(directory, '.or3-cloud', 'state.json'), JSON.stringify(state));
    const before = await readFile(join(directory, '.or3-cloud', 'state.json'), 'utf8');

    const assessment = await assessUpdate(directory, '0.1.13');
    expect(assessment.source?.appVersion).toBe('0.1.12');
    expect(assessment.target.appVersion).toBe('0.1.13');
    expect(assessment.stateFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(assessment.checks.some((check) => check.code === 'image-pull' && check.status === 'deferred')).toBe(true);
    expect(assessment.findings.filter((finding) => finding.severity === 'blocker')).toEqual([]);
    expect(await readFile(join(directory, '.or3-cloud', 'state.json'), 'utf8')).toBe(before);
    expect(await enumerateBackups(directory)).toEqual([]);

    const blocked = await assessUpdate(directory, '0.1.12');
    expect(blocked.checks.some((check) => check.code === 'already-installed' && check.status === 'passed')).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('shared update assessment blocks on a foreign lease but not the caller own lease', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'or3-assess-lease-'));
  try {
    const env = buildEnv({ mode: 'local', version: '0.1.12', directory, email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
    await copyAssets(directory, 'local');
    await mkdir(join(directory, '.or3-cloud', 'backups'), { recursive: true });
    const state = stateFromEnv(directory, env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
    await writeFile(join(directory, '.env'), serializeEnv(env));
    await writeFile(join(directory, '.or3-cloud', 'state.json'), JSON.stringify(state));
    const leasePath = join(directory, '.or3-cloud', 'operation-lease');
    await mkdir(leasePath, { recursive: true });
    await writeFile(join(leasePath, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      nonce: 'test-lease',
      command: 'update',
      origin: 'cli',
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    }));

    const foreign = await assessUpdate(directory, '0.1.13');
    expect(foreign.findings.some((finding) => finding.code === 'operation-in-progress' && finding.severity === 'blocker')).toBe(true);

    const own = await assessUpdate(directory, '0.1.13', { underLease: true });
    expect(own.findings.some((finding) => finding.code === 'operation-in-progress' && finding.severity === 'blocker')).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
