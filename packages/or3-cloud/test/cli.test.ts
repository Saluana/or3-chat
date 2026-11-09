import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assertEnoughFreeSpace, requiredArchiveSpace } from '../src/backup/archive';
import { assertPurgeBackupFreshness } from '../src/backup/export';
import { assertBackupMatchesDeployment, enumerateBackups, inventoryBackups, recordedBackupPath } from '../src/backup/manifests';
import { assertRemovableArtifactName, planRetention, selectPruneTargets } from '../src/backup/retention';
import { assertCommandFlags, assertCommandPositionals, parseFlags } from '../src/cli/args';
import { assessUpdate } from '../src/commands/update';
import { validatePassword } from '../src/credentials/inputs';
import { buildCredentialsResetScript } from '../src/credentials/reset-script';
import { assertSupportedSource, assertSupportedSourceCompose } from '../src/deployment/adoption-source';
import { copyAssets, restoreManagedAssets, snapshotManagedAssets, MANAGED_ASSET_INVENTORY_VERSION } from '../src/deployment/assets';
import { STATE_SCHEMA_COMPATIBILITY, assertKnownStateSchema } from '../src/deployment/contracts';
import {
  buildEnv,
  parseEnv,
  secretValues,
  serializeInitialCredentials,
  serializeEnv,
  withoutProvisioningCredentials,
} from '../src/deployment/env';
import { isVersion } from '../src/deployment/identity';
import { publicStateProjection, stateFingerprint } from '../src/deployment/observation';
import { decideRecoveryAction } from '../src/deployment/recovery';
import { assertPhaseAllowsCommand, assertStateSchemaWritable, writeStateSchema, stateFromEnv } from '../src/deployment/state-store';
import { lifecycleFaults } from '../src/lifecycle-faults';
import { checkResolvedLoopbackBinding } from '../src/runtime/compose';
import { assertDashboardOperatorMounts, dashboardOperatorHandoffArgs } from '../src/runtime/dashboard-operator';
import { assertImageReleaseLabels, assertSupportedArchitecture, supportedImageArchitectures } from '../src/runtime/images';
import { assertVerificationGrant, sameOriginVerificationUrl, validateVerificationHealth } from '../src/runtime/verification';
import { restoreRequiresVolumeRecreation, updateRequiresVolumeRecreation } from '../src/runtime/volumes';
import { redact } from '../src/util/primitives';
import type { ManagedState } from '../src/deployment/contracts';
import * as deploymentEnvironment from '../src/deployment/env';
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
    managedAssetInventoryVersion: MANAGED_ASSET_INVENTORY_VERSION,
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

test.each(
  ['restore', 'recover'].flatMap((operation) =>
    ['missing', 'foreign-project', 'foreign-deployment'].map(
      (labelCase) => [operation, labelCase] as const
    )
  )
)(
  '%s refuses %s volume labels before any destructive Docker request',
  async (operation, labelCase) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'or3-restore-volume-binding-')));
    try {
      const { path, manifest } = await authenticatedBackupFixture(directory, 'backup-bound-volume');
      const digest = `sha256:${'a'.repeat(64)}`;
      const env = buildEnv({
        mode: 'local',
        version: manifest.appVersion,
        directory,
        image: manifest.image,
        email: 'fixture@example.invalid',
        password: 'FixturePassword123!',
        port: 3197,
      });
      env.NUXT_SECRETS_PROVIDER = '';
      const state = stateFromEnv(directory, env, 'local', 'init', digest);
      if (operation === 'recover') {
        state.incompleteOperation = {
          id: 'update-volume-binding',
          operation: 'update',
          phase: 'target-mutating',
          startedAt: new Date().toISOString(),
          message: 'Fixture interrupted update',
          backupId: manifest.backupId,
          backupPath: path,
          previousRootOwnership: { uid: 0, gid: 0 },
        };
      }
      const config = serializeEnv(env);
      const data = gzipSync(Buffer.from('fixture archive bytes'));
      const contents = JSON.stringify({
        ...manifest,
        mode: state.mode,
        composeProject: state.composeProject,
        volumeName: state.volumeName,
        deploymentId: state.deploymentId,
        port: state.port,
        dataSha256: createHash('sha256').update(data).digest('hex'),
        configSha256: createHash('sha256').update(config).digest('hex'),
      });
      await writeFile(join(path, 'data.tgz'), data);
      await writeFile(join(path, 'config.env'), config);
      await writeFile(join(path, 'manifest.json'), contents);
      await writeFile(
        join(path, 'manifest.auth'),
        createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex'))
          .update(contents)
          .digest('hex')
      );
      await writeFile(join(directory, '.env'), config);
      await writeFile(join(directory, '.or3-cloud', 'state.json'), JSON.stringify(state));
      const bin = join(directory, 'bin');
      const trace = join(directory, 'docker-requests.jsonl');
      const labels =
        labelCase === 'missing'
          ? {}
          : {
              'com.docker.compose.project':
                labelCase === 'foreign-project' ? 'another-project' : state.composeProject,
              'com.docker.compose.volume': 'or3-data',
              'io.or3.cloud.deployment-id':
                labelCase === 'foreign-deployment' ? 'another-deployment' : state.deploymentId,
            };
      await mkdir(bin);
      // This executable records requests and NEVER invokes Docker or a shell.
      // The unsafe clear/removal paths are audited without executing them.
      await writeFile(
        join(bin, 'docker'),
        `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n');
if (args.includes('-i')) await Bun.stdin.bytes();
const text = args.join(' ');
const fixtureEnv = ${JSON.stringify(env)};
fixtureEnv.OR3_ADMIN_DATA_DIR = '/data/admin'; fixtureEnv.OR3_EXTENSIONS_ROOT = '/data/extensions';
if (text.includes('tar czf')) { await Bun.stdout.write(gzipSync(Buffer.from('fixture archive bytes'))); }
else if (text.includes('backup-inspect.mjs inventory')) console.log(JSON.stringify({selected:['./sync.sqlite'],bytes:1000}));
else if (text.includes('backup-inspect.mjs references')) console.log(JSON.stringify({contract:1,complete:true,liveAttachments:0}));
else if (args[0] === 'volume' && args[1] === 'inspect') {
  console.log(text.includes('.Labels') ? ${JSON.stringify(JSON.stringify(labels))} : ${JSON.stringify(state.volumeName)});
} else if (args[0] === 'inspect' && text.includes('.HostConfig.ReadonlyRootfs')) {
  for (const value of [['/entrypoint'], ['serve'], '/app', true, null, null]) console.log(JSON.stringify(value));
} else if (args[0] === 'inspect' && text.includes('.Config.Env')) {
  for (const value of [Object.entries(fixtureEnv).map(([k,v]) => k+'='+v), 'sha256:fixture-image', [{Type:'volume',Name:fixtureEnv.OR3_VOLUME_NAME,Destination:'/data'}], {'com.docker.compose.project':fixtureEnv.OR3_COMPOSE_PROJECT,'com.docker.compose.service':'or3'}]) console.log(JSON.stringify(value));
} else if (args[0] === 'image' && text.includes('.Config.Entrypoint')) {
  for (const value of [['/entrypoint'], ['serve'], '/app', []]) console.log(JSON.stringify(value));
} else if (args[0] === 'image' && text.includes('{{.Id}}')) console.log('sha256:fixture-image');
else if (args[0] === 'compose' && args.includes('ps') && args.includes('-aq')) console.log('fixture-container');
else if (text.includes('.RepoDigests')) console.log(JSON.stringify([${JSON.stringify(manifest.image)}]));
else if (text.includes('.Architecture')) console.log(args[0] === 'image' ? 'arm64' : 'aarch64');
else if (text.includes('imagetools inspect')) console.log(JSON.stringify({architecture:'arm64',manifests:[{platform:{architecture:'arm64'}},{platform:{architecture:'amd64'}}]}));
else if (text.includes('df -Pk')) console.log('1000000');
else if (text.includes('du -sb')) console.log('1000');
else if (text.includes('du -sk')) console.log('1');
else if (text.includes('stat -c')) console.log('0:0');
else if (args[0] === 'compose' && args.includes('config')) {
  console.log(JSON.stringify({services:{or3:{image:${JSON.stringify(manifest.image)},read_only:true,environment:fixtureEnv,labels:{'io.or3.cloud.deployment-id':${JSON.stringify(env.OR3_DEPLOYMENT_ID)}},ports:[{target:3000,published:3197,host_ip:'127.0.0.1',protocol:'tcp'}],volumes:[{type:'volume',source:'or3-data',target:'/data'}]}},volumes:{'or3-data':{name:${JSON.stringify(state.volumeName)},labels:{'io.or3.cloud.deployment-id':${JSON.stringify(env.OR3_DEPLOYMENT_ID)}}}}}));
} else if (args[0] === 'compose' && args.includes('up')) { console.error('Fixture refuses runtime start'); process.exit(1); }
`,
        { mode: 0o755 }
      );
      const command =
        operation === 'restore' ? ['restore', path, '--yes'] : ['recover', '--restore', '--yes'];
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, '../src/cli.ts'), ...command],
        {
          cwd: directory,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          stdout: 'pipe',
          stderr: 'pipe',
        }
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const requests = (
        await readFile(trace, 'utf8').catch(() => {
          throw new Error(stdout + stderr);
        })
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
      expect(
        requests.some(
          (args) =>
            args.includes('find /data -mindepth 1 -delete') ||
            args.some((arg) => arg.startsWith('chown ')) ||
            (args[0] === 'volume' && args[1] === 'rm')
        )
      ).toBe(false);
      expect(exitCode).toBe(1);
      expect(stdout + stderr).toContain('expected managed deployment labels');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  20_000,
);

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
      managedAssetInventoryVersion: MANAGED_ASSET_INVENTORY_VERSION,
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
    await rm(join(directory, 'dashboard-lifecycle.mjs'));
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
  expect(parseFlags(['--yes', 'backup-id', '--local', 'target'])).toEqual({
    positionals: ['backup-id', 'target'],
    flags: { yes: true, local: true },
  });
  // Only the first `=` splits, so values (passwords) may contain `=`.
  expect(parseFlags(['--admin-password=pa=ss']).flags).toEqual({ 'admin-password': 'pa=ss' });
  expect(() => parseFlags(['--dry-run=true'])).toThrow('--dry-run is a switch and does not take a value');
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

test('deep-health verification checks the requested complete managed profile', () => {
  const clerk = { status: 'ok', providers: { auth: { provider: 'clerk' }, sync: { provider: 'sqlite' }, storage: { provider: 's3' } } };
  expect(validateVerificationHealth(clerk, 'clerk-sqlite-s3')).toEqual(clerk);
  expect(() => validateVerificationHealth(clerk)).toThrow();
  expect(() => validateVerificationHealth({ ...clerk, providers: { ...clerk.providers, storage: { provider: 'fs' } } }, 'clerk-sqlite-s3')).toThrow();
  expect(() => validateVerificationHealth({ ...clerk, status: 'degraded' }, 'clerk-sqlite-s3')).toThrow();
});

test('target-ready checks accept only the database count required by the managed profile', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'or3-profile-ready-')));
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await writeFile(join(directory, '.env'), 'OR3_COMPOSE_PROJECT=fixture\n');
    await writeFile(join(bin, 'docker'), `#!/usr/bin/env bun
const args = process.argv.slice(2), text = args.join(' ');
if (args.includes('ps')) console.log('fixture-container');
else if (text.includes('quick_check')) console.log(JSON.stringify(Array.from({length:Number(process.env.OR3_FIXTURE_DB_COUNT)}, (_,i) => ({path:'fixture-'+i,quickCheck:'ok',tables:1}))));
else if (!args.includes('exec')) process.exit(1);
`, { mode: 0o755 });
    const script = `import {collectTargetReadyChecks} from ${JSON.stringify(join(import.meta.dir, '../src/deployment/recovery.ts'))}; const env = JSON.parse(process.env.FIXTURE_PROFILE); console.log(JSON.stringify(await collectTargetReadyChecks(process.cwd(), 'local', env)));`;
    for (const [auth, storage, count, expected] of [
      ['basic-auth', 'fs', 2, 'passed'], ['basic-auth', 'fs', 1, 'failed'],
      ['clerk', 's3', 1, 'passed'], ['clerk', 's3', 2, 'failed'],
    ] as const) {
      await writeFile(join(directory, '.env'), `OR3_COMPOSE_PROJECT=fixture\nOR3_FIXTURE_DB_COUNT=${count}\n`);
      const child = Bun.spawn([process.execPath, '-e', script], { cwd: directory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_DB_COUNT: String(count), FIXTURE_PROFILE: JSON.stringify({ AUTH_PROVIDER: auth, OR3_AUTH_PROVIDER: auth, OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: storage }) }, stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(stdout).checks.find((check: {code: string}) => check.code === 'database-integrity').status, stdout).toBe(expected);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  // SDK errors may quote raw credential values without their environment keys.
  const env = {
    OR3_STORAGE_S3_ACCESS_KEY_ID: 'test-access-value',
    OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'test-secret-value',
    OR3_STORAGE_S3_SESSION_TOKEN: 'test-session-value',
  };
  expect(redact(Object.values(env).join(' '), secretValues(env))).toBe('[REDACTED] [REDACTED] [REDACTED]');
  const launchSecrets = { NUXT_CLERK_SECRET_KEY: 'sk_fixture_clerk', OR3_LIBRARY_LINK_SECRET: 'fixture-library-key', NUXT_ADMIN_LIBRARY_LINK_SECRET: 'fixture-runtime-key' };
  expect(redact(Object.values(launchSecrets).join(' '), secretValues(launchSecrets))).toBe('[REDACTED] [REDACTED] [REDACTED]');
  // Raw child-process errors can contain values without their environment
  // names; cover both documented operator keys and their runtime translations.
  const runtimeSecrets = Object.fromEntries([
    'OR3_PLUGIN_CONNECTION_SECRET', 'NUXT_ADMIN_PLUGIN_CONNECTION_SECRET',
    'OR3_BACKGROUND_ENCRYPTION_KEY', 'NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY',
    'OR3_WEBHOOKS_ENCRYPTION_KEY', 'NUXT_WEBHOOKS_ENCRYPTION_KEY', 'OR3_CONNECT_ENCRYPTION_KEY', 'NUXT_CONNECT_ENCRYPTION_KEY', 'OR3_CONNECT_CLOUDFLARE_API_TOKEN', 'NUXT_CONNECT_CLOUDFLARE_API_TOKEN',
    'OPENROUTER_API_KEY', 'NUXT_OPENROUTER_API_KEY', 'OR3_OPENAI_API_KEY', 'NUXT_OPENAI_API_KEY',
    'OR3_BILLING_STRIPE_SECRET_KEY', 'OR3_BILLING_STRIPE_WEBHOOK_SECRET', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'CONVEX_DEPLOY_KEY',
    'NUXT_AUTH_INVITE_TOKEN_SECRET', 'NUXT_ADMIN_AUTH_PASSWORD', 'NUXT_ADMIN_AUTH_JWT_SECRET',
  ].map((key, index) => [key, `private-fixture-value-${index}-end`]));
  expect(redact(Object.values(runtimeSecrets).join(' '), secretValues(runtimeSecrets))).toBe(Object.keys(runtimeSecrets).map(() => '[REDACTED]').join(' '));
  // Unsupported settings can still appear in a failed Compose diagnostic
  // before adoption has had a chance to refuse them.
  const unknownSecrets = { NITRO_OPENROUTER_API_KEY: 'fixture-unknown-api-key', CUSTOM_OAUTH_TOKEN: 'fixture-unknown-token', CUSTOM_DATABASE_PASSWORD: 'fixture-unknown-password' };
  expect(redact(Object.values(unknownSecrets).join(' '), secretValues(unknownSecrets))).toBe('[REDACTED] [REDACTED] [REDACTED]');
  // Mask every overlap so no fragment of another secret remains visible.
  expect(redact('abcdef and abc', ['abc', 'abcdef'])).toBe('[REDACTED] and [REDACTED]');
  expect(redact('abcdefg', ['abcde', 'cdefg'])).toBe('[REDACTED]');
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
  const source = { AUTH_PROVIDER: 'basic-auth', OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_STORAGE_ENABLED: 'true', NUXT_SECRETS_PROVIDER: '', OR3_INSTANCE_ID: 'stable-instance' };
  const image = 'ghcr.io/saluana/or3-chat:0.1.94';
  const config = JSON.stringify({
    services: {
      or3: {
        image,
        environment: {
          ...source,
          OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
          OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
          OR3_STORAGE_FS_ROOT: '/data/storage',
          OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions',
        },
        ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }],
        volumes: [{ type: 'volume', source: 'or3-data', target: '/data' }],
      },
    },
    volumes: { 'or3-data': { name: 'source-data' } },
  });
  expect(() => assertSupportedSourceCompose(config, 'source-data', 3000, source, [image])).not.toThrow();
  expect(() => assertSupportedSourceCompose(config.replace('/data/storage', '/tmp/storage'), 'source-data', 3000, source, [image])).toThrow('custom data layouts');
  for (const [path, foreign] of [['/data/admin', '/data/custom-admin'], ['/data/extensions', '/data/custom-extensions']]) {
    expect(() => assertSupportedSourceCompose(config.replace(path!, foreign!), 'source-data', 3000, source, [image])).toThrow('custom data layouts');
    const omitted = JSON.parse(config); delete omitted.services.or3.environment[path === '/data/admin' ? 'OR3_ADMIN_DATA_DIR' : 'OR3_EXTENSIONS_ROOT'];
    expect(() => assertSupportedSourceCompose(JSON.stringify(omitted), 'source-data', 3000, source, [image])).toThrow('custom data layouts');
  }
});

// Failure inventory: Compose may override the validated source env, omit a
// required selector, or attach source vault custody which adoption does not
// archive. Every such source must be refused before it is stopped.
test('adoption refuses effective provider drift and untransferred vault custody', () => {
  const image = 'ghcr.io/saluana/or3-chat:0.1.94';
  const env: Record<string, string> = {
    AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth', OR3_SYNC_PROVIDER: 'sqlite',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false',
    SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_STORAGE_ENABLED: 'true', NUXT_SECRETS_PROVIDER: '', OR3_INSTANCE_ID: 'stable-instance',
  };
  const base = {
    services: { or3: { image, environment: { ...env, OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite', OR3_STORAGE_FS_ROOT: '/data/storage', OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions' }, ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }], volumes: [{ type: 'volume', source: 'or3-data', target: '/data' }] } },
    volumes: { 'or3-data': { name: 'source-data' } },
  };
  const check = (config: unknown, source: Record<string, string> = env) => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, source, [image]);
  expect(() => check(base)).not.toThrow();
  const tmpfs = structuredClone(base) as typeof base & { services: { or3: { tmpfs?: string[] } } };
  tmpfs.services.or3.tmpfs = ['/data/storage:size=1m'];
  expect(() => check(tmpfs)).toThrow(/temporary filesystem/i);
  const subpath = structuredClone(base);
  Object.assign(subpath.services.or3.volumes[0]!, { volume: { subpath: 'other' } });
  expect(() => check(subpath)).toThrow(/subpath/i);
  const foreignImage = structuredClone(base);
  foreignImage.services.or3.image = 'example.invalid/custom:latest';
  expect(() => check(foreignImage)).toThrow(/image/i);
  for (const [key, value] of Object.entries({ AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk', OR3_SYNC_PROVIDER: 'convex', NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_AUTH_REGISTRATION_MODE: 'open', OR3_AUTH_AUTO_PROVISION: 'true', SSR_AUTH_ENABLED: 'false', NUXT_SECRETS_PROVIDER: 'or3-secrets' })) {
    const config = structuredClone(base);
    (config.services.or3.environment as Record<string, string>)[key] = value;
    expect(() => check(config), key).toThrow();
  }
  for (const [key, value] of Object.entries({ NUXT_AUTH_PROVIDER: 'clerk', NUXT_PUBLIC_AUTH_PROVIDER: 'clerk', NUXT_SYNC_PROVIDER: 'convex', NUXT_PUBLIC_SYNC_PROVIDER: 'convex', OR3_STORAGE_PROVIDER: 's3', NUXT_STORAGE_PROVIDER: 's3', NUXT_AUTH_ENABLED: 'false', NUXT_AUTH_REGISTRATION_MODE: 'open', NUXT_AUTH_AUTO_PROVISION: 'true', NUXT_SYNC_ENABLED: 'false', NUXT_STORAGE_ENABLED: 'false', NITRO_SECRETS_PROVIDER: 'or3-secrets', NITRO_AUTH_PROVIDER: 'clerk', NITRO_ENV_PREFIX: 'OTHER_', NUXT_AUTH: '{"provider":"clerk"}', NUXT_PUBLIC: '{"storageProvider":"s3"}', NITRO_STORAGE: '{"provider":"s3"}', NUXT_ADMIN: '{"libraryLinkSecret":"private"}', NITRO_ADMIN_LIBRARY_LINK_SECRET: 'private', NUXT_ADMIN_AUTH_PASSWORD: 'private', NUXT_ADMIN_AUTH_USERNAME: 'private' })) {
    const config = structuredClone(base);
    (config.services.or3.environment as Record<string, string>)[key] = value;
    expect(() => check(config), key).toThrow();
  }
  for (const key of ['NUXT_ADMIN_AUTH', 'NUXT_AUTH_INVITE', 'NUXT_BACKGROUND_JOBS', 'NUXT_CONNECT', 'NUXT_CONNECT_CLOUDFLARE', 'NUXT_WEBHOOKS', 'NITRO_BACKGROUND_JOBS_ENCRYPTION_KEY', 'NITRO_CONNECT_ENCRYPTION_KEY', 'NITRO_WEBHOOKS_ENCRYPTION_KEY']) {
    const config = structuredClone(base);
    (config.services.or3.environment as Record<string, string>)[key] = '{"encryptionKey":"fixture-private"}';
    expect(() => check(config), key).toThrow();
  }
  for (const [key, value] of Object.entries({ OR3_SQLITE_DRIVER: 'turso', OR3_WEBHOOKS_ENABLED: 'true', OR3_CONNECT_ENABLED: 'true', NUXT_ADMIN_PLUGIN_ISOLATION_ENABLED: 'true', NUXT_OPENAI_BASE_URL: 'https://example.invalid', NITRO_OPENROUTER_API_KEY: 'fixture-private', NITRO_SECURITY_PROXY_TRUST_PROXY: 'true' })) {
    const config = structuredClone(base);
    (config.services.or3.environment as Record<string, string>)[key] = value;
    expect(() => check(config), key).toThrow();
  }
  const supportedDriver = structuredClone(base);
  (supportedDriver.services.or3.environment as Record<string, string>).OR3_SQLITE_DRIVER = 'better-sqlite3';
  expect(() => check(supportedDriver, { ...env, OR3_SQLITE_DRIVER: 'better-sqlite3' })).not.toThrow();
  for (const value of ['TRUE', ' true ', 'yes']) {
    const config = structuredClone(base);
    (config.services.or3.environment as Record<string, string>).OR3_GUEST_ACCESS_ENABLED = value;
    expect(() => check(config), value).toThrow();
  }
  const omitted = structuredClone(base);
  delete (omitted.services.or3.environment as Record<string, string>).NUXT_SECRETS_PROVIDER;
  expect(() => check(omitted)).toThrow();
  for (const key of ['SSR_AUTH_ENABLED', 'OR3_SYNC_ENABLED', 'OR3_STORAGE_ENABLED']) {
    const config = structuredClone(base);
    delete (config.services.or3.environment as Record<string, string>)[key];
    const source = { ...env }; delete source[key];
    expect(() => check(config, source), key).toThrow();
  }
  const mounted = structuredClone(base);
  mounted.services.or3.volumes.push({ type: 'volume', source: 'custody', target: '/run/or3-secrets' });
  expect(() => check(mounted)).toThrow(/vault|secret/i);
  const withVaultService = { ...base, services: { ...base.services, 'or3-vault': {} } };
  expect(() => check(withVaultService)).toThrow(/vault|secret/i);
  for (const extra of ['auxiliary-worker', 'caddy']) {
    const withExtraService = { ...base, services: { ...base.services, [extra]: {} } };
    expect(() => check(withExtraService), extra).toThrow(/service/i);
  }
  expect(() => check(base, { ...env, NUXT_SECRETS_PROVIDER: 'or3-secrets' })).toThrow(/vault|secret/i);
});

// Failure inventory: losing an encryption key makes existing records
// unreadable; a stale source file can silently substitute a different key.
// An effective-only key is equally unsafe because adoption would drop it.
test('adoption retains supported application secrets and refuses secret drift', () => {
  const keys = [
    'OR3_BASIC_AUTH_JWT_SECRET', 'OR3_BASIC_AUTH_REFRESH_SECRET', 'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
    'OR3_AUTH_INVITE_TOKEN_SECRET', 'OR3_STORAGE_FS_TOKEN_SECRET', 'OR3_ADMIN_PASSWORD', 'OR3_ADMIN_JWT_SECRET',
    'NUXT_AUTH_INVITE_TOKEN_SECRET', 'NUXT_ADMIN_AUTH_JWT_SECRET',
    'OR3_LIBRARY_LINK_SECRET', 'NUXT_ADMIN_LIBRARY_LINK_SECRET',
    'OR3_PLUGIN_CONNECTION_SECRET', 'NUXT_ADMIN_PLUGIN_CONNECTION_SECRET',
    'OR3_BACKGROUND_ENCRYPTION_KEY', 'NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY',
    'OR3_WEBHOOKS_ENCRYPTION_KEY', 'NUXT_WEBHOOKS_ENCRYPTION_KEY',
    'OR3_CONNECT_ENCRYPTION_KEY', 'NUXT_CONNECT_ENCRYPTION_KEY',
    'OR3_CONNECT_CLOUDFLARE_API_TOKEN', 'NUXT_CONNECT_CLOUDFLARE_API_TOKEN',
    'OPENROUTER_API_KEY', 'NUXT_OPENROUTER_API_KEY', 'OR3_OPENAI_API_KEY', 'NUXT_OPENAI_API_KEY',
  ];
  const image = 'ghcr.io/saluana/or3-chat:0.1.94';
  const source: Record<string, string> = { AUTH_PROVIDER: 'basic-auth', OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_STORAGE_ENABLED: 'true', NUXT_SECRETS_PROVIDER: '', OR3_INSTANCE_ID: 'stable-instance' };
  const config = { services: { or3: { image, environment: { ...source, OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite', OR3_STORAGE_FS_ROOT: '/data/storage', OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions' } as Record<string, string>, ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }], volumes: [{ type: 'volume', source: 'data', target: '/data' }] } }, volumes: { data: { name: 'source-data' } } };
  for (const key of keys) {
    expect(deploymentEnvironment.ALLOWED_ENV_KEYS.has(key), key).toBe(true);
    const env = { ...source, [key]: 'fixture-private-value' };
    config.services.or3.environment[key] = env[key]!;
    expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, env, [image]), key).not.toThrow();
    config.services.or3.environment[key] = 'fixture-different-private-value';
    expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, env, [image]), key).toThrow(/drift/i);
    expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, source, [image]), key).toThrow(/drift/i);
    delete config.services.or3.environment[key];
    expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, env, [image]), key).toThrow(/drift/i);
  }
});

// Registry trust and stable acquisition identity must survive a relocation;
// a hostname-derived identity changes when the target container is created.
test('adoption retains registry configuration and requires stable acquisition identity', () => {
  const keys = ['OR3_MARKETPLACE_REGISTRY_ORIGIN', 'OR3_MARKETPLACE_INSTALL_ENABLED', 'OR3_MARKETPLACE_RELEASE_KEYS', 'OR3_INSTANCE_ID',
    'OR3_MARKETPLACE_MAX_ARTIFACT_BYTES', 'OR3_MARKETPLACE_RESERVE_BYTES',
    'OR3_BACKGROUND_STREAMING_ENABLED', 'OR3_BACKGROUND_STREAMING_PROVIDER', 'OR3_BACKGROUND_MAX_JOBS', 'OR3_BACKGROUND_MAX_JOBS_PER_USER', 'OR3_BACKGROUND_JOB_TIMEOUT',
    'NUXT_BACKGROUND_JOBS_ENABLED', 'NUXT_PUBLIC_BACKGROUND_STREAMING_ENABLED', 'NUXT_BACKGROUND_JOBS_STORAGE_PROVIDER', 'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS', 'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS_PER_USER', 'NUXT_BACKGROUND_JOBS_JOB_TIMEOUT_MS',
    'OR3_PLUGIN_ALLOWED_MODELS', 'OR3_PLUGIN_MODEL_PRICES', 'NUXT_ADMIN_PLUGIN_ALLOWED_MODELS', 'NUXT_ADMIN_PLUGIN_MODEL_PRICES',
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL', 'OR3_ADMIN_USERNAME', 'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS', 'OR3_SQLITE_STRICT', 'OR3_STORAGE_FS_URL_TTL_SECONDS', 'OR3_ADMIN_JWT_EXPIRY'];
  const image = 'ghcr.io/saluana/or3-chat:0.1.94';
  const source: Record<string, string> = { AUTH_PROVIDER: 'basic-auth', OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_STORAGE_ENABLED: 'true', NUXT_SECRETS_PROVIDER: '', OR3_INSTANCE_ID: 'stable-instance' };
  const config = { services: { or3: { image, environment: { ...source, OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite', OR3_STORAGE_FS_ROOT: '/data/storage', OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions' } as Record<string, string>, ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }], volumes: [{ type: 'volume', source: 'data', target: '/data' }] } }, volumes: { data: { name: 'source-data' } } };
  for (const key of keys) {
    expect(deploymentEnvironment.ALLOWED_ENV_KEYS.has(key), key).toBe(true);
    const env = { ...source, [key]: 'fixture-value' };
    config.services.or3.environment[key] = env[key]!;
    expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, env, [image]), key).not.toThrow();
    config.services.or3.environment[key] = 'different';
    expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, env, [image]), key).toThrow(/drift/i);
    if (key === 'OR3_INSTANCE_ID') config.services.or3.environment[key] = source.OR3_INSTANCE_ID!;
    else delete config.services.or3.environment[key];
  }
  const missing = { ...source }; delete missing.OR3_INSTANCE_ID; delete config.services.or3.environment.OR3_INSTANCE_ID;
  expect(() => assertSupportedSourceCompose(JSON.stringify(config), 'source-data', 3000, missing, [image])).toThrow(/identity/i);
});

// A stopped or running container can retain older environment and mounts even
// after its Compose files change. Inspection must reject that drift without
// printing credentials from the inspected environment.
test('adoption inspects existing source container custody and configuration', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'or3-adopt-container-')));
  try {
    const bin = join(directory, 'bin'); await mkdir(bin);
    await writeFile(join(directory, '.env'), 'OR3_FIXTURE=1\n');
    await writeFile(join(bin, 'docker'), `#!/usr/bin/env bun
const args=process.argv.slice(2);
if(args[0]==='compose') console.log(process.env.OR3_FIXTURE_CONTAINER === 'missing' ? '' : process.env.OR3_FIXTURE_CONTAINER || 'container');
else if(args[0]==='inspect') { const f=JSON.parse(process.env.FIXTURE_INSPECT); console.log(JSON.stringify(f.image)); console.log(JSON.stringify(f.env)); console.log(JSON.stringify(f.mounts)); console.log(JSON.stringify(f.labels)); if(args.join(' ').includes('.Config.Entrypoint')) { console.log(JSON.stringify(f.entrypoint)); console.log(JSON.stringify(f.cmd)); } if(args.join(' ').includes('.Config.WorkingDir')) console.log(JSON.stringify(f.cwd)); if(args.join(' ').includes('.HostConfig.ReadonlyRootfs')) console.log(JSON.stringify(f.readonly)); if(args.join(' ').includes('.HostConfig.Tmpfs')) console.log(JSON.stringify(f.tmpfs ?? null)); if(args.join(' ').includes('.HostConfig.Mounts')) console.log(JSON.stringify(f.hostMounts ?? null)); }
else if(args[0]==='image' && args[1]==='inspect') { console.log('sha256:matching'); if(args.join(' ').includes('.Config.Entrypoint')) { console.log(JSON.stringify(['/entrypoint'])); console.log(JSON.stringify(['serve'])); } if(args.join(' ').includes('.Config.WorkingDir')) { console.log(JSON.stringify('/app')); console.log(JSON.stringify([])); } }
else if(args[0]==='diff') process.stdout.write(JSON.parse(process.env.FIXTURE_INSPECT).diff || '');
else process.exit(1);
`, { mode: 0o755 });
    const source = { AUTH_PROVIDER: 'basic-auth', OR3_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false', SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_STORAGE_ENABLED: 'true', NUXT_SECRETS_PROVIDER: '', OR3_INSTANCE_ID: 'stable-instance' };
    const image = 'example.test/or3@sha256:' + 'a'.repeat(64);
    const config = { name: 'source', services: { or3: { image, environment: { ...source, OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite', OR3_STORAGE_FS_ROOT: '/data/storage', OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions' }, ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }], volumes: [{ type: 'volume', source: 'data', target: '/data' }] } }, volumes: { data: { name: 'source-data' } } };
    const inspected = { image: 'sha256:matching', env: Object.entries({ ...config.services.or3.environment, PRIVATE_TEST_SECRET: 'never-print-this-secret' }).map(([key, value]) => `${key}=${value}`), mounts: [{ Type: 'volume', Name: 'source-data', Destination: '/data' }], labels: { 'com.docker.compose.project': 'source', 'com.docker.compose.service': 'or3' }, entrypoint: ['/entrypoint'], cmd: ['serve'], cwd: '/app', readonly: true, diff: '' };
    const wrongEnv = structuredClone(inspected); wrongEnv.env.push('NITRO_SECRETS_PROVIDER=or3-secrets');
    const wrongMount = structuredClone(inspected); wrongMount.mounts[0]!.Name = 'foreign-data';
    const aliasMount = structuredClone(inspected); aliasMount.mounts[0]!.Name = 'data';
    const wrongLabel = structuredClone(inspected); wrongLabel.labels['com.docker.compose.project'] = 'foreign';
    const wrongImage = { ...inspected, image: 'sha256:foreign' };
    const codeMount = structuredClone(inspected); codeMount.mounts.push({ Type: 'bind', Name: '', Destination: '/app' });
    const wrongEntrypoint = { ...inspected, entrypoint: ['/custom'] };
    const wrongCommand = { ...inspected, cmd: ['custom'] };
    const wrongCwd = { ...inspected, cwd: '/data' };
    const preload = structuredClone(inspected); preload.env.push('NODE_OPTIONS=--require=/data/custom.cjs');
    const writable = { ...inspected, readonly: false };
    const changedCode = { ...inspected, diff: 'C /app/.output/server/index.mjs\n' };
    const hiddenTmpfs = { ...inspected, tmpfs: { '/data/storage': 'size=1m' } };
    const volumeSubpath = { ...inspected, hostMounts: [{ Type: 'volume', Target: '/data', VolumeOptions: { Subpath: 'other' } }] };
    const script = `import {assertSourceContainer} from ${JSON.stringify(join(import.meta.dir, '../src/deployment/adoption-source.ts'))}; await assertSourceContainer(process.cwd(), ['-f','compose.yaml'], process.env.FIXTURE_IMAGE, process.env.FIXTURE_CONFIG, 'source-data', 3000, JSON.parse(process.env.FIXTURE_SOURCE));`;
    for (const [input, expected, container] of [[inspected, 0, 'container'], [wrongEnv, 1, 'container'], [wrongMount, 1, 'container'], [aliasMount, 1, 'container'], [wrongLabel, 1, 'container'], [wrongImage, 1, 'container'], [codeMount, 1, 'container'], [wrongEntrypoint, 1, 'container'], [wrongCommand, 1, 'container'], [wrongCwd, 1, 'container'], [preload, 1, 'container'], [writable, 1, 'container'], [changedCode, 1, 'container'], [hiddenTmpfs, 1, 'container'], [volumeSubpath, 1, 'container'], [inspected, 1, 'missing'], [inspected, 1, 'first second']] as const) {
      await writeFile(join(directory, '.env'), `OR3_FIXTURE_CONTAINER='${container}'\n`);
      const child = Bun.spawn([process.execPath, '-e', script], { cwd: directory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_INSPECT: JSON.stringify(input), FIXTURE_IMAGE: image, FIXTURE_CONFIG: JSON.stringify(config), FIXTURE_SOURCE: JSON.stringify(source) }, stdout: 'pipe', stderr: 'pipe' });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, stderr).toBe(expected);
      expect(stdout + stderr).not.toContain('never-print-this-secret');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);

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

test('restore refuses an authentication or sync provider change before mutation', () => {
  const env = buildEnv({ mode: 'local', version: '0.1.12', directory: '/tmp/or3-profile-test', email: 'admin@example.com', password: 'AValidPassword123', port: 3000 });
  const state = stateFromEnv('/tmp/or3-profile-test', env, 'local', 'init', `sha256:${'a'.repeat(64)}`);
  const manifest = { schemaVersion: 1 as const, backupId: 'backup-test', appVersion: state.appVersion, image: state.image, mode: 'local' as const, deploymentId: state.deploymentId };
  expect(() => assertBackupMatchesDeployment(manifest, env, state, env)).not.toThrow();
  expect(() => assertBackupMatchesDeployment(manifest, { ...env, AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'clerk' }, state, env)).toThrow(/profile/i);
  expect(() => assertBackupMatchesDeployment(manifest, { ...env, OR3_SYNC_PROVIDER: 'convex' }, state, env)).toThrow(/profile/i);
  expect(() => assertBackupMatchesDeployment(manifest, { ...env, OR3_AUTH_PROVIDER: 'clerk' }, state, env)).toThrow(/profile/i);
});

test('restore keeps the current S3 destination and refuses profile or prefix drift', () => {
  const backup = { NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_KEY_PREFIX: 'uploads/', OR3_STORAGE_S3_BUCKET: 'source', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'old-secret', OR3_STORAGE_S3_SESSION_TOKEN: 'old-token', UNRELATED: 'saved' };
  const current = { NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_KEY_PREFIX: '/uploads', OR3_STORAGE_S3_BUCKET: 'target', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'new-secret' };
  expect(deploymentEnvironment.restoreStorageConfiguration(backup, current)).toEqual({ NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_STORAGE_S3_KEY_PREFIX: '/uploads', OR3_STORAGE_S3_BUCKET: 'target', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'new-secret', UNRELATED: 'saved' });
  expect(() => deploymentEnvironment.restoreStorageConfiguration(backup, { ...current, OR3_STORAGE_S3_KEY_PREFIX: 'other/' })).toThrow('backup-prefix-mismatch');
  expect(() => deploymentEnvironment.restoreStorageConfiguration(backup, { ...current, NUXT_PUBLIC_STORAGE_PROVIDER: 'fs' })).toThrow('backup-profile-mismatch');
  expect(deploymentEnvironment.restoreStorageConfiguration({ NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', UNRELATED: 'saved' }, { NUXT_PUBLIC_STORAGE_PROVIDER: 'fs' })).toEqual({ NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', UNRELATED: 'saved' });
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

// Adoption must not accept contradictory auth selectors and silently carry a
// different provider into a Basic Auth deployment. A single legacy selector
// and two agreeing selectors remain supported; absent or unknown auth refuses.
test('adoption requires all specified auth selectors to agree on Basic Auth', () => {
  const base = {
    OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false',
    OR3_SYNC_PROVIDER: 'sqlite', OR3_STORAGE_FS_ROOT: '/data/storage', NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'admin@example.com', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'AValidPassword123', OR3_VERSION: '0.1.94',
  };
  const providers = 'or3-provider-basic-auth/nuxt\nor3-provider-sqlite/nuxt\nor3-provider-fs/nuxt';
  const check = (auth: Record<string, string>) => assertSupportedSource('/tmp/v1', { ...base, ...auth }, providers);
  expect(() => check({ AUTH_PROVIDER: 'basic-auth' })).not.toThrow();
  expect(() => check({ OR3_AUTH_PROVIDER: 'basic-auth' })).not.toThrow();
  expect(() => check({ AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth' })).not.toThrow();
  for (const auth of [{}, { AUTH_PROVIDER: 'clerk' }, { AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'clerk' }, { AUTH_PROVIDER: 'clerk', OR3_AUTH_PROVIDER: 'basic-auth' }]) {
    expect(() => check(auth)).toThrow(/auth provider|basic auth/i);
  }
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

test('purge freshness rejects stale and future timestamps', () => {
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
  expect(() => assertPurgeBackupFreshness(
    [{ backupId: 'backup-future', createdAt: new Date(now + 60_000).toISOString() }],
    now,
  )).toThrow('backup newer than 24 hours');
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
    message: 'resetting', remoteReconcile: { uploaded: 2, markersCreated: 1 }, credentialReset: { nextEnv: { OR3_ADMIN_PASSWORD: 'AdminSecretPassword123', OR3_BASIC_AUTH_JWT_SECRET: 'jwt-secret-value', OR3_STORAGE_FS_TOKEN_SECRET: 'storage-secret' } },
  };
  state.lastError = 'OR3_ADMIN_PASSWORD=leaked-in-error';
  const serialized = JSON.stringify(publicStateProjection(state));
  expect(serialized).not.toContain('AdminSecretPassword123');
  expect(serialized).not.toContain('jwt-secret-value');
  expect(serialized).not.toContain('storage-secret');
  expect(serialized).not.toContain('leaked-in-error');
  expect(serialized).toContain('credentials-reset-1');
  expect(serialized).toContain('credentials-reset');
  expect(publicStateProjection(state).incompleteOperation?.remoteReconcile).toEqual({ uploaded: 2, markersCreated: 1 });
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

for (const scenario of ['coordinated', 'deferred', 'unexpected-503', 'metadata-failure', 'put-failure', 'commit-failure'] as const) {
  test(`verify cleans canonical probe metadata before physical deletion (${scenario})`, async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'or3-verify-retention-')));
    const events: string[] = [];
    let live = false;
    let bytes = new Uint8Array();
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const json = (body: unknown, status = 200) => Response.json(body, { status });
        if (path === '/') return new Response('synthetic application');
        if (path === '/api/health') return json({status:'ok',providers:{auth:{provider:'basic-auth'},sync:{provider:'sqlite'},storage:{provider:'fs'}}});
        if (path === '/api/basic-auth/sign-in') return Response.json({}, {headers:{'set-cookie':'session=synthetic; HttpOnly'}});
        if (path === '/api/auth/session') return json({session:{user:{email:'fixture@example.test'},workspace:{id:'synthetic-workspace'}}});
        if (path === '/api/sync/pull') return json({changes:[],nextCursor:0});
        if (path === '/api/storage/presign-upload') return json({storageId:'synthetic-probe',intentId:'synthetic-upload-intent',url:new URL('/upload',request.url).href,method:'PUT'});
        if (path === '/upload') { bytes = new Uint8Array(await request.arrayBuffer()); return json({}); }
        if (path === '/api/storage/commit') {
          const body = await request.json() as { intent_id?: string };
          if (body.intent_id !== 'synthetic-upload-intent') return json({statusMessage:'Invalid upload intent commit'},400);
          events.push('commit'); live = true; return scenario === 'commit-failure' ? json({statusMessage:'Synthetic commit response failure'},500) : json({}); }
        if (path === '/api/sync/push') {
          const body = await request.json() as {ops:{operation:string}[]};
          const operation = body.ops[0]!.operation;
          events.push(operation);
          if (scenario === 'metadata-failure' && operation === 'delete') return json({results:[{success:false}]});
          if (scenario === 'put-failure' && operation === 'put') return json({results:[{success:false}]});
          live = operation === 'put';
          return json({results:[{success:true}]});
        }
        if (path === '/api/storage/presign-download') return json({url:new URL('/download',request.url).href,method:'GET'});
        if (path === '/download') return new Response(bytes);
        if (path === '/api/storage/delete') {
          events.push('physical-delete');
          // Independent retention contract: physical deletion must never precede the tombstone.
          if (live) return json({statusMessage:'Cannot delete a retained file'},409);
          if (scenario === 'deferred') return json({statusMessage:'Provider-owned deletion coordination is required',stack:['synthetic detail '.repeat(100)]},503);
          if (scenario === 'unexpected-503') return json({statusMessage:'Synthetic unexpected failure'},503);
          return json({});
        }
        if (path === '/api/basic-auth/sign-out') { events.push('sign-out'); return json({}); }
        return json({statusMessage:'Unexpected fixture request'},500);
      },
    });
    try {
      const image = `ghcr.io/saluana/or3-chat@sha256:${'a'.repeat(64)}`;
      const env = buildEnv({mode:'local',version:'0.1.73',directory,image,email:'fixture@example.test',password:'Synthetic-fixture-password-123!',port:server.port!});
      const state = stateFromEnv(directory,env,'local','init',`sha256:${'a'.repeat(64)}`);
      await mkdir(join(directory,'.or3-cloud'));
      await writeFile(join(directory,'.env'),serializeEnv(env),{mode:0o600});
      await writeFile(join(directory,'.or3-cloud','state.json'),JSON.stringify(state),{mode:0o600});
      const bin = join(directory,'bin');
      await mkdir(bin);
      // Synthetic executable: allow only verification observations; never invoke real Docker.
      await writeFile(join(bin,'docker'),`#!/usr/bin/env bun
const args = process.argv.slice(2); const text = args.join(' ');
if (args[0] === 'info' || (args[0] === 'compose' && args[1] === 'version')) process.exit(0);
if (args[0] === 'image' && args[1] === 'inspect' && text.includes('.RepoDigests')) console.log(JSON.stringify([${JSON.stringify(image)}]));
else if (args[0] === 'compose' && args.includes('exec') && text.includes('quick_check')) console.log(JSON.stringify([{path:'auth.sqlite',quickCheck:'ok',tables:1},{path:'sync.sqlite',quickCheck:'ok',tables:1}]));
else if (args[0] === 'compose' && (args.includes('exec') || args.includes('logs'))) process.exit(0);
else { console.error('Fixture refused Docker operation'); process.exit(1); }
`,{mode:0o755});
      const child = Bun.spawn([process.execPath,join(import.meta.dir,'../src/cli.ts'),'verify'],{cwd:directory,env:{...process.env,PATH:`${bin}:${process.env.PATH}`},stdout:'pipe',stderr:'pipe'});
      const [exitCode,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
      expect(events,stdout+stderr).toContain('delete');
      expect(events.at(-1)).toBe('sign-out');
      if (scenario === 'metadata-failure') {
        expect(exitCode).toBe(1);
        expect(events).not.toContain('physical-delete');
        expect(stderr).toContain('metadata cleanup failed');
      } else {
        expect(events.indexOf('delete')).toBeLessThan(events.indexOf('physical-delete'));
        expect(live).toBe(false);
        expect(exitCode,stdout+stderr).toBe(scenario === 'unexpected-503' || scenario === 'put-failure' || scenario === 'commit-failure' ? 1 : 0);
        if (scenario === 'deferred') expect(stdout).toContain('physical cleanup deferred');
        if (scenario === 'unexpected-503') expect(stderr).toContain('Synthetic unexpected failure');
        if (scenario === 'put-failure') expect(stderr).toContain('metadata sync failed');
        if (scenario === 'commit-failure') expect(stderr).toContain('Synthetic commit response failure');
      }
    } finally {
      server.stop(true);
      await rm(directory,{recursive:true,force:true});
    }
  });
}
