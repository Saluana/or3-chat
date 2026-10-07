import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_VERSION } from '../src/package-info';
import { createSandbox, deadPid, writeLease } from './process-harness';
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

const LEASE_REFUSAL = 'Another OR3 Cloud operation owns';
const DOCKER_MUTATIONS = /compose .* (up|stop|down|restart)\b|volume rm|tar xzf|find \/data/;

test('dispatch prints the version without touching the deployment', async () => {
  const fixture = await sandbox();
  for (const args of [['--version'], ['version']]) {
    const result = await fixture.cli(args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
  }
  expect(await fixture.trace()).toEqual([]);
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);
});

test('dispatch prints help for no command, help, --help, and any command --help', async () => {
  const fixture = await sandbox();
  for (const args of [[], ['help'], ['--help'], ['backup', '--help'], ['restore', '--help'], ['remove', '--help']]) {
    const result = await fixture.cli(args);
    expect(result.exitCode, `${args.join(' ')}: ${result.output}`).toBe(0);
    expect(result.stdout).toContain('OR3 Cloud — managed container installer and operator');
    expect(result.stdout).toContain('npx @or3/cloud remove [--purge-data --yes]');
  }
  expect(await fixture.trace()).toEqual([]);
});

test('dispatch rejects unknown commands, flags, and positionals before any lease or Docker request', async () => {
  const fixture = await sandbox();
  const cases: Array<[string[], string]> = [
    [['frobnicate'], 'Unknown command "frobnicate"'],
    [['frobnicate', '--help-me'], 'Unknown option for frobnicate: --help-me'],
    [['stop', '--bogus'], 'Unknown option for stop: --bogus'],
    [['remove', '--purge', '--yes'], 'Unknown option for remove: --purge'],
    [['remove', '--purge-all', '--force'], 'Unknown options for remove: --purge-all, --force'],
    [['status', '--public'], 'Unknown option for status: --public'],
    [['stop', 'extra'], 'stop accepts no positional arguments'],
    [['update', 'extra'], 'update accepts no positional arguments'],
    [['restore'], 'restore requires exactly one backup ID or absolute backup path'],
    [['restore', 'a', 'b'], 'restore requires exactly one backup ID or absolute backup path'],
    [['logs', 'a', 'b'], 'logs accepts at most one service name'],
    [['init', 'a', 'b', '--local'], 'init accepts at most one target directory'],
  ];
  for (const [args, message] of cases) {
    const result = await fixture.cli(args);
    expect(result.exitCode, args.join(' ')).toBe(1);
    expect(result.stderr, args.join(' ')).toContain(message);
    expect(result.stderr).toContain('OR3 Cloud failed:');
  }
  expect(await fixture.trace()).toEqual([]);
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);
});

// A switch given a value must never be read as "off" (which would turn a
// preview into a real operation), and must never swallow the next word.
test('switches reject a value and never consume the next word, before any lease or Docker request', async () => {
  const fixture = await sandbox();
  const cases: Array<[string[], string]> = [
    [['update', '--dry-run=true'], '--dry-run is a switch and does not take a value'],
    [['update', '--dry-run=false'], '--dry-run is a switch and does not take a value'],
    [['recover', '--dry-run=1'], '--dry-run is a switch and does not take a value'],
    [['verify', '--read-only=true'], '--read-only is a switch and does not take a value'],
    [['backup', '--json=true', 'list'], '--json is a switch and does not take a value'],
    [['update', '--dry-run', '0.1.76'], 'update accepts no positional arguments'],
    [['update', '--json', '0.1.76'], 'update accepts no positional arguments'],
  ];
  for (const [args, message] of cases) {
    const result = await fixture.cli(args);
    expect(result.exitCode, args.join(' ')).toBe(1);
    expect(result.stderr, args.join(' ')).toContain(message);
    expect(result.stderr).toContain('OR3 Cloud failed:');
  }
  expect(await fixture.trace()).toEqual([]);
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);

  // `--yes` before the backup ID leaves the ID positional instead of eating it.
  const restore = await fixture.cli(['restore', '--yes', 'no-such-backup']);
  expect(restore.exitCode).toBe(1);
  expect(restore.stderr).not.toContain('requires exactly one backup');
});

// Every command that mutates a deployment must hold the single-writer lease.
// A live foreign owner must be refused before Docker or state is touched.
const MUTATING_INVOCATIONS: string[][] = [
  ['stop'],
  ['start'],
  ['restart'],
  ['remove'],
  ['backup'],
  ['restore', 'backup-fixture', '--yes'],
  ['rollback', '--yes'],
  ['credentials', 'reset', '--yes'],
  ['update'],
  ['recover'],
  ['recover', '--finish'],
  ['verify'],
];
for (const args of MUTATING_INVOCATIONS) {
  test(`mutating "${args.join(' ')}" is refused while another operation owns the lease`, async () => {
    const fixture = await sandbox();
    const lease = await writeLease(fixture, { command: 'update' });
    const stateBefore = await fixture.readStateText();
    const result = await fixture.cli(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(LEASE_REFUSAL);
    expect(result.stderr).toContain('update (cli)');
    expect(await readFile(lease.owner, 'utf8')).toBe(lease.text);
    expect(await fixture.readStateText()).toBe(stateBefore);
    expect(await fixture.trace()).toEqual([]);
  });
}

// Read-only observations bypass the lease entirely: they must never acquire,
// reclaim, or rewrite it, even while another operation is active.
const LEASE_BYPASS_INVOCATIONS: string[][] = [
  ['backup', 'list'],
  ['backup', 'list', '--json'],
  ['update', '--dry-run'],
  ['recover', '--dry-run'],
  ['verify', '--read-only'],
  ['status'],
  ['status', '--json'],
  ['doctor'],
  ['logs'],
];
for (const args of LEASE_BYPASS_INVOCATIONS) {
  test(`read-only "${args.join(' ')}" bypasses a foreign lease without touching it`, async () => {
    const fixture = await sandbox();
    const lease = await writeLease(fixture, { command: 'update' });
    const stateBefore = await fixture.readStateText();
    const before = await stat(lease.owner);
    const result = await fixture.cli(args);
    expect(result.output).not.toContain(LEASE_REFUSAL);
    expect(await readFile(lease.owner, 'utf8')).toBe(lease.text);
    expect((await stat(lease.owner)).mtimeMs).toBe(before.mtimeMs);
    expect(existsSync(lease.lease)).toBe(true);
    expect(await fixture.readStateText()).toBe(stateBefore);
    expect(await fixture.traceText()).not.toMatch(DOCKER_MUTATIONS);
  });
}

test('read-only observations that can succeed do succeed under a foreign lease', async () => {
  const fixture = await sandbox();
  await writeLease(fixture);
  for (const args of [['backup', 'list'], ['recover', '--dry-run'], ['status'], ['update', '--dry-run']]) {
    const result = await fixture.cli(args);
    expect(result.exitCode, `${args.join(' ')}: ${result.output}`).toBe(args[0] === 'update' ? 1 : 0);
  }
  const preview = await fixture.cli(['update', '--dry-run', '--json']);
  expect(JSON.parse(preview.stdout).findings.some((finding: { code: string }) => finding.code === 'operation-in-progress')).toBe(true);
});

test('a mutating command acquires the lease for its whole run and releases it afterwards', async () => {
  const fixture = await sandbox();
  const lease = join(fixture.cloud, 'operation-lease');
  const result = await fixture.cli(['stop']);
  expect(result.exitCode, result.output).toBe(0);
  expect(existsSync(lease)).toBe(false);
  expect(await fixture.traceText()).toContain('stop or3');
});

test('the lease is released when a mutating command fails', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: ' stop or3', message: 'fixture stop failure' }] });
  const result = await fixture.cli(['stop']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('fixture stop failure');
  expect(existsSync(join(fixture.cloud, 'operation-lease'))).toBe(false);
});

test('a lease owned by a dead CLI process is reclaimed', async () => {
  const fixture = await sandbox();
  const lease = await writeLease(fixture, { pid: await deadPid() });
  const result = await fixture.cli(['stop']);
  expect(result.exitCode, result.output).toBe(0);
  expect(existsSync(lease.lease)).toBe(false);
  expect(await fixture.traceText()).toContain('stop or3');
});

test('a dashboard lease is reclaimed only after its heartbeat is stale and for the same job', async () => {
  const stale = new Date(Date.now() - 120_000).toISOString();
  const fresh = new Date().toISOString();
  const jobId = '123e4567-e89b-42d3-a456-426614174000';
  const otherJob = '223e4567-e89b-42d3-a456-426614174000';

  const live = await sandbox();
  const liveLease = await writeLease(live, { origin: 'dashboard', jobId, heartbeatAt: fresh });
  const refused = await live.cli(['stop'], { env: { OR3_DASHBOARD_UPDATE_JOB_ID: jobId } });
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain(LEASE_REFUSAL);
  expect(await readFile(liveLease.owner, 'utf8')).toBe(liveLease.text);

  const foreignJob = await sandbox();
  const foreignLease = await writeLease(foreignJob, { origin: 'dashboard', jobId, heartbeatAt: stale });
  const foreign = await foreignJob.cli(['stop'], { env: { OR3_DASHBOARD_UPDATE_JOB_ID: otherJob } });
  expect(foreign.exitCode).toBe(1);
  expect(foreign.stderr).toContain(LEASE_REFUSAL);
  expect(await readFile(foreignLease.owner, 'utf8')).toBe(foreignLease.text);

  const sameJob = await sandbox();
  const sameLease = await writeLease(sameJob, { origin: 'dashboard', jobId, heartbeatAt: stale });
  const reclaimed = await sameJob.cli(['stop'], { env: { OR3_DASHBOARD_UPDATE_JOB_ID: jobId } });
  expect(reclaimed.exitCode, reclaimed.output).toBe(0);
  expect(existsSync(sameLease.lease)).toBe(false);

  const host = await sandbox();
  const hostLease = await writeLease(host, { origin: 'dashboard', jobId, heartbeatAt: stale });
  const hostReclaim = await host.cli(['stop']);
  expect(hostReclaim.exitCode, hostReclaim.output).toBe(0);
  expect(existsSync(hostLease.lease)).toBe(false);
});

test('an unreadable lease owner record is never reclaimed', async () => {
  const fixture = await sandbox();
  const lease = await writeLease(fixture, { raw: '{not json' });
  const result = await fixture.cli(['stop']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`${LEASE_REFUSAL}`);
  expect(result.stderr).toContain('an unreadable owner record');
  expect(await readFile(lease.owner, 'utf8')).toBe('{not json');
  expect(await fixture.trace()).toEqual([]);
});

test('init and adopt acquire the lease on the directory they will create', async () => {
  const fixture = await sandbox();
  const target = join(fixture.root, 'fresh-target');
  await mkdir(join(target, '.or3-cloud', 'operation-lease'), { recursive: true });
  const owner = join(target, '.or3-cloud', 'operation-lease', 'owner.json');
  await writeFile(owner, `${JSON.stringify({
    schemaVersion: 1, nonce: 'n', command: 'init', origin: 'cli', pid: process.pid,
    acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(),
  })}\n`);
  const init = await fixture.cli(['init', target, '--local', '--admin-email', 'owner@example.test'], { cwd: fixture.root });
  expect(init.exitCode).toBe(1);
  expect(init.stderr).toContain(`${LEASE_REFUSAL} ${target}`);
  const adopt = await fixture.cli(['adopt', target, '--from', fixture.directory], { cwd: fixture.root });
  expect(adopt.exitCode).toBe(1);
  expect(adopt.stderr).toContain(`${LEASE_REFUSAL} ${target}`);
  expect(await fixture.trace()).toEqual([]);
});

test('status reports healthy, degraded, and unreachable deployments', async () => {
  const fixture = await sandbox();
  const healthy = await fixture.cli(['status']);
  expect(healthy.exitCode, healthy.output).toBe(0);
  expect(healthy.stdout).toContain('Deep health: OK');
  expect(healthy.stdout).toContain('image: digest matches managed state');

  await fixture.configure({ healthy: false });
  const degraded = await fixture.cli(['status']);
  expect(degraded.exitCode).toBe(0);
  expect(degraded.stdout).toContain('Deep health: DEGRADED');

  await fixture.configure({ healthy: true, running: false });
  await fixture.reset();
  const unreachable = await fixture.cli(['status']);
  expect(unreachable.exitCode).toBe(0);
  expect(unreachable.stdout).toContain('Deep health: unreachable');

  const json = await fixture.cli(['status', '--json']);
  const parsed = JSON.parse(json.stdout);
  expect(parsed.kind).toBe('or3-deployment-status');
  expect(parsed.docker).toBe(true);
  expect(parsed.state.appVersion).toBe('0.1.74');
  expect(JSON.stringify(parsed)).not.toContain('OR3_ADMIN_JWT_SECRET');
});

test('status degrades gracefully when Docker is unavailable or a probe fails', async () => {
  const fixture = await sandbox();
  await fixture.configure({ failures: [{ match: 'info', message: 'Cannot connect to the Docker daemon' }] });
  const unavailable = await fixture.cli(['status']);
  expect(unavailable.exitCode).toBe(0);
  expect(unavailable.stdout).toContain('Docker is unavailable; container and health checks were skipped.');

  await fixture.configure({ failures: [{ match: ' ps', message: 'compose ps exploded' }] });
  const failing = await fixture.cli(['status']);
  expect(failing.exitCode).toBe(0);
  expect(failing.stdout).toContain('Could not list containers');
});
