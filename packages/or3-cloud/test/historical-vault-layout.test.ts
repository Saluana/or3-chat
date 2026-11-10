import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readAuthenticatedBackupConfig } from '../src/backup/config';
import { backupHasVaultCoverage } from '../src/backup/vault';
import { buildEnv, serializeEnv, withoutProvisioningCredentials } from '../src/deployment/env';
import { managedAssetNamesForInventory } from '../src/deployment/assets';
import type { BackupManifest, Mode } from '../src/deployment/contracts';

// Published package @or3/cloud@0.1.90: SHA-512 integrity and image digests
// are recorded in registry metadata. Compressed fixtures expand to its assets.
const assetRoot = new URL('./fixtures/historical-0.1.90/', import.meta.url);
const image = 'ghcr.io/saluana/or3-chat:0.1.90';
const imageDigest = 'sha256:d50b70d6522574798f1a3081894b5bf8fe9eca7aa5f183ad5a562de2e4f41c12';
const operator = 'ghcr.io/saluana/or3-chat@sha256:7148fc08014a0a35c1bd211243c3cf7cecb4b25cce9ec0dac1ecd7e50a61121a';
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function fixture(mode: Mode, dashboard: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'or3-historical-layout-'));
  await mkdir(join(root, 'managed-assets'));
  const checksums: Record<string, string> = {};
  for (const name of managedAssetNamesForInventory(mode, 4)) {
    const compressed = name.endsWith('.mjs');
    const stored = await readFile(new URL(`${name}${compressed ? '.gz' : ''}`, assetRoot));
    const bytes = compressed ? gunzipSync(stored) : stored;
    checksums[name] = sha(bytes);
    await writeFile(join(root, 'managed-assets', name), bytes);
  }
  const env = withoutProvisioningCredentials(buildEnv({ mode, version: '0.1.90', image, directory: root,
    email: 'owner@example.test', password: 'fixture-password', port: 3197,
    ...(mode === 'public' ? { domain: 'cloud.example.test' } : {}),
    ...(dashboard ? { dashboardOperator: { OR3_DASHBOARD_UPDATES_ENABLED: 'true', OR3_OPERATOR_IMAGE: operator,
      OR3_DEPLOYMENT_DIR: root, OR3_OPERATOR_UID: '1000', OR3_OPERATOR_GID: '1000',
      OR3_DOCKER_SOCKET: '/var/run/docker.sock', OR3_DOCKER_GID: '998' } } : {}),
  }));
  const config = serializeEnv(env);
  await writeFile(join(root, 'config.env'), config);
  const manifest = { backupId: 'backup-fixture', appVersion: '0.1.90', image, imageDigest, mode,
    configSha256: sha(config), managedAssetSha256: checksums, managedAssetInventoryVersion: 4 } as BackupManifest;
  return { root, env, config, manifest, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test.each([
  ['public', false], ['local', true], ['public', true],
] as const)('published %s layout with dashboard=%s proves historical vault absence', async (mode, dashboard) => {
  const f = await fixture(mode, dashboard);
  try {
    expect(await backupHasVaultCoverage(f.manifest, f.config, f.root)).toBe(true);
    if (dashboard) {
      const wrongOperator = serializeEnv({ ...f.env, OR3_OPERATOR_IMAGE: `ghcr.io/saluana/or3-chat@sha256:${'f'.repeat(64)}` });
      expect(await backupHasVaultCoverage({ ...f.manifest, configSha256: sha(wrongOperator) }, wrongOperator, f.root)).toBe(false);
    }
    if (mode === 'public') {
      const wrongProfile = serializeEnv({ ...f.env, OR3_FORCE_HTTPS: 'false' });
      expect(await backupHasVaultCoverage({ ...f.manifest, configSha256: sha(wrongProfile) }, wrongProfile, f.root)).toBe(false);
    }
    const names = mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [];
    if (dashboard) names.push('compose.operator.yaml', 'dashboard-operator.mjs', 'dashboard-lifecycle.mjs');
    for (const name of names) {
      const path = join(f.root, 'managed-assets', name);
      const original = await readFile(path);
      const altered = Buffer.concat([original, Buffer.from('\n# modified\n')]);
      await writeFile(path, altered);
      const changed = { ...f.manifest, managedAssetSha256: { ...f.manifest.managedAssetSha256!, [name]: sha(altered) } };
      expect(await backupHasVaultCoverage(changed, f.config, f.root)).toBe(false);
      await writeFile(path, original);
    }
  } finally { await f.cleanup(); }
});

test('configuration snapshot contains the hashed bytes and rejects a later replacement', async () => {
  const f = await fixture('local', false);
  try {
    const captured = await readAuthenticatedBackupConfig(f.root, f.manifest);
    await writeFile(join(f.root, 'config.env'), `${f.config}RUNTIME_CONFIG={}\n`);
    expect(captured).toBe(f.config);
    await expect(readAuthenticatedBackupConfig(f.root, f.manifest)).rejects.toThrow(/checksum/i);
  } finally { await f.cleanup(); }
});

test('managed asset reader rejects bytes swapped after the checksum read', async () => {
  const f = await fixture('local', false);
  try {
    // Isolate the module mock in a child so no other tests inherit it. The old
    // stream-hash-then-read implementation returned the mocked second bytes.
    const code = `
      import { mock } from 'bun:test';
      import * as fs from 'node:fs/promises';
      const original = { ...fs };
      const [moduleUrl, file, root, manifest] = process.argv.slice(1);
      mock.module('node:fs/promises', () => ({ ...original, readFile: async (path, ...args) =>
        String(path) === file ? Buffer.from('changed after validation') : original.readFile(path, ...args) }));
      const { verifiedManagedAssetContents } = await import(moduleUrl);
      try { await verifiedManagedAssetContents(root, JSON.parse(manifest)); process.exit(2); }
      catch (error) { if (!String(error).includes('checksum mismatch')) { console.error(error); process.exit(3); } }
    `;
    const child = Bun.spawn([process.execPath, '-e', code, new URL('../src/deployment/assets.ts', import.meta.url).href,
      join(f.root, 'managed-assets', 'compose.yaml'), f.root, JSON.stringify(f.manifest)], { stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exitCode, stderr).toBe(0);
  } finally { await f.cleanup(); }
});
