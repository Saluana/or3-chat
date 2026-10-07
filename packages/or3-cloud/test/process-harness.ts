// Shared harness for process-level OR3 Cloud tests: a real CLI process driven
// against a managed-deployment fixture and a scripted stand-in for `docker`.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyAssets } from '../src/deployment/assets';
import { buildEnv, serializeEnv, withoutProvisioningCredentials } from '../src/deployment/env';
import { stateFromEnv } from '../src/deployment/state-store';
import type { ManagedState } from '../src/deployment/contracts';

export const CLI_ENTRY = join(import.meta.dir, '../src/cli.ts');
/** Set to a built dist/cli.mjs to qualify the shipped bundle under Node instead of the TypeScript entry. */
const BUNDLE_ENTRY = process.env.OR3_CLOUD_TEST_CLI;
const CLI_COMMAND = BUNDLE_ENTRY ? ['node', BUNDLE_ENTRY] : [process.execPath, CLI_ENTRY];
export const OLD_VERSION = '0.1.74';
export const OLD_DIGEST = `sha256:${'a'.repeat(64)}`;
export const NEW_DIGEST = `sha256:${'b'.repeat(64)}`;
export const REPOSITORY = 'ghcr.io/saluana/or3-chat';

export type FakeDockerRule = {
  /** Substring of the space-joined Docker arguments. */
  match: string;
  /** Matches that pass through before the failure begins. */
  skip?: number;
  /** Number of failing matches; unlimited when omitted. */
  times?: number;
  message?: string;
  /** Directory removed when the rule matches, before the command succeeds. */
  removeOnMatch?: string;
};

export type FakeDockerConfig = {
  failures: FakeDockerRule[];
  running: boolean;
  healthy: boolean;
  runningImage: string;
  digests: Record<string, string>;
  maintenance?: unknown;
};

const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = __ROOT__;
const args = process.argv.slice(2);
const joined = args.join(' ');
const config = JSON.parse(readFileSync(root + '/config.json', 'utf8'));
const stateFile = root + '/state.json';
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { running: config.running, runningImage: config.runningImage, counters: {}, ids: {} };
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const sha = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const stdin = args.includes('-i') ? Buffer.from(await Bun.stdin.bytes()) : null;
appendFileSync(root + '/trace.jsonl', JSON.stringify({ args, stdinSha: stdin ? sha(stdin) : undefined }) + '\n');
const out = (text) => process.stdout.write(String(text) + '\n');
const fail = (message, code = 1) => { process.stderr.write(message + '\n'); process.exit(code); };

for (const [index, rule] of (config.failures ?? []).entries()) {
  if (!joined.includes(rule.match)) continue;
  const seen = state.counters[index] ?? 0;
  state.counters[index] = seen + 1;
  save();
  const skip = rule.skip ?? 0;
  if (seen < skip || (rule.times !== undefined && seen >= skip + rule.times)) continue;
  if (rule.removeOnMatch) { rmSync(rule.removeOnMatch, { recursive: true, force: true }); continue; }
  fail(rule.message ?? 'Fixture injected failure', 1);
}

const last = args.at(-1);
const repoOf = (ref) => {
  const base = ref.split('@', 1)[0];
  const slash = base.lastIndexOf('/');
  const colon = base.lastIndexOf(':');
  return colon > slash ? base.slice(0, colon) : base;
};
const digestOf = (ref) => ref.match(/@(sha256:[0-9a-f]{64})$/)?.[1] ?? config.digests[ref] ?? config.digests.default;
const idOf = (ref) => { const id = sha('image:' + ref); state.ids[id] = ref; save(); return id; };
const refOf = (value) => state.ids[value] ?? value;
const readEnv = (path) => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
  .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean)
  .map((match) => [match[1], match[2].replace(/^'(.*)'$/s, '$1').replace(/\\(['\\])/g, '$1')]));
const labels = { 'org.opencontainers.image.source': 'https://github.com/Saluana/or3-chat' };
const volumeLabels = () => config.volumeLabels ?? {};

if (args[0] === 'info') { out(joined.includes('.Architecture') ? 'aarch64' : 'fixture'); process.exit(0); }
if (args[0] === 'compose' && args[1] === 'version') { out('Docker Compose version v2'); process.exit(0); }
if (args[0] === 'context') { out('unix:///var/run/docker.sock'); process.exit(0); }
if (args[0] === 'pull') process.exit(0);
if (args[0] === 'network' || (args[0] === 'ps' && args.includes('-aq'))) process.exit(0);
if (args[0] === 'rm') process.exit(0);
if (args[0] === 'manifest') { out(JSON.stringify({ manifests: [{ platform: { architecture: 'arm64' } }] })); process.exit(0); }

if (args[0] === 'image' && args[1] === 'inspect') {
  const ref = refOf(last);
  if (joined.includes('.RepoDigests')) out(JSON.stringify([repoOf(ref) + '@' + digestOf(ref)]));
  else if (joined.includes('.Config.Labels')) {
    out(JSON.stringify({ ...labels, 'org.opencontainers.image.version': ref.match(/:(\d+\.\d+\.\d+)$/)?.[1] ?? config.version, 'org.opencontainers.image.revision': '1'.repeat(40) }));
  } else if (joined.includes('.Architecture')) out('arm64');
  else if (joined.includes('{{.Id}}')) out(idOf(ref));
  else out('[]');
  process.exit(0);
}

if (args[0] === 'inspect') {
  if (joined.includes('{{.Image}}')) out(idOf(state.runningImage));
  else out('{"Status":"running"}');
  process.exit(0);
}

if (args[0] === 'volume') {
  if (args[1] === 'rm') process.exit(0);
  const name = args[2];
  const meta = { Name: name, Labels: volumeLabels()[name] ?? config.volumeLabels?.default };
  if (joined.includes('{{.Name}}')) out(name);
  else if (joined.includes('json .Labels')) out(JSON.stringify(meta.Labels ?? null));
  else out(JSON.stringify(meta));
  process.exit(0);
}

const containerScript = () => {
  if (joined.includes('stat -c')) return out('65532:65532');
  if (joined.includes('du -sb')) return out('1000\t/data');
  if (joined.includes('df -Pk')) return out('1000000');
  if (joined.includes('tar czf')) return process.stdout.write(gzipSync(Buffer.from('fixture archive bytes')));
  if (joined.includes('quick_check')) return out(JSON.stringify([{ path: 'auth.sqlite', quickCheck: 'ok', tables: 1 }, { path: 'sync.sqlite', quickCheck: 'ok', tables: 1 }]));
  if (joined.includes('accessSync')) {
    if (state.running && config.healthy) return;
    fail('fixture application is not healthy');
  }
  if (joined.includes('maintenance') && joined.includes('fetch')) return config.maintenance ? out(JSON.stringify(config.maintenance)) : undefined;
  if (joined.includes('OR3_RESET_OWNER_PASSWORD')) return out('credentials-reset: fixture');
};

if (args[0] === 'run') { containerScript(); process.exit(0); }

if (args[0] === 'compose') {
  let index = 1;
  while (['--project-name', '--project-directory', '--env-file', '-f'].includes(args[index])) index += 2;
  const sub = args[index];
  const rest = args.slice(index + 1);
  const envFile = args[args.indexOf('--env-file') + 1];
  if (sub === 'config') {
    const env = readEnv(envFile);
    const label = { 'io.or3.cloud.deployment-id': env.OR3_DEPLOYMENT_ID };
    out(JSON.stringify({
      name: env.OR3_COMPOSE_PROJECT,
      services: { or3: { image: env.OR3_IMAGE, labels: label, ports: [{ target: 3000, published: Number(env.OR3_PORT), host_ip: '127.0.0.1', protocol: 'tcp' }], volumes: [{ type: 'volume', source: 'or3-data', target: '/data' }] } },
      volumes: { 'or3-data': { name: env.OR3_VOLUME_NAME, labels: label } },
    }));
  } else if (sub === 'up') { state.running = true; state.runningImage = readEnv(envFile).OR3_IMAGE; save(); }
  else if (sub === 'restart') { state.running = true; save(); }
  else if (sub === 'stop' || sub === 'down') { state.running = false; save(); }
  else if (sub === 'ps') {
    if (rest.includes('-aq')) out('c0ffee000001');
    else if (rest.includes('-q')) { if (state.running) out('c0ffee000001'); }
    else out('NAME STATUS\nor3 ' + (state.running ? 'running' : 'exited'));
  } else if (sub === 'logs') out('fixture log line');
  else if (sub === 'exec' || sub === 'run') containerScript();
  else if (sub !== 'rm') fail('Fixture refused Docker Compose operation: ' + joined);
  process.exit(0);
}

fail('Fixture refused Docker operation: ' + joined);
`;

export type Sandbox = {
  root: string;
  directory: string;
  cloud: string;
  env: Record<string, string>;
  state: ManagedState;
  image: string;
  configure(patch: Partial<FakeDockerConfig>): Promise<void>;
  reset(): Promise<void>;
  trace(): Promise<string[][]>;
  traceEntries(): Promise<Array<{ args: string[]; stdinSha?: string }>>;
  traceText(): Promise<string>;
  cli(args: string[], options?: CliOptions): Promise<CliResult>;
  readState(): Promise<ManagedState>;
  readStateText(): Promise<string>;
  writeState(state: ManagedState): Promise<void>;
  readEnvText(): Promise<string>;
  backupIds(): Promise<string[]>;
  cleanup(): Promise<void>;
};

export type CliOptions = { env?: Record<string, string | undefined>; cwd?: string };
export type CliResult = { exitCode: number; stdout: string; stderr: string; output: string };

async function runProcess(command: string[], options: { cwd: string; env: Record<string, string> }): Promise<CliResult> {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code: number | null) => resolveRun({ exitCode: code ?? 1, stdout, stderr, output: `${stdout}${stderr}` }));
  });
}

export async function createSandbox(options: { version?: string; mode?: 'local' | 'public'; postInstall?: boolean } = {}): Promise<Sandbox> {
  const version = options.version ?? OLD_VERSION;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'or3-process-')));
  const directory = join(root, 'deploy');
  const cloud = join(directory, '.or3-cloud');
  const bin = join(root, 'bin');
  await mkdir(join(cloud, 'backups'), { recursive: true, mode: 0o700 });
  await mkdir(bin);
  const image = `${REPOSITORY}@${OLD_DIGEST}`;
  const mode = options.mode ?? 'local';
  let env = buildEnv({
    mode,
    version,
    directory,
    image,
    email: 'owner@example.test',
    password: 'Fixture-password-123!',
    port: 3197,
    ...(mode === 'public' ? { domain: 'cloud.example.test' } : {}),
  });
  if (options.postInstall !== false) env = withoutProvisioningCredentials(env);
  const state = stateFromEnv(directory, env, mode, 'init', OLD_DIGEST);
  await copyAssets(directory, mode);
  await writeFile(join(directory, '.env'), serializeEnv(env), { mode: 0o600 });
  await writeFile(join(cloud, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(cloud, 'backup-auth.key'), `${'ab'.repeat(32)}\n`, { mode: 0o600 });
  await writeFile(join(bin, 'docker'), FAKE_DOCKER.replace('__ROOT__', JSON.stringify(root)), { mode: 0o755 });
  const defaults: FakeDockerConfig = {
    failures: [],
    running: true,
    healthy: true,
    runningImage: image,
    digests: { default: OLD_DIGEST, [`${REPOSITORY}:0.1.75`]: NEW_DIGEST },
  };
  const volumeLabels = {
    'com.docker.compose.project': env.OR3_COMPOSE_PROJECT,
    'com.docker.compose.volume': 'or3-data',
    'io.or3.cloud.deployment-id': env.OR3_DEPLOYMENT_ID,
  };
  const configPath = join(root, 'config.json');
  const writeConfig = async (value: object) => writeFile(configPath, JSON.stringify({ ...value, version, volumeLabels: { default: volumeLabels } }));
  let current = defaults;
  await writeConfig(current);

  const sandbox: Sandbox = {
    root,
    directory,
    cloud,
    env,
    state,
    image,
    async configure(patch) {
      current = { ...current, ...patch };
      await writeConfig(current);
    },
    async reset() {
      await rm(join(root, 'state.json'), { force: true });
      await rm(join(root, 'trace.jsonl'), { force: true });
    },
    async traceEntries() {
      const text = await readFile(join(root, 'trace.jsonl'), 'utf8').catch(() => '');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; stdinSha?: string });
    },
    async trace() {
      return (await sandbox.traceEntries()).map((entry) => entry.args);
    },
    async traceText() {
      return (await sandbox.trace()).map((args) => args.join(' ')).join('\n');
    },
    async cli(args, cliOptions = {}) {
      const base = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('OR3_') && key !== 'DOCKER_HOST'),
      );
      return await runProcess([...CLI_COMMAND, ...args], {
        cwd: cliOptions.cwd ?? directory,
        env: { ...base, PATH: `${bin}:${process.env.PATH}`, ...cliOptions.env } as Record<string, string>,
      });
    },
    async readState() {
      return JSON.parse(await readFile(join(cloud, 'state.json'), 'utf8')) as ManagedState;
    },
    readStateText: () => readFile(join(cloud, 'state.json'), 'utf8'),
    async writeState(next) {
      await writeFile(join(cloud, 'state.json'), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    },
    readEnvText: () => readFile(join(directory, '.env'), 'utf8'),
    async backupIds() {
      const { readdir } = await import('node:fs/promises');
      return (await readdir(join(cloud, 'backups')).catch(() => [])).sort();
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
  return sandbox;
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

/** Writes a live foreign lease owner record. */
export async function writeLease(
  sandbox: Sandbox,
  owner: Partial<{ pid: number; origin: 'cli' | 'dashboard'; heartbeatAt: string; jobId: string; command: string; raw: string }> = {},
) {
  const lease = join(sandbox.cloud, 'operation-lease');
  await mkdir(lease, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const text = owner.raw ?? `${JSON.stringify({
    schemaVersion: 1,
    nonce: 'fixture-owner',
    command: owner.command ?? 'update',
    origin: owner.origin ?? 'cli',
    pid: owner.pid ?? process.pid,
    acquiredAt: now,
    heartbeatAt: owner.heartbeatAt ?? now,
    ...(owner.jobId ? { jobId: owner.jobId } : {}),
  }, null, 2)}\n`;
  await writeFile(join(lease, 'owner.json'), text);
  return { lease, owner: join(lease, 'owner.json'), text };
}

/** A process id that is verified to be dead at the moment it is returned. */
export async function deadPid() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = child.pid;
    await new Promise((resolveExit) => child.once('close', resolveExit));
    if (pid === undefined) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return pid;
    }
  }
  throw new Error('Could not obtain a dead process id.');
}
