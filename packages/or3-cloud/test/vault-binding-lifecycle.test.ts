import { expect, setDefaultTimeout, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeBackupAuthentication } from '../src/backup/manifests';
import { parseEnv, serializeEnv } from '../src/deployment/env';
import type { BackupManifest } from '../src/deployment/contracts';
import { createSandbox, sha256 } from './process-harness';

setDefaultTimeout(30_000);
const image = 'ghcr.io/saluana/or3-chat:0.1.90';
const imageDigest = 'sha256:d50b70d6522574798f1a3081894b5bf8fe9eca7aa5f183ad5a562de2e4f41c12';
const destructive = /compose .* (stop|down|restart)\b|compose .* up\b|volume rm|tar xzf|find \/data|chown/;

test.each(['runtime override', 'authenticated changed layout', 'tampered config', 'missing current vault', 'published layout'] as const)(
  'rollback evaluates historical snapshot with %s', async scenario => {
    const fixture = await createSandbox();
    try {
      const created = await fixture.cli(['backup']);
      expect(created.exitCode, created.output).toBe(0);
      const [backupId] = await fixture.backupIds();
      const path = join(fixture.cloud, 'backups', backupId!);
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as BackupManifest;
      const env = parseEnv(await readFile(join(path, 'config.env'), 'utf8'));
      env.OR3_VERSION = '0.1.90';
      env.OR3_IMAGE = image;
      if (scenario === 'runtime override') env.RUNTIME_CONFIG = '{}';
      const config = serializeEnv(env);
      const original = await readFile(new URL('./fixtures/historical-0.1.90/compose.yaml', import.meta.url));
      const compose = scenario === 'authenticated changed layout'
        ? Buffer.concat([original, Buffer.from('\n# modified\n')]) : original;
      await writeFile(join(path, 'config.env'), config);
      await writeFile(join(path, 'managed-assets', 'compose.yaml'), compose);
      manifest.appVersion = '0.1.90';
      manifest.image = image;
      manifest.imageDigest = imageDigest;
      manifest.configSha256 = sha256(config);
      manifest.managedAssetSha256!['compose.yaml'] = sha256(compose);
      delete manifest.vaultSha256;
      const contents = JSON.stringify(manifest);
      await writeFile(join(path, 'manifest.json'), contents);
      await writeBackupAuthentication(fixture.directory, path, contents);
      if (scenario === 'tampered config') await writeFile(join(path, 'config.env'), `${config}RUNTIME_CONFIG={}\n`);
      const state = await fixture.readState();
      state.rollback = { appVersion: manifest.appVersion, image, imageDigest, backupId: backupId!, createdAt: state.updatedAt };
      await fixture.writeState(state);
      await fixture.configure({
        digests: { default: fixture.state.imageDigest!, [image]: imageDigest },
        ...(scenario === 'missing current vault' ? { failures: [{ match: `volume inspect ${state.volumeName}-vault-data`, message: 'fixture missing vault' }] } : {}),
      });
      const before = await fixture.readStateText();
      await fixture.reset();
      const result = await fixture.cli(['rollback', '--yes']);
      if (scenario === 'published layout') {
        expect(result.exitCode, result.output).toBe(0);
        expect((await fixture.readState()).appVersion).toBe('0.1.90');
      } else {
        expect(result.exitCode, result.output).toBe(1);
        expect(result.stderr).toMatch(scenario === 'tampered config' ? /checksum/i : scenario === 'missing current vault' ? /vault/i : /vault archive/i);
        expect(await fixture.readStateText()).toBe(before);
        expect(await fixture.traceText()).not.toMatch(destructive);
      }
    } finally { await fixture.cleanup(); }
  },
);
