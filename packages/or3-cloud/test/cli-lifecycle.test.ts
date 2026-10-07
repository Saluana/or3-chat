import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installedManagedAssetChecksums } from '../src/deployment/assets';
import { serializeEnv, parseEnv } from '../src/deployment/env';
import { PACKAGE_VERSION } from '../src/package-info';
import type { ManagedState } from '../src/deployment/contracts';
import { NEW_DIGEST, OLD_DIGEST, OLD_VERSION, REPOSITORY, createSandbox, sha256 } from './process-harness';
import type { Sandbox } from './process-harness';

type Pending = NonNullable<ManagedState['incompleteOperation']>;

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

const NEW_IMAGE = `${REPOSITORY}@${NEW_DIGEST}`;
const DESTRUCTIVE = /compose .* (stop|down|restart)\b|compose .* up\b|volume rm|tar xzf|find \/data|chown/;

async function fixtureState(fixture: Sandbox) {
  return {
    state: await fixture.readState(),
    env: parseEnv(await fixture.readEnvText()),
  };
}

/** The data archive the fake Docker streamed into backup `id`. */
async function backupDataSha(fixture: Sandbox, id: string) {
  return sha256(await readFile(join(fixture.cloud, 'backups', id, 'data.tgz')));
}

test('update replaces the release behind a verified snapshot and commits one terminal state', async () => {
  const fixture = await sandbox();
  const result = await fixture.cli(['update']);
  expect(result.exitCode, result.output).toBe(0);
  expect(result.stdout).toContain(`OR3 updated to ${PACKAGE_VERSION}. Image digest: ${NEW_DIGEST}`);
  const { state, env } = await fixtureState(fixture);
  expect(state).toMatchObject({ appVersion: PACKAGE_VERSION, image: NEW_IMAGE, imageDigest: NEW_DIGEST, lastSuccessfulOperation: 'update' });
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.lastError).toBeUndefined();
  expect(state.deploymentId).toBe(fixture.env.OR3_DEPLOYMENT_ID);
  expect(env).toMatchObject({ OR3_VERSION: PACKAGE_VERSION, OR3_IMAGE: NEW_IMAGE });
  const [snapshot] = await fixture.backupIds();
  expect(state.rollback).toMatchObject({ appVersion: OLD_VERSION, imageDigest: OLD_DIGEST, backupId: snapshot });
  expect(state.lastReceipt).toMatchObject({ rollbackBackupId: snapshot, operatorHandoff: 'not-required' });
  expect(state.lastReceipt!.operationId).toMatch(/^update-/);
  expect(state.lastReceipt!.checks.map((check) => check.code)).toEqual(expect.arrayContaining(['container-binding', 'database-integrity', 'public-health']));
  expect(JSON.parse(await readFile(join(fixture.cloud, 'last-operation.json'), 'utf8')).operationId).toBe(state.lastReceipt!.operationId);
  expect(existsSync(join(fixture.cloud, 'operations', `${state.lastReceipt!.operationId}.json`))).toBe(false);
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);
  // The snapshot is taken (service stopped, volume archived) before the target starts.
  const calls = (await fixture.trace()).map((args) => args.join(' '));
  const archived = calls.findIndex((call) => call.includes('tar czf'));
  const started = calls.findIndex((call) => /compose .* up -d/.test(call));
  expect(archived).toBeGreaterThan(-1);
  expect(started).toBeGreaterThan(archived);
});

test('update is a no-op for the installed version and refuses a version this CLI cannot install', async () => {
  const current = await sandbox({ version: PACKAGE_VERSION });
  const noop = await current.cli(['update']);
  expect(noop.exitCode, noop.output).toBe(0);
  expect(noop.stdout).toContain(`OR3 ${PACKAGE_VERSION} is already installed. Nothing to do.`);
  const json = await current.cli(['update', '--json']);
  expect(JSON.parse(json.stdout)).toMatchObject({ outcome: { kind: 'no-op', currentVersion: PACKAGE_VERSION } });
  expect(await current.backupIds()).toEqual([]);

  const other = await sandbox();
  const wrong = await other.cli(['update', '--to', '9.9.9']);
  expect(wrong.exitCode).toBe(1);
  expect(wrong.stderr).toContain(`This CLI contains deployment assets for OR3 ${PACKAGE_VERSION}`);
  expect(await other.backupIds()).toEqual([]);
  expect((await other.readState()).incompleteOperation).toBeUndefined();
});

test('update --json emits exactly one result object and sends progress to stderr', async () => {
  const fixture = await sandbox();
  const result = await fixture.cli(['update', '--json']);
  expect(result.exitCode, result.output).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed).toMatchObject({ schemaVersion: 1, kind: 'or3-operation-result', outcome: { kind: 'completed' } });
  expect(result.stderr).toContain(`OR3 updated to ${PACKAGE_VERSION}`);

  const blocked = await sandbox();
  await blocked.configure({ failures: [{ match: '.Config.Labels', message: 'fixture label failure' }] });
  const failure = await blocked.cli(['update', '--json']);
  expect(failure.exitCode).toBe(1);
  expect(JSON.parse(failure.stdout).outcome).toMatchObject({ kind: 'blocked', findings: [{ code: 'update-failed' }] });
});

test('an update refused before the journal opens changes nothing', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: '.Config.Labels', message: 'fixture label failure' }] });
  const before = await fixture.readStateText();
  const result = await fixture.cli(['update']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('fixture label failure');
  expect(await fixture.readStateText()).toBe(before);
  expect(await fixture.backupIds()).toEqual([]);
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});

test('a failure in the prepared phase is resumed without replacing anything', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'tar czf', message: 'fixture archive failure' }] });
  const failed = await fixture.cli(['update']);
  expect(failed.exitCode).toBe(1);
  let { state } = await fixtureState(fixture);
  expect(state.incompleteOperation).toMatchObject({ operation: 'update', phase: 'prepared', targetVersion: PACKAGE_VERSION });
  expect(state.lastError).toContain('fixture archive failure');
  expect(await fixture.backupIds()).toEqual([]);

  await fixture.configure({ failures: [] });
  const dryRun = JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout);
  expect(dryRun).toMatchObject({ phase: 'prepared', decision: { action: 'resume' }, dataLoss: false });

  const recovered = await fixture.cli(['recover']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  expect(recovered.stdout).toContain('Recovered the incomplete update before the replacement was applied');
  ({ state } = await fixtureState(fixture));
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.appVersion).toBe(OLD_VERSION);
  expect(state.lastError).toBeUndefined();
  expect((await fixtureState(fixture)).env.OR3_VERSION).toBe(OLD_VERSION);
  expect((await fixture.trace()).some((args) => args.join(' ').includes('tar xzf'))).toBe(false);
});

test('a failure in the snapshot-created phase is resumed without replacing anything', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'stat -c', message: 'fixture ownership probe failure' }] });
  const failed = await fixture.cli(['update']);
  expect(failed.exitCode).toBe(1);
  const { state } = await fixtureState(fixture);
  expect(state.incompleteOperation).toMatchObject({ phase: 'snapshot-created' });
  expect(state.incompleteOperation!.verifiedSnapshot!.backupId).toMatch(/^backup-/);
  const [snapshot] = await fixture.backupIds();
  expect(state.incompleteOperation!.backupId).toBe(snapshot);

  await fixture.configure({ failures: [] });
  expect(JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout)).toMatchObject({ phase: 'snapshot-created', decision: { action: 'resume' } });
  const recovered = await fixture.cli(['recover']);
  expect(recovered.exitCode, recovered.output).toBe(0);
  const after = await fixtureState(fixture);
  expect(after.state.incompleteOperation).toBeUndefined();
  expect(after.state.appVersion).toBe(OLD_VERSION);
  expect(after.env.OR3_VERSION).toBe(OLD_VERSION);
  expect(await fixture.backupIds()).toEqual([snapshot]);
});

test('a failure while replacing the target restores the verified snapshot and keeps the journal for confirmation', async () => {
  const fixture = await sandbox();
  // The first stop belongs to the snapshot; the second is the replacement.
  await fixture.configure({ failures: [{ match: ' stop or3', skip: 1, times: 1, message: 'fixture stop failure' }] });
  const failed = await fixture.cli(['update']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain(`Update to ${PACKAGE_VERSION} failed and was restored`);
  const { state, env } = await fixtureState(fixture);
  expect(state).toMatchObject({ appVersion: OLD_VERSION, imageDigest: OLD_DIGEST });
  expect(env).toMatchObject({ OR3_VERSION: OLD_VERSION, OR3_IMAGE: fixture.image });
  const [snapshot] = await fixture.backupIds();
  const extracted = (await fixture.traceEntries()).filter((entry) => entry.args.join(' ').includes('tar xzf'));
  expect(extracted.map((entry) => entry.stdinSha)).toEqual([`sha256:${await backupDataSha(fixture, snapshot)}`]);
  // Characterizes current behavior: the outer failure handler re-persists the
  // in-memory journal after the restoration commit, so the operator confirms
  // with an explicit (idempotent) restore rather than finding silent success.
  expect(state.incompleteOperation).toMatchObject({ operation: 'update', phase: 'restoring-previous', backupId: snapshot });
  expect(JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout)).toMatchObject({ decision: { action: 'require-explicit-restore', snapshotId: snapshot } });
  const confirmed = await fixture.cli(['recover', '--restore', '--yes']);
  expect(confirmed.exitCode, confirmed.output).toBe(0);
  expect((await fixture.readState()).incompleteOperation).toBeUndefined();
});

test('a failed automatic restoration leaves the restoring-previous phase for an explicit restore', async () => {
  const fixture = await sandbox();
  await fixture.configure({
    failures: [
      { match: ' stop or3', skip: 1, times: 1, message: 'fixture stop failure' },
      { match: 'tar xzf', message: 'fixture extraction failure' },
    ],
  });
  const failed = await fixture.cli(['update']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('automatic backup restoration also failed');
  const stuck = (await fixtureState(fixture)).state;
  expect(stuck.incompleteOperation).toMatchObject({ operation: 'update', phase: 'restoring-previous' });
  const journal = stuck.incompleteOperation!.id;
  expect(existsSync(join(fixture.cloud, 'operations', `${journal}.json`))).toBe(true);

  await fixture.configure({ failures: [] });
  const dryRun = JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout);
  expect(dryRun).toMatchObject({ phase: 'restoring-previous', decision: { action: 'require-explicit-restore' }, dataLoss: true });
  await fixture.reset();
  const refused = await fixture.cli(['recover']);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain('Nothing was changed');
  expect((await fixture.cli(['recover', '--restore'])).stderr).toContain('replaces live data');
  expect((await fixture.cli(['recover', '--finish'])).stderr).toContain('recover --finish is not admissible');
  expect(await fixture.readStateText()).toContain('"phase": "restoring-previous"');
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);

  const [snapshot] = await fixture.backupIds();
  const restored = await fixture.cli(['recover', '--restore', '--yes']);
  expect(restored.exitCode, restored.output).toBe(0);
  expect(restored.stdout).toContain(`Recovered the incomplete update by restoring pre-update snapshot ${snapshot}`);
  const after = await fixtureState(fixture);
  expect(after.state.incompleteOperation).toBeUndefined();
  expect(after.state.appVersion).toBe(OLD_VERSION);
  expect(after.state.lastError).toContain('Interrupted update was rolled back to pre-update snapshot');
  expect(after.env.OR3_VERSION).toBe(OLD_VERSION);
  expect(existsSync(join(fixture.cloud, 'operations', `${journal}.json`))).toBe(false);
  const archives = (await fixture.trace()).filter((args) => args.join(' ').includes('tar xzf'));
  expect(archives.length).toBeGreaterThan(0);
});

test('a target that starts but fails verification is never restored implicitly', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: ' up -d', times: 1, message: 'fixture target start failure' }] });
  const failed = await fixture.cli(['update']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('Writes may have been accepted, so the deployment was NOT restored automatically');
  const stuck = await fixtureState(fixture);
  expect(stuck.state.incompleteOperation).toMatchObject({ phase: 'starting-target', targetVersion: PACKAGE_VERSION });
  expect(stuck.env.OR3_VERSION).toBe(PACKAGE_VERSION);
  expect(stuck.state.appVersion).toBe(OLD_VERSION);

  // Every normal entry point refuses an ambiguous deployment.
  await fixture.configure({ failures: [] });
  for (const args of [['start'], ['restart'], ['update'], ['backup'], ['rollback', '--yes'], ['credentials', 'reset', '--yes']]) {
    const blocked = await fixture.cli(args);
    expect(blocked.exitCode, args.join(' ')).toBe(1);
    expect(blocked.stderr, args.join(' ')).toMatch(/incomplete update/);
  }
  const stop = await fixture.cli(['stop']);
  expect(stop.exitCode, stop.output).toBe(0);

  const dryRun = JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout);
  expect(dryRun).toMatchObject({ phase: 'starting-target', decision: { action: 'require-explicit-restore' }, dataLoss: true });
  const snapshotCalls = await fixture.trace();
  expect(snapshotCalls.length).toBeGreaterThan(0);
  const plain = await fixture.cli(['recover']);
  expect(plain.exitCode).toBe(1);
  expect(plain.stderr).toContain('may have replaced data and has no completion proof');

  const [snapshot] = await fixture.backupIds();
  const restored = await fixture.cli(['recover', '--restore', '--yes']);
  expect(restored.exitCode, restored.output).toBe(0);
  const after = await fixtureState(fixture);
  expect(after.state).toMatchObject({ appVersion: OLD_VERSION, imageDigest: OLD_DIGEST });
  expect(after.state.incompleteOperation).toBeUndefined();
  expect(after.env).toMatchObject({ OR3_VERSION: OLD_VERSION, OR3_IMAGE: fixture.image });
  const extracted = (await fixture.trace()).filter((args) => args.join(' ').includes('tar xzf'));
  expect(extracted).toHaveLength(1);
  expect((await fixture.cli(['status'])).stdout).toContain('Deep health: OK');
  expect(snapshot).toMatch(/^backup-/);
});

test('failed target checks keep the update recoverable instead of committing it', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'quick_check', message: 'fixture integrity failure' }] });
  const failed = await fixture.cli(['update']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('did not pass the required target checks (database-integrity)');
  expect((await fixture.readState()).incompleteOperation).toMatchObject({ phase: 'starting-target' });
  expect((await fixture.readState()).appVersion).toBe(OLD_VERSION);
});

test('recover --dry-run classifies every durable phase without mutating anything', async () => {
  const fixture = await sandbox();
  const base = await fixture.readState();
  const evidence = { checkedAt: new Date().toISOString(), deploymentId: 'd', deploymentRoot: fixture.directory, imageDigest: NEW_DIGEST, configurationSha256: 'c'.repeat(64), managedAssetSha256: {}, dataReplacementCompleted: true as const, checks: [] };
  const phases: Array<[Pending['phase'], Partial<Pending>, string, boolean]> = [
    ['prepared', {}, 'resume', false],
    ['snapshot-created', {}, 'resume', false],
    ['target-mutating', {}, 'require-explicit-restore', true],
    ['target-ready', { evidence, targetVersion: PACKAGE_VERSION, targetImage: NEW_IMAGE }, 'finish', false],
    ['target-ready', {}, 'require-explicit-restore', true],
    ['restoring-previous', {}, 'require-explicit-restore', true],
    ['starting-target', {}, 'require-explicit-restore', true],
    ['starting-previous', {}, 'require-explicit-restore', true],
  ];
  for (const [phase, extra, action, dataLoss] of phases) {
    await fixture.writeState({
      ...base,
      incompleteOperation: { id: `update-${phase}`, operation: 'update', startedAt: base.updatedAt, message: 'fixture', phase, backupId: 'backup-fixture', ...extra },
    });
    await fixture.reset();
    const stateBefore = await fixture.readStateText();
    const result = await fixture.cli(['recover', '--dry-run', '--json']);
    expect(result.exitCode, `${phase}: ${result.output}`).toBe(0);
    const preview = JSON.parse(result.stdout);
    expect(preview, phase).toMatchObject({ kind: 'or3-recover-preview', phase, operation: 'update', decision: { action }, dataLoss });
    expect(await fixture.readStateText()).toBe(stateBefore);
    expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
    expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);
  }
});

/** Writes a target-ready journal whose proof matches the live target. */
async function craftTargetReady(fixture: Sandbox, mutate: (evidence: NonNullable<Pending['evidence']>, pending: Pending) => void = () => undefined) {
  const backupId = (await fixture.cli(['backup'])).exitCode === 0 ? (await fixture.backupIds())[0] : '';
  const target = { ...parseEnv(await fixture.readEnvText()), OR3_VERSION: PACKAGE_VERSION, OR3_IMAGE: NEW_IMAGE };
  await writeFile(join(fixture.directory, '.env'), serializeEnv(target), { mode: 0o600 });
  await fixture.configure({ runningImage: NEW_IMAGE });
  await fixture.reset();
  const state = await fixture.readState();
  const manifest = JSON.parse(await readFile(join(fixture.cloud, 'backups', backupId, 'manifest.json'), 'utf8'));
  const pending: Pending = {
    id: 'update-target-ready',
    operation: 'update',
    startedAt: state.updatedAt,
    message: 'fixture update',
    phase: 'target-ready',
    targetVersion: PACKAGE_VERSION,
    targetImage: NEW_IMAGE,
    targetImageDigest: NEW_DIGEST,
    targetDeploymentId: fixture.env.OR3_DEPLOYMENT_ID,
    backupId,
    backupPath: join(fixture.cloud, 'backups', backupId),
    backupDataSha256: manifest.dataSha256,
    backupConfigSha256: manifest.configSha256,
    evidence: {
      checkedAt: new Date().toISOString(),
      deploymentId: fixture.env.OR3_DEPLOYMENT_ID,
      deploymentRoot: fixture.directory,
      containerId: 'c0ffee000001',
      imageDigest: NEW_DIGEST,
      configurationSha256: sha256(await readFile(join(fixture.directory, '.env'))),
      managedAssetSha256: await installedManagedAssetChecksums(fixture.directory, 'local'),
      dataReplacementCompleted: true,
      checks: [
        { code: 'container-binding', status: 'passed', detail: 'bound' },
        { code: 'database-integrity', status: 'passed', detail: 'ok' },
        { code: 'public-health', status: 'passed', detail: 'ok' },
      ],
    },
  };
  mutate(pending.evidence!, pending);
  state.incompleteOperation = pending;
  await fixture.writeState(state);
  return { backupId, pending };
}

test('recover --finish commits a proven target-ready update without restoring data', async () => {
  const fixture = await sandbox();
  const { backupId } = await craftTargetReady(fixture);
  expect(JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout)).toMatchObject({ decision: { action: 'finish' } });
  const finished = await fixture.cli(['recover', '--finish']);
  expect(finished.exitCode, finished.output).toBe(0);
  expect(finished.stdout).toContain(`Finished the recorded update as OR3 ${PACKAGE_VERSION}`);
  const { state, env } = await fixtureState(fixture);
  expect(state).toMatchObject({ appVersion: PACKAGE_VERSION, imageDigest: NEW_DIGEST, lastSuccessfulOperation: 'update' });
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.rollback).toMatchObject({ appVersion: OLD_VERSION, backupId });
  expect(state.lastReceipt).toMatchObject({ operationId: 'update-target-ready', rollbackBackupId: backupId });
  expect(env.OR3_VERSION).toBe(PACKAGE_VERSION);
  expect(await fixture.traceText()).not.toMatch(/tar xzf|find \/data|volume rm/);
});

const FINISH_DRIFT: Array<[string, (fixture: Sandbox) => Promise<void>, Parameters<typeof craftTargetReady>[1], string]> = [
  ['configuration changed', async (fixture) => { await writeFile(join(fixture.directory, '.env'), `${await fixture.readEnvText()}OR3_EXTRA='1'\n`); }, undefined, 'managed configuration changed after the target-ready milestone'],
  ['container replaced', async () => undefined, (evidence) => { evidence.containerId = 'deadbeef0000'; }, 'running target container no longer matches'],
  ['image digest differs', async () => undefined, (evidence) => { evidence.imageDigest = OLD_DIGEST; }, 'does not match the recorded target-ready proof'],
  ['asset changed', async () => undefined, (evidence) => { evidence.managedAssetSha256 = { 'compose.yaml': 'f'.repeat(64) }; }, 'Managed asset compose.yaml changed after the target-ready milestone'],
  ['missing integrity proof', async () => undefined, (evidence) => { evidence.checks = evidence.checks.filter((check) => check.code !== 'database-integrity'); }, 'missing database-integrity'],
  ['failed health proof', async () => undefined, (evidence) => { evidence.checks = evidence.checks.map((check) => (check.code === 'public-health' ? { ...check, status: 'failed' as const } : check)); }, 'missing public-health'],
  ['deployment identity differs', async () => undefined, (evidence) => { evidence.deploymentId = 'another-deployment'; }, 'deployment identity no longer matches'],
];
for (const [name, drift, mutate, message] of FINISH_DRIFT) {
  test(`recover --finish refuses when the proof drifted: ${name}`, async () => {
    const fixture = await sandbox();
    await craftTargetReady(fixture, mutate);
    await drift(fixture);
    const before = await fixture.readStateText();
    const result = await fixture.cli(['recover', '--finish']);
    expect(result.exitCode, result.output).toBe(1);
    expect(result.stderr).toContain(message);
    expect(await fixture.readStateText()).toBe(before);
    expect(await fixture.traceText()).not.toMatch(/tar xzf|find \/data|volume rm|compose .* stop/);
  });
}

test('an explicit restore overrides a target-ready journal', async () => {
  const fixture = await sandbox();
  await craftTargetReady(fixture);
  const restored = await fixture.cli(['recover', '--restore', '--yes']);
  expect(restored.exitCode, restored.output).toBe(0);
  const { state, env } = await fixtureState(fixture);
  expect(state).toMatchObject({ appVersion: OLD_VERSION, imageDigest: OLD_DIGEST });
  expect(state.incompleteOperation).toBeUndefined();
  expect(env.OR3_VERSION).toBe(OLD_VERSION);
});

test('recover does nothing when no operation is recorded', async () => {
  const fixture = await sandbox();
  const result = await fixture.cli(['recover']);
  expect(result.exitCode, result.output).toBe(0);
  expect(result.stdout).toContain('No incomplete OR3 Cloud operation is recorded.');
  const finish = await fixture.cli(['recover', '--finish']);
  expect(finish.exitCode).toBe(1);
  expect(finish.stderr).toContain('recover --finish requires an incomplete operation');
  const both = await fixture.cli(['recover', '--finish', '--restore', '--yes']);
  expect(both.stderr).toContain('Use either --finish or --restore, not both.');
  const dry = await fixture.cli(['recover', '--dry-run', '--restore', '--yes']);
  expect(dry.stderr).toContain('--dry-run cannot be combined');
});

test('restore replaces the data from a verified backup behind a pre-restore snapshot', async () => {
  const fixture = await sandbox();
  expect((await fixture.cli(['backup'])).exitCode).toBe(0);
  const [target] = await fixture.backupIds();
  await fixture.reset();
  const restored = await fixture.cli(['restore', target, '--yes']);
  expect(restored.exitCode, restored.output).toBe(0);
  expect(restored.stdout).toContain(`Restored ${target}.`);
  const ids = await fixture.backupIds();
  expect(ids).toHaveLength(2);
  const previous = ids.find((entry) => entry.startsWith('backup-before-restore'))!;
  expect(previous).toBeDefined();
  const { state } = await fixtureState(fixture);
  expect(state).toMatchObject({ lastSuccessfulOperation: 'restore', appVersion: OLD_VERSION });
  expect(state.incompleteOperation).toBeUndefined();
  const calls = await fixture.trace();
  const joined = calls.map((args) => args.join(' '));
  const snapshotted = joined.findIndex((call) => call.includes('tar czf'));
  const cleared = joined.findIndex((call) => call.includes('find /data -mindepth 1 -delete'));
  const extracted = calls.findIndex((args) => args.join(' ').includes('tar xzf'));
  expect(snapshotted).toBeGreaterThan(-1);
  expect(cleared).toBeGreaterThan(snapshotted);
  expect(extracted).toBeGreaterThan(cleared);
  const stdinSha = (JSON.parse((await readFile(join(fixture.root, 'trace.jsonl'), 'utf8')).split('\n').filter(Boolean)[extracted]) as { stdinSha: string }).stdinSha;
  expect(stdinSha).toBe(`sha256:${await backupDataSha(fixture, target)}`);
  expect(((await stat(join(fixture.directory, '.env'))).mode & 0o777)).toBe(0o600);
});

test('a failed target replacement during restore returns to the pre-restore snapshot', async () => {
  const fixture = await sandbox();
  expect((await fixture.cli(['backup'])).exitCode).toBe(0);
  const [target] = await fixture.backupIds();
  await fixture.configure({ failures: [{ match: 'tar xzf', times: 1, message: 'fixture extraction failure' }] });
  const failed = await fixture.cli(['restore', target, '--yes']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('failed and the pre-restore snapshot');
  const { state } = await fixtureState(fixture);
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.lastError).toContain('was restored: ');
  expect(state.lastError).toContain('fixture extraction failure');
  const extractions = (await fixture.trace()).filter((args) => args.join(' ').includes('tar xzf'));
  expect(extractions).toHaveLength(2);
});

test('a restore whose snapshot restoration also fails stays journaled and is recoverable', async () => {
  const fixture = await sandbox();
  expect((await fixture.cli(['backup'])).exitCode).toBe(0);
  const [target] = await fixture.backupIds();
  await fixture.configure({ failures: [{ match: 'tar xzf', message: 'fixture extraction failure' }] });
  const failed = await fixture.cli(['restore', target, '--yes']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('automatic restoration of the pre-restore snapshot also failed');
  const stuck = (await fixture.readState()).incompleteOperation!;
  expect(stuck).toMatchObject({ operation: 'restore', phase: 'restoring-previous' });
  expect(stuck.previousBackupId).toMatch(/^backup-before-restore/);

  await fixture.configure({ failures: [] });
  expect(JSON.parse((await fixture.cli(['recover', '--dry-run', '--json'])).stdout)).toMatchObject({ operation: 'restore', decision: { action: 'require-explicit-restore' } });
  const restored = await fixture.cli(['recover', '--restore', '--yes']);
  expect(restored.exitCode, restored.output).toBe(0);
  expect(restored.stdout).toContain(`pre-mutation snapshot ${stuck.previousBackupId}`);
  const { state } = await fixtureState(fixture);
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.lastError).toContain('Interrupted restore was rolled back to pre-mutation snapshot');
});

test('a restore that stops before data replacement restarts the original deployment', async () => {
  const fixture = await sandbox();
  expect((await fixture.cli(['backup'])).exitCode).toBe(0);
  const [target] = await fixture.backupIds();
  // The first archive is the pre-restore snapshot, before any replacement.
  await fixture.configure({ failures: [{ match: 'tar czf', times: 1, message: 'fixture snapshot failure' }] });
  const failed = await fixture.cli(['restore', target, '--yes']);
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('fixture snapshot failure');
  const { state } = await fixtureState(fixture);
  expect(state.incompleteOperation).toBeUndefined();
  expect(state.lastError).toContain('stopped before data replacement');
  expect((await fixture.trace()).some((args) => args.join(' ').includes('tar xzf'))).toBe(false);
  expect((await fixture.cli(['status'])).stdout).toContain('Deep health: OK');
});

test('rollback returns to the recorded pre-update snapshot and clears the rollback point', async () => {
  const fixture = await sandbox();
  expect((await fixture.cli(['update'])).exitCode).toBe(0);
  const updated = await fixtureState(fixture);
  expect(updated.state.rollback).toBeDefined();
  await fixture.reset();
  const rolledBack = await fixture.cli(['rollback', '--yes']);
  expect(rolledBack.exitCode, rolledBack.output).toBe(0);
  expect(rolledBack.stdout).toContain(`Rolled back to OR3 ${OLD_VERSION}`);
  const { state, env } = await fixtureState(fixture);
  expect(state).toMatchObject({ appVersion: OLD_VERSION, imageDigest: OLD_DIGEST, lastSuccessfulOperation: 'restore' });
  expect(state.rollback).toBeUndefined();
  expect(state.incompleteOperation).toBeUndefined();
  expect(env).toMatchObject({ OR3_VERSION: OLD_VERSION, OR3_IMAGE: fixture.image });
  expect((await fixture.backupIds()).some((entry) => entry.startsWith('backup-before-rollback'))).toBe(true);
});

test('rollback refuses without confirmation, without a rollback point, and for a drifted point', async () => {
  const fixture = await sandbox();
  const noConfirm = await fixture.cli(['rollback']);
  expect(noConfirm.stderr).toContain('Re-run with --yes');
  const noPoint = await fixture.cli(['rollback', '--yes']);
  expect(noPoint.exitCode).toBe(1);
  expect(noPoint.stderr).toContain('No immediate rollback point is recorded');

  expect((await fixture.cli(['backup'])).exitCode).toBe(0);
  const [id] = await fixture.backupIds();
  const state = await fixture.readState();
  state.rollback = { appVersion: '0.1.70', image: state.image, imageDigest: state.imageDigest, backupId: id, createdAt: new Date().toISOString() };
  await fixture.writeState(state);
  await fixture.reset();
  const drifted = await fixture.cli(['rollback', '--yes']);
  expect(drifted.exitCode).toBe(1);
  expect(drifted.stderr).toContain('no longer matches its recorded image/version');
  expect(await fixture.traceText()).not.toMatch(DESTRUCTIVE);
});
