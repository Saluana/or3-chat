#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);

export const PACKAGE_VERSION = '0.1.15';
export const IMAGE_REPOSITORY = 'ghcr.io/saluana/or3-chat';
const ASSET_ROOT = resolve(fileURLToPath(new URL('../assets/', import.meta.url)));
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_PORT = 3000;
const DEEP_HEALTH_TIMEOUT_MS = 180_000;
const SECRET_KEYS = [
  'OR3_BASIC_AUTH_JWT_SECRET',
  'OR3_BASIC_AUTH_REFRESH_SECRET',
  'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_STORAGE_FS_TOKEN_SECRET',
  'OR3_ADMIN_JWT_SECRET',
  'OR3_ADMIN_PASSWORD',
];

const DEPLOYMENT_ENV_KEYS = [
  'OR3_COMPOSE_PROJECT',
  'OR3_VOLUME_NAME',
  'OR3_CADDY_DATA_VOLUME',
  'OR3_CADDY_CONFIG_VOLUME',
  'OR3_PORT',
  'OR3_PUBLIC_DOMAIN',
] as const;

type Mode = 'local' | 'public';
type Operation = 'init' | 'update' | 'restore' | 'adopt';
type PendingOperation = NonNullable<ManagedState['incompleteOperation']>;

export type ManagedState = {
  schemaVersion: 1;
  mode: Mode;
  composeProject: string;
  volumeName: string;
  caddyDataVolume?: string;
  caddyConfigVolume?: string;
  appVersion: string;
  image: string;
  imageDigest: string;
  domain?: string;
  port: number;
  lastSuccessfulOperation: Operation;
  updatedAt: string;
  rollback?: RollbackPoint;
  incompleteOperation?: {
    id: string;
    operation: Operation | 'backup' | 'rollback';
    startedAt: string;
    message: string;
    sourceDirectory?: string;
    backupId?: string;
    targetVersion?: string;
    targetImage?: string;
    targetImageDigest?: string;
  };
  lastError?: string;
};

export type BackupManifest = {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  appVersion: string;
  image: string;
  imageDigest: string;
  dataSha256: string;
  configSha256?: string;
  mode: Mode;
  domain?: string;
  composeProject?: string;
  volumeName?: string;
  caddyDataVolume?: string;
  caddyConfigVolume?: string;
  port?: number;
};

type RollbackPoint = {
  appVersion: string;
  image: string;
  imageDigest: string;
  backupId: string;
  createdAt: string;
};

type Flags = Record<string, string | boolean>;

type CommandResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; command: string; exitCode: number | null; stderr: string };

const ALLOWED_ENV_KEYS = new Set([
  'SSR_AUTH_ENABLED',
  'AUTH_PROVIDER',
  'OR3_AUTH_PROVIDER',
  'OR3_GUEST_ACCESS_ENABLED',
  'OR3_BASIC_AUTH_JWT_SECRET',
  'OR3_BASIC_AUTH_REFRESH_SECRET',
  'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
  'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS',
  'OR3_BASIC_AUTH_DB_PATH',
  'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
  'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_SYNC_ENABLED',
  'OR3_CLOUD_SYNC_ENABLED',
  'OR3_SYNC_PROVIDER',
  'OR3_SQLITE_DB_PATH',
  'OR3_SQLITE_PRAGMA_JOURNAL_MODE',
  'OR3_SQLITE_PRAGMA_SYNCHRONOUS',
  'OR3_SQLITE_ALLOW_IN_MEMORY',
  'OR3_SQLITE_STRICT',
  'OR3_STORAGE_ENABLED',
  'OR3_CLOUD_STORAGE_ENABLED',
  'NUXT_PUBLIC_STORAGE_PROVIDER',
  'OR3_STORAGE_FS_ROOT',
  'OR3_STORAGE_FS_TOKEN_SECRET',
  'OR3_STORAGE_FS_URL_TTL_SECONDS',
  'OR3_ADMIN_USERNAME',
  'OR3_ADMIN_PASSWORD',
  'OR3_ADMIN_JWT_SECRET',
  'OR3_ADMIN_JWT_EXPIRY',
  'OR3_PUBLIC_DOMAIN',
  'OR3_ALLOWED_ORIGINS',
  'OR3_FORCE_HTTPS',
  'OR3_TRUST_PROXY',
  'OR3_FORWARDED_FOR_HEADER',
]);

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}-${now().replaceAll(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
}

function randomSecret() {
  return `or3-${randomBytes(32).toString('base64url')}`;
}

function randomPassword() {
  return `A${randomBytes(20).toString('base64url')}a1`;
}

function validatePassword(password: string) {
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('The administrator password must be at least 12 characters and contain uppercase, lowercase, and numeric characters.');
  }
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function redact(text: string, secrets: string[] = []) {
  let output = text;
  for (const secret of secrets.filter(Boolean)) output = output.replaceAll(secret, '[REDACTED]');
  output = output.replace(
    /((?:PASSWORD|SECRET|TOKEN|JWT)\s*[=:]\s*)([^\s\n]+)/gi,
    '$1[REDACTED]'
  );
  return output;
}

export function parseFlags(argv: string[]) {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) {
      flags[rawKey] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[rawKey] = next;
      index += 1;
    } else {
      flags[rawKey] = true;
    }
  }
  return { positionals, flags };
}

const COMMAND_FLAGS: Record<string, readonly string[]> = {
  init: ['local', 'public', 'domain', 'admin-email', 'admin-password', 'admin-password-file', 'port'],
  update: ['to'],
  backup: [],
  restore: ['yes'],
  rollback: ['yes'],
  doctor: [],
  recover: [],
  adopt: ['from'],
};

/** Reject typos before they can silently produce an unexpected deployment. */
export function assertCommandFlags(command: string, flags: Flags) {
  const allowed = new Set(['help', ...(COMMAND_FLAGS[command] ?? [])]);
  const unknown = Object.keys(flags).filter((flag) => !allowed.has(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown option${unknown.length === 1 ? '' : 's'} for ${command}: ${unknown.map((flag) => `--${flag}`).join(', ')}. Run npx @or3/cloud ${command} --help.`);
  }
}

function stringFlag(flags: Flags, key: string) {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function boolFlag(flags: Flags, key: string) {
  return flags[key] === true;
}

function requireStringFlag(flags: Flags, key: string) {
  const value = stringFlag(flags, key)?.trim();
  if (!value) throw new Error(`--${key} requires a value.`);
  return value;
}

export function isVersion(value: string) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function imageFor(version: string) {
  if (!isVersion(version)) throw new Error(`Invalid release version "${version}".`);
  const testImage = process.env.OR3_CLOUD_TEST_IMAGE?.trim();
  if (testImage) return testImage;
  return `${IMAGE_REPOSITORY}:${version}`;
}

function sanitizeName(value: string, fallback = 'or3-cloud') {
  const name = value.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, '-').replaceAll(/^-+|-+$/g, '');
  return name || fallback;
}

function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Use a real administrator email address, for example admin@example.com.');
  }
}

async function resolveAdminEmail(flags: Flags) {
  const supplied = stringFlag(flags, 'admin-email')?.trim();
  if (supplied) {
    validateEmail(supplied);
    return supplied;
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('--admin-email is required in a non-interactive session so the first administrator identity is not a placeholder.');
  }
  const prompt = readline.createInterface({ input, output });
  try {
    const answer = (await prompt.question('Administrator email: ')).trim();
    validateEmail(answer);
    return answer;
  } finally {
    prompt.close();
  }
}

function validateDomain(domain: string) {
  if (
    domain.includes('://') ||
    domain.includes('/') ||
    domain.includes(' ') ||
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)
  ) {
    throw new Error(`"${domain}" is not a hostname. Use a name such as cloud.example.com.`);
  }
}

async function run(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  const printable = `${command} ${args.map(quote).join(' ')}`;
  try {
    const result = await execFile(command, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
      env: process.env,
    });
    return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      ok: false,
      command: printable,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      stderr: redact(failure.stderr ?? failure.stdout ?? String(error)),
    };
  }
}

async function requireCommand(command: string, args: string[], label: string, cwd?: string) {
  const result = await run(command, args, cwd);
  if (!result.ok) throw new Error(`${label} is unavailable. Run: ${result.command}\n${result.stderr}`);
  return result.stdout.trim();
}

async function writeSecure(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function copySecure(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string) {
  return readFile(path, 'utf8');
}

export function parseEnv(text: string) {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replaceAll(/\\([\\'])/g, '$1');
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function serializeEnvValue(value: string) {
  if (value.includes('\0') || /\r|\n/.test(value)) {
    throw new Error('Environment values may not contain NUL or newline characters.');
  }
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

export function serializeEnv(values: Record<string, string>) {
  return `${Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${serializeEnvValue(value)}`)
    .join('\n')}\n`;
}

function deploymentPaths(directory: string) {
  const cloud = join(directory, '.or3-cloud');
  return {
    env: join(directory, '.env'),
    state: join(cloud, 'state.json'),
    operations: join(cloud, 'operations'),
    backups: join(cloud, 'backups'),
  };
}

async function readState(directory: string): Promise<ManagedState> {
  const paths = deploymentPaths(directory);
  const parsed = JSON.parse(await readText(paths.state)) as Partial<ManagedState>;
  if (parsed.schemaVersion !== STATE_SCHEMA_VERSION || !parsed.appVersion || !parsed.image || !parsed.composeProject) {
    throw new Error(`Invalid managed state at ${paths.state}. Run "npx @or3/cloud doctor" for diagnostics.`);
  }
  return parsed as ManagedState;
}

async function writeState(directory: string, state: ManagedState) {
  await writeSecure(deploymentPaths(directory).state, `${JSON.stringify(state, null, 2)}\n`);
}

async function readDirectoryEmpty(directory: string) {
  try {
    const entries = await readdir(directory);
    if (entries.length) throw new Error(`Refusing to use non-empty directory ${directory}. Choose a new directory or run adopt explicitly.`);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

function composeArgs(directory: string, mode: Mode, command: string[] = []) {
  const files = ['-f', join(directory, 'compose.yaml')];
  if (mode === 'public') files.push('-f', join(directory, 'compose.public.yaml'));
  return [
    'compose',
    '--project-directory',
    directory,
    '--env-file',
    join(directory, '.env'),
    ...files,
    ...command,
  ];
}

function diagnostics(directory: string, mode: Mode) {
  const files = `-f ${quote(join(directory, 'compose.yaml'))}${mode === 'public' ? ` -f ${quote(join(directory, 'compose.public.yaml'))}` : ''}`;
  return `cd ${quote(directory)} && docker compose --env-file ${quote(join(directory, '.env'))} ${files} ps && docker compose --env-file ${quote(join(directory, '.env'))} ${files} logs --tail=200`;
}

async function compose(directory: string, mode: Mode, command: string[], secrets: string[] = []) {
  const result = await run('docker', composeArgs(directory, mode, command), directory);
  if (!result.ok) {
    throw new Error(`${result.command}\n${redact(result.stderr, secrets)}\nDiagnostics: ${diagnostics(directory, mode)}`);
  }
  return result.stdout;
}

type ComposeService = {
  ports?: Array<Record<string, unknown>>;
  volumes?: Array<Record<string, unknown>>;
  environment?: Record<string, unknown> | string[];
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, { name?: string }>;
};

function parseComposeConfig(text: string): ComposeConfig {
  try {
    const parsed = JSON.parse(text) as ComposeConfig;
    if (!parsed || typeof parsed !== 'object' || !parsed.services) throw new Error('missing services');
    return parsed;
  } catch (error) {
    throw new Error(`Docker Compose did not return a readable JSON configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function composeEnvironmentValue(service: ComposeService, key: string) {
  const environment = service.environment;
  if (Array.isArray(environment)) {
    const line = environment.find((value) => value.startsWith(`${key}=`));
    return line?.slice(key.length + 1);
  }
  const value = environment?.[key];
  return typeof value === 'string' ? value : undefined;
}

function composePublishedPort(port: Record<string, unknown>) {
  const target = Number(port.target);
  const published = Number(port.published);
  const hostIp = typeof port.host_ip === 'string' ? port.host_ip : undefined;
  return { target, published, hostIp, protocol: port.protocol };
}

export function checkResolvedLoopbackBinding(config: string, expectedPort?: number) {
  try {
    const parsed = parseComposeConfig(config);
    const service = parsed.services?.or3;
    if (!service) return false;
    const ports = (service.ports ?? []).map(composePublishedPort);
    const appPorts = ports.filter(({ target }) => target === 3000);
    if (!appPorts.length) return false;
    if (expectedPort !== undefined && !appPorts.some(({ published }) => published === expectedPort)) return false;
    return appPorts.every(({ hostIp, protocol }) => hostIp === '127.0.0.1' && (protocol === undefined || protocol === 'tcp'));
  } catch {
    return false;
  }
}

async function resolvedComposeConfig(directory: string, mode: Mode) {
  const result = await run('docker', composeArgs(directory, mode, ['config', '--format', 'json']), directory);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  return result.stdout;
}

async function assertSafeComposeBinding(directory: string, mode: Mode, env: Record<string, string>) {
  const config = await resolvedComposeConfig(directory, mode);
  if (!checkResolvedLoopbackBinding(config, Number(env.OR3_PORT))) {
    throw new Error('Resolved Compose configuration must publish OR3 port 3000 only on 127.0.0.1. Refusing to expose the application directly.');
  }
}

const HEALTH_SCRIPT = "fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok||body.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))";

async function waitForDeepHealthWithArgs(composeCommand: string[], directory: string, secrets: string[] = []) {
  const deadline = Date.now() + DEEP_HEALTH_TIMEOUT_MS;
  let lastError = 'health check did not complete';
  while (Date.now() < deadline) {
    const result = await run('docker', [...composeCommand, 'exec', '-T', 'or3', 'node', '-e', HEALTH_SCRIPT], directory);
    if (result.ok) return;
    lastError = redact(result.stderr, secrets);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`OR3 deep health did not pass within ${DEEP_HEALTH_TIMEOUT_MS / 1000} seconds. Last error: ${lastError}`);
}

async function ensureDocker() {
  await requireCommand('docker', ['info'], 'Docker Engine');
  await requireCommand('docker', ['compose', 'version'], 'Docker Compose v2');
}

async function portAvailable(port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => server.close(() => resolvePromise(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function waitForDeepHealth(directory: string, mode: Mode, secrets: string[] = []) {
  try {
    await waitForDeepHealthWithArgs(composeArgs(directory, mode), directory, secrets);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nDiagnostics: ${diagnostics(directory, mode)}`);
  }
}

async function pullImage(image: string) {
  const local = await run('docker', ['image', 'inspect', image]);
  if (!local.ok && process.env.OR3_CLOUD_SKIP_PULL !== 'true') {
    const result = await run('docker', ['pull', image]);
    if (!result.ok) {
      const detail = result.stderr.trim();
      if (/(not found|manifest unknown|pull access denied)/i.test(detail)) {
        throw new Error(`The matching OR3 container image is not published yet: ${image}. This is a release issue, not a problem with your computer. Try again after the image release completes. ${detail}`);
      }
      throw new Error(`Could not download ${image}. Check your internet connection and Docker registry access, then retry. ${detail}`);
    }
  } else if (!local.ok) {
    throw new Error(`${image} is not available locally and OR3_CLOUD_SKIP_PULL=true prevents downloading it.`);
  }
  return imageDigest(image);
}

function imageRepository(image: string) {
  const reference = image.split('@', 1)[0];
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  return colon > slash ? reference.slice(0, colon) : reference;
}

async function requireImageDigest(image: string, expected: string, label: string) {
  const actual = await imageDigest(image);
  if (actual !== expected) {
    throw new Error(`${label} image digest mismatch for ${image}. Expected ${expected}, found ${actual}. The registry tag may have moved; refusing to mutate the deployment.`);
  }
  return actual;
}

async function pullAndRequireImage(image: string, expected: string, label: string) {
  const actual = await pullImage(image);
  if (actual !== expected) {
    throw new Error(`${label} image digest mismatch for ${image}. Expected ${expected}, found ${actual}. The registry tag may have moved; refusing to mutate the deployment.`);
  }
  return actual;
}

async function imageDigest(image: string) {
  const result = await run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image]);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  try {
    const digests = JSON.parse(result.stdout.trim()) as string[];
    const repository = imageRepository(image);
    const digest = digests.find((value) => value.startsWith(`${repository}@sha256:`))?.split('@').at(-1);
    if (digest) return digest;
  } catch {
    // Fall through to the image ID for local registries that omit RepoDigests.
  }
  const idResult = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  if (!idResult.ok || !idResult.stdout.trim()) throw new Error(`Could not resolve a digest for ${image}.`);
  return idResult.stdout.trim();
}

function composeProjectNames(directory: string) {
  const base = sanitizeName(basename(directory));
  return {
    project: base,
    volume: `${base}-or3-data`,
    caddyData: `${base}-caddy-data`,
    caddyConfig: `${base}-caddy-config`,
  };
}

export function buildEnv(input: {
  mode: Mode;
  version: string;
  directory: string;
  email: string;
  password: string;
  domain?: string;
  port: number;
  secrets?: Record<string, string>;
}) {
  const names = composeProjectNames(input.directory);
  const secrets = input.secrets ?? {};
  const publicOrigin = input.mode === 'public' ? `https://${input.domain}` : `http://127.0.0.1:${input.port}`;
  const values: Record<string, string> = {
    OR3_VERSION: input.version,
    OR3_IMAGE: imageFor(input.version),
    OR3_COMPOSE_PROJECT: names.project,
    OR3_VOLUME_NAME: names.volume,
    OR3_CADDY_DATA_VOLUME: names.caddyData,
    OR3_CADDY_CONFIG_VOLUME: names.caddyConfig,
    OR3_PORT: String(input.port),
    SSR_AUTH_ENABLED: 'true',
    AUTH_PROVIDER: 'basic-auth',
    OR3_AUTH_PROVIDER: 'basic-auth',
    OR3_GUEST_ACCESS_ENABLED: 'false',
    OR3_BASIC_AUTH_JWT_SECRET: secrets.OR3_BASIC_AUTH_JWT_SECRET ?? randomSecret(),
    OR3_BASIC_AUTH_REFRESH_SECRET: secrets.OR3_BASIC_AUTH_REFRESH_SECRET ?? randomSecret(),
    OR3_BASIC_AUTH_ACCESS_TTL_SECONDS: '900',
    OR3_BASIC_AUTH_REFRESH_TTL_SECONDS: '2592000',
    OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: input.email,
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: input.password,
    OR3_SYNC_ENABLED: 'true',
    OR3_CLOUD_SYNC_ENABLED: 'true',
    OR3_SYNC_PROVIDER: 'sqlite',
    OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
    OR3_SQLITE_PRAGMA_JOURNAL_MODE: 'WAL',
    OR3_SQLITE_PRAGMA_SYNCHRONOUS: 'NORMAL',
    OR3_SQLITE_ALLOW_IN_MEMORY: 'false',
    OR3_SQLITE_STRICT: 'false',
    OR3_STORAGE_ENABLED: 'true',
    OR3_CLOUD_STORAGE_ENABLED: 'true',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
    OR3_STORAGE_FS_ROOT: '/data/storage',
    OR3_STORAGE_FS_TOKEN_SECRET: secrets.OR3_STORAGE_FS_TOKEN_SECRET ?? randomSecret(),
    OR3_STORAGE_FS_URL_TTL_SECONDS: '900',
    OR3_ADMIN_USERNAME: input.email,
    OR3_ADMIN_PASSWORD: input.password,
    OR3_ADMIN_JWT_SECRET: secrets.OR3_ADMIN_JWT_SECRET ?? randomSecret(),
    OR3_ADMIN_JWT_EXPIRY: '24h',
    OR3_PUBLIC_DOMAIN: input.domain ?? 'localhost',
    OR3_ALLOWED_ORIGINS: publicOrigin,
    OR3_FORCE_HTTPS: input.mode === 'public' ? 'true' : 'false',
    OR3_TRUST_PROXY: input.mode === 'public' ? 'true' : 'false',
    OR3_FORWARDED_FOR_HEADER: 'x-forwarded-for',
  };
  return values;
}

function secretValues(env: Record<string, string>) {
  return SECRET_KEYS.map((key) => env[key]).filter((value): value is string => Boolean(value));
}

async function readPassword(flags: Flags) {
  const passwordFlagValue = flags['admin-password'];
  const passwordFileValue = flags['admin-password-file'];
  if (passwordFlagValue !== undefined && typeof passwordFlagValue !== 'string') {
    throw new Error('--admin-password requires a value.');
  }
  if (passwordFileValue !== undefined && typeof passwordFileValue !== 'string') {
    throw new Error('--admin-password-file requires a path.');
  }
  const passwordFlag = passwordFlagValue as string | undefined;
  const passwordFile = passwordFileValue as string | undefined;
  if (passwordFileValue !== undefined && !passwordFile) {
    throw new Error('--admin-password-file requires a path.');
  }
  if (passwordFlag !== undefined && passwordFile !== undefined) {
    throw new Error('Use either --admin-password or --admin-password-file, not both.');
  }
  if (passwordFlag !== undefined) {
    validatePassword(passwordFlag);
    return passwordFlag;
  }
  if (passwordFile) {
    const value = (await readText(resolve(passwordFile))).trim();
    if (!value) throw new Error('The administrator password file is empty.');
    validatePassword(value);
    return value;
  }
  const password = randomPassword();
  validatePassword(password);
  return password;
}

async function copyAssets(directory: string, mode: Mode) {
  await copyFile(join(ASSET_ROOT, 'compose.yaml'), join(directory, 'compose.yaml'));
  await chmod(join(directory, 'compose.yaml'), 0o644);
  if (mode === 'public') {
    await copyFile(join(ASSET_ROOT, 'compose.public.yaml'), join(directory, 'compose.public.yaml'));
    await copyFile(join(ASSET_ROOT, 'Caddyfile'), join(directory, 'Caddyfile'));
    await chmod(join(directory, 'compose.public.yaml'), 0o644);
    await chmod(join(directory, 'Caddyfile'), 0o644);
  }
}

async function checkPublicPrerequisites(domain: string) {
  validateDomain(domain);
  let address: string;
  try {
    address = (await lookup(domain)).address;
  } catch {
    throw new Error(`DNS for ${domain} does not resolve yet. Create the A/AAAA record before starting public mode.`);
  }
  return address;
}

async function markPending(directory: string, state: ManagedState, operation: PendingOperation) {
  state.incompleteOperation = operation;
  await writeState(directory, state);
  await writeSecure(join(deploymentPaths(directory).operations, `${operation.id}.json`), `${JSON.stringify(operation, null, 2)}\n`);
}

async function updatePending(directory: string, state: ManagedState, patch: Partial<PendingOperation>) {
  if (!state.incompleteOperation) throw new Error('No incomplete operation is available to update.');
  Object.assign(state.incompleteOperation, patch);
  state.updatedAt = now();
  await writeState(directory, state);
  await writeSecure(
    join(deploymentPaths(directory).operations, `${state.incompleteOperation.id}.json`),
    `${JSON.stringify(state.incompleteOperation, null, 2)}\n`,
  );
}

async function removeOperationRecord(directory: string, operationId?: string) {
  if (!operationId) return;
  await rm(join(deploymentPaths(directory).operations, `${operationId}.json`), { force: true });
}

async function clearPending(directory: string, state: ManagedState) {
  const operationId = state.incompleteOperation?.id;
  delete state.incompleteOperation;
  state.updatedAt = now();
  await removeOperationRecord(directory, operationId);
  await writeState(directory, state);
}

async function stopProject(directory: string, mode: Mode) {
  await compose(directory, mode, ['stop', 'or3']);
}

async function startProject(directory: string, mode: Mode, env: Record<string, string>) {
  await assertSafeComposeBinding(directory, mode, env);
  await compose(directory, mode, ['up', '-d', '--wait', '--wait-timeout', '180'], secretValues(env));
  await waitForDeepHealth(directory, mode, secretValues(env));
}

function backupDirectory(directory: string, backupId: string) {
  return join(deploymentPaths(directory).backups, backupId);
}

function assertDeploymentIdentity(state: ManagedState, env: Record<string, string>) {
  const expected: Record<string, string | undefined> = {
    OR3_COMPOSE_PROJECT: state.composeProject,
    OR3_VOLUME_NAME: state.volumeName,
    OR3_CADDY_DATA_VOLUME: state.caddyDataVolume,
    OR3_CADDY_CONFIG_VOLUME: state.caddyConfigVolume,
    OR3_PORT: String(state.port),
    OR3_PUBLIC_DOMAIN: state.domain ?? 'localhost',
  };
  for (const key of DEPLOYMENT_ENV_KEYS) {
    if (state.mode === 'local' && (key === 'OR3_CADDY_DATA_VOLUME' || key === 'OR3_CADDY_CONFIG_VOLUME')) continue;
    if (env[key] !== expected[key]) {
      throw new Error(`Managed state does not match ${key} in .env. Refusing to operate on an unexpected deployment identity.`);
    }
  }
}

export function assertBackupMatchesDeployment(manifest: BackupManifest, backupEnv: Record<string, string>, state: ManagedState, env: Record<string, string>) {
  if (manifest.mode !== state.mode || manifest.appVersion === undefined || manifest.image === undefined) {
    throw new Error(`Backup ${manifest.backupId} does not match the managed deployment mode.`);
  }
  assertDeploymentIdentity(state, env);
  const expected: Record<string, string | undefined> = {
    OR3_COMPOSE_PROJECT: state.composeProject,
    OR3_VOLUME_NAME: state.volumeName,
    OR3_CADDY_DATA_VOLUME: state.caddyDataVolume,
    OR3_CADDY_CONFIG_VOLUME: state.caddyConfigVolume,
    OR3_PORT: String(state.port),
    OR3_PUBLIC_DOMAIN: state.domain ?? 'localhost',
  };
  for (const key of DEPLOYMENT_ENV_KEYS) {
    if (state.mode === 'local' && (key === 'OR3_CADDY_DATA_VOLUME' || key === 'OR3_CADDY_CONFIG_VOLUME')) continue;
    if (backupEnv[key] !== expected[key]) {
      throw new Error(`Backup ${manifest.backupId} belongs to a different deployment identity (${key}). Refusing to replace this deployment's data.`);
    }
  }
  if (manifest.composeProject !== undefined && manifest.composeProject !== state.composeProject) {
    throw new Error(`Backup ${manifest.backupId} belongs to Compose project ${manifest.composeProject}, not ${state.composeProject}.`);
  }
  if (manifest.volumeName !== undefined && manifest.volumeName !== state.volumeName) {
    throw new Error(`Backup ${manifest.backupId} belongs to volume ${manifest.volumeName}, not ${state.volumeName}.`);
  }
  if (manifest.domain !== undefined && manifest.domain !== state.domain) {
    throw new Error(`Backup ${manifest.backupId} belongs to domain ${manifest.domain}, not ${state.domain ?? 'localhost'}.`);
  }
  if (manifest.caddyDataVolume !== undefined && manifest.caddyDataVolume !== state.caddyDataVolume) {
    throw new Error(`Backup ${manifest.backupId} belongs to a different Caddy data volume.`);
  }
  if (manifest.caddyConfigVolume !== undefined && manifest.caddyConfigVolume !== state.caddyConfigVolume) {
    throw new Error(`Backup ${manifest.backupId} belongs to a different Caddy config volume.`);
  }
  if (manifest.port !== undefined && manifest.port !== state.port) {
    throw new Error(`Backup ${manifest.backupId} belongs to port ${manifest.port}, not ${state.port}.`);
  }
}

async function sha256File(path: string) {
  const digest = createHash('sha256');
  digest.update(await readFile(path));
  return digest.digest('hex');
}

async function volumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupDir: string) {
  const mount = `${backupDir}:/backup`;
  await compose(directory, mode, [
    'run', '--rm', '--no-deps', '--user', '0:0', '-v', mount,
    '--entrypoint', 'sh', 'or3', '-c',
    'umask 077 && tar czf /backup/data.tgz -C /data . && tar tzf /backup/data.tgz >/dev/null',
  ], secretValues(env));
}

async function archiveExternalVolume(image: string, volume: string, backupDir: string) {
  const result = await run('docker', [
    'run', '--rm', '--user', '0:0', '-v', `${volume}:/source:ro`, '-v', `${backupDir}:/backup`,
    image, 'sh', '-c', 'umask 077 && tar czf /backup/data.tgz -C /source . && tar tzf /backup/data.tgz >/dev/null',
  ]);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
}

async function restoreAdoptionBackup(directory: string, mode: Mode, env: Record<string, string>, backupPath: string) {
  await compose(directory, mode, [
    'run', '--rm', '--no-deps', '--user', '0:0', '-v', `${backupPath}:/backup:ro`,
    '--entrypoint', 'sh', 'or3', '-c',
    'find /data -mindepth 1 -delete && tar xzf /backup/data.tgz -C /data',
  ], secretValues(env));
}

async function createBackup(directory: string, state: ManagedState, env: Record<string, string>) {
  await requireImageDigest(state.image, state.imageDigest, 'Current deployment');
  const backupId = id('backup');
  const backupDir = backupDirectory(directory, backupId);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);
  let stopAttempted = false;
  try {
    stopAttempted = true;
    await stopProject(directory, state.mode);
    await volumeArchive(directory, state.mode, env, backupDir);
    await copySecure(deploymentPaths(directory).env, join(backupDir, 'config.env'));
    const manifest: BackupManifest = {
      schemaVersion: 1,
      backupId,
      createdAt: now(),
      appVersion: state.appVersion,
      image: state.image,
      imageDigest: state.imageDigest,
      dataSha256: await sha256File(join(backupDir, 'data.tgz')),
      configSha256: await sha256File(join(backupDir, 'config.env')),
      mode: state.mode,
      domain: state.domain,
      composeProject: state.composeProject,
      volumeName: state.volumeName,
      caddyDataVolume: state.caddyDataVolume,
      caddyConfigVolume: state.caddyConfigVolume,
      port: state.port,
    };
    await writeSecure(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { backupId, backupDir, manifest };
  } finally {
    if (stopAttempted) {
      try {
        await startProject(directory, state.mode, env);
      } catch (error) {
        throw new Error(`Backup was created but OR3 could not restart: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function readManifest(backupPath: string) {
  const manifest = JSON.parse(await readText(join(backupPath, 'manifest.json'))) as BackupManifest;
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.backupId ||
    !isVersion(manifest.appVersion) ||
    !manifest.image ||
    !/^sha256:[0-9a-f]{64}$/i.test(manifest.imageDigest)
  ) {
    throw new Error(`Invalid backup manifest at ${backupPath}.`);
  }
  const actual = await sha256File(join(backupPath, 'data.tgz'));
  if (actual !== manifest.dataSha256) throw new Error(`Backup checksum mismatch for ${manifest.backupId}. Expected ${manifest.dataSha256}, got ${actual}.`);
  if (manifest.configSha256) {
    const configActual = await sha256File(join(backupPath, 'config.env'));
    if (configActual !== manifest.configSha256) throw new Error(`Backup configuration checksum mismatch for ${manifest.backupId}.`);
  }
  return manifest;
}

async function restoreBackupData(directory: string, state: ManagedState, env: Record<string, string>, backupPath: string) {
  const manifest = await readManifest(backupPath);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, state, env);
  if (manifest.imageDigest) await requireImageDigest(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  let started = false;
  let stopAttempted = false;
  try {
    stopAttempted = true;
    await stopProject(directory, state.mode);
    await copySecure(join(backupPath, 'config.env'), deploymentPaths(directory).env);
    await compose(directory, state.mode, [
      'run', '--rm', '--no-deps', '--user', '0:0', '-v', `${backupPath}:/backup:ro`,
      '--entrypoint', 'sh', 'or3', '-c',
      'find /data -mindepth 1 -delete && tar xzf /backup/data.tgz -C /data',
    ], secretValues(backupEnv));
    const restoredEnv = parseEnv(await readText(deploymentPaths(directory).env));
    await startProject(directory, state.mode, restoredEnv);
    started = true;
  } catch (error) {
    let restartError = '';
    if (stopAttempted && !started) {
      try {
        const recoveryEnv = parseEnv(await readText(deploymentPaths(directory).env));
        await startProject(directory, state.mode, recoveryEnv);
      } catch (recovery) {
        restartError = ` OR3 could not be restarted: ${recovery instanceof Error ? recovery.message : String(recovery)}`;
      }
    }
    throw new Error(`Restore failed for ${manifest.backupId}: ${error instanceof Error ? error.message : String(error)}${restartError}`);
  }
  return manifest;
}

export function stateFromEnv(directory: string, env: Record<string, string>, mode: Mode, operation: Operation, digest: string): ManagedState {
  return {
    schemaVersion: 1,
    mode,
    composeProject: env.OR3_COMPOSE_PROJECT,
    volumeName: env.OR3_VOLUME_NAME,
    caddyDataVolume: mode === 'public' ? env.OR3_CADDY_DATA_VOLUME : undefined,
    caddyConfigVolume: mode === 'public' ? env.OR3_CADDY_CONFIG_VOLUME : undefined,
    appVersion: env.OR3_VERSION,
    image: env.OR3_IMAGE,
    imageDigest: digest,
    domain: mode === 'public' ? env.OR3_PUBLIC_DOMAIN : undefined,
    port: Number(env.OR3_PORT),
    lastSuccessfulOperation: operation,
    updatedAt: now(),
  };
}

function help() {
  console.log(`OR3 Cloud — managed container installer and operator

Usage:
  npx @or3/cloud init [directory] --local
  npx @or3/cloud init [directory] --public --domain <hostname>
  npx @or3/cloud update [--to <exact-version>]
  npx @or3/cloud backup
  npx @or3/cloud restore <backup-id-or-path> --yes
  npx @or3/cloud rollback --yes
  npx @or3/cloud doctor
  npx @or3/cloud recover
  npx @or3/cloud adopt --from <v1-directory> [directory]

Options:
  --admin-email <email>          Administrator email for first login
  --admin-password <password>    Explicit password (prefer --admin-password-file)
  --admin-password-file <path>   Read the bootstrap password without shell history
  --port <port>                  Local OR3 port (default: 3000)
  --yes                          Confirm a destructive restore or rollback
  --help                         Show this help
  --version                      Show the Cloud package version

The supported profile is Basic Auth + SQLite + filesystem storage.
The installer never changes firewall, DNS, Cloudflare, or Tailscale settings.`);
}

async function initCommand(positionals: string[], flags: Flags) {
  const hasLocal = boolFlag(flags, 'local');
  const hasPublic = boolFlag(flags, 'public');
  if (hasLocal === hasPublic) throw new Error('Choose exactly one of --local or --public.');
  const mode: Mode = hasPublic ? 'public' : 'local';
  const directory = resolve(process.cwd(), positionals[0] ?? 'or3-cloud');
  if (await fileExists(join(directory, '.or3-cloud', 'state.json'))) {
    throw new Error(`${directory} is already a managed deployment. Use update, doctor, or adopt.`);
  }
  await readDirectoryEmpty(directory);
  const domain = mode === 'public' ? requireStringFlag(flags, 'domain') : undefined;
  if (domain) {
    const address = await checkPublicPrerequisites(domain);
    console.log(`DNS: ${domain} → ${address}`);
  }
  const port = Number(stringFlag(flags, 'port') ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be a valid TCP port.');
  if (mode === 'public' && [80, 443].includes(port)) throw new Error('Public mode reserves ports 80 and 443 for Caddy; choose another --port for OR3.');
  if (!await portAvailable(port)) throw new Error(`Port ${port} is already in use. Choose another port with --port.`);
  if (mode === 'public') {
    for (const publicPort of [80, 443]) {
      if (!await portAvailable(publicPort)) throw new Error(`Public port ${publicPort} is already in use. Stop the conflicting service before starting Caddy.`);
    }
  }
  await ensureDocker();
  const names = composeProjectNames(directory);
  for (const volume of [names.volume, ...(mode === 'public' ? [names.caddyData, names.caddyConfig] : [])]) {
    const existing = await run('docker', ['volume', 'inspect', volume]);
    if (existing.ok) throw new Error(`Docker volume ${volume} already exists. Choose a new directory or inspect it before initializing.`);
  }
  const email = await resolveAdminEmail(flags);
  const password = await readPassword(flags);
  const version = PACKAGE_VERSION;
  const image = imageFor(version);
  await pullImage(image);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await mkdir(deploymentPaths(directory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(directory).backups, { recursive: true, mode: 0o700 });
  await copyAssets(directory, mode);
  const env = buildEnv({ mode, version, directory, email, password, domain, port });
  await writeSecure(deploymentPaths(directory).env, serializeEnv(env));
  await writeSecure(join(directory, '.or3-initial-credentials'), `email=${email}\npassword=${password}\n`);
  const digest = await imageDigest(image);
  const state = stateFromEnv(directory, env, mode, 'init', digest);
  await markPending(directory, state, {
    id: id('init'),
    operation: 'init',
    startedAt: now(),
    message: 'Initializing the managed deployment',
  });
  try {
    await startProject(directory, mode, env);
    await clearPending(directory, state);
    console.log(`\nOR3 Cloud ${version} is running at ${mode === 'public' ? `https://${domain}` : `http://127.0.0.1:${port}`}`);
    console.log(`Credentials were written to ${join(directory, '.or3-initial-credentials')} (mode 0600). Save them, then remove that file.`);
    console.log(`\nCheck: cd ${quote(directory)} && npx @or3/cloud doctor`);
  } catch (error) {
    state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(env));
    await writeState(directory, state);
    await compose(directory, mode, ['down']).catch(() => undefined);
    throw new Error(`${state.lastError}\nThe new deployment files were preserved at ${directory}.`);
  }
}

async function loadManaged(directory = process.cwd()) {
  const resolved = resolve(directory);
  const state = await readState(resolved);
  const env = parseEnv(await readText(deploymentPaths(resolved).env));
  assertDeploymentIdentity(state, env);
  return { directory: resolved, state, env };
}

function operationToStateOperation(operation: PendingOperation['operation'], fallback: Operation): Operation {
  if (operation === 'init' || operation === 'update' || operation === 'adopt') return operation;
  return fallback;
}

async function commitRecoveredState(directory: string, previous: ManagedState, next: ManagedState) {
  await removeOperationRecord(directory, previous.incompleteOperation?.id);
  await writeState(directory, next);
}

async function recoverCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  const pending = loaded.state.incompleteOperation;
  if (!pending) {
    console.log('No incomplete OR3 Cloud operation is recorded.');
    return;
  }
  try {
    if (pending.operation === 'restore' || pending.operation === 'rollback') {
      if (!pending.backupId) throw new Error(`The incomplete ${pending.operation} has no recorded backup ID.`);
      const backupPath = await resolveBackup(loaded.directory, pending.backupId);
      const manifest = await readManifest(backupPath);
      const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
      if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
        throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
      }
      if (
        (pending.targetVersion && pending.targetVersion !== manifest.appVersion) ||
        (pending.targetImage && pending.targetImage !== manifest.image) ||
        (pending.targetImageDigest && pending.targetImageDigest !== manifest.imageDigest)
      ) {
        throw new Error(`Backup ${manifest.backupId} does not match the recorded ${pending.operation} target.`);
      }
      assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
      await pullAndRequireImage(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
      await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath);
      const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
      const restored = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', await imageDigest(restoredEnv.OR3_IMAGE));
      restored.lastError = undefined;
      await commitRecoveredState(loaded.directory, loaded.state, restored);
      console.log(`Recovered the incomplete ${pending.operation} operation from backup ${manifest.backupId}. OR3 ${restored.appVersion} is deeply healthy.`);
      return;
    }

    if (pending.operation === 'update') {
      const oldDeployment = loaded.env.OR3_VERSION === loaded.state.appVersion && loaded.env.OR3_IMAGE === loaded.state.image;
      if (oldDeployment) {
        await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
        const recovered = stateFromEnv(loaded.directory, loaded.env, loaded.state.mode, loaded.state.lastSuccessfulOperation, await imageDigest(loaded.env.OR3_IMAGE));
        recovered.rollback = loaded.state.rollback;
        recovered.lastError = undefined;
        await commitRecoveredState(loaded.directory, loaded.state, recovered);
        console.log(`Recovered the incomplete update before the replacement was applied. OR3 ${recovered.appVersion} is deeply healthy.`);
        return;
      }
      if (
        !pending.backupId ||
        loaded.env.OR3_VERSION !== pending.targetVersion ||
        loaded.env.OR3_IMAGE !== pending.targetImage
      ) {
        throw new Error('The incomplete update has an unknown .env version/image. Refusing to guess which image or data should be live.');
      }
      const backupPath = await resolveBackup(loaded.directory, pending.backupId);
      const manifest = await readManifest(backupPath);
      const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
      if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
        throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
      }
      assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
      try {
        if (pending.targetImageDigest) await pullAndRequireImage(pending.targetImage, pending.targetImageDigest, `OR3 ${pending.targetVersion}`);
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
      } catch (replacementError) {
        await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath);
        const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
        const restored = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, loaded.state.lastSuccessfulOperation, await imageDigest(restoredEnv.OR3_IMAGE));
        restored.rollback = loaded.state.rollback;
        restored.lastError = `Interrupted update was restored: ${redact(replacementError instanceof Error ? replacementError.message : String(replacementError), secretValues(restoredEnv))}`;
        await commitRecoveredState(loaded.directory, loaded.state, restored);
        console.log(`Recovered the incomplete update by restoring backup ${manifest.backupId}. OR3 ${restored.appVersion} is deeply healthy.`);
        return;
      }
      const updated = stateFromEnv(loaded.directory, loaded.env, loaded.state.mode, 'update', await imageDigest(loaded.env.OR3_IMAGE));
      updated.rollback = {
        appVersion: loaded.state.appVersion,
        image: loaded.state.image,
        imageDigest: loaded.state.imageDigest,
        backupId: pending.backupId,
        createdAt: now(),
      };
      updated.lastError = undefined;
      await commitRecoveredState(loaded.directory, loaded.state, updated);
      console.log(`Recovered the incomplete update. OR3 ${updated.appVersion} is deeply healthy.`);
      return;
    }

    if (pending.operation === 'adopt') {
      if (!pending.backupId) throw new Error('The incomplete adoption has no source backup ID. Refusing to claim that data was transferred.');
      const sourceBackupPath = await resolveBackup(loaded.directory, pending.backupId);
      const sourceManifest = await readManifest(sourceBackupPath);
      if (
        sourceManifest.mode !== loaded.state.mode ||
        sourceManifest.appVersion !== loaded.state.appVersion ||
        sourceManifest.image !== loaded.state.image ||
        sourceManifest.imageDigest !== loaded.state.imageDigest
      ) {
        throw new Error(`Source backup ${sourceManifest.backupId} does not match the managed adoption target.`);
      }
      await stopProject(loaded.directory, loaded.state.mode);
      await restoreAdoptionBackup(loaded.directory, loaded.state.mode, loaded.env, sourceBackupPath);
    }

    // Init and backup keep the current .env as the intended deployment.
    // Starting is idempotent and commits only its observed image digest after
    // deep health passes. Adoption additionally replays its verified source
    // archive before starting, so a crash cannot silently adopt an empty or
    // partially copied volume.
    await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
    await startProject(loaded.directory, loaded.state.mode, loaded.env);
    const digest = await imageDigest(loaded.env.OR3_IMAGE);
    const recovered = stateFromEnv(
      loaded.directory,
      loaded.env,
      loaded.state.mode,
      operationToStateOperation(pending.operation, loaded.state.lastSuccessfulOperation),
      digest,
    );
    recovered.rollback = loaded.state.rollback;
    recovered.lastError = undefined;
    await commitRecoveredState(loaded.directory, loaded.state, recovered);
    console.log(`Recovered the incomplete ${pending.operation} operation. OR3 ${recovered.appVersion} is deeply healthy.`);
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    if (pending.operation === 'adopt' && pending.sourceDirectory) {
      try {
        await compose(loaded.directory, loaded.state.mode, ['down']).catch(() => undefined);
        const sourceEnv = parseEnv(await readText(join(pending.sourceDirectory, '.env')));
        const sourceFiles = ['-f', join(pending.sourceDirectory, 'compose.yaml')];
        const sourceModeValue = sourceMode(pending.sourceDirectory, sourceEnv) as Mode;
        if (sourceModeValue === 'public') sourceFiles.push('-f', join(pending.sourceDirectory, 'compose.public.yaml'));
        await restartSource(pending.sourceDirectory, sourceFiles, secretValues(sourceEnv));
      } catch (recovery) {
        loaded.state.lastError += ` Original deployment recovery failed: ${recovery instanceof Error ? recovery.message : String(recovery)}`;
      }
    }
    await writeState(loaded.directory, loaded.state);
    throw new Error(`Recovery could not safely complete ${pending.operation}. Keep the operation record and run doctor. ${loaded.state.lastError}`);
  }
}

function assertNoPending(state: ManagedState) {
  if (state.incompleteOperation) {
    throw new Error(`An incomplete ${state.incompleteOperation.operation} is recorded. Run "npx @or3/cloud recover" before starting another operation.`);
  }
}

async function backupCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const pending: PendingOperation = {
    id: id('backup'), operation: 'backup', startedAt: now(), message: 'Creating a stopped-volume backup',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const result = await createBackup(loaded.directory, loaded.state, loaded.env);
    await clearPending(loaded.directory, loaded.state);
    console.log(`Backup ${result.backupId} created at ${result.backupDir}`);
    console.log(`SHA-256: ${result.manifest.dataSha256}`);
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    await writeState(loaded.directory, loaded.state);
    throw error;
  }
}

async function updateCommand(directory: string, flags: Flags) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  const { state, env } = loaded;
  assertNoPending(state);
  await waitForDeepHealth(loaded.directory, state.mode, secretValues(env));
  const targetVersion = stringFlag(flags, 'to')?.trim() ?? PACKAGE_VERSION;
  if (!isVersion(targetVersion)) throw new Error('--to must be a complete semantic version such as 0.1.15.');
  if (targetVersion === state.appVersion) throw new Error(`The deployment is already on OR3 ${targetVersion}.`);
  const targetImage = imageFor(targetVersion);
  const targetDigest = await pullImage(targetImage);
  const oldEnv = { ...env };
  const pending: PendingOperation = {
    id: id('update'),
    operation: 'update',
    startedAt: now(),
    message: `Updating from ${state.appVersion} to ${targetVersion}`,
    targetVersion,
    targetImage,
    targetImageDigest: targetDigest,
  };
  await markPending(loaded.directory, state, pending);
  try {
    const backup = await createBackup(loaded.directory, state, env);
    await updatePending(loaded.directory, state, { backupId: backup.backupId });
    const nextEnv = { ...env, OR3_VERSION: targetVersion, OR3_IMAGE: targetImage };
    await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(nextEnv));
    try {
      await startProject(loaded.directory, state.mode, nextEnv);
    } catch (error) {
      await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(oldEnv));
      await restoreBackupData(loaded.directory, state, oldEnv, backup.backupDir);
      const oldDigest = await imageDigest(state.image);
      state.imageDigest = oldDigest;
      state.lastError = `Update to ${targetVersion} failed and was restored: ${redact(error instanceof Error ? error.message : String(error), secretValues(oldEnv))}`;
      const operationId = pending.id;
      delete state.incompleteOperation;
      await removeOperationRecord(loaded.directory, operationId);
      await writeState(loaded.directory, state);
      throw new Error(state.lastError);
    }
    const digest = await requireImageDigest(targetImage, targetDigest, `OR3 ${targetVersion}`);
    state.rollback = {
      appVersion: state.appVersion,
      image: state.image,
      imageDigest: state.imageDigest,
      backupId: backup.backupId,
      createdAt: now(),
    };
    state.appVersion = targetVersion;
    state.image = targetImage;
    state.imageDigest = digest;
    state.lastSuccessfulOperation = 'update';
    state.lastError = undefined;
    await clearPending(loaded.directory, state);
    console.log(`OR3 updated to ${targetVersion}. Image digest: ${digest}`);
    console.log(`Rollback point: ${backup.backupId}. Keep it until login, chat, and file checks pass.`);
  } catch (error) {
    if (state.incompleteOperation) {
      state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(env));
      await writeState(loaded.directory, state);
    }
    throw error;
  }
}

async function resolveBackup(directory: string, value: string) {
  const candidate = isAbsolute(value) ? value : backupDirectory(directory, value);
  if (!await fileExists(join(candidate, 'manifest.json'))) throw new Error(`Backup ${value} was not found in ${deploymentPaths(directory).backups}.`);
  return resolve(candidate);
}

async function restoreCommand(directory: string, flags: Flags, positionals: string[]) {
  if (!boolFlag(flags, 'yes')) throw new Error('Restore replaces live data. Re-run with --yes after confirming the backup and data-loss boundary.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const backupValue = positionals[0];
  if (!backupValue) throw new Error('restore requires a backup ID or path.');
  const backupPath = await resolveBackup(loaded.directory, backupValue);
  const manifest = await readManifest(backupPath);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
  if (manifest.imageDigest) await pullAndRequireImage(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  const pending: PendingOperation = {
    id: id('restore'),
    operation: 'restore',
    startedAt: now(),
    message: `Restoring backup ${manifest.backupId}`,
    backupId: manifest.backupId,
    targetVersion: manifest.appVersion,
    targetImage: manifest.image,
    targetImageDigest: manifest.imageDigest,
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath);
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const digest = await imageDigest(restoredEnv.OR3_IMAGE);
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', digest);
    nextState.lastError = undefined;
    await removeOperationRecord(loaded.directory, pending.id);
    await writeState(loaded.directory, nextState);
    console.log(`Restored ${manifest.backupId}. Verify sign-in, a conversation, and a previously uploaded file.`);
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    await writeState(loaded.directory, loaded.state);
    throw error;
  }
}

async function rollbackCommand(directory: string, flags: Flags) {
  if (!boolFlag(flags, 'yes')) throw new Error('Rollback restores the previous image and data snapshot. Re-run with --yes after confirming post-update data loss.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const point = loaded.state.rollback;
  if (!point) throw new Error('No immediate rollback point is recorded for this deployment.');
  const backupPath = await resolveBackup(loaded.directory, point.backupId);
  const manifest = await readManifest(backupPath);
  if (manifest.appVersion !== point.appVersion || manifest.image !== point.image || manifest.imageDigest !== point.imageDigest) {
    throw new Error(`Rollback point ${point.backupId} no longer matches its recorded image/version. Refusing to mutate the deployment.`);
  }
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
  await pullAndRequireImage(point.image, point.imageDigest, 'Rollback');
  const pending: PendingOperation = {
    id: id('rollback'),
    operation: 'rollback',
    startedAt: now(),
    message: `Rolling back to ${point.appVersion}`,
    backupId: point.backupId,
    targetVersion: point.appVersion,
    targetImage: point.image,
    targetImageDigest: point.imageDigest,
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath);
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', await imageDigest(restoredEnv.OR3_IMAGE));
    nextState.rollback = undefined;
    await removeOperationRecord(loaded.directory, pending.id);
    await writeState(loaded.directory, nextState);
    console.log(`Rolled back to OR3 ${nextState.appVersion}. Verify sign-in, chat, and file access.`);
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    await writeState(loaded.directory, loaded.state);
    throw error;
  }
}

async function doctorCommand(directory: string) {
  const resolved = resolve(directory);
  const paths = deploymentPaths(resolved);
  const failures: string[] = [];
  let state: ManagedState | undefined;
  let env: Record<string, string> = {};
  let dockerReady = false;
  console.log(`OR3 Cloud doctor: ${resolved}`);
  try {
    await ensureDocker();
    dockerReady = true;
    console.log('✓ Docker Engine and Compose v2 are available');
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    console.log(`✗ Docker preflight failed`);
  }
  try {
    state = await readState(resolved);
    env = parseEnv(await readText(paths.env));
    console.log(`✓ Managed state: OR3 ${state.appVersion} (${state.imageDigest})`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    console.log('✗ Managed state or .env is missing/invalid');
  }
  for (const file of [paths.env, paths.state]) {
    if (!existsSync(file)) continue;
    const mode = (await stat(file)).mode & 0o777;
    if (mode !== 0o600) {
      failures.push(`${file} must be mode 0600 (currently ${mode.toString(8)}).`);
      console.log(`✗ Permissions: ${file} is ${mode.toString(8)}`);
    } else {
      console.log(`✓ Permissions: ${basename(file)} is 0600`);
    }
  }
  if (state) {
    try {
      if (
        env.OR3_VERSION !== state.appVersion ||
        env.OR3_IMAGE !== state.image ||
        env.OR3_COMPOSE_PROJECT !== state.composeProject ||
        env.OR3_VOLUME_NAME !== state.volumeName ||
        Number(env.OR3_PORT) !== state.port ||
        env.OR3_PUBLIC_DOMAIN !== (state.domain ?? 'localhost') ||
        (state.mode === 'public' && (env.OR3_CADDY_DATA_VOLUME !== state.caddyDataVolume || env.OR3_CADDY_CONFIG_VOLUME !== state.caddyConfigVolume))
      ) {
        throw new Error('Managed state does not match the deployment .env (version, image, or data volume).');
      }
      const actualDigest = await imageDigest(state.image);
      if (actualDigest !== state.imageDigest) {
        throw new Error(`Managed image digest differs from state. Expected ${state.imageDigest}, found ${actualDigest}.`);
      }
      const config = await resolvedComposeConfig(resolved, state.mode);
      if (!checkResolvedLoopbackBinding(config, state.port)) throw new Error('Resolved Compose configuration does not bind OR3 only to 127.0.0.1.');
      console.log('✓ OR3 port binding is loopback-only');
      console.log('✓ Compose configuration is valid');
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      console.log('✗ Compose configuration or port binding failed');
    }
    if (state.incompleteOperation) {
      failures.push(`Incomplete ${state.incompleteOperation.operation} ${state.incompleteOperation.id} is recorded.`);
      console.log(`✗ Incomplete operation: ${state.incompleteOperation.operation} (${state.incompleteOperation.id}). Run "npx @or3/cloud recover" after reviewing the diagnostics.`);
    }
    if (dockerReady) {
      try {
        await waitForDeepHealth(resolved, state.mode, secretValues(env));
        console.log('✓ Deep health is passing');
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Deep health is not passing');
      }
    }
    if (state.mode === 'public' && state.domain) {
      try {
        const caddy = await run('docker', composeArgs(resolved, state.mode, ['ps', '--services', '--status', 'running']), resolved);
        if (!caddy.ok || !caddy.stdout.split(/\s+/).includes('caddy')) throw new Error('Caddy is not running.');
        console.log('✓ Caddy service is running');
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Caddy service is not running');
      }
      try {
        const address = await checkPublicPrerequisites(state.domain);
        console.log(`✓ DNS: ${state.domain} → ${address}`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log(`✗ DNS: ${state.domain} does not resolve`);
      }
      for (const port of [80, 443]) {
        console.log((await portAvailable(port)) ? `⚠ Port ${port} is not listening (Caddy may be stopped)` : `✓ Port ${port} is in use by a local service; verify it is Caddy`);
      }
      console.log('ℹ Firewall: allow TCP 80/443 (and optional UDP 443) in your existing nftables or UFW rules; OR3 did not modify them.');
    }
  }
  if (failures.length) {
    throw new Error(`Doctor found ${failures.length} issue(s). Run: ${diagnostics(resolved, state?.mode ?? 'local')}`);
  }
  console.log('OR3 Cloud doctor passed.');
}

async function readSourceVolume(sourceDirectory: string) {
  const composeResult = await run('docker', [
    'compose', '--project-directory', sourceDirectory, '--env-file', join(sourceDirectory, '.env'),
    '-f', join(sourceDirectory, 'compose.yaml'), 'ps', '-aq', 'or3',
  ], sourceDirectory);
  if (composeResult.ok && composeResult.stdout.trim()) {
    const container = composeResult.stdout.trim().split(/\s+/)[0];
    const inspect = await run('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', container]);
    const project = inspect.ok ? inspect.stdout.trim() : sanitizeName(basename(sourceDirectory));
    const volumes = await run('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.volume=or3-data']);
    if (volumes.ok && volumes.stdout.trim()) return volumes.stdout.trim().split(/\s+/)[0];
  }
  const fallbackProject = sanitizeName(basename(sourceDirectory));
  const volumes = await run('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${fallbackProject}`, '--filter', 'label=com.docker.compose.volume=or3-data']);
  if (!volumes.ok || !volumes.stdout.trim()) throw new Error(`Could not resolve the V1 or3-data volume for ${sourceDirectory}. Keep the source project unchanged and inspect Docker volumes manually.`);
  return volumes.stdout.trim().split(/\s+/)[0];
}

function sourceMode(sourceDirectory: string, sourceEnv: Record<string, string>) {
  const publicDeployment = sourceEnv.OR3_PUBLIC_DOMAIN && sourceEnv.OR3_PUBLIC_DOMAIN !== 'localhost'
    && sourceEnv.OR3_FORCE_HTTPS !== 'false';
  return publicDeployment && existsSync(join(sourceDirectory, 'compose.public.yaml')) ? 'public' : 'local';
}

function sourceComposeArgs(sourceDirectory: string, sourceComposeFiles: string[]) {
  return [
    'compose', '--project-directory', sourceDirectory, '--env-file', join(sourceDirectory, '.env'),
    ...sourceComposeFiles,
  ];
}

async function restartSource(sourceDirectory: string, sourceComposeFiles: string[], secrets: string[]) {
  const args = sourceComposeArgs(sourceDirectory, sourceComposeFiles);
  const started = await run('docker', [...args, 'start'], sourceDirectory);
  if (!started.ok) throw new Error(`The original V1 deployment could not be started. ${redact(started.stderr, secrets)}`);
  await waitForDeepHealthWithArgs(args, sourceDirectory, secrets);
}

export function assertSupportedSource(sourceDirectory: string, sourceEnv: Record<string, string>, providers: string) {
  const values = [sourceEnv.AUTH_PROVIDER, sourceEnv.OR3_AUTH_PROVIDER].filter(Boolean);
  if (!values.includes('basic-auth')) throw new Error(`V1 project uses ${values.join(', ') || 'an unknown auth provider'}, not Basic Auth.`);
  if (sourceEnv.SSR_AUTH_ENABLED === 'false' || sourceEnv.OR3_GUEST_ACCESS_ENABLED === 'true') {
    throw new Error('V1 project does not require authenticated access; adoption expects the supported authenticated profile.');
  }
  if (sourceEnv.OR3_SYNC_PROVIDER !== 'sqlite' || sourceEnv.OR3_STORAGE_FS_ROOT === undefined || sourceEnv.NUXT_PUBLIC_STORAGE_PROVIDER !== 'fs') {
    throw new Error('V1 project is not the supported Basic Auth + SQLite + filesystem profile.');
  }
  if (sourceEnv.OR3_SYNC_ENABLED === 'false' || sourceEnv.OR3_CLOUD_SYNC_ENABLED === 'false' || sourceEnv.OR3_STORAGE_ENABLED === 'false' || sourceEnv.OR3_CLOUD_STORAGE_ENABLED === 'false') {
    throw new Error('V1 project has sync or storage disabled; adoption expects the supported enabled profile.');
  }
  const moduleIds = [...providers.matchAll(/or3-provider-[a-z0-9-]+\/nuxt/g)].map((match) => match[0]);
  const supported = new Set(['or3-provider-basic-auth/nuxt', 'or3-provider-sqlite/nuxt', 'or3-provider-fs/nuxt']);
  if (moduleIds.some((moduleId) => !supported.has(moduleId)) || moduleIds.length !== 3 || new Set(moduleIds).size !== 3) {
    throw new Error(`V1 provider modules are unsupported: ${moduleIds.join(', ') || 'none'}.`);
  }
  if (!sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL || !sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD) {
    throw new Error('V1 project has no Basic Auth bootstrap credentials; adoption cannot safely preserve first login.');
  }
  if (!sourceEnv.OR3_VERSION && !sourceEnv.OR3_IMAGE) {
    // The release manifest is checked separately; this only protects malformed env files.
    throw new Error('V1 project is missing OR3 version metadata.');
  }
  void sourceDirectory;
}

export function assertSupportedSourceCompose(configText: string, sourceVolume: string, expectedPort: number) {
  const config = parseComposeConfig(configText);
  const service = config.services?.or3;
  if (!service) throw new Error('V1 Compose configuration does not define an or3 service.');
  for (const [key, expected] of [
    ['OR3_BASIC_AUTH_DB_PATH', '/data/auth.sqlite'],
    ['OR3_SQLITE_DB_PATH', '/data/sync.sqlite'],
    ['OR3_STORAGE_FS_ROOT', '/data/storage'],
  ] as const) {
    if (composeEnvironmentValue(service, key) !== expected) {
      throw new Error(`V1 Compose configuration does not resolve ${key} to ${expected}. Adoption refuses custom data layouts.`);
    }
  }
  const mounts = service.volumes ?? [];
  const dataMount = mounts.find((mount) => mount.target === '/data');
  if (!dataMount || dataMount.type !== 'volume') {
    throw new Error('V1 Compose configuration must mount one named volume at /data.');
  }
  const mountSource = typeof dataMount.source === 'string' ? dataMount.source : '';
  const volumeDefinition = config.volumes?.[mountSource]?.name;
  if (mountSource !== sourceVolume && volumeDefinition !== sourceVolume) {
    throw new Error(`V1 Compose /data volume does not resolve to the detected Docker volume ${sourceVolume}.`);
  }
  if (mounts.some((mount) => typeof mount.target === 'string' && mount.target.startsWith('/data/') )) {
    throw new Error('V1 Compose configuration has an additional mount inside /data. Adoption refuses ambiguous storage layouts.');
  }
  if (!checkResolvedLoopbackBinding(configText, expectedPort)) {
    throw new Error('V1 Compose configuration must publish OR3 only on 127.0.0.1.');
  }
}

async function adoptCommand(positionals: string[], flags: Flags) {
  const sourceDirectory = resolve(requireStringFlag(flags, 'from'));
  const targetDirectory = resolve(process.cwd(), positionals[0] ?? `${basename(sourceDirectory)}-managed`);
  if (targetDirectory === sourceDirectory) throw new Error('Choose a separate target directory for adoption.');
  await readDirectoryEmpty(targetDirectory);
  if (!await fileExists(join(sourceDirectory, 'or3-release.json'))) throw new Error(`V1 release metadata is missing at ${sourceDirectory}/or3-release.json.`);
  const release = JSON.parse(await readText(join(sourceDirectory, 'or3-release.json'))) as { or3Version?: string };
  if (!release.or3Version || !isVersion(release.or3Version)) throw new Error('V1 release metadata does not contain a usable OR3 version.');
  const sourceEnv = parseEnv(await readText(join(sourceDirectory, '.env')));
  const providers = await readText(join(sourceDirectory, 'or3.providers.generated.ts'));
  assertSupportedSource(sourceDirectory, sourceEnv, providers);
  const mode = sourceMode(sourceDirectory, sourceEnv) as Mode;
  const domain = mode === 'public' ? sourceEnv.OR3_PUBLIC_DOMAIN : undefined;
  if (domain) await checkPublicPrerequisites(domain);
  const sourceComposeFiles = ['-f', join(sourceDirectory, 'compose.yaml')];
  if (mode === 'public') sourceComposeFiles.push('-f', join(sourceDirectory, 'compose.public.yaml'));
  await ensureDocker();
  const sourceConfig = await run('docker', [
    'compose', '--project-directory', sourceDirectory, '--env-file', join(sourceDirectory, '.env'),
    ...sourceComposeFiles, 'config', '--format', 'json',
  ], sourceDirectory);
  if (!sourceConfig.ok) throw new Error(`The V1 Compose configuration is invalid. ${redact(sourceConfig.stderr, secretValues(sourceEnv))}`);
  const image = imageFor(release.or3Version);
  if (sourceEnv.OR3_VERSION && sourceEnv.OR3_VERSION !== release.or3Version) {
    throw new Error(`V1 OR3_VERSION ${sourceEnv.OR3_VERSION} does not match or3-release.json ${release.or3Version}.`);
  }
  if (sourceEnv.OR3_IMAGE && sourceEnv.OR3_IMAGE !== image) {
    throw new Error(`V1 OR3_IMAGE ${sourceEnv.OR3_IMAGE} does not match the published image for ${release.or3Version}.`);
  }
  await pullImage(image);
  const sourceVolume = await readSourceVolume(sourceDirectory);
  const email = sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const password = sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  validateEmail(email);
  validatePassword(password);
  const sourcePort = Number(sourceEnv.OR3_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) throw new Error('V1 project has an invalid OR3 port.');
  if (mode === 'public' && [80, 443].includes(sourcePort)) throw new Error('V1 public deployment uses a Caddy port for OR3; adoption requires a separate OR3 port.');
  assertSupportedSourceCompose(sourceConfig.stdout, sourceVolume, sourcePort);
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(targetDirectory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(targetDirectory).backups, { recursive: true, mode: 0o700 });
  await copyAssets(targetDirectory, mode);
  const copiedSecrets: Record<string, string> = {};
  for (const key of SECRET_KEYS) if (sourceEnv[key]) copiedSecrets[key] = sourceEnv[key];
  const targetEnv = buildEnv({ mode, version: release.or3Version, directory: targetDirectory, email, password, domain, port: sourcePort, secrets: copiedSecrets });
  for (const key of ALLOWED_ENV_KEYS) if (sourceEnv[key] !== undefined) targetEnv[key] = sourceEnv[key];
  Object.assign(targetEnv, {
    OR3_VERSION: release.or3Version,
    OR3_IMAGE: image,
    OR3_COMPOSE_PROJECT: composeProjectNames(targetDirectory).project,
    OR3_VOLUME_NAME: composeProjectNames(targetDirectory).volume,
    OR3_CADDY_DATA_VOLUME: composeProjectNames(targetDirectory).caddyData,
    OR3_CADDY_CONFIG_VOLUME: composeProjectNames(targetDirectory).caddyConfig,
    OR3_PORT: String(sourcePort),
    OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
    OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
    OR3_STORAGE_FS_ROOT: '/data/storage',
    OR3_PUBLIC_DOMAIN: domain ?? 'localhost',
    OR3_ALLOWED_ORIGINS: mode === 'public' ? `https://${domain}` : `http://127.0.0.1:${sourcePort}`,
    OR3_FORCE_HTTPS: mode === 'public' ? 'true' : 'false',
    OR3_TRUST_PROXY: mode === 'public' ? 'true' : 'false',
  });
  const targetNames = composeProjectNames(targetDirectory);
  for (const volume of [targetNames.volume, ...(mode === 'public' ? [targetNames.caddyData, targetNames.caddyConfig] : [])]) {
    const existing = await run('docker', ['volume', 'inspect', volume]);
    if (existing.ok) throw new Error(`Docker volume ${volume} already exists. Choose a new adoption target directory.`);
  }
  await writeSecure(deploymentPaths(targetDirectory).env, serializeEnv(targetEnv));
  await writeSecure(join(targetDirectory, '.or3-initial-credentials'), `email=${email}\npassword=${password}\n`);
  const digest = await imageDigest(image);
  const state = stateFromEnv(targetDirectory, targetEnv, mode, 'adopt', digest);
  await markPending(targetDirectory, state, {
    id: id('adopt'),
    operation: 'adopt',
    startedAt: now(),
    message: `Adopting ${sourceDirectory}`,
    sourceDirectory,
  });
  let sourceStopAttempted = false;
  let sourceBackupDir: string | undefined;
  try {
    sourceStopAttempted = true;
    const sourceStop = await run('docker', [...sourceComposeArgs(sourceDirectory, sourceComposeFiles), 'stop'], sourceDirectory);
    if (!sourceStop.ok) throw new Error(`Could not stop the V1 deployment. ${redact(sourceStop.stderr, secretValues(sourceEnv))}`);
    if (!await portAvailable(Number(targetEnv.OR3_PORT))) throw new Error(`Port ${targetEnv.OR3_PORT} is still in use after stopping the V1 deployment.`);
    if (mode === 'public') {
      for (const publicPort of [80, 443]) {
        if (!await portAvailable(publicPort)) throw new Error(`Public port ${publicPort} is still in use after stopping the V1 deployment.`);
      }
    }
    const sourceBackupId = id('adopt-source');
    sourceBackupDir = backupDirectory(targetDirectory, sourceBackupId);
    await mkdir(sourceBackupDir, { recursive: true, mode: 0o700 });
    await copySecure(join(sourceDirectory, '.env'), join(sourceBackupDir, 'config.env'));
    await archiveExternalVolume(image, sourceVolume, sourceBackupDir);
    const sourceManifest: BackupManifest = {
      schemaVersion: 1,
      backupId: sourceBackupId,
      createdAt: now(),
      appVersion: release.or3Version,
      image,
      imageDigest: digest,
      dataSha256: await sha256File(join(sourceBackupDir, 'data.tgz')),
      configSha256: await sha256File(join(sourceBackupDir, 'config.env')),
      mode,
      domain,
      composeProject: sourceEnv.OR3_COMPOSE_PROJECT ?? sanitizeName(basename(sourceDirectory)),
      volumeName: sourceVolume,
      caddyDataVolume: sourceEnv.OR3_CADDY_DATA_VOLUME,
      caddyConfigVolume: sourceEnv.OR3_CADDY_CONFIG_VOLUME,
      port: sourcePort,
    };
    await writeSecure(join(sourceBackupDir, 'manifest.json'), `${JSON.stringify(sourceManifest, null, 2)}\n`);
    await updatePending(targetDirectory, state, { backupId: sourceBackupId });
    await compose(targetDirectory, mode, ['run', '--rm', '--no-deps', '--user', '0:0', '-v', `${sourceVolume}:/source:ro`, '--entrypoint', 'sh', 'or3', '-c', 'mkdir -p /data && cp -a /source/. /data/'], secretValues(targetEnv));
    await startProject(targetDirectory, mode, targetEnv);
    await clearPending(targetDirectory, state);
    console.log(`Adopted ${sourceDirectory} into ${targetDirectory} at OR3 ${release.or3Version}.`);
    console.log(`Source backup: ${sourceBackupDir}`);
    console.log(`The original deployment is preserved and stopped. Verify sign-in, chat, and file access before removing anything.`);
  } catch (error) {
    await compose(targetDirectory, mode, ['down']).catch(() => undefined);
    let sourceRecoveryError = '';
    if (sourceStopAttempted) {
      try {
        await restartSource(sourceDirectory, sourceComposeFiles, secretValues(sourceEnv));
      } catch (recovery) {
        sourceRecoveryError = ` Original deployment recovery failed: ${recovery instanceof Error ? recovery.message : String(recovery)}`;
      }
    }
    state.lastError = redact(`${error instanceof Error ? error.message : String(error)}${sourceRecoveryError}`, secretValues(targetEnv));
    await writeState(targetDirectory, state);
    throw new Error(`${state.lastError}\n${sourceRecoveryError ? 'The original V1 deployment needs manual recovery. ' : 'The original V1 deployment was restarted and deeply healthy. '}Managed files remain at ${targetDirectory}.${sourceBackupDir ? ` Source backup: ${sourceBackupDir}.` : ''}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  if (command === '--help' || command === 'help') return help();
  if (command === '--version' || command === 'version') return console.log(PACKAGE_VERSION);
  const parsed = parseFlags(rest);
  try {
    if (parsed.flags.help) return help();
    assertCommandFlags(command, parsed.flags);
    if (command === 'init') return await initCommand(parsed.positionals, parsed.flags);
    if (command === 'update') return await updateCommand(process.cwd(), parsed.flags);
    if (command === 'backup') return await backupCommand(process.cwd());
    if (command === 'restore') return await restoreCommand(process.cwd(), parsed.flags, parsed.positionals);
    if (command === 'rollback') return await rollbackCommand(process.cwd(), parsed.flags);
    if (command === 'doctor') return await doctorCommand(process.cwd());
    if (command === 'recover') return await recoverCommand(process.cwd());
    if (command === 'adopt') return await adoptCommand(parsed.positionals, parsed.flags);
    throw new Error(`Unknown command "${command}". Run npx @or3/cloud --help.`);
  } catch (error) {
    console.error(`\nOR3 Cloud failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  }
}

const invokedAsCli = process.argv[1]
  ? ['or3', 'cli.mjs'].includes(basename(process.argv[1]))
  : false;
if (invokedAsCli || (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))) {
  await main();
}
