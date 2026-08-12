#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { dirname, basename, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const execFile = promisify(execFileCallback);

export const PACKAGE_VERSION = '0.1.37';
export const IMAGE_REPOSITORY = 'ghcr.io/saluana/or3-chat';
const ASSET_ROOT = resolve(fileURLToPath(new URL('../assets/', import.meta.url)));
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_PORT = 3000;
const DEEP_HEALTH_TIMEOUT_MS = 180_000;
const BACKUP_RETENTION_KEEP = 5;
const PURGE_REQUIRES_BACKUP_WITHIN_MS = 24 * 60 * 60 * 1000;
const FREE_SPACE_HEADROOM_BYTES = 64 * 1024 * 1024;
const BACKUP_ID_PATTERN = /^backup-[0-9A-Za-z-]+$/;
const SECRET_KEYS = [
  'OR3_BASIC_AUTH_JWT_SECRET',
  'OR3_BASIC_AUTH_REFRESH_SECRET',
  'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_AUTH_INVITE_TOKEN_SECRET',
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
type Operation = 'init' | 'update' | 'restore' | 'adopt' | 'credentials-reset';
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
    credentialReset?: {
      nextEnv: Record<string, string>;
    };
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
  /** Uncompressed live-volume bytes measured immediately before archiving. */
  dataBytes?: number;
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

type BackupExportReceipt = {
  schemaVersion: 1;
  backupId: string;
  exportedAt: string;
  destination: string;
  destinationDevice: number;
  dataSha256: string;
  configSha256?: string;
};

type Flags = Record<string, string | boolean>;

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  command: string;
  exitCode: number | null;
};

const ALLOWED_ENV_KEYS = new Set([
  'SSR_AUTH_ENABLED',
  'AUTH_PROVIDER',
  'OR3_AUTH_PROVIDER',
  'OR3_AUTH_REGISTRATION_MODE',
  'OR3_AUTH_AUTO_PROVISION',
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

export function serializeInitialCredentials(input: {
  bootstrapEmail: string;
  bootstrapPassword: string;
  adminUsername: string;
  adminPassword: string;
}) {
  return [
    '# OR3 first-run credentials — move to a password manager, then delete this file.',
    `OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=${serializeCredentialValue(input.bootstrapEmail)}`,
    `OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=${serializeCredentialValue(input.bootstrapPassword)}`,
    `OR3_ADMIN_USERNAME=${serializeCredentialValue(input.adminUsername)}`,
    `OR3_ADMIN_PASSWORD=${serializeCredentialValue(input.adminPassword)}`,
    '',
  ].join('\n');
}

export function validatePassword(password: string) {
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
  backup: ['keep', 'force', 'yes'],
  restore: ['yes'],
  rollback: ['yes'],
  doctor: [],
  recover: [],
  adopt: ['from'],
  credentials: ['yes', 'owner-password', 'admin-password'],
  status: [],
  logs: ['tail'],
  start: [],
  stop: [],
  restart: [],
  remove: ['purge-data', 'yes'],
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
    return {
      ok: true,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      command: printable,
      exitCode: 0,
    };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    const stdout = failure.stdout ?? '';
    return {
      ok: false,
      stdout,
      command: printable,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      stderr: redact(failure.stderr || stdout || String(error)),
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

/** Total bytes an operation needs on disk: required data plus reserve headroom. */
export function requiredArchiveSpace(requiredBytes: number) {
  return requiredBytes + Math.max(Math.ceil(requiredBytes / 2), FREE_SPACE_HEADROOM_BYTES);
}

/** Pure free-space gate: fails when free bytes cannot cover the archive plus headroom. */
export function assertEnoughFreeSpace(freeBytes: number, requiredBytes: number, label: string) {
  const needed = requiredArchiveSpace(requiredBytes);
  if (freeBytes < needed) {
    throw new Error(`${label} needs at least ${needed} bytes of free space (${requiredBytes} required plus reserve headroom) but only ${freeBytes} bytes are available. Free disk space or move backups off-host before retrying.`);
  }
}

/**
 * Preflight for archive operations. Checks the filesystem that holds
 * `targetPath` (the directory the archive will be written into) via statfs,
 * which reports free blocks for the unprivileged user. Used before a backup
 * writes data.tgz and before a restore extracts one.
 */
async function assertFreeSpaceForArchive(targetPath: string, requiredBytes: number, label: string) {
  let stats;
  try {
    stats = await statfs(dirname(targetPath));
  } catch (error) {
    throw new Error(`Could not check free disk space for ${dirname(targetPath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertEnoughFreeSpace(Number(stats.bavail) * Number(stats.bsize), requiredBytes, label);
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

function serializeCredentialValue(value: string) {
  if (/^[A-Za-z0-9._:@%+=/-]+$/.test(value)) return value;
  return serializeEnvValue(value);
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
    exports: join(cloud, 'exports'),
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

async function captureComposeDiagnostics(directory: string, mode: Mode, secrets: string[]) {
  const sections: string[] = [];
  for (const [label, command] of [
    ['compose ps', ['ps', '-a']],
    ['compose logs', ['logs', '--tail=200']],
  ] as const) {
    const result = await run('docker', composeArgs(directory, mode, [...command]), directory);
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    sections.push(`${label}:\n${detail || '(no output)'}`);
  }
  const containers = await run('docker', composeArgs(directory, mode, ['ps', '-aq']), directory);
  for (const container of containers.stdout.split(/\s+/).filter(Boolean)) {
    const state = await run('docker', ['inspect', '--format', '{{json .State}}', container], directory);
    const detail = [state.stdout, state.stderr].filter(Boolean).join('\n').trim();
    sections.push(`container ${container} state:\n${detail || '(no output)'}`);
  }
  return redact(sections.join('\n\n'), secrets);
}

async function compose(directory: string, mode: Mode, command: string[], secrets: string[] = []) {
  const result = await run('docker', composeArgs(directory, mode, command), directory);
  if (!result.ok) {
    const captured = await captureComposeDiagnostics(directory, mode, secrets).catch((error) =>
      redact(`Diagnostics capture failed: ${error instanceof Error ? error.message : String(error)}`, secrets),
    );
    throw new Error(`${redact(result.command, secrets)}\n${redact(result.stderr, secrets)}\nCaptured Docker diagnostics:\n${captured}\nDiagnostics: ${diagnostics(directory, mode)}`);
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

const HEALTH_SCRIPT = "const fs=require('node:fs');try{fs.accessSync('/data',fs.constants.R_OK|fs.constants.W_OK);for(const path of [process.env.OR3_BASIC_AUTH_DB_PATH,process.env.OR3_SQLITE_DB_PATH].filter(Boolean)){const fd=fs.openSync(path,'r+');fs.closeSync(fd)}}catch{process.exit(1)}fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok||body.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))";
const MAINTENANCE_SCRIPT = "fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));const m=body?.providers?.sync?.details?.maintenance;if(m)console.log(JSON.stringify(m))}).catch(()=>{})";
const CONTAINER_NODE = '/nodejs/bin/node';
const LEGACY_CONTAINER_NODE = '/usr/local/bin/node';
const CONTAINER_NODE_SHELL = `if [ -x ${CONTAINER_NODE} ]; then exec ${CONTAINER_NODE} -e "$1"; elif [ -x ${LEGACY_CONTAINER_NODE} ]; then exec ${LEGACY_CONTAINER_NODE} -e "$1"; else exit 127; fi`;
const MANAGED_RUNTIME_UID = 65532;
const MANAGED_RUNTIME_GID = 65532;

function containerNodeCommand(script: string) {
  return ['sh', '-c', CONTAINER_NODE_SHELL, 'or3-node', script];
}

async function waitForDeepHealthWithArgs(composeCommand: string[], directory: string, secrets: string[] = []) {
  const deadline = Date.now() + DEEP_HEALTH_TIMEOUT_MS;
  let lastError = 'health check did not complete';
  while (Date.now() < deadline) {
    const result = await run('docker', [
      ...composeCommand,
      'exec', '-T', 'or3', ...containerNodeCommand(HEALTH_SCRIPT),
    ], directory);
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

type VolumeRootOwnership = { uid: number; gid: number };

async function managedVolumeRootOwnership(image: string, volume: string): Promise<VolumeRootOwnership> {
  const result = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL',
    '-v', `${volume}:/data:ro`, '--entrypoint', 'sh', image, '-c', "stat -c '%u:%g' /data",
  ]);
  if (!result.ok) throw new Error(`Could not inspect managed volume ${volume}. ${result.stderr.trim()}`);
  const match = result.stdout.trim().match(/^(\d+):(\d+)$/);
  if (!match) throw new Error(`Managed volume ${volume} returned an invalid root ownership value.`);
  return { uid: Number(match[1]), gid: Number(match[2]) };
}

async function setManagedVolumeRootOwnership(image: string, volume: string, ownership: VolumeRootOwnership) {
  if (!Number.isSafeInteger(ownership.uid) || ownership.uid < 0 || !Number.isSafeInteger(ownership.gid) || ownership.gid < 0) {
    throw new Error('Refusing an invalid managed volume root UID/GID.');
  }
  const result = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
    '-v', `${volume}:/data`, '--entrypoint', 'sh', image, '-c',
    `chown ${ownership.uid}:${ownership.gid} /data`,
  ]);
  if (!result.ok) throw new Error(`Could not set managed volume ${volume} root ownership. ${result.stderr.trim()}`);
  const actual = await managedVolumeRootOwnership(image, volume);
  if (actual.uid !== ownership.uid || actual.gid !== ownership.gid) {
    throw new Error(`Managed volume ${volume} root ownership verification failed.`);
  }
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
    const captured = await captureComposeDiagnostics(directory, mode, secrets).catch((captureError) =>
      redact(`Diagnostics capture failed: ${captureError instanceof Error ? captureError.message : String(captureError)}`, secrets),
    );
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nCaptured Docker diagnostics:\n${captured}\nDiagnostics: ${diagnostics(directory, mode)}`);
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

export type ImageManifest = {
  architecture?: string;
  manifests?: Array<{ platform?: { architecture?: string } }>;
};

export function supportedImageArchitectures(manifest: ImageManifest | null | undefined): string[] {
  if (manifest && Array.isArray(manifest.manifests)) {
    const architectures = manifest.manifests
      .map((entry) => entry.platform?.architecture)
      .filter((value): value is string => typeof value === 'string');
    if (architectures.length > 0) return [...new Set(architectures)];
  }
  if (manifest && typeof manifest.architecture === 'string') return [manifest.architecture];
  throw new Error('The OR3 image manifest has no recognizable architecture list. Refusing to continue without confirming the image supports this machine.');
}

export function assertSupportedArchitecture(manifest: ImageManifest | null | undefined, hostArch: 'arm64' | 'amd64') {
  const supported = supportedImageArchitectures(manifest);
  if (!supported.includes(hostArch)) {
    throw new Error(
      `OR3 does not publish a ${hostArch} image for this version yet. Supported architectures: ${supported.join(', ') || 'none detected'}. Install on a supported machine or wait for the next release.`,
    );
  }
}

function hostArchitecture(): 'arm64' | 'amd64' {
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'x64') return 'amd64';
  throw new Error(`OR3 supports only linux/amd64 and linux/arm64 hosts; this machine reports ${process.arch}. Install on a supported machine.`);
}

async function assertSupportedHostArchitecture(image: string) {
  const hostArch = hostArchitecture();
  // Qualification runs intentionally use a local, not-yet-published candidate
  // image. Its single-platform Docker image config is the authoritative source
  // there; normal operator installs still require the registry manifest list.
  if (process.env.OR3_CLOUD_SKIP_PULL === 'true') {
    const local = await run('docker', ['image', 'inspect', '--format', '{{.Architecture}}', image]);
    if (local.ok && local.stdout.trim()) {
      assertSupportedArchitecture({ architecture: local.stdout.trim() }, hostArch);
      return;
    }
  }
  const result = await run('docker', ['manifest', 'inspect', image]);
  if (!result.ok) {
    throw new Error(`Could not inspect the OR3 image manifest for ${image}. ${result.stderr.trim()}`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`The OR3 image manifest for ${image} could not be parsed. Refusing to continue without confirming the image supports this machine.`);
  }
  assertSupportedArchitecture(manifest as ImageManifest, hostArch);
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
    OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false',
    OR3_GUEST_ACCESS_ENABLED: 'false',
    OR3_PLUGIN_ZIP_INSTALL_ENABLED: 'false',
    OR3_ADMIN_ALLOW_REBUILD: 'false',
    OR3_BASIC_AUTH_JWT_SECRET: secrets.OR3_BASIC_AUTH_JWT_SECRET ?? randomSecret(),
    OR3_BASIC_AUTH_REFRESH_SECRET: secrets.OR3_BASIC_AUTH_REFRESH_SECRET ?? randomSecret(),
    OR3_BASIC_AUTH_ACCESS_TTL_SECONDS: '900',
    OR3_BASIC_AUTH_REFRESH_TTL_SECONDS: '2592000',
    OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: input.email,
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: input.password,
    OR3_AUTH_INVITE_TOKEN_SECRET:
      secrets.OR3_AUTH_INVITE_TOKEN_SECRET ?? randomSecret(),
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

/**
 * Measures the live data volume (mounted at /data) in bytes for the
 * free-space preflight, before the service is stopped.
 *
 * Probe choice: `du -sb` runs inside the or3 image itself — first via
 * `docker compose exec` against the running container, then via
 * `docker compose run --entrypoint sh` (same image, no second image needed)
 * when the deployment is stopped. The managed distroless image includes the
 * pinned BusyBox applets used here, and /data is already mounted there.
 */
async function dataVolumeSize(directory: string, mode: Mode, env: Record<string, string>) {
  const parseDuOutput = (stdout: string) => {
    const match = stdout.trim().match(/^(\d+)/);
    if (!match) throw new Error(`Could not parse the data volume size from "du" output.`);
    return Number(match[1]);
  };
  const exec = await run('docker', [...composeArgs(directory, mode, ['exec', '-T', 'or3', 'sh', '-c', 'du -sb /data 2>/dev/null'])], directory);
  if (exec.ok) return parseDuOutput(exec.stdout);
  const fallback = await run('docker', [...composeArgs(directory, mode, ['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'or3', '-c', 'du -sb /data 2>/dev/null'])], directory);
  if (fallback.ok) return parseDuOutput(fallback.stdout);
  throw new Error(`Could not measure the data volume size for the free-space preflight. Start the deployment and retry. ${redact(`${exec.stderr} ${fallback.stderr}`)}`);
}

/** Pure guard: only an operation's own generated backup ID may be removed. */
export function assertRemovableArtifactName(name: string) {
  if (!BACKUP_ID_PATTERN.test(name)) {
    throw new Error(`Refusing to remove a backup artifact named "${name}". Only paths matching an OR3-generated backup ID may be removed.`);
  }
  return name;
}

/**
 * Removes exactly the named backup directory under .or3-cloud/backups and
 * nothing else: the name must match an OR3-generated backup ID and the
 * resolved path must sit directly inside the backups root.
 */
async function removeNamedBackupArtifact(directory: string, backupId: string) {
  assertRemovableArtifactName(backupId);
  const target = backupDirectory(directory, backupId);
  if (dirname(target) !== deploymentPaths(directory).backups) {
    throw new Error(`Refusing to remove a path outside the backups directory: ${target}.`);
  }
  await rm(target, { recursive: true, force: true });
  await rm(join(deploymentPaths(directory).exports, `${backupId}.json`), { force: true });
}

type BackupListing = {
  backupId: string;
  createdAt: string;
  appVersion: string;
  path: string;
  bytes: number;
  dataSha256: string;
};

/** Reads a backup manifest for listing/pruning without checksum verification. */
async function readBackupManifestMetadata(backupPath: string): Promise<BackupManifest | null> {
  try {
    const manifest = JSON.parse(await readText(join(backupPath, 'manifest.json'))) as BackupManifest;
    if (manifest.schemaVersion !== 1 || !manifest.backupId || !manifest.createdAt) return null;
    return manifest;
  } catch {
    return null;
  }
}

/** Enumerates complete backups (manifest present) newest first. */
async function enumerateBackups(directory: string): Promise<BackupListing[]> {
  const backupsRoot = deploymentPaths(directory).backups;
  let entries: string[] = [];
  try {
    entries = await readdir(backupsRoot);
  } catch {
    return [];
  }
  const result: BackupListing[] = [];
  for (const entry of entries) {
    const path = join(backupsRoot, entry);
    const manifest = await readBackupManifestMetadata(path);
    if (!manifest) continue;
    let bytes = 0;
    try {
      for (const file of ['data.tgz', 'config.env', 'manifest.json']) {
        bytes += (await stat(join(path, file))).size;
      }
    } catch {
      bytes = 0;
    }
    result.push({
      backupId: manifest.backupId,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      path,
      bytes,
      dataSha256: manifest.dataSha256,
    });
  }
  result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return result;
}

/**
 * Pure retention rule: keeps the newest `keep` backups. Backups referenced by
 * the rollback point or an incomplete operation are never pruned unless
 * `force` is set. Returns the IDs to delete (newest first).
 */
export function selectPruneTargets(
  backups: Array<{ backupId: string; createdAt: string }>,
  keep: number,
  protectedIds: ReadonlySet<string>,
  force = false,
) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Backup retention must be an integer of at least 1.');
  const sorted = [...backups].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const deletable = force ? sorted : sorted.filter((backup) => !protectedIds.has(backup.backupId));
  return deletable.slice(keep).map((backup) => backup.backupId);
}

function parseKeep(flags: Flags) {
  const value = stringFlag(flags, 'keep') ?? String(BACKUP_RETENTION_KEEP);
  const keep = Number(value);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be an integer of at least 1.');
  return keep;
}

/**
 * Enforces bounded backup retention. Protected backups (the recorded rollback
 * point and any incomplete-operation backup) are exempt unless `force` is
 * passed. Prints each deleted backup id and path.
 */
async function pruneBackups(directory: string, state: ManagedState, keep: number, force: boolean) {
  const backups = await enumerateBackups(directory);
  const protectedIds = new Set<string>();
  if (state.rollback?.backupId) protectedIds.add(state.rollback.backupId);
  if (state.incompleteOperation?.backupId) protectedIds.add(state.incompleteOperation.backupId);
  const targets = selectPruneTargets(backups, keep, protectedIds, force);
  if (force && targets.length > 0) {
    console.log(`--force --yes will permanently delete: ${targets.join(', ')}`);
  }
  for (const backupId of targets) {
    await removeNamedBackupArtifact(directory, backupId);
    console.log(`Deleted backup ${backupId} at ${backupDirectory(directory, backupId)}`);
  }
  return targets.length;
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

/**
 * Refuses to operate on a directory whose basename no longer resolves to the
 * Compose project and volume names recorded in managed state. A renamed or
 * copied deployment would otherwise target a different (or unrelated) project
 * in Docker. Reuse of composeProjectNames keeps the same derivation as init.
 */
function assertDeploymentDirectoryIdentity(directory: string, state: ManagedState) {
  const resolved = resolve(directory);
  const names = composeProjectNames(resolved);
  const mismatches: string[] = [];
  if (state.composeProject !== names.project) {
    mismatches.push(`compose project "${state.composeProject}" (this directory resolves to "${names.project}")`);
  }
  if (state.volumeName !== names.volume) {
    mismatches.push(`volume "${state.volumeName}" (this directory resolves to "${names.volume}")`);
  }
  if (state.mode === 'public') {
    if (state.caddyDataVolume !== names.caddyData) mismatches.push(`Caddy data volume "${state.caddyDataVolume}"`);
    if (state.caddyConfigVolume !== names.caddyConfig) mismatches.push(`Caddy config volume "${state.caddyConfigVolume}"`);
  }
  if (mismatches.length) {
    throw new Error(`Managed state does not match the deployment directory identity: ${mismatches.join('; ')}. Refusing to operate on an unrelated project. Run doctor for diagnostics.`);
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
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return digest.digest('hex');
}

/** Streams a container archive to a host-owned file without a root bind mount. */
async function streamCommandToFile(
  command: string,
  args: string[],
  destination: string,
  cwd?: string,
  secrets: string[] = [],
) {
  if (await fileExists(destination)) {
    throw new Error(`Refusing to overwrite existing archive ${destination}.`);
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomBytes(8).toString('hex')}.partial`;
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const exit = new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  try {
    const [exitCode] = await Promise.all([
      exit,
      pipeline(child.stdout, createWriteStream(temporary, { flags: 'wx', mode: 0o600 })),
    ]);
    if (exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}. ${redact(stderr, secrets)}`.trim());
    }
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    await rm(temporary, { force: true }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr && !detail.includes(stderr) ? `\n${redact(stderr, secrets)}` : ''}`);
  }
}

/** Streams a private host archive into a container without bind-mounting it. */
async function streamFileToCommand(
  command: string,
  args: string[],
  source: string,
  cwd?: string,
  secrets: string[] = [],
) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const exit = new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  try {
    const [exitCode] = await Promise.all([
      exit,
      pipeline(createReadStream(source), child.stdin),
    ]);
    if (exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}. ${redact(stderr, secrets)}`.trim());
    }
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr && !detail.includes(stderr) ? `\n${redact(stderr, secrets)}` : ''}`);
  }
}

async function gzipUncompressedBytes(path: string) {
  let bytes = 0;
  const counter = new Writable({
    write(chunk, _encoding, callback) {
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      callback();
    },
  });
  await pipeline(createReadStream(path), createGunzip(), counter);
  return bytes;
}

async function volumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupDir: string) {
  await streamCommandToFile(
    'docker',
    composeArgs(directory, mode, [
      'run', '--rm', '--no-deps', '--entrypoint', 'sh', 'or3', '-c',
      'tar czf - -C /data .',
    ]),
    join(backupDir, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

async function archiveExternalVolume(image: string, volume: string, backupDir: string) {
  // Source V1 volumes may be root-owned, so the reader stays root. The archive
  // itself is streamed to a file opened by this user, avoiding root-owned 0600
  // backups on ordinary Linux Docker hosts.
  await streamCommandToFile(
    'docker',
    ['run', '--rm', '--user', '0:0', '-v', `${volume}:/source:ro`, image, 'sh', '-c', 'tar czf - -C /source .'],
    join(backupDir, 'data.tgz'),
  );
}

async function restoreVolumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupPath: string) {
  // Host backups intentionally stay 0700/0600. Stream the archive over stdin
  // so the normal image user can write its owned /data volume without either
  // exposing the backup through a bind mount or forcing a capability-less root.
  await streamFileToCommand(
    'docker',
    composeArgs(directory, mode, [
      'run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'or3', '-c',
      'find /data -mindepth 1 -delete && tar xzf - -C /data',
    ]),
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

async function createBackup(directory: string, state: ManagedState, env: Record<string, string>) {
  await requireImageDigest(state.image, state.imageDigest, 'Current deployment');
  const backupId = id('backup');
  const backupDir = backupDirectory(directory, backupId);
  // Preflight before anything is created: the archive needs the live volume
  // size plus reserve headroom on the deployment filesystem.
  const volumeSize = await dataVolumeSize(directory, state.mode, env);
  await assertFreeSpaceForArchive(backupDir, volumeSize, 'Backup');
  let manifestWritten = false;
  let stopAttempted = false;
  try {
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await chmod(backupDir, 0o700);
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
      dataBytes: volumeSize,
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
    manifestWritten = true;
    try {
      await pruneBackups(directory, state, BACKUP_RETENTION_KEEP, false);
    } catch (error) {
      console.log(`Warning: automatic backup retention could not run: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { backupId, backupDir, manifest };
  } catch (error) {
    if (!manifestWritten) {
      await removeNamedBackupArtifact(directory, backupId).catch(() => undefined);
      throw new Error(`${error instanceof Error ? error.message : String(error)} The partial backup artifact at ${backupDir} was removed.`);
    }
    throw error;
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
    !/^sha256:[0-9a-f]{64}$/i.test(manifest.imageDigest) ||
    (manifest.dataBytes !== undefined && (!Number.isSafeInteger(manifest.dataBytes) || manifest.dataBytes < 0))
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

async function dataVolumeFreeBytes(directory: string, mode: Mode, env: Record<string, string>) {
  const parse = (stdout: string) => {
    const blocks = Number(stdout.trim());
    if (!Number.isSafeInteger(blocks) || blocks < 0) throw new Error('Could not parse free blocks from the data volume.');
    return blocks * 1024;
  };
  const script = "df -Pk /data | awk 'NR == 2 { print $4 }'";
  const exec = await run('docker', [...composeArgs(directory, mode, ['exec', '-T', 'or3', 'sh', '-c', script])], directory);
  if (exec.ok) return parse(exec.stdout);
  const fallback = await run('docker', [...composeArgs(directory, mode, ['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'or3', '-c', script])], directory);
  if (fallback.ok) return parse(fallback.stdout);
  throw new Error(`Could not measure free space in the Docker data volume. ${redact(`${exec.stderr} ${fallback.stderr}`, secretValues(env))}`);
}

async function assertRestoreFreeSpace(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  manifest: BackupManifest,
  backupPath: string,
) {
  const archiveBytes = await gzipUncompressedBytes(join(backupPath, 'data.tgz'));
  const requiredBytes = Math.max(manifest.dataBytes ?? 0, archiveBytes);
  const freeBytes = await dataVolumeFreeBytes(directory, state.mode, env);
  assertEnoughFreeSpace(freeBytes, requiredBytes, 'Restore');
}

async function restoreBackupData(directory: string, state: ManagedState, env: Record<string, string>, backupPath: string) {
  const manifest = await readManifest(backupPath);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, state, env);
  if (manifest.imageDigest) await requireImageDigest(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  // Preflight the filesystem Docker will actually extract into. A compressed
  // tarball's byte size and the backup directory's filesystem cannot prove
  // there is room in /data.
  await assertRestoreFreeSpace(directory, state, env, manifest, backupPath);
  let started = false;
  let stopAttempted = false;
  try {
    stopAttempted = true;
    await stopProject(directory, state.mode);
    await copySecure(join(backupPath, 'config.env'), deploymentPaths(directory).env);
    await restoreVolumeArchive(directory, state.mode, backupEnv, backupPath);
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
  npx @or3/cloud backup [list|prune [--keep <n>]|export <backup-id> <destination-dir>]
  npx @or3/cloud restore <backup-id-or-path> --yes
  npx @or3/cloud rollback --yes
  npx @or3/cloud credentials reset --yes [--owner-password <p> --admin-password <p>]
  npx @or3/cloud doctor
  npx @or3/cloud recover
  npx @or3/cloud adopt --from <v1-directory> [directory]
  npx @or3/cloud status
  npx @or3/cloud logs [--tail <n>] [service]
  npx @or3/cloud start | stop | restart
  npx @or3/cloud remove [--purge-data --yes]

Options:
  --admin-email <email>          Administrator email for first login
  --admin-password <password>    Explicit password (prefer --admin-password-file); for credentials reset, the new admin password
  --admin-password-file <path>   Read the bootstrap password without shell history
  --owner-password <password>    New owner (basic auth) password for credentials reset
  --port <port>                  Local OR3 port (default: 3000)
  --keep <n>                     Backups to retain when pruning (default: 5)
  --force                        Prune backups even when referenced by the rollback point
  --tail <n>                     Log lines to show (default: 200)
  --purge-data                   Remove data volumes and managed files (with remove)
  --yes                          Confirm a destructive restore, rollback, credentials reset, or purge
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
  await assertSupportedHostArchitecture(image);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await mkdir(deploymentPaths(directory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(directory).backups, { recursive: true, mode: 0o700 });
  await copyAssets(directory, mode);
  const env = buildEnv({ mode, version, directory, email, password, domain, port });
  await writeSecure(deploymentPaths(directory).env, serializeEnv(env));
  await writeSecure(join(directory, '.or3-initial-credentials'), serializeInitialCredentials({
    bootstrapEmail: email,
    bootstrapPassword: password,
    adminUsername: email,
    adminPassword: password,
  }));
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
    if (pending.operation === 'credentials-reset') {
      const nextEnv = pending.credentialReset?.nextEnv;
      if (!nextEnv) throw new Error('The incomplete credential reset has no protected recovery data. Restore a backup rather than guessing credentials.');
      await applyCredentialReset(loaded.directory, loaded.state, nextEnv);
      loaded.state.lastError = undefined;
      await clearPending(loaded.directory, loaded.state);
      console.log('Recovered the incomplete credential reset. Owner and admin credentials were verified inside the OR3 container.');
      return;
    }

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
      await restoreVolumeArchive(loaded.directory, loaded.state.mode, loaded.env, sourceBackupPath);
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
    const recoverySecrets = pending.operation === 'credentials-reset'
      ? secretValues(pending.credentialReset?.nextEnv ?? loaded.env)
      : secretValues(loaded.env);
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), recoverySecrets);
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

async function backupCreateCommand(directory: string) {
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

async function backupListCommand(directory: string) {
  const loaded = await loadManaged(directory);
  const backups = await enumerateBackups(loaded.directory);
  if (backups.length === 0) {
    console.log(`No backups exist yet for ${loaded.directory}. Run "npx @or3/cloud backup" to create one.`);
    return;
  }
  console.log(`OR3 Cloud backups for ${loaded.directory} (${backups.length}):`);
  console.log('backupId                      createdAt                      version  bytes     checksum');
  for (const backup of backups) {
    console.log(
      `${backup.backupId.padEnd(30)} ${backup.createdAt.padEnd(30)} ${backup.appVersion.padEnd(8)} ${String(backup.bytes).padStart(9)}  ${backup.dataSha256.slice(0, 12)}`,
    );
  }
  console.log('\nBackups contain credentials and secrets; keep them owner-only and export off-host.');
}

async function backupPruneCommand(directory: string, flags: Flags) {
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const keep = parseKeep(flags);
  const force = boolFlag(flags, 'force');
  if (force && !boolFlag(flags, 'yes')) throw new Error('--force may delete the only rollback or recovery backup. Re-run with --force --yes after confirming the exact backups shown by `backup list`.');
  const deleted = await pruneBackups(loaded.directory, loaded.state, keep, force);
  console.log(deleted > 0
    ? `Pruned ${deleted} backup(s); keeping the newest ${keep}.`
    : `Nothing to prune: keeping all backups (newest ${keep}).`);
}

async function backupExportCommand(directory: string, backupId: string, destination: string) {
  const backupPath = await resolveBackup(directory, backupId);
  const manifest = await readManifest(backupPath);
  const dest = resolve(destination);
  const source = resolve(backupPath);
  if (source === dest || dest.startsWith(`${source}${sep}`)) {
    throw new Error('Choose a destination directory different from the backup itself.');
  }
  if (await fileExists(dest)) throw new Error(`Destination ${dest} already exists. Choose a new empty destination so an export can never merge with unrelated files.`);
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  await mkdir(dest, { mode: 0o700 });
  try {
    await chmod(dest, 0o700);
    for (const file of ['data.tgz', 'config.env', 'manifest.json']) {
      await copySecure(join(backupPath, file), join(dest, file));
    }
    const dataSha = await sha256File(join(dest, 'data.tgz'));
    if (dataSha !== manifest.dataSha256) {
      throw new Error(`Exported data.tgz checksum mismatch for ${manifest.backupId}. Expected ${manifest.dataSha256}, got ${dataSha}.`);
    }
    if (manifest.configSha256) {
      const configSha = await sha256File(join(dest, 'config.env'));
      if (configSha !== manifest.configSha256) {
        throw new Error(`Exported config.env checksum mismatch for ${manifest.backupId}.`);
      }
    }
    const destinationDevice = (await stat(dest)).dev;
    await mkdir(deploymentPaths(directory).exports, { recursive: true, mode: 0o700 });
    const receipt: BackupExportReceipt = {
      schemaVersion: 1,
      backupId: manifest.backupId,
      exportedAt: now(),
      destination: dest,
      destinationDevice,
      dataSha256: manifest.dataSha256,
      configSha256: manifest.configSha256,
    };
    await writeSecure(join(deploymentPaths(directory).exports, `${manifest.backupId}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    const bytes = (await stat(join(dest, 'data.tgz'))).size + (await stat(join(dest, 'config.env'))).size + (await stat(join(dest, 'manifest.json'))).size;
    console.log(`Exported backup ${manifest.backupId} (${bytes} bytes) to ${dest}`);
    console.log('The exported copy contains credentials and secrets. It is owner-only (0600); keep it off-host.');
    if ((await stat(backupPath)).dev === destinationDevice) {
      console.log('This export is on the same filesystem as the deployment and cannot authorize `remove --purge-data`. Copy it to a mounted backup disk or another host, then export again there.');
    } else {
      console.log('Verified export recorded. It can authorize `remove --purge-data --yes` while this backup remains fresh.');
    }
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
}

async function backupCommand(directory: string, positionals: string[], flags: Flags) {
  const subcommand = positionals[0];
  if (!subcommand) return await backupCreateCommand(directory);
  if (subcommand === 'list') {
    if (positionals.length > 1) throw new Error('backup list accepts no arguments.');
    return await backupListCommand(directory);
  }
  if (subcommand === 'prune') {
    if (positionals.length > 1) throw new Error('backup prune accepts no arguments.');
    return await backupPruneCommand(directory, flags);
  }
  if (subcommand === 'export') {
    const backupId = positionals[1];
    const destination = positionals[2];
    if (!backupId || !destination) throw new Error('backup export requires a backup ID and a destination directory.');
    if (positionals.length > 3) throw new Error('backup export accepts a backup ID and a destination directory only.');
    return await backupExportCommand(directory, backupId, destination);
  }
  throw new Error(`Unknown backup subcommand "${subcommand}". Use list, prune, export, or no subcommand to create a backup.`);
}

async function updateCommand(directory: string, flags: Flags) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  const { state, env } = loaded;
  assertNoPending(state);
  await waitForDeepHealth(loaded.directory, state.mode, secretValues(env));
  const targetVersion = stringFlag(flags, 'to')?.trim() ?? PACKAGE_VERSION;
  if (!isVersion(targetVersion)) throw new Error(`--to must be a complete semantic version such as ${PACKAGE_VERSION}.`);
  if (targetVersion === state.appVersion) throw new Error(`The deployment is already on OR3 ${targetVersion}.`);
  const targetImage = imageFor(targetVersion);
  const targetDigest = await pullImage(targetImage);
  await assertSupportedHostArchitecture(targetImage);
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
    const previousRootOwnership = await managedVolumeRootOwnership(targetImage, state.volumeName);
    const migrateLegacyVolume = previousRootOwnership.uid !== MANAGED_RUNTIME_UID || previousRootOwnership.gid !== MANAGED_RUNTIME_GID;
    try {
      await stopProject(loaded.directory, state.mode);
      if (migrateLegacyVolume) {
        // Change only the mount root, then recreate every data entry from the
        // checksummed backup as the target runtime user. Avoid recursive chown:
        // it would erase heterogeneous ownership without a reversible record.
        await setManagedVolumeRootOwnership(targetImage, state.volumeName, {
          uid: MANAGED_RUNTIME_UID,
          gid: MANAGED_RUNTIME_GID,
        });
      }
      await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(nextEnv));
      if (migrateLegacyVolume) {
        await restoreVolumeArchive(loaded.directory, state.mode, nextEnv, backup.backupDir);
      }
      await startProject(loaded.directory, state.mode, nextEnv);
    } catch (error) {
      await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(oldEnv));
      try {
        await stopProject(loaded.directory, state.mode).catch(() => undefined);
        if (migrateLegacyVolume) {
          await setManagedVolumeRootOwnership(targetImage, state.volumeName, previousRootOwnership);
        }
        await restoreBackupData(loaded.directory, state, oldEnv, backup.backupDir);
      } catch (restoreError) {
        throw new Error(`Update to ${targetVersion} failed, and automatic backup restoration also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. Original update error: ${error instanceof Error ? error.message : String(error)}`);
      }
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
  await assertSupportedHostArchitecture(manifest.image);
  // Do this before recording a recovery operation: a capacity refusal has not
  // touched the live deployment and should not require an operator recovery.
  await assertRestoreFreeSpace(loaded.directory, loaded.state, loaded.env, manifest, backupPath);
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
  await assertSupportedHostArchitecture(point.image);
  await assertRestoreFreeSpace(loaded.directory, loaded.state, loaded.env, manifest, backupPath);
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
  await assertSupportedHostArchitecture(image);
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
  await writeSecure(join(targetDirectory, '.or3-initial-credentials'), serializeInitialCredentials({
    bootstrapEmail: email,
    bootstrapPassword: password,
    adminUsername: email,
    adminPassword: password,
  }));
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
    await restoreVolumeArchive(targetDirectory, mode, targetEnv, sourceBackupDir);
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

/**
 * Resolves the two new passwords for `credentials reset`: both flags together,
 * or interactive prompts. Credentials are never generated or printed here;
 * the passwords go only into protected state files and the container reset.
 */
async function resolveResetPasswords(flags: Flags) {
  const ownerPassword = stringFlag(flags, 'owner-password');
  const adminPassword = stringFlag(flags, 'admin-password');
  if (ownerPassword !== undefined || adminPassword !== undefined) {
    if (ownerPassword === undefined || adminPassword === undefined) {
      throw new Error('Use both --owner-password and --admin-password together so a reset never applies one credential without the other.');
    }
    validatePassword(ownerPassword);
    validatePassword(adminPassword);
    return { ownerPassword, adminPassword };
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('--owner-password and --admin-password are required in a non-interactive session. Credentials are never generated automatically.');
  }
  const prompt = readline.createInterface({ input, output });
  try {
    const owner = (await prompt.question('New owner (basic auth) password: ')).trim();
    validatePassword(owner);
    const admin = (await prompt.question('New admin password: ')).trim();
    validatePassword(admin);
    return { ownerPassword: owner, adminPassword: admin };
  } finally {
    prompt.close();
  }
}

/**
 * Builds the Node script executed inside the or3 container for `credentials reset`.
 *
 * Schema contract (or3-provider-basic-auth, session-store.ts):
 * - basic_auth_accounts: password_hash, token_version, updated_at; email unique.
 * - basic_auth_sessions: revoked_at, rotation_grace_until, rotation_grace_refresh_token;
 *   account lookup by email, sessions keyed by account_id.
 * The script mirrors updatePasswordAndRevokeSessions: it bumps token_version
 * (invalidates every outstanding refresh token, verified at refresh time) and
 * revokes all sessions for the owner account, clearing rotation grace tokens.
 * Admin credentials are re-hashed into /data/admin/admin-credentials.json
 * (bootstrapAdminCredentialsFromEnv only imports env credentials once, so the
 * file must be rewritten in place), preserving created_at.
 * Admin JWT session cookies are invalidated by rotating OR3_ADMIN_JWT_SECRET
 * in .env at restart; admin auth is per-request (no persistent session table).
 * The script fails hard with a plain-language message if better-sqlite3 or
 * bcryptjs cannot be required, and restores the admin credentials file if the
 * database update fails, so no partial state survives.
 */
export function buildCredentialsResetScript(input: {
  ownerEmail: string;
  ownerPassword: string;
  adminUsername: string;
  adminPassword: string;
  authDbPath?: string;
  adminCredentialsPath?: string;
}) {
  const authDbPath = input.authDbPath ?? '/data/auth.sqlite';
  const adminCredentialsPath = input.adminCredentialsPath ?? '/data/admin/admin-credentials.json';
  return `const fs = require('fs');
const path = require('path');
const candidates = [process.cwd(), '/app'];
const resolveModule = (name) => {
  for (const root of candidates) {
    const resolved = path.join(root, '.output/server/node_modules', name);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
};
let Database;
try {
  const betterSqlite3Path = resolveModule('better-sqlite3');
  if (!betterSqlite3Path) throw new Error('better-sqlite3 directory not found');
  Database = require(betterSqlite3Path);
} catch (error) {
  console.error('OR3 credentials reset failed: better-sqlite3 is not available in this image, so the auth database could not be updated. Nothing was changed. Update the OR3 image to a release that bundles it, then retry.');
  process.exit(1);
}
let bcrypt;
try {
  // bcryptjs 2.x ships a broken "exports" map (require -> missing umd/index.js),
  // so it must be loaded by explicit absolute path, like the server bundle does.
  const bcryptPath = resolveModule('bcryptjs/index.js');
  if (!bcryptPath) throw new Error('bcryptjs directory not found');
  bcrypt = require(bcryptPath);
} catch (error) {
  console.error('OR3 credentials reset failed: bcryptjs is not available in this image, so new password hashes could not be computed. Nothing was changed. Update the OR3 image to a release that bundles it, then retry.');
  process.exit(1);
}
const ownerEmail = process.env.OR3_RESET_OWNER_EMAIL;
const ownerPassword = process.env.OR3_RESET_OWNER_PASSWORD;
const adminUsername = process.env.OR3_RESET_ADMIN_USERNAME;
const adminPassword = process.env.OR3_RESET_ADMIN_PASSWORD;
if (!ownerEmail || !ownerPassword || !adminUsername || !adminPassword) {
  console.error('OR3 credentials reset failed: required environment values were not supplied to the reset script. Nothing was changed.');
  process.exit(1);
}
const ownerHash = bcrypt.hashSync(ownerPassword, 12);
const adminHash = bcrypt.hashSync(adminPassword, 12);
const now = Date.now();
const db = new Database(${JSON.stringify(authDbPath)});
db.pragma('busy_timeout = 10000');
const account = db.prepare('SELECT id FROM basic_auth_accounts WHERE email = ?').get(ownerEmail);
if (!account) {
  console.error('OR3 credentials reset failed: no Basic Auth account matches OR3_BASIC_AUTH_BOOTSTRAP_EMAIL. Nothing was changed.');
  process.exit(1);
}
const adminCredentialsPath = ${JSON.stringify(adminCredentialsPath)};
const previousCredentials = (() => {
  try { return fs.readFileSync(adminCredentialsPath, 'utf8'); } catch { return null; }
})();
let credentials;
try {
  credentials = previousCredentials ? JSON.parse(previousCredentials) : { created_at: new Date().toISOString() };
} catch (error) {
  console.error('OR3 credentials reset failed: the admin credentials file is corrupt. Nothing was changed.');
  process.exit(1);
}
credentials.username = adminUsername;
credentials.password_hash_bcrypt = adminHash;
credentials.updated_at = new Date().toISOString();
try {
  fs.writeFileSync(adminCredentialsPath, JSON.stringify(credentials, null, 2) + '\\n', { mode: 0o600 });
} catch (error) {
  console.error('OR3 credentials reset failed: could not update the admin credentials file at ' + adminCredentialsPath + '. Nothing was changed. ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
try {
  db.transaction(() => {
    db.prepare('UPDATE basic_auth_accounts SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(ownerHash, now, account.id);
    db.prepare('UPDATE basic_auth_sessions SET revoked_at = COALESCE(revoked_at, ?), rotation_grace_until = NULL, rotation_grace_refresh_token = NULL WHERE account_id = ?').run(now, account.id);
  })();
} catch (error) {
  if (previousCredentials !== null) {
    try { fs.writeFileSync(adminCredentialsPath, previousCredentials, { mode: 0o600 }); } catch {}
  } else {
    try { fs.rmSync(adminCredentialsPath, { force: true }); } catch {}
  }
  console.error('OR3 credentials reset failed: the authentication database rejected the update. Any partial change was rolled back. ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
db.close();
console.log('credentials-reset: owner hash, sessions, and admin credentials updated.');
`;
}

function credentialResetValues(env: Record<string, string>) {
  const ownerEmail = env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const ownerPassword = env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  const adminUsername = env.OR3_ADMIN_USERNAME;
  const adminPassword = env.OR3_ADMIN_PASSWORD;
  if (!ownerEmail || !ownerPassword || !adminUsername || !adminPassword) {
    throw new Error('Credential recovery data is incomplete. Run doctor and restore a backup rather than guessing credentials.');
  }
  return { ownerEmail, ownerPassword, adminUsername, adminPassword };
}

const CREDENTIALS_VERIFY_SCRIPT = `
const request = async (path, body) => {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(path + ' returned HTTP ' + response.status);
};
Promise.all([
  request('/api/basic-auth/sign-in', { email: process.env.OR3_RESET_OWNER_EMAIL, password: process.env.OR3_RESET_OWNER_PASSWORD }),
  request('/api/admin/auth/login', { username: process.env.OR3_RESET_ADMIN_USERNAME, password: process.env.OR3_RESET_ADMIN_PASSWORD }),
]).catch((error) => { console.error('Credential verification failed: ' + error.message); process.exit(1); });
`;

async function runCredentialsResetScript(directory: string, mode: Mode, values: ReturnType<typeof credentialResetValues>) {
  const script = buildCredentialsResetScript(values);
  const result = await run('docker', [
    ...composeArgs(directory, mode, [
      'exec', '-T',
      '-e', `OR3_RESET_OWNER_EMAIL=${values.ownerEmail}`,
      '-e', `OR3_RESET_OWNER_PASSWORD=${values.ownerPassword}`,
      '-e', `OR3_RESET_ADMIN_USERNAME=${values.adminUsername}`,
      '-e', `OR3_RESET_ADMIN_PASSWORD=${values.adminPassword}`,
      'or3', ...containerNodeCommand(script),
    ]),
  ], directory);
  if (!result.ok) throw new Error(`${result.command}\n${redact(result.stderr, [values.ownerPassword, values.adminPassword])}`);
}

async function verifyCredentialsInsideContainer(directory: string, mode: Mode, values: ReturnType<typeof credentialResetValues>) {
  const result = await run('docker', [
    ...composeArgs(directory, mode, [
      'exec', '-T',
      '-e', `OR3_RESET_OWNER_EMAIL=${values.ownerEmail}`,
      '-e', `OR3_RESET_OWNER_PASSWORD=${values.ownerPassword}`,
      '-e', `OR3_RESET_ADMIN_USERNAME=${values.adminUsername}`,
      '-e', `OR3_RESET_ADMIN_PASSWORD=${values.adminPassword}`,
      'or3', ...containerNodeCommand(CREDENTIALS_VERIFY_SCRIPT),
    ]),
  ], directory);
  if (!result.ok) throw new Error(`Credential verification inside the OR3 container failed. ${redact(result.stderr, [values.ownerPassword, values.adminPassword])}`);
}

async function applyCredentialReset(directory: string, state: ManagedState, nextEnv: Record<string, string>) {
  const values = credentialResetValues(nextEnv);
  const running = await run('docker', [...composeArgs(directory, state.mode, ['ps', '-q', 'or3'])], directory);
  if (!running.ok || !running.stdout.trim()) {
    // A process interruption may have written the operation journal before the
    // first mutation. Start the intended configuration and replay the reset;
    // the database operation is idempotent for the requested credentials.
    await writeSecure(deploymentPaths(directory).env, serializeEnv(nextEnv));
    await startProject(directory, state.mode, nextEnv);
  }
  await runCredentialsResetScript(directory, state.mode, values);
  await writeSecure(deploymentPaths(directory).env, serializeEnv(nextEnv));
  const initialCredentials = join(directory, '.or3-initial-credentials');
  if (await fileExists(initialCredentials)) {
    await writeSecure(initialCredentials, serializeInitialCredentials({
      bootstrapEmail: values.ownerEmail,
      bootstrapPassword: values.ownerPassword,
      adminUsername: values.adminUsername,
      adminPassword: values.adminPassword,
    }));
  }
  await stopProject(directory, state.mode);
  await startProject(directory, state.mode, nextEnv);
  await verifyCredentialsInsideContainer(directory, state.mode, values);
}

async function credentialsResetCommand(directory: string, flags: Flags) {
  if (!boolFlag(flags, 'yes')) throw new Error('Credentials reset changes the owner password, revokes all app sessions, and changes the admin password. Re-run with --yes after confirming the impact.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  const ownerEmail = loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const adminUsername = loaded.env.OR3_ADMIN_USERNAME;
  if (!ownerEmail) throw new Error('OR3_BASIC_AUTH_BOOTSTRAP_EMAIL is missing from .env, so the owner account cannot be reset.');
  if (!adminUsername) throw new Error('OR3_ADMIN_USERNAME is missing from .env, so the admin password cannot be reset.');
  const { ownerPassword, adminPassword } = await resolveResetPasswords(flags);
  const nextEnv = {
    ...loaded.env,
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: ownerPassword,
    OR3_ADMIN_PASSWORD: adminPassword,
    // Rotating the admin JWT secret invalidates every previously issued admin
    // session cookie; admin auth is per-request basic auth over JWT cookies
    // with no persistent session table to revoke.
    OR3_ADMIN_JWT_SECRET: randomSecret(),
  };
  const pending: PendingOperation = {
    id: id('credentials-reset'),
    operation: 'credentials-reset',
    startedAt: now(),
    message: 'Resetting owner and admin credentials',
    credentialReset: { nextEnv },
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    await applyCredentialReset(loaded.directory, loaded.state, nextEnv);
    await clearPending(loaded.directory, loaded.state);
    console.log('Owner and admin credentials are now separate. The old owner password and all app sessions were revoked.');
    console.log('Admin session cookies were invalidated by rotating OR3_ADMIN_JWT_SECRET. New passwords were written only to protected files; sign in again with them.');
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv));
    await writeState(loaded.directory, loaded.state);
    throw new Error(`${loaded.state.lastError}\nCredential reset is recoverable: run \"npx @or3/cloud recover\" to replay the intended protected operation.`);
  }
}

async function credentialsCommand(directory: string, positionals: string[], flags: Flags) {
  const subcommand = positionals[0];
  if (subcommand !== 'reset') {
    throw new Error(`Unknown credentials subcommand "${subcommand ?? ''}". Use "npx @or3/cloud credentials reset --yes".`);
  }
  if (positionals.length > 1) throw new Error('credentials reset accepts no arguments.');
  return await credentialsResetCommand(directory, flags);
}

/** Reports deployment summary, container status, and a bounded deep-health probe. */
async function statusCommand(directory: string) {
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  const { state } = loaded;
  console.log(`OR3 Cloud deployment: ${loaded.directory}`);
  console.log(`  mode: ${state.mode}`);
  console.log(`  version: ${state.appVersion}`);
  if (state.domain) console.log(`  domain: ${state.domain}`);
  console.log(`  port: ${state.port}`);
  console.log(`  image digest: ${state.imageDigest}`);
  console.log(`  last successful operation: ${state.lastSuccessfulOperation} (${state.updatedAt})`);
  if (state.incompleteOperation) console.log(`  incomplete operation: ${state.incompleteOperation.operation} (${state.incompleteOperation.id})`);
  if (state.lastError) console.log(`  last error: ${state.lastError}`);
  console.log();
  const ps = await run('docker', [...composeArgs(directory, state.mode, ['ps'])], directory);
  if (ps.ok) {
    console.log(ps.stdout.trim());
  } else {
    console.log(`Could not list containers: ${ps.stderr}`);
  }
const health = await probeDeepHealth(directory, state.mode);
  if (health === 'ok') console.log('Deep health: OK');
  else if (health === 'degraded') console.log('Deep health: DEGRADED (the container is running but /api/health?deep=true is failing).');
  else console.log('Deep health: unreachable (the or3 container is not running).');
  await printMaintenanceSummary(directory, state.mode);
}

/** Renders the provider maintenance state (SQLite history GC) from deep health. */
async function printMaintenanceSummary(directory: string, mode: Mode) {
  const result = await run('docker', [...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(MAINTENANCE_SCRIPT)])], directory);
  if (!result.ok || !result.stdout.trim()) return;
  try {
    const maintenance = JSON.parse(result.stdout.trim()) as {
      enabled?: boolean;
      lastRun?: string;
      backlog?: number;
      lastError?: string;
      state?: string;
    };
    if (!maintenance.enabled) return;
    const state = maintenance.state ?? 'idle';
    const line = `Sync history maintenance: ${state}${maintenance.lastRun ? ` (last run ${maintenance.lastRun})` : ''}${maintenance.backlog !== undefined ? `, backlog ${maintenance.backlog}` : ''}`;
    if (state === 'failed') {
      console.log(`⚠ ${line}${maintenance.lastError ? `: ${maintenance.lastError}` : ''}`);
    } else {
      console.log(`  ${line}`);
    }
  } catch {
    // The maintenance payload is informational; never fail status on a parse issue.
  }
}

async function logsCommand(directory: string, flags: Flags, positionals: string[]) {
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  if (positionals.length > 1) throw new Error('logs accepts at most one service name.');
  const tailValue = stringFlag(flags, 'tail') ?? '200';
  const tail = Number(tailValue);
  if (!Number.isInteger(tail) || tail < 1) throw new Error('--tail must be a positive integer.');
  const service = positionals[0];
  const args = composeArgs(directory, loaded.state.mode, [
    'logs', '--no-color', '--tail', String(tail), ...(service ? [service] : []),
  ]);
  const result = await run('docker', [...args], directory);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  const secrets = secretValues(loaded.env);
  process.stdout.write(redact(result.stdout, secrets));
  if (result.stderr) process.stderr.write(redact(result.stderr, secrets));
}

async function startCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  await startProject(directory, loaded.state.mode, loaded.env);
  const url = loaded.state.mode === 'public' ? `https://${loaded.state.domain}` : `http://127.0.0.1:${loaded.state.port}`;
  console.log(`OR3 started and is deeply healthy at ${url}.`);
}

async function stopCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  await stopProject(directory, loaded.state.mode);
  console.log('OR3 stopped. The data volume, backups, and managed state are retained.');
}

async function restartCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  await compose(directory, loaded.state.mode, ['restart', 'or3']);
  await waitForDeepHealth(directory, loaded.state.mode, secretValues(loaded.env));
  console.log('OR3 restarted and is deeply healthy.');
}

/** Purge targets derived only from validated managed state — never user input. */
export function purgeVolumesFromState(state: ManagedState) {
  const volumes = [state.volumeName];
  if (state.mode === 'public') {
    if (state.caddyDataVolume) volumes.push(state.caddyDataVolume);
    if (state.caddyConfigVolume) volumes.push(state.caddyConfigVolume);
  }
  return volumes;
}

/** Pure freshness gate used before verifying an export receipt. */
export function assertPurgeBackupFreshness(
  backups: Array<{ backupId: string; createdAt: string }>,
  nowMs: number,
) {
  const cutoff = nowMs - PURGE_REQUIRES_BACKUP_WITHIN_MS;
  if (!backups.some((backup) => new Date(backup.createdAt).getTime() >= cutoff)) {
    throw new Error('No backup newer than 24 hours exists for this deployment. Run "npx @or3/cloud backup" and "npx @or3/cloud backup export <backup-id> <destination-dir>" before destroying local data.');
  }
}

async function readBackupExportReceipt(directory: string, backupId: string): Promise<BackupExportReceipt | undefined> {
  try {
    const receipt = JSON.parse(await readText(join(deploymentPaths(directory).exports, `${backupId}.json`))) as Partial<BackupExportReceipt>;
    if (
      receipt.schemaVersion !== 1 ||
      receipt.backupId !== backupId ||
      typeof receipt.destination !== 'string' ||
      !isAbsolute(receipt.destination) ||
      typeof receipt.destinationDevice !== 'number' ||
      !receipt.dataSha256
    ) return undefined;
    return receipt as BackupExportReceipt;
  } catch {
    return undefined;
  }
}

/**
 * Purge is allowed only when a fresh backup has a checksum-verified export on
 * another filesystem. The receipt is revalidated at destruction time so a
 * copied receipt, deleted export, or same-device destination cannot bypass it.
 */
async function assertPurgeHasVerifiedExport(directory: string, backups: BackupListing[], nowMs: number) {
  assertPurgeBackupFreshness(backups, nowMs);
  const cutoff = nowMs - PURGE_REQUIRES_BACKUP_WITHIN_MS;
  for (const backup of backups) {
    if (new Date(backup.createdAt).getTime() < cutoff) continue;
    const receipt = await readBackupExportReceipt(directory, backup.backupId);
    if (!receipt || !await fileExists(receipt.destination)) continue;
    try {
      const exported = await readManifest(receipt.destination);
      const sourceDevice = (await stat(backup.path)).dev;
      const destinationDevice = (await stat(receipt.destination)).dev;
      if (
        sourceDevice !== destinationDevice &&
        receipt.destinationDevice === destinationDevice &&
        exported.backupId === backup.backupId &&
        exported.dataSha256 === receipt.dataSha256 &&
        exported.dataSha256 === backup.dataSha256 &&
        exported.configSha256 === receipt.configSha256
      ) return receipt;
    } catch {
      // Try another fresh backup; a malformed or missing export cannot count.
    }
  }
  throw new Error('No fresh checksum-verified backup export on another filesystem is available. Run `npx @or3/cloud backup export <backup-id> <new-directory-on-a-mounted-backup-disk>` before purging local data.');
}

async function removeCommand(directory: string, flags: Flags) {
  if (boolFlag(flags, 'purge-data') && !boolFlag(flags, 'yes')) {
    throw new Error('--purge-data deletes the data volume, every backup, and the managed files. Re-run with --purge-data --yes after confirming the data-loss boundary.');
  }
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  const { state } = loaded;
  if (!boolFlag(flags, 'purge-data')) {
    // Data-retaining removal: containers and the compose network only.
    // Volumes, backups, .env, state, and the .or3-cloud directory survive.
    await compose(directory, state.mode, ['down']);
    console.log(`Removed runtime containers and network. Data volume, backups, configuration, and managed state are retained at ${directory}. Re-run \`npx @or3/cloud start\` to restore service.`);
    return;
  }
  // Hard refuse unless a fresh export is still checksum-verified on another
  // filesystem, rather than treating a local backup as disaster recovery.
  const exportReceipt = await assertPurgeHasVerifiedExport(directory, await enumerateBackups(directory), Date.now());
  const volumes = purgeVolumesFromState(state);
  const managedFiles = ['.env', '.or3-cloud', 'compose.yaml', ...(state.mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : []), '.or3-initial-credentials'];
  console.log('Removing exactly these targets:');
  for (const volume of volumes) console.log(`  docker volume ${volume}`);
  for (const file of managedFiles) console.log(`  ${join(directory, file)}`);
  await compose(directory, state.mode, ['down']);
  for (const volume of volumes) {
    const result = await run('docker', ['volume', 'rm', volume], directory);
    if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  }
  for (const file of managedFiles) {
    await rm(join(directory, file), { recursive: true, force: true });
  }
  console.log(`Purged: data volumes, backups, .env, managed state, and compose files were deleted. The verified export at ${exportReceipt.destination} is the remaining copy.`);
}

/** Bounded single-shot health probe for status: ok | degraded | unreachable. */
async function probeDeepHealth(directory: string, mode: Mode) {
  const result = await run('docker', [...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(HEALTH_SCRIPT)])], directory);
  if (result.ok) return 'ok' as const;
  const ps = await run('docker', [...composeArgs(directory, mode, ['ps', '-q', 'or3'])], directory);
  if (ps.ok && ps.stdout.trim()) return 'degraded' as const;
  return 'unreachable' as const;
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
    if (command === 'backup') return await backupCommand(process.cwd(), parsed.positionals, parsed.flags);
    if (command === 'restore') return await restoreCommand(process.cwd(), parsed.flags, parsed.positionals);
    if (command === 'rollback') return await rollbackCommand(process.cwd(), parsed.flags);
    if (command === 'credentials') return await credentialsCommand(process.cwd(), parsed.positionals, parsed.flags);
    if (command === 'doctor') return await doctorCommand(process.cwd());
    if (command === 'recover') return await recoverCommand(process.cwd());
    if (command === 'adopt') return await adoptCommand(parsed.positionals, parsed.flags);
    if (command === 'status') return await statusCommand(process.cwd());
    if (command === 'logs') return await logsCommand(process.cwd(), parsed.flags, parsed.positionals);
    if (command === 'start') return await startCommand(process.cwd());
    if (command === 'stop') return await stopCommand(process.cwd());
    if (command === 'restart') return await restartCommand(process.cwd());
    if (command === 'remove') return await removeCommand(process.cwd(), parsed.flags);
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
