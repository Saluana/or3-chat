import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_VERSION, packagedSourceRevision } from '../src/package-info';
import { parseEnv, serializeEnv } from '../src/deployment/env';
import { createSandbox, deadPid, NEW_DIGEST, REPOSITORY, writeLease } from './process-harness';
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

// Drive the real command against synthetic Docker and sign-in responses. The
// archive and extraction are fakes: this checks orchestration and protected
// configuration, not preservation or use of real application data.
test.each(['source-stop', 'target-start', 'none'] as const)('adoption handles configuration and orchestration with %s', async (failure) => {
  const fixture = await sandbox();
  const source = join(fixture.root, 'source'); const target = join(fixture.root, 'adopted');
  await mkdir(source);
  const app = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/basic-auth/sign-in' || path === '/api/admin/auth/login') return Response.json({}, { headers: { 'set-cookie': 'fixture=session; Path=/' } });
    if (path === '/api/auth/session') return Response.json({ session: { user: { email: 'owner@example.test' }, workspace: { id: 'fixture-workspace' } } });
    return Response.json({});
  } });
  const image = `${REPOSITORY}:${PACKAGE_VERSION}`;
  const sourceEnv = {
    AUTH_PROVIDER: 'basic-auth', OR3_AUTH_PROVIDER: 'basic-auth', OR3_SYNC_PROVIDER: 'sqlite',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs', OR3_AUTH_REGISTRATION_MODE: 'invite_only', OR3_AUTH_AUTO_PROVISION: 'false',
    SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_STORAGE_ENABLED: 'true', NUXT_SECRETS_PROVIDER: '',
    OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite', OR3_STORAGE_FS_ROOT: '/data/storage',
    OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions', OR3_INSTANCE_ID: 'stable-fixture',
    OR3_VERSION: PACKAGE_VERSION, OR3_IMAGE: image, OR3_PORT: String(app.port),
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'owner@example.test', OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'Fixture-password-123!',
    OR3_ADMIN_USERNAME: 'owner', OR3_ADMIN_PASSWORD: 'Fixture-admin-123!',
    OR3_LIBRARY_LINK_SECRET: 'fixture-library-private', NUXT_ADMIN_PLUGIN_CONNECTION_SECRET: 'fixture-plugin-private',
    NUXT_AUTH_INVITE_TOKEN_SECRET: 'fixture-invite-private', OR3_MARKETPLACE_REGISTRY_ORIGIN: 'https://market.example.test',
    OR3_MARKETPLACE_INSTALL_ENABLED: 'true', OR3_MARKETPLACE_RELEASE_KEYS: 'fixture-public-keys',
    OR3_BACKGROUND_STREAMING_ENABLED: 'true', OR3_PLUGIN_ALLOWED_MODELS: 'example/model',
  };
  await writeFile(join(source, '.env'), serializeEnv(sourceEnv), { mode: 0o600 });
  await writeFile(join(source, 'or3-release.json'), JSON.stringify({ or3Version: PACKAGE_VERSION }));
  await writeFile(join(source, 'or3.providers.generated.ts'), ['or3-provider-basic-auth/nuxt', 'or3-provider-sqlite/nuxt', 'or3-provider-fs/nuxt'].join('\n'));
  await writeFile(join(source, 'compose.yaml'), 'fixture\n');
  const resolved = { name: 'source', services: { or3: { image, environment: sourceEnv, ports: [{ target: 3000, published: app.port, host_ip: '127.0.0.1', protocol: 'tcp' }], volumes: [{ type: 'volume', source: 'data', target: '/data' }] } }, volumes: { data: { name: 'source-data' } } };
  const fakeConfig = join(fixture.root, 'adoption-docker.json');
  const trace = join(fixture.root, 'adoption-trace.jsonl');
  await writeFile(fakeConfig, JSON.stringify({ env: sourceEnv, config: resolved, repo: REPOSITORY, digest: NEW_DIGEST, version: PACKAGE_VERSION, revision: packagedSourceRevision(PACKAGE_VERSION) ?? '1'.repeat(40), failure, source, target, trace }), { mode: 0o600 });
  await writeFile(join(fixture.root, 'bin', 'docker'), `#!/usr/bin/env bun
import {appendFileSync,readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const f=JSON.parse(readFileSync(${JSON.stringify(fakeConfig)},'utf8')), a=process.argv.slice(2), s=a.join(' '), env=f.env;
appendFileSync(f.trace,JSON.stringify(a)+'\\n');
const targetEnv=()=>Object.fromEntries(readFileSync(f.target+'/.env','utf8').split('\\n').map(x=>x.match(/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'$/)).filter(Boolean).map(m=>[m[1],m[2]]));
if(a[0]==='info') console.log(s.includes('.Architecture') ? 'arm64' : 'fixture');
else if(a[0]==='network' || a[0]==='ps' || a[0]==='diff') {}
else if(a[0]==='context') console.log('tcp://fixture');
else if(a[0]==='volume' && a[1]==='ls') console.log('source-data');
else if(a[0]==='volume' && a[1]==='inspect') {
  if(s.includes('{{.Name}}')) console.log(a[2]);
  else if(s.includes('.Labels')) {const e=targetEnv(); console.log(JSON.stringify({'com.docker.compose.project':e.OR3_COMPOSE_PROJECT,'com.docker.compose.volume':'or3-data','io.or3.cloud.deployment-id':e.OR3_DEPLOYMENT_ID}));}
  else { console.error('Error: No such volume'); process.exit(1); }
}
else if(a[0]==='run') { if(s.includes('tar czf')) process.stdout.write(gzipSync(Buffer.from('fixture-data'))); }
else if(a[0]==='image' && a[1]==='inspect') {
  if(s.includes('.RepoDigests')) console.log(JSON.stringify([f.repo+'@'+f.digest]));
  else if(s.includes('.Architecture')) console.log('arm64');
  else if(s.includes('.Config.Labels')) console.log(JSON.stringify({'org.opencontainers.image.source':'https://github.com/Saluana/or3-chat','org.opencontainers.image.version':f.version,'org.opencontainers.image.revision':f.revision}));
  else if(s.includes('.Config.Entrypoint')) { console.log('sha256:fixture'); console.log(JSON.stringify(['/entrypoint'])); console.log(JSON.stringify(['serve'])); console.log(JSON.stringify('/app')); console.log('[]'); }
  else console.log('[]');
} else if(a[0]==='inspect') {
  if(s.includes('com.docker.compose.project') && !s.includes('.Mounts')) console.log('source');
  else if(s.includes('{{.Image}}')) console.log('sha256:fixture');
  else if(s.includes('.State')) console.log('{}');
  else { for(const x of ['sha256:fixture',Object.entries(env).map(([k,v])=>k+'='+v),[{Type:'volume',Name:'source-data',Destination:'/data'}],{'com.docker.compose.project':'source','com.docker.compose.service':'or3'},['/entrypoint'],['serve'],'/app',true,null,null]) console.log(JSON.stringify(x)); }
} else if(a[0]==='compose' && a[1]==='version') console.log('Docker Compose v2');
else if(a[0]==='compose' && s.includes(' config ')) { if(a[a.indexOf('--project-directory')+1]===f.source) console.log(JSON.stringify(f.config)); else {const e=targetEnv(), labels={'io.or3.cloud.deployment-id':e.OR3_DEPLOYMENT_ID}; console.log(JSON.stringify({name:e.OR3_COMPOSE_PROJECT,services:{or3:{image:e.OR3_IMAGE,labels,ports:[{target:3000,published:Number(e.OR3_PORT),host_ip:'127.0.0.1',protocol:'tcp'}],volumes:[{type:'volume',source:'data',target:'/data'}]}},volumes:{data:{name:e.OR3_VOLUME_NAME,labels}}}));} }
else if(a[0]==='compose' && s.includes(' ps ')) { if(s.includes('-aq') || s.includes(' ps -q ') || (f.failure==='target-start' && s.includes('--status running'))) console.log('container'); }
else if(a[0]==='compose' && s.endsWith(' stop')) { if(f.failure==='source-stop'){ console.error('fixture source stop failure'); process.exit(1); } }
else if(a[0]==='compose' && s.includes(' up ')) { if(f.failure==='target-start'){ console.error('fixture target start failure'); process.exit(1); } }
else if(a[0]==='compose' && (s.includes(' exec ') || s.includes(' stop '))) {}
else if(a[0]==='compose' && (s.includes(' logs ') || s.endsWith(' start'))) {}
else if(a[0]==='compose' && s.endsWith(' down')) {}
else { console.error('fixture unsupported docker operation'); process.exit(1); }
`, { mode: 0o755 });
  const result = await fixture.cli(['adopt', target, '--from', source], { cwd: fixture.root }).finally(() => app.stop(true));
  expect(result.exitCode, result.output).toBe(failure === 'none' ? 0 : 1);
  if (failure !== 'none') expect(result.stderr).toContain(failure === 'source-stop' ? 'fixture source stop failure' : 'fixture target start failure');
  const targetEnv = parseEnv(await readFile(join(target, '.env'), 'utf8'));
  for (const key of ['OR3_LIBRARY_LINK_SECRET', 'NUXT_ADMIN_PLUGIN_CONNECTION_SECRET', 'NUXT_AUTH_INVITE_TOKEN_SECRET', 'OR3_MARKETPLACE_REGISTRY_ORIGIN', 'OR3_MARKETPLACE_INSTALL_ENABLED', 'OR3_MARKETPLACE_RELEASE_KEYS', 'OR3_INSTANCE_ID', 'OR3_BACKGROUND_STREAMING_ENABLED', 'OR3_PLUGIN_ALLOWED_MODELS'] as const) {
    expect(targetEnv[key], key).toBe(sourceEnv[key]);
    if (key.includes('SECRET')) expect(result.output).not.toContain(sourceEnv[key]);
  }
  expect((await stat(join(target, '.env'))).mode & 0o777).toBe(0o600);
  if (failure === 'target-start') {
    expect(result.stderr).toContain('target may contain new writes');
    const calls = (await readFile(trace, 'utf8')).trim().split('\n').map((line) => (JSON.parse(line) as string[]).join(' '));
    const up = calls.findIndex((call) => /compose .* up /.test(call));
    expect(up).toBeGreaterThan(-1);
    expect(calls.slice(up + 1).join('\n')).not.toMatch(/compose .* (down|start)\b/);
    const state = JSON.parse(await readFile(join(target, '.or3-cloud', 'state.json'), 'utf8'));
    expect(state.incompleteOperation).toMatchObject({ operation: 'adopt', phase: 'target-mutating' });
  } else if (failure === 'none') {
    const state = JSON.parse(await readFile(join(target, '.or3-cloud', 'state.json'), 'utf8'));
    expect(state.incompleteOperation).toBeUndefined();
    expect(targetEnv.OR3_ADMIN_PASSWORD).toBeUndefined();
    expect(await readFile(join(source, '.env'), 'utf8')).toBe(serializeEnv(sourceEnv));
  }
});

// Fresh deployments must not reuse any pre-existing vault volume: data/key
// collisions could attach another vault, while run/client collisions can carry
// another deployment's socket or token. Docker errors other than explicit
// not-found are also not evidence that a volume is free.
test.each(['vault-data', 'vault-key', 'vault-run', 'vault-client'] as const)('init refuses a pre-existing %s volume before writing deployment files', async (suffix) => {
  const fixture = await sandbox();
  const name = 'fresh-custody';
  const target = join(fixture.root, name);
  const index = ['vault-data', 'vault-key', 'vault-run', 'vault-client'].indexOf(suffix);
  await fixture.configure({ failures: [{ match: `volume inspect ${name}-or3-data`, times: index + 1, message: 'Error: No such volume' }] });
  await fixture.reset();
  const result = await fixture.cli(['init', target, '--local', '--port', '39741'], { cwd: fixture.root });
  expect(result.exitCode, result.output).toBe(1);
  expect(result.stderr).toContain(`${name}-or3-data-${suffix} already exists`);
  expect(await fixture.traceText()).not.toMatch(DOCKER_MUTATIONS);
  expect(existsSync(join(target, '.env'))).toBe(false);
});

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
