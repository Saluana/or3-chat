import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox, sha256 } from './process-harness';
import type { Sandbox } from './process-harness';

// Each test drives several real CLI processes.
setDefaultTimeout(30_000);

const sandboxes: Sandbox[] = [];
async function sandbox(options?: Parameters<typeof createSandbox>[0]) {
  const created = await createSandbox(options);
  sandboxes.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((entry) => entry.cleanup()));
});

const DESTRUCTIVE = /compose .* (stop|down|restart)\b|compose .* up\b|volume rm|tar xzf|find \/data|chown/;

async function createBackup(fixture: Sandbox) {
  const before = await fixture.backupIds();
  const result = await fixture.cli(['backup']);
  expect(result.exitCode, result.output).toBe(0);
  const created = (await fixture.backupIds()).filter((entry) => !before.includes(entry));
  expect(created).toHaveLength(1);
  return created[0];
}

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
  const stopped = calls.findIndex((call) => /compose .* stop or3$/.test(call));
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

test('export copies a verified backup, records a receipt, and refuses unsafe destinations', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const destination = join(fixture.root, 'exported');
  const exported = await fixture.cli(['backup', 'export', id, destination]);
  expect(exported.exitCode, exported.output).toBe(0);
  expect(exported.stdout).toContain('same filesystem as the deployment and cannot authorize `remove --purge-data`');
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
  expect(result.stderr).toContain('Re-run with --purge-data --yes');
  expect(await fixture.trace()).toEqual([]);
  expect(existsSync(join(fixture.directory, '.env'))).toBe(true);
});

test('purge refuses without a recent backup, without an export, and with a same-filesystem export', async () => {
  const fixture = await sandbox();
  await writeFile(join(fixture.directory, 'user-notes.txt'), 'keep me');
  const noBackup = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(noBackup.exitCode).toBe(1);
  expect(noBackup.stderr).toContain('No backup newer than 24 hours exists');

  const id = await createBackup(fixture);
  await fixture.reset();
  const noExport = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(noExport.exitCode).toBe(1);
  expect(noExport.stderr).toContain('No fresh checksum-verified backup export on another filesystem is available');

  const sameDevice = join(fixture.root, 'same-device-export');
  expect((await fixture.cli(['backup', 'export', id, sameDevice])).exitCode).toBe(0);
  await fixture.reset();
  const sameFs = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(sameFs.exitCode).toBe(1);
  expect(sameFs.stderr).toContain('No fresh checksum-verified backup export on another filesystem is available');

  // A receipt copied by hand cannot manufacture a different device.
  const receiptPath = join(fixture.cloud, 'exports', `${id}.json`);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await writeFile(receiptPath, JSON.stringify({ ...receipt, destinationDevice: receipt.destinationDevice + 1 }));
  const forgedDevice = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(forgedDevice.exitCode).toBe(1);
  expect(forgedDevice.stderr).toContain('No fresh checksum-verified backup export on another filesystem is available');

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
  const result = await fixture.cli(['remove', '--purge-data', '--yes']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('No backup newer than 24 hours exists');
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

const crossDevice = test.skipIf(!otherFs);

crossDevice('purge removes exactly the managed volume and files once an export is verified on another filesystem', async () => {
  const fixture = await sandbox();
  await writeFile(join(fixture.directory, 'user-notes.txt'), 'keep me');
  const id = await createBackup(fixture);
  const destination = join(otherFs!, `or3-export-${process.pid}-${Date.now()}`);
  try {
    const exported = await fixture.cli(['backup', 'export', id, destination]);
    expect(exported.exitCode, exported.output).toBe(0);
    expect(exported.stdout).toContain('Verified export recorded');
    await fixture.reset();
    const purged = await fixture.cli(['remove', '--purge-data', '--yes']);
    expect(purged.exitCode, purged.output).toBe(0);
    const calls = await fixture.trace();
    const joined = calls.map((args) => args.join(' '));
    expect(joined.findIndex((call) => /compose .* down$/.test(call))).toBeGreaterThan(-1);
    expect(calls.filter((args) => args[0] === 'volume' && args[1] === 'rm')).toEqual([['volume', 'rm', fixture.env.OR3_VOLUME_NAME]]);
    for (const removed of ['.env', '.or3-cloud', 'compose.yaml', 'compose.operator.yaml', 'dashboard-operator.mjs']) {
      expect(existsSync(join(fixture.directory, removed)), removed).toBe(false);
    }
    expect(await readFile(join(fixture.directory, 'user-notes.txt'), 'utf8')).toBe('keep me');
    expect(existsSync(join(destination, 'manifest.json'))).toBe(true);
    expect(purged.stdout).toContain(`docker volume ${fixture.env.OR3_VOLUME_NAME}`);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

crossDevice('a public purge removes the Caddy volumes recorded in state and nothing else', async () => {
  const fixture = await sandbox({ mode: 'public' });
  const id = await createBackup(fixture);
  const destination = join(otherFs!, `or3-export-public-${process.pid}-${Date.now()}`);
  try {
    expect((await fixture.cli(['backup', 'export', id, destination])).exitCode).toBe(0);
    await fixture.reset();
    const purged = await fixture.cli(['remove', '--purge-data', '--yes']);
    expect(purged.exitCode, purged.output).toBe(0);
    const removed = (await fixture.trace()).filter((args) => args[0] === 'volume' && args[1] === 'rm').map((args) => args[2]);
    expect(removed).toEqual([fixture.state.volumeName, fixture.state.caddyDataVolume, fixture.state.caddyConfigVolume]);
    for (const file of ['compose.public.yaml', 'Caddyfile']) expect(existsSync(join(fixture.directory, file))).toBe(false);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

crossDevice('purge revalidates the export immediately before deletion', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const destination = join(otherFs!, `or3-export-revalidate-${process.pid}-${Date.now()}`);
  try {
    expect((await fixture.cli(['backup', 'export', id, destination])).exitCode).toBe(0);
    await fixture.reset();
    // The export disappears while the stack is being stopped: the first check
    // passed, the second must refuse before any volume or file is deleted.
    await fixture.configure({ failures: [{ match: ' down', removeOnMatch: destination }] });
    const purged = await fixture.cli(['remove', '--purge-data', '--yes']);
    expect(purged.exitCode).toBe(1);
    expect(purged.stderr).toContain('No fresh checksum-verified backup export on another filesystem is available');
    const calls = (await fixture.trace()).map((args) => args.join(' '));
    expect(calls.some((call) => /compose .* down$/.test(call))).toBe(true);
    expect(calls.some((call) => call.includes('volume rm'))).toBe(false);
    for (const file of ['.env', '.or3-cloud', 'compose.yaml']) expect(existsSync(join(fixture.directory, file)), file).toBe(true);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

crossDevice('a tampered export on another filesystem cannot authorize a purge', async () => {
  const fixture = await sandbox();
  const id = await createBackup(fixture);
  const destination = join(otherFs!, `or3-export-tamper-${process.pid}-${Date.now()}`);
  try {
    expect((await fixture.cli(['backup', 'export', id, destination])).exitCode).toBe(0);
    await appendFile(join(destination, 'data.tgz'), 'tampered');
    await fixture.reset();
    const purged = await fixture.cli(['remove', '--purge-data', '--yes']);
    expect(purged.exitCode).toBe(1);
    expect(purged.stderr).toContain('No fresh checksum-verified backup export on another filesystem is available');
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect((await readdir(fixture.directory)).includes('.env')).toBe(true);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
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

import { createBackup as captureBackup } from '../src/backup/create';
import { backupCommand } from '../src/commands/backup';
import { recoverCommand } from '../src/commands/recover';
import { lifecycleFaults } from '../src/lifecycle-faults';
import { streamCommandToFile } from '../src/runtime/command-runner';
import type { BackupProgress } from '../src/deployment/contracts';

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
async function recordUnclaimedBackup(fixture: Sandbox, backupId: string) {
  const state = await fixture.readState();
  state.incompleteOperation = {
    id: 'backup-operation-fixture', operation: 'backup', startedAt: state.updatedAt,
    message: 'Preflight: preparing a stopped-volume backup', phase: 'prepared',
    backupId, backupPath: join(fixture.cloud, 'backups', backupId), initialAppRunning: true,
    backupProgress: { stage: 'preflight', service: 'running', artifact: 'not-created', message: 'Preflight' },
  };
  await fixture.writeState(state);
}

test('recovery reports the retained directory from a crash before ownership was journaled', async () => {
  const fixture = await sandbox();
  const id = 'backup-crash-window';
  const path = join(fixture.cloud, 'backups', id);
  await recordUnclaimedBackup(fixture, id);
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
