import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { backupHasVaultCoverage } from '../src/backup/vault';
import { parseEnv } from '../src/deployment/env';
import type { BackupManifest } from '../src/deployment/contracts';

// Independent published identity from @or3/cloud@0.1.90's registry metadata.
const historical = {
  appVersion: '0.1.90', image: 'ghcr.io/saluana/or3-chat:0.1.90',
  imageDigest: 'sha256:d50b70d6522574798f1a3081894b5bf8fe9eca7aa5f183ad5a562de2e4f41c12',
};
const config = "OR3_VERSION='0.1.90'\nOR3_IMAGE='ghcr.io/saluana/or3-chat:0.1.90'\n";
function coverage(text: string, overrides: Partial<BackupManifest> = {}, authenticated = text) {
  const manifest = { ...historical, configSha256: createHash('sha256').update(authenticated).digest('hex'), ...overrides } as BackupManifest;
  return backupHasVaultCoverage(manifest, parseEnv(text), text);
}

test('authenticated published pre-vault backup can be restored without a vault archive', () => {
  expect(coverage(config)).toBe(true);
  expect(coverage(config, { imageDigest: `sha256:${'a'.repeat(64)}` })).toBe(false);
  expect(coverage(config, { appVersion: '0.1.91' })).toBe(false);
  expect(coverage(config, { image: 'custom-image:0.1.90' })).toBe(false);
  expect(coverage(config, {}, config + '# changed')).toBe(false);
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
])('ambiguous or overridden historical configuration refuses vault absence: %s', suffix => {
  expect(coverage(config + suffix)).toBe(false);
});
