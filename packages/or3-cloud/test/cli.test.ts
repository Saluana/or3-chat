import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCommandFlags,
  assertCommandPositionals,
  assertEnoughFreeSpace,
  assertPurgeBackupFreshness,
  assertRemovableArtifactName,
  assertSupportedSource,
  assertSupportedSourceCompose,
  assertBackupMatchesDeployment,
  assertSupportedArchitecture,
  buildCredentialsResetScript,
  buildEnv,
  checkResolvedLoopbackBinding,
  copyAssets,
  isVersion,
  parseEnv,
  parseFlags,
  purgeVolumesFromState,
  redact,
  requiredArchiveSpace,
  restoreManagedAssets,
  selectPruneTargets,
  serializeInitialCredentials,
  serializeEnv,
  snapshotManagedAssets,
  stateFromEnv,
  supportedImageArchitectures,
  validateVerificationHealth,
  validatePassword,
} from '../src/cli';
import { ADMIN_PASSWORD_POLICY_VECTORS } from '../../../shared/cloud/wizard/admin-password-policy-vectors';
import { MANAGED_PROFILE_SHARED_ENV } from '../../../shared/cloud/wizard/managed-profile-contract';

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

test('redacts known values and secret-shaped environment output', () => {
  expect(redact('OR3_BASIC_AUTH_JWT_SECRET=abc123 password=hidden', ['abc123'])).toBe(
    'OR3_BASIC_AUTH_JWT_SECRET=[REDACTED] password=[REDACTED]',
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
  expect(script).toContain('process.exit(1)');
  expect(script).not.toContain('ANewOwnerPassword123');
  expect(script).not.toContain('ANewAdminPassword123');
});

test('accepts only the new operator flags and rejects typos before dispatch', () => {
  expect(() => assertCommandFlags('remove', { 'purge-data': true, yes: true })).not.toThrow();
  expect(() => assertCommandFlags('remove', { purge: true })).toThrow('Unknown option for remove: --purge');
  expect(() => assertCommandFlags('credentials', { yes: true, 'owner-password': 'x', 'admin-password': 'y' })).not.toThrow();
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
