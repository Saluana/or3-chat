import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { BackupManifest, ManagedState } from '../deployment/contracts';
import { imageAtDigest } from '../deployment/identity';
import { run } from '../runtime/command-runner';

/** Caller must zero the returned key when finished. */
export async function readVaultRecoveryKey(path: string) {
  if (!isAbsolute(path)) throw new Error('Vault recovery key path must be absolute.');
  const bytes = Buffer.alloc(32);
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await file.stat({ bigint: true });
    const pathBefore = await lstat(path, { bigint: true });
    const identity = (info: typeof before) => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
    if (!before.isFile() || !pathBefore.isFile() || pathBefore.isSymbolicLink() || before.nlink !== 1n || (before.mode & 0o777n) !== 0o600n || before.size !== 32n || typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid()) || identity(before) !== identity(pathBefore)) throw new Error('invalid custody');
    if ((await file.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length || identity(before) !== identity(await file.stat({ bigint: true })) || identity(before) !== identity(await lstat(path, { bigint: true }))) throw new Error('changed custody');
    return bytes;
  } catch {
    bytes.fill(0);
    throw new Error('Vault recovery key must be a stable, owner-only regular 32-byte file.');
  } finally { await file?.close(); }
}

/** Extract identity only from bytes matching the authenticated manifest hash. */
export async function readAuthenticatedVaultId(path: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid vault backup checksum.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    const identity = (info: typeof before) => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
    const pathInfo = await lstat(path, { bigint: true });
    if (!before.isFile() || !pathInfo.isFile() || pathInfo.isSymbolicLink() || before.nlink !== 1n || before.size < 113n || before.size > BigInt(2 ** 30 + 112) || identity(before) !== identity(pathInfo)) throw new Error('invalid vault backup');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), header = Buffer.alloc(96);
    let offset = 0;
    while (offset < Number(before.size)) {
      const count = (await file.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset)).bytesRead;
      if (count === 0) throw new Error('truncated vault backup');
      if (offset < header.length) buffer.copy(header, offset, 0, Math.min(count, header.length - offset));
      hash.update(buffer.subarray(0, count)); offset += count;
    }
    if (hash.digest('hex') !== expectedSha256 || identity(before) !== identity(await file.stat({ bigint: true })) || identity(before) !== identity(await lstat(path, { bigint: true }))) throw new Error('vault backup changed');
    const vaultId = header.subarray(8, 40).toString('latin1');
    if (!header.subarray(0, 8).equals(Buffer.from('OR3BAK01')) || !/^[a-f0-9]{32}$/.test(vaultId) || header.readBigUInt64BE(84) + 112n !== before.size || header.subarray(92, 96).some(byte => byte !== 0)) throw new Error('invalid vault header');
    return vaultId;
  } catch {
    throw new Error('Vault backup checksum, header, or file identity is invalid.');
  } finally { await file.close(); }
}

/** Only archived configuration can establish that custody was not required. */
export function backupHasVaultCoverage(manifest: BackupManifest, env: Record<string, string>, archivedConfig?: string) {
  if (Object.keys(env).some((key) => /^(?:RUNTIME_CONFIG|NUXT_SECRETS|NITRO_ENV_(?:PREFIX|EXPANSION)|NITRO_SECRETS(?:_.*)?)$/.test(key))) return false;
  const provider = env.NUXT_SECRETS_PROVIDER;
  // The published 0.1.90 binary predates vault support. Its digest and source
  // are recorded in @or3/cloud@0.1.90 (source 8cc6e0d3). Do not generalize this
  // exception to version ranges or similarly named, locally rebuilt images.
  if (provider === undefined && manifest.appVersion === '0.1.90'
    && manifest.image === 'ghcr.io/saluana/or3-chat:0.1.90'
    && manifest.imageDigest === 'sha256:d50b70d6522574798f1a3081894b5bf8fe9eca7aa5f183ad5a562de2e4f41c12'
    && archivedConfig !== undefined
    && createHash('sha256').update(archivedConfig).digest('hex') === manifest.configSha256) {
    // parseEnv intentionally tolerates malformed input and duplicate keys.
    // Absence is proof only for the simple, unique assignments written by the
    // historical managed CLI; reject ambiguous Compose syntax or expansion.
    const keys = new Set<string>();
    for (const line of archivedConfig.split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(text);
      if (!match || keys.has(match[1]!) || !/^(?:'[^'\r\n]*'|"[^"$\\\r\n]*"|[^'"$\\\s]*)$/.test(match[2]!)) return false;
      keys.add(match[1]!);
    }
    return !keys.has('NUXT_SECRETS_PROVIDER');
  }
  return provider === '' || ((provider === undefined || provider === 'or3-secrets') && Boolean(manifest.vaultSha256));
}

/** Check without mounting: Docker must not create lost custody while probing. */
export async function assertVaultVolumesExist(directory: string, state: ManagedState) {
  const dataVolume = `${state.volumeName}-vault-data`;
  const keyVolume = `${state.volumeName}-vault-key`;
  for (const volume of [dataVolume, keyVolume]) {
    const result = await run('docker', ['volume', 'inspect', volume], directory);
    if (!result.ok) throw new Error('Vault custody is missing or cannot be inspected. The operation is refused; preserve the encrypted backup and recover the vault key and volumes first.');
  }
}

// Until importing vault backups is implemented, restoring data may only use an
// already existing, intact vault. In particular Docker must not create absent
// volumes while probing, since an empty vault would lose the saved secrets.
export async function assertExistingVaultCustody(directory: string, state: ManagedState, manifest: BackupManifest, backupPath: string, backupEnv: Record<string, string>) {
  const archivedConfig = await readFile(join(backupPath, 'config.env'), 'utf8');
  if (!backupHasVaultCoverage(manifest, backupEnv, archivedConfig)) throw new Error('Backup lacks the vault archive required by its saved configuration. Preserve it and use a separately reviewed recovery procedure.');
  if (!manifest.vaultSha256) return;
  const expectedVaultId = await readAuthenticatedVaultId(join(backupPath, 'vault.backup'), manifest.vaultSha256);
  const dataVolume = `${state.volumeName}-vault-data`;
  const keyVolume = `${state.volumeName}-vault-key`;
  await assertVaultVolumesExist(directory, state);
  const script = `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
for (const path of ['/vault-data/live/complete','/vault-key/master.key','/vault-key/operator.token']) {
  const st = fs.lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== 1000 || (st.mode & 0o777) !== 0o600 || st.nlink !== 1 || st.size < 1) process.exit(1);
}
if (!/^[a-f0-9]{32}$/.test(fs.readFileSync('/vault-data/live/complete', 'utf8').trim())) process.exit(1);
// Never open the running vault database for maintenance. Copy a stable view to
// private tmpfs and verify that copy with the existing vault's master key.
const db = '/vault-data/live/vault.sqlite';
const journal = db + '-journal';
const identity = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
const journalIdentity = () => {
  let input;
  try { input = fs.openSync(journal, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (e) { if (e.code === 'ENOENT') return 'absent'; throw e; }
  try {
    const before = fs.fstatSync(input, { bigint: true });
    if (!before.isFile() || before.uid !== 1000n || (before.mode & 0o777n) !== 0o600n || before.nlink !== 1n) process.exit(1);
    if (before.size !== 0n) {
      if (before.size < 8n) process.exit(1);
      const header = Buffer.alloc(8);
      if (fs.readSync(input, header, 0, 8, 0) !== 8 || !header.every(byte => byte === 0)) process.exit(1);
    }
    if (identity(before) !== identity(fs.fstatSync(input, { bigint: true })) || identity(before) !== identity(fs.lstatSync(journal, { bigint: true }))) process.exit(1);
    return identity(before);
  } finally { fs.closeSync(input); }
};
const copy = (source, destination, maxSize) => {
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(input, { bigint: true });
    if (!before.isFile() || before.uid !== 1000n || (before.mode & 0o777n) !== 0o600n || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maxSize)) process.exit(1);
    const output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let remaining = Number(before.size);
      while (remaining > 0) {
        const n = fs.readSync(input, buffer, 0, Math.min(buffer.length, remaining), null);
        if (n === 0) process.exit(1);
        let offset = 0;
        while (offset < n) offset += fs.writeSync(output, buffer, offset, n - offset);
        remaining -= n;
      }
    } finally { fs.closeSync(output); }
    if (identity(before) !== identity(fs.fstatSync(input, { bigint: true })) || identity(before) !== identity(fs.lstatSync(source, { bigint: true }))) process.exit(1);
    return identity(before);
  } finally { fs.closeSync(input); }
};
const journalBefore = journalIdentity();
fs.mkdirSync('/scratch/vault', { mode: 0o700 });
const dbIdentity = copy(db, '/scratch/vault/vault.sqlite', 128 * 1024 * 1024);
const markerIdentity = copy('/vault-data/live/complete', '/scratch/vault/complete', 128);
const keyIdentity = copy('/vault-key/master.key', '/scratch/master.key', 4096);
if (fs.readFileSync('/scratch/vault/complete', 'utf8').trim() !== process.env.OR3_EXPECTED_VAULT_ID) process.exit(1);
if (journalIdentity() !== journalBefore) process.exit(1);
const audit = '/app/vault/cli.js audit verify'.split(' ');
const checked = spawnSync('/usr/local/bin/bun', ['--no-env-file', ...audit, '--vault-dir', '/scratch/vault', '--key-file', '/scratch/master.key'], { stdio: 'ignore', timeout: 120000 });
if (checked.status !== 0 || checked.error) process.exit(1);
if (journalIdentity() !== journalBefore) process.exit(1);
if (dbIdentity !== identity(fs.lstatSync(db, { bigint: true })) || markerIdentity !== identity(fs.lstatSync('/vault-data/live/complete', { bigint: true })) || keyIdentity !== identity(fs.lstatSync('/vault-key/master.key', { bigint: true }))) process.exit(1);
`;
  const name = `or3-vault-inspection-${randomUUID()}`;
  let failure: unknown;
  try {
    const result = await run('docker', [
    'run', '--rm', '--name', name, '--pull', 'never', '--log-driver', 'none', '--network', 'none', '--read-only', '--user', '1000:65532',
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
    '--memory', '256m', '--pids-limit', '32',
    '--tmpfs', '/scratch:rw,noexec,nosuid,nodev,size=192m,mode=700,uid=1000,gid=65532',
    '--env', `OR3_EXPECTED_VAULT_ID=${expectedVaultId}`,
    '--mount', `type=volume,src=${dataVolume},dst=/vault-data,readonly`,
    '--mount', `type=volume,src=${keyVolume},dst=/vault-key,readonly`,
    '--entrypoint', '/nodejs/bin/node', imageAtDigest(manifest.image, manifest.imageDigest), '-e', script,
    ], directory);
    if (!result.ok) throw new Error('Vault custody is empty, incomplete, or unreadable. Restore is refused; preserve the encrypted backup and recover the vault key and volumes first.');
  } catch (error) { failure = error; }
  const cleanup = await run('docker', ['rm', '--force', name], directory);
  if (!cleanup.ok && !/No such container/i.test(cleanup.stderr)) throw new AggregateError(failure ? [failure] : [], 'Vault custody inspection cleanup failed. Inspect the named helper before retrying.');
  if (failure) throw failure;
}
