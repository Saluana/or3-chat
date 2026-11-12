import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertExistingVaultCustody, backupHasVaultCoverage } from '../src/backup/vault';
import { buildEnv, serializeEnv, withoutProvisioningCredentials } from '../src/deployment/env';
import type { BackupManifest } from '../src/deployment/contracts';

// Identity and Compose bytes independently sourced from @or3/cloud@0.1.90.
const historical = {
  appVersion: '0.1.90', image: 'ghcr.io/saluana/or3-chat:0.1.90',
  imageDigest: 'sha256:d50b70d6522574798f1a3081894b5bf8fe9eca7aa5f183ad5a562de2e4f41c12',
};
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const baseEnv = withoutProvisioningCredentials(buildEnv({ mode: 'local', version: '0.1.90', image: historical.image,
  directory: '/tmp/or3-historical', email: 'fixture@example.test', password: 'fixture-password', port: 3197 }));
const config = serializeEnv(baseEnv);
let root: string;
let compose: Buffer;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'or3-vault-binding-'));
  compose = await readFile(new URL('./fixtures/historical-0.1.90/compose.yaml', import.meta.url));
  await mkdir(join(root, 'managed-assets'));
  await writeFile(join(root, 'managed-assets', 'compose.yaml'), compose);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
function manifest(text: string, overrides: Partial<BackupManifest> = {}) {
  return { ...historical, mode: 'local', configSha256: sha(text), managedAssetSha256: { 'compose.yaml': sha(compose) }, ...overrides } as BackupManifest;
}
async function coverage(text: string, overrides: Partial<BackupManifest> = {}, authenticated = text) {
  return await backupHasVaultCoverage(manifest(authenticated, overrides), text, root);
}

test('authenticated published pre-vault configuration and layout need no vault archive', async () => {
  expect(await coverage(config)).toBe(true);
  expect(await coverage(config, { imageDigest: `sha256:${'a'.repeat(64)}` })).toBe(false);
  expect(await coverage(config, { appVersion: '0.1.91' })).toBe(false);
  expect(await coverage(config, { image: 'custom-image:0.1.90' })).toBe(false);
  expect(await coverage(config, {}, config + '# changed')).toBe(false);
});

test('custody rejects a checksum-mismatched prior config snapshot', async () => {
  const signed = `${config}RUNTIME_CONFIG={}\n`;
  await writeFile(join(root, 'config.env'), signed);
  await expect(assertExistingVaultCustody(root, {} as never, manifest(signed), root, config)).rejects.toThrow(/vault archive/i);
});

test('a vault-free historical deployment does not require nonexistent current vault volumes', async () => {
  await writeFile(join(root, '.env'), config);
  await writeFile(join(root, 'compose.yaml'), compose);
  await expect(assertExistingVaultCustody(root, {} as never, manifest(config), root, config)).resolves.toBeUndefined();
});

test('explicit disabled mode works while a configured vault still requires its archive', async () => {
  expect(await coverage(serializeEnv({ ...baseEnv, NUXT_SECRETS_PROVIDER: '' }))).toBe(true);
  expect(await coverage(serializeEnv({ ...baseEnv, NUXT_SECRETS_PROVIDER: 'or3-secrets' }))).toBe(false);
});

test.each([
  'NUXT_SECRETS_PROVIDER=or3-secrets\n',
  'export NUXT_SECRETS_PROVIDER=or3-secrets\n',
  'NUXT_SECRETS_PROVIDER\n',
  'OTHER=one\nOTHER=two\n',
  'OTHER="unterminated\n',
  'OTHER=${NUXT_SECRETS_PROVIDER}\n',
  'RUNTIME_CONFIG={}\n',
  'NUXT_SECRETS={}\n',
  'NITRO_ENV_PREFIX=CUSTOM_\n',
  'NUXT_UNKNOWN_OVERRIDE=yes\n',
  '__proto__=hidden\n',
])('ambiguous or overridden historical configuration refuses vault absence: %s', async suffix => {
  expect(await coverage(config + suffix)).toBe(false);
});

test('an altered but checksummed historical Compose layout cannot prove vault absence', async () => {
  const altered = Buffer.concat([compose, Buffer.from('\n# changed layout\n')]);
  await writeFile(join(root, 'managed-assets', 'compose.yaml'), altered);
  try {
    expect(await coverage(config, { managedAssetSha256: { 'compose.yaml': sha(altered) } })).toBe(false);
  } finally { await writeFile(join(root, 'managed-assets', 'compose.yaml'), compose); }
});
