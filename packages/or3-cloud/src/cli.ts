#!/usr/bin/env node

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
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
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));

export const PACKAGE_VERSION = '0.1.39';
export const IMAGE_REPOSITORY = 'ghcr.io/saluana/or3-chat';
const ASSET_ROOT = resolve(fileURLToPath(new URL('../assets/', import.meta.url)));
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_PORT = 3000;
const DEEP_HEALTH_TIMEOUT_MS = 180_000;
const BACKUP_RETENTION_KEEP = 5;
const PURGE_REQUIRES_BACKUP_WITHIN_MS = 24 * 60 * 60 * 1000;
const FREE_SPACE_HEADROOM_BYTES = 64 * 1024 * 1024;
const BACKUP_ID_PATTERN = /^backup-[0-9A-Za-z-]+$/;
const MANAGED_ASSET_INVENTORY_VERSION = 3;
const DASHBOARD_LEASE_STALE_MS = 30_000;
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
const DEPLOYMENT_ID_ENV_KEY = 'OR3_DEPLOYMENT_ID';

type Mode = 'local' | 'public';
type Operation = 'init' | 'update' | 'restore' | 'adopt' | 'credentials-reset';
type PendingOperation = NonNullable<ManagedState['incompleteOperation']>;
type LeaseOwner = {
  schemaVersion: 1;
  nonce: string;
  command: string;
  origin: 'cli' | 'dashboard';
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
  jobId?: string;
};
type DashboardOperatorEnv = {
  OR3_DASHBOARD_UPDATES_ENABLED: 'true';
  OR3_OPERATOR_IMAGE: string;
  OR3_DEPLOYMENT_DIR: string;
  OR3_OPERATOR_UID: string;
  OR3_OPERATOR_GID: string;
  OR3_DOCKER_SOCKET: string;
  OR3_DOCKER_GID: string;
};

export type ManagedState = {
  schemaVersion: 1;
  mode: Mode;
  composeProject: string;
  volumeName: string;
  caddyDataVolume?: string;
  caddyConfigVolume?: string;
  /** Fresh deployments bind their Docker resources to this random identity. */
  deploymentId?: string;
  /** Canonical path at initialization; moved copies need an explicit migration. */
  deploymentRoot?: string;
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
    origin?: 'cli' | 'dashboard';
    dashboardJobId?: string;
    backupId?: string;
    /** Canonical source path for an external restore; never reconstruct it from an ID. */
    backupPath?: string;
    backupDataSha256?: string;
    backupConfigSha256?: string;
    /** Verified pre-mutation snapshot used to restore a failed restore/rollback. */
    previousBackupId?: string;
    previousBackupPath?: string;
    phase?: 'prepared' | 'snapshot-created' | 'target-mutating' | 'restoring-previous' | 'starting-target' | 'starting-previous';
    previousRootOwnership?: { uid: number; gid: number };
    /** Whether the managed app was running before a standalone backup. */
    initialAppRunning?: boolean;
    /** Whether an adopted source should be restarted if adoption fails. */
    sourceInitiallyRunning?: boolean;
    targetVersion?: string;
    targetImage?: string;
    targetImageDigest?: string;
    /** Identity assigned to a legacy deployment only when its target assets are installed. */
    targetDeploymentId?: string;
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
  /** Checksums for the generated Compose/Caddy files needed by this release. */
  managedAssetSha256?: Record<string, string>;
  /** Inventory 2 includes the dashboard operator asset and requires an exact file set. */
  managedAssetInventoryVersion?: number;
  mode: Mode;
  domain?: string;
  composeProject?: string;
  volumeName?: string;
  caddyDataVolume?: string;
  caddyConfigVolume?: string;
  deploymentId?: string;
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

const PROCESS_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
] as const;

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
  if (password.includes('\0') || /\r|\n/.test(password)) {
    throw new Error('The administrator password may not contain NUL or newline characters.');
  }
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
    /((?:PASSWORD|SECRET|TOKEN|JWT)\s*[=:]\s*)(?!\[REDACTED\])([^\r\n]+)/gi,
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
  verify: ['public'],
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

/** Reject positional typos before any command can act on the current directory. */
export function assertCommandPositionals(command: string, positionals: string[]) {
  if (command === 'backup' || command === 'credentials') return;
  if (command === 'init' || command === 'adopt') {
    if (positionals.length > 1) throw new Error(`${command} accepts at most one target directory.`);
    return;
  }
  if (command === 'restore') {
    if (positionals.length !== 1) throw new Error('restore requires exactly one backup ID or absolute backup path.');
    return;
  }
  if (command === 'logs') {
    if (positionals.length > 1) throw new Error('logs accepts at most one service name.');
    return;
  }
  if (positionals.length > 0) {
    throw new Error(`${command} accepts no positional arguments. Run npx @or3/cloud ${command} --help.`);
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

function operatorImageFor(version: string) {
  return process.env.OR3_CLOUD_TEST_OPERATOR_IMAGE?.trim() || `${IMAGE_REPOSITORY}:${version}-operator`;
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

function composeProcessEnv(directory: string): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of PROCESS_ENV_PASSTHROUGH) {
    if (process.env[key] !== undefined) safe[key] = process.env[key];
  }
  const envPath = join(directory, '.env');
  try {
    // Compose reads the full file through `env_file`; only OR3 interpolation
    // values belong in its process environment. In particular, never let a
    // managed .env replace PATH or smuggle COMPOSE_* control variables into
    // the Docker client invocation.
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) {
      if (key.startsWith('OR3_')) safe[key] = value;
    }
    return safe;
  } catch (error) {
    throw new Error(`Could not read managed Compose environment ${envPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function commandEnvironment(command: string, args: string[], cwd?: string, supplied?: NodeJS.ProcessEnv) {
  if (supplied) return supplied;
  return command === 'docker' && args[0] === 'compose' && cwd
    ? composeProcessEnv(cwd)
    : process.env;
}

async function run(command: string, args: string[], cwd?: string, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
  const printable = `${command} ${args.map(quote).join(' ')}`;
  try {
    const result = await execFile(command, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
      env: commandEnvironment(command, args, cwd, environment),
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
    lease: join(cloud, 'operation-lease'),
    backupAuthKey: join(cloud, 'backup-auth.key'),
    operatorIpc: join(cloud, 'operator-ipc'),
  };
}

async function backupAuthenticationKey(directory: string, create = false) {
  const keyPath = deploymentPaths(directory).backupAuthKey;
  try {
    const key = (await readText(keyPath)).trim();
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('invalid format');
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Backup authentication key at ${keyPath} is invalid or unreadable. Restore is refused until it is repaired from the deployment owner’s secure key material.`);
    }
    if (!create) {
      throw new Error(`This deployment has no backup authentication key at ${keyPath}. Backups created by older CLI versions are intentionally not trusted for restore. Create a new verified backup before attempting a destructive restore.`);
    }
    const key = randomBytes(32).toString('hex');
    await writeSecure(keyPath, `${key}\n`);
    return key;
  }
}

function backupAuthenticationTag(key: string, manifestContents: string) {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(manifestContents).digest('hex');
}

async function writeBackupAuthentication(directory: string, backupPath: string, manifestContents: string) {
  const key = await backupAuthenticationKey(directory, true);
  await writeSecure(join(backupPath, 'manifest.auth'), `${backupAuthenticationTag(key, manifestContents)}\n`);
}

async function assertBackupAuthentication(directory: string, backupPath: string, manifestContents: string) {
  const key = await backupAuthenticationKey(directory);
  let provided: Buffer;
  try {
    const value = (await readText(join(backupPath, 'manifest.auth'))).trim();
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('invalid authentication tag');
    provided = Buffer.from(value, 'hex');
  } catch {
    throw new Error(`Backup at ${backupPath} has no valid deployment authentication tag. Refusing to restore or export an unauthenticated backup.`);
  }
  const expected = Buffer.from(backupAuthenticationTag(key, manifestContents), 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error(`Backup authentication failed for ${backupPath}. Refusing to trust data, configuration, or managed assets from another deployment.`);
  }
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
    const nonLeaseEntries = entries.filter((entry) => entry !== '.or3-cloud');
    if (nonLeaseEntries.length) throw new Error(`Refusing to use non-empty directory ${directory}. Choose a new directory or run adopt explicitly.`);
    if (entries.includes('.or3-cloud')) {
      const cloudEntries = await readdir(join(directory, '.or3-cloud'));
      if (cloudEntries.some((entry) => entry !== 'operation-lease')) {
        throw new Error(`Refusing to use non-empty directory ${directory}. Choose a new directory or run adopt explicitly.`);
      }
    }
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function readLeaseOwner(leasePath: string): Promise<LeaseOwner | undefined> {
  try {
    const owner = JSON.parse(await readText(join(leasePath, 'owner.json'))) as Partial<LeaseOwner>;
    if (
      owner.schemaVersion !== 1
      || typeof owner.nonce !== 'string'
      || typeof owner.command !== 'string'
      || (owner.origin !== 'cli' && owner.origin !== 'dashboard')
      || !Number.isSafeInteger(owner.pid)
      || typeof owner.acquiredAt !== 'string'
      || typeof owner.heartbeatAt !== 'string'
    ) return undefined;
    return owner as LeaseOwner;
  } catch {
    return undefined;
  }
}

function cliLeaseOwnerIsGone(owner: LeaseOwner) {
  if (owner.origin !== 'cli') return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function dashboardLeaseOwnerIsStale(owner: LeaseOwner, jobId?: string) {
  if (owner.origin !== 'dashboard' || (jobId && owner.jobId !== jobId)) return false;
  const heartbeat = Date.parse(owner.heartbeatAt);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat > DASHBOARD_LEASE_STALE_MS;
}

async function acquireDeploymentLease(directory: string, command: string) {
  const leasePath = deploymentPaths(directory).lease;
  await mkdir(dirname(leasePath), { recursive: true, mode: 0o700 });
  const nonce = randomBytes(16).toString('hex');
  const owner: LeaseOwner = {
    schemaVersion: 1,
    nonce,
    command,
    origin: process.env.OR3_DASHBOARD_UPDATE_JOB_ID ? 'dashboard' : 'cli',
    jobId: process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim() || undefined,
    pid: process.pid,
    acquiredAt: now(),
    heartbeatAt: now(),
  };
  try {
    await mkdir(leasePath, { recursive: false, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const active = await readLeaseOwner(leasePath);
    if (active && (cliLeaseOwnerIsGone(active) || dashboardLeaseOwnerIsStale(active, owner.jobId))) {
      const stalePath = `${leasePath}.stale-${randomBytes(8).toString('hex')}`;
      try {
        await rename(leasePath, stalePath);
        await rm(stalePath, { recursive: true, force: true });
        await mkdir(leasePath, { recursive: false, mode: 0o700 });
      } catch (reclaimError) {
        throw new Error(`Another OR3 Cloud operation owns ${directory}. Refusing to race its lifecycle lock. ${reclaimError instanceof Error ? reclaimError.message : String(reclaimError)}`);
      }
    } else {
      const detail = active
        ? `${active.command} (${active.origin}) acquired at ${active.acquiredAt}`
        : 'an unreadable owner record';
      throw new Error(`Another OR3 Cloud operation owns ${directory}: ${detail}. Refusing to run concurrently.`);
    }
  }
  try {
    await writeSecure(join(leasePath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`);
  } catch (error) {
    await rm(leasePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const heartbeat = setInterval(() => {
    owner.heartbeatAt = now();
    // A transient heartbeat write failure must not become an unhandled
    // rejection that kills the lifecycle process. The atomic lease directory
    // remains owned; CLI leases also retain the live-PID check, while a stale
    // dashboard lease still requires the full recovery protocol before reuse.
    void writeSecure(join(leasePath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`).catch(() => undefined);
  }, 5_000);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    const current = await readLeaseOwner(leasePath);
    if (current?.nonce === nonce) await rm(leasePath, { recursive: true, force: true });
  };
}

async function withDeploymentLease<T>(directory: string, command: string, action: () => Promise<T>) {
  const release = await acquireDeploymentLease(directory, command);
  try {
    return await action();
  } finally {
    await release();
  }
}

function dashboardUpdatesEnabled(directory: string) {
  try {
    return parseEnv(readFileSync(join(directory, '.env'), 'utf8')).OR3_DASHBOARD_UPDATES_ENABLED === 'true';
  } catch {
    return false;
  }
}

function composeArgs(directory: string, mode: Mode, command: string[] = []) {
  const env = parseEnv(readFileSync(join(directory, '.env'), 'utf8'));
  const project = env.OR3_COMPOSE_PROJECT;
  if (!project) throw new Error(`Managed Compose environment at ${join(directory, '.env')} has no OR3_COMPOSE_PROJECT.`);
  const files = ['-f', join(directory, 'compose.yaml')];
  if (mode === 'public') files.push('-f', join(directory, 'compose.public.yaml'));
  if (dashboardUpdatesEnabled(directory)) {
    const operatorOverlay = join(directory, 'compose.operator.yaml');
    if (!existsSync(operatorOverlay)) {
      throw new Error('Dashboard updates are enabled but compose.operator.yaml is missing. Run `npx @or3/cloud recover` before operating on this deployment.');
    }
    files.push('-f', operatorOverlay);
  }
  return [
    'compose',
    '--project-name',
    project,
    '--project-directory',
    directory,
    '--env-file',
    join(directory, '.env'),
    ...files,
    ...command,
  ];
}

function diagnostics(directory: string, mode: Mode) {
  const files = `-f ${quote(join(directory, 'compose.yaml'))}${mode === 'public' ? ` -f ${quote(join(directory, 'compose.public.yaml'))}` : ''}${dashboardUpdatesEnabled(directory) ? ` -f ${quote(join(directory, 'compose.operator.yaml'))}` : ''}`;
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
  image?: string;
  network_mode?: string;
  ports?: Array<Record<string, unknown>>;
  volumes?: Array<Record<string, unknown>>;
  environment?: Record<string, unknown> | string[];
  labels?: Record<string, unknown> | string[];
};

type ComposeConfig = {
  name?: string;
  services?: Record<string, ComposeService>;
  volumes?: Record<string, { name?: string; labels?: Record<string, unknown> | string[] }>;
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

function composeLabelValue(service: ComposeService, key: string) {
  const labels = service.labels;
  if (Array.isArray(labels)) {
    const line = labels.find((value) => value.startsWith(`${key}=`));
    return line?.slice(key.length + 1);
  }
  const value = labels?.[key];
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
    if (service.network_mode) return false;
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
  const parsed = parseComposeConfig(config);
  const service = parsed.services?.or3;
  if (parsed.name !== undefined && parsed.name !== env.OR3_COMPOSE_PROJECT) {
    throw new Error('Resolved Compose configuration does not use the managed project name. Refusing to operate on another deployment.');
  }
  if (!checkResolvedLoopbackBinding(config, Number(env.OR3_PORT))) {
    throw new Error('Resolved Compose configuration must publish OR3 port 3000 only on 127.0.0.1. Refusing to expose the application directly.');
  }
  if (!service || service.image !== env.OR3_IMAGE) {
    throw new Error('Resolved Compose configuration does not use the managed immutable OR3 image reference. Refusing to start an unexpected image.');
  }
  if (env.OR3_DEPLOYMENT_ID && composeLabelValue(service, 'io.or3.cloud.deployment-id') !== env.OR3_DEPLOYMENT_ID) {
    throw new Error('Resolved Compose configuration does not carry the managed deployment identity label. Refusing to start an unbound project.');
  }
  const dataMount = (service.volumes ?? []).find((mount) => mount.target === '/data');
  const source = typeof dataMount?.source === 'string' ? dataMount.source : '';
  const volumeName = source ? parsed.volumes?.[source]?.name : undefined;
  if (dataMount?.type !== 'volume' || volumeName !== env.OR3_VOLUME_NAME) {
    throw new Error('Resolved Compose configuration does not bind the managed OR3 data volume. Refusing to operate on an unexpected volume.');
  }
  const volumeLabels = source ? parsed.volumes?.[source]?.labels : undefined;
  const deploymentLabel = Array.isArray(volumeLabels)
    ? volumeLabels.find((value) => value.startsWith('io.or3.cloud.deployment-id='))?.slice('io.or3.cloud.deployment-id='.length)
    : volumeLabels?.['io.or3.cloud.deployment-id'];
  if (env.OR3_DEPLOYMENT_ID && deploymentLabel !== env.OR3_DEPLOYMENT_ID) {
    throw new Error('Resolved managed data volume lacks the expected deployment identity label.');
  }
  if (env.OR3_DASHBOARD_UPDATES_ENABLED === 'true') {
    const operator = parsed.services?.['or3-operator'];
    if (
      !operator
      || operator.network_mode
      || operator.image !== env.OR3_OPERATOR_IMAGE
      || (env.OR3_DEPLOYMENT_ID && composeLabelValue(operator, 'io.or3.cloud.deployment-id') !== env.OR3_DEPLOYMENT_ID)
    ) {
      throw new Error('Resolved dashboard operator does not match the managed digest-qualified deployment bridge. Refusing to start it.');
    }
    if (process.env.OR3_CLOUD_SKIP_PULL !== 'true' && !/@sha256:[0-9a-f]{64}$/i.test(env.OR3_OPERATOR_IMAGE ?? '')) {
      throw new Error('The dashboard operator image is not digest-qualified. Refusing to start a mutable privileged runtime.');
    }
  }
}

async function assertRunningAppImage(directory: string, mode: Mode, expectedImage: string) {
  const container = await run('docker', composeArgs(directory, mode, ['ps', '-q', 'or3']), directory);
  const containerId = container.stdout.trim();
  if (!container.ok || !containerId) throw new Error('OR3 started without a running application container.');
  const image = await run('docker', ['inspect', '--format', '{{.Image}}', containerId], directory);
  if (!image.ok || !image.stdout.trim()) throw new Error('Could not inspect the image of the running OR3 container.');
  const expectedDigest = expectedImage.match(/@((?:sha256:)[0-9a-f]{64})$/i)?.[1];
  if (!expectedDigest && process.env.OR3_CLOUD_SKIP_PULL === 'true') {
    const expectedId = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', expectedImage], directory);
    if (!expectedId.ok || expectedId.stdout.trim() !== image.stdout.trim()) {
      throw new Error('The local qualification fixture started a different OR3 image than the one selected by the managed environment.');
    }
    return;
  }
  if (!expectedDigest) throw new Error(`Managed OR3 image ${expectedImage} is not digest-qualified.`);
  const repoDigests = await run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image.stdout.trim()], directory);
  if (!repoDigests.ok) throw new Error('Could not inspect repository digests for the running OR3 container.');
  let values: string[];
  try {
    values = JSON.parse(repoDigests.stdout.trim()) as string[];
  } catch {
    throw new Error('The running OR3 container has no readable repository digests.');
  }
  const expected = `${imageRepository(expectedImage)}@${expectedDigest}`;
  if (!values.includes(expected)) {
    throw new Error(`The running OR3 container image does not match the managed digest ${expectedDigest}. Refusing to commit startup.`);
  }
}

const HEALTH_SCRIPT = "const fs=require('node:fs');try{fs.accessSync('/data',fs.constants.R_OK|fs.constants.W_OK);for(const path of [process.env.OR3_BASIC_AUTH_DB_PATH,process.env.OR3_SQLITE_DB_PATH].filter(Boolean)){const fd=fs.openSync(path,'r+');fs.closeSync(fd)}}catch{process.exit(1)}fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok||body.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))";
const MAINTENANCE_SCRIPT = "fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));const m=body?.providers?.sync?.details?.maintenance;if(m)console.log(JSON.stringify(m))}).catch(()=>{})";
const VERIFY_DATABASES_SCRIPT = `
const fs = require('node:fs');
const Database = require('/app/.output/server/node_modules/better-sqlite3');
const results = [];
for (const path of [process.env.OR3_BASIC_AUTH_DB_PATH, process.env.OR3_SQLITE_DB_PATH].filter(Boolean)) {
  const info = fs.statSync(path);
  if (info.uid !== 65532 || info.gid !== 65532) throw new Error(path + ' must be owned by 65532:65532');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const quickCheck = db.pragma('quick_check', { simple: true });
  const tables = db.prepare("select count(*) as count from sqlite_master where type = 'table'").get().count;
  db.close();
  if (quickCheck !== 'ok') throw new Error(path + ' quick_check failed: ' + quickCheck);
  results.push({ path, quickCheck, tables });
}
if (process.env.OR3_FORCE_HTTPS === 'true' && process.env.NUXT_SECURITY_PROXY_TRUST_PROXY !== 'true') {
  throw new Error('NUXT_SECURITY_PROXY_TRUST_PROXY must be true for a managed public deployment');
}
console.log(JSON.stringify(results));
`;
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

function packagedImageDigest(version: string) {
  let manifest: { version?: unknown; or3Cloud?: { imageDigest?: unknown } };
  try {
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (manifest.version !== version || manifest.or3Cloud?.imageDigest === undefined) return undefined;
  const digest = manifest.or3Cloud.imageDigest;
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error('This @or3/cloud package contains an invalid release image digest. Refusing to pull an unverified image.');
  }
  return digest;
}

function packagedOperatorImageDigest(version: string) {
  let manifest: { version?: unknown; or3Cloud?: { operatorImageDigest?: unknown } };
  try {
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (manifest.version !== version || manifest.or3Cloud?.operatorImageDigest === undefined) return undefined;
  const digest = manifest.or3Cloud.operatorImageDigest;
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error('This @or3/cloud package contains an invalid dashboard operator image digest. Refusing to enable a mutable privileged runtime.');
  }
  return digest;
}

function expectedImageDigest(version: string) {
  const packaged = packagedImageDigest(version);
  const supplied = process.env.OR3_EXPECTED_IMAGE_DIGEST?.trim();
  if (supplied && !/^sha256:[0-9a-f]{64}$/.test(supplied)) {
    throw new Error('OR3_EXPECTED_IMAGE_DIGEST must be a complete sha256 digest.');
  }
  if (packaged && supplied && packaged !== supplied) {
    throw new Error('The requested image digest does not match the authenticated @or3/cloud package.');
  }
  return packaged ?? supplied;
}

function expectedOperatorImageDigest(version: string) {
  const packaged = packagedOperatorImageDigest(version);
  const supplied = process.env.OR3_EXPECTED_OPERATOR_IMAGE_DIGEST?.trim();
  if (supplied && !/^sha256:[0-9a-f]{64}$/.test(supplied)) {
    throw new Error('OR3_EXPECTED_OPERATOR_IMAGE_DIGEST must be a complete sha256 digest.');
  }
  if (packaged && supplied && packaged !== supplied) {
    throw new Error('The requested dashboard operator digest does not match the authenticated @or3/cloud package.');
  }
  return packaged ?? supplied;
}

async function pullImage(image: string, expectedDigest?: string) {
  const local = await run('docker', ['image', 'inspect', image]);
  if (local.ok) {
    const localDigest = await imageDigest(image);
    if (!expectedDigest || localDigest === expectedDigest) return localDigest;
    if (process.env.OR3_CLOUD_SKIP_PULL === 'true') {
      throw new Error(`Local image digest mismatch for ${image}. Expected ${expectedDigest}, found ${localDigest}, and OR3_CLOUD_SKIP_PULL=true prevents downloading the authenticated image.`);
    }
  }
  if (process.env.OR3_CLOUD_SKIP_PULL !== 'true') {
    const result = await run('docker', ['pull', image]);
    if (!result.ok) {
      const detail = result.stderr.trim();
      if (/(not found|manifest unknown|pull access denied)/i.test(detail)) {
        throw new Error(`The matching OR3 container image is not published yet: ${image}. This is a release issue, not a problem with your computer. Try again after the image release completes. ${detail}`);
      }
      throw new Error(`Could not download ${image}. Check your internet connection and Docker registry access, then retry. ${detail}`);
    }
  } else {
    throw new Error(`${image} is not available locally and OR3_CLOUD_SKIP_PULL=true prevents downloading it.`);
  }
  const actual = await imageDigest(image);
  if (expectedDigest && actual !== expectedDigest) {
    throw new Error(`Published image digest mismatch for ${image}. Expected the package-authenticated ${expectedDigest}, found ${actual}. The image tag may have been replaced; refusing to continue.`);
  }
  return actual;
}

function imageRepository(image: string) {
  const reference = image.split('@', 1)[0];
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  return colon > slash ? reference.slice(0, colon) : reference;
}

/**
 * Compose must receive an immutable reference. The one intentional exception
 * is the isolated local-image qualification fixture, whose image ID is not a
 * registry manifest digest and therefore cannot be used as repository@digest.
 */
function imageAtDigest(image: string, digest: string) {
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(`Could not bind ${image} to a complete immutable image digest.`);
  }
  if (image.includes('@')) {
    if (!image.endsWith(`@${digest}`)) throw new Error(`Image reference ${image} does not match expected digest ${digest}.`);
    return image;
  }
  if (process.env.OR3_CLOUD_SKIP_PULL === 'true') return image;
  return `${imageRepository(image)}@${digest}`;
}

async function requireImageDigest(image: string, expected: string, label: string) {
  const actual = await imageDigest(image);
  if (actual !== expected) {
    throw new Error(`${label} image digest mismatch for ${image}. Expected ${expected}, found ${actual}. The registry tag may have moved; refusing to mutate the deployment.`);
  }
  return actual;
}

async function pullAndRequireImage(image: string, expected: string, label: string) {
  const actual = await pullImage(image, expected);
  if (actual !== expected) {
    throw new Error(`${label} image digest mismatch for ${image}. Expected ${expected}, found ${actual}. The registry tag may have moved; refusing to mutate the deployment.`);
  }
  return actual;
}

async function assertImageReleaseIdentity(image: string, version: string) {
  const result = await run('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', image]);
  if (!result.ok) throw new Error(`Could not inspect release labels for ${image}. ${result.stderr.trim()}`);
  let labels: Record<string, unknown>;
  try {
    labels = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(`OR3 image ${image} has no readable release labels.`);
  }
  if (
    labels['org.opencontainers.image.source'] !== 'https://github.com/Saluana/or3-chat'
    || labels['org.opencontainers.image.version'] !== version
    || typeof labels['org.opencontainers.image.revision'] !== 'string'
    || !/^[0-9a-f]{40}$/i.test(labels['org.opencontainers.image.revision'])
  ) {
    throw new Error(`OR3 image ${image} does not carry the expected source/version release labels for ${version}.`);
  }
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

async function assertDockerProjectAbsent(project: string) {
  for (const [resource, args] of [
    ['container', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]],
    ['network', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]],
  ] as Array<[string, string[]]>) {
    const result = await run('docker', args);
    if (!result.ok) {
      throw new Error(`Could not inspect Docker ${resource}s for Compose project ${project}. Refusing to continue while the daemon state is unknown. ${result.stderr.trim()}`);
    }
    if (result.stdout.trim()) {
      throw new Error(`Docker ${resource}s already exist for Compose project ${project}. Choose a different target directory or inspect the existing project before continuing.`);
    }
  }
}

/**
 * Dashboard updates are available only when this CLI can see a local Unix
 * Docker socket and has a concrete Unix identity to pass into the isolated
 * operator container. Remote Docker daemons intentionally stay CLI-only.
 */
async function dashboardOperatorEnv(directory: string, version: string): Promise<DashboardOperatorEnv | undefined> {
  if (process.platform !== 'linux' || !process.getuid || !process.getgid) return undefined;
  const expectedDigest = expectedOperatorImageDigest(version);
  // Development and packages published before the dedicated runtime remains
  // CLI-only rather than falling back to the full application image.
  if (!expectedDigest) return undefined;
  const configured = process.env.DOCKER_HOST?.trim();
  if (configured && !configured.startsWith('unix://')) return undefined;
  const socket = configured ? configured.slice('unix://'.length) : '/var/run/docker.sock';
  if (!isAbsolute(socket)) return undefined;
  let socketStat;
  let uid: number;
  let gid: number;
  try {
    socketStat = await stat(socket);
    if (!socketStat.isSocket()) return undefined;
    uid = process.getuid();
    gid = process.getgid();
    if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) return undefined;
  } catch {
    return undefined;
  }
  const operatorTag = operatorImageFor(version);
  let digest: string;
  try {
    digest = await pullImage(operatorTag, expectedDigest);
    await assertSupportedHostArchitecture(operatorTag);
    await assertImageReleaseIdentity(operatorTag, version);
  } catch {
    return undefined;
  }
  return {
    OR3_DASHBOARD_UPDATES_ENABLED: 'true',
    OR3_OPERATOR_IMAGE: imageAtDigest(operatorTag, digest),
    OR3_DEPLOYMENT_DIR: resolve(directory),
    OR3_OPERATOR_UID: String(uid!),
    OR3_OPERATOR_GID: String(gid!),
    OR3_DOCKER_SOCKET: socket,
    OR3_DOCKER_GID: String(socketStat!.gid),
  };
}

async function prepareDashboardOperatorIpc(directory: string, enabled: boolean) {
  if (!enabled) return;
  const ipc = deploymentPaths(directory).operatorIpc;
  // The app's fixed container UID needs to traverse its read-only bind mount
  // to connect to the socket. Execute-only access prevents it from listing
  // this host-owned directory or creating another socket beside it.
  await mkdir(ipc, { recursive: true, mode: 0o710 });
  await chmod(ipc, 0o710);
}

/**
 * A socket stat is not enough to enable a host-root control plane. Exercise
 * the exact image, user, group, Docker socket, and writable deployment bind
 * before adding the Compose overlay.
 */
async function verifyDashboardOperatorBridge(directory: string, operator?: DashboardOperatorEnv) {
  if (!operator) return false;
  const probe = `.operator-probe-${randomBytes(8).toString('hex')}`;
  const result = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only',
    '--user', `${operator.OR3_OPERATOR_UID}:${operator.OR3_OPERATOR_GID}`,
    '--group-add', operator.OR3_DOCKER_GID,
    '--mount', `type=bind,src=${operator.OR3_DOCKER_SOCKET},dst=/var/run/docker.sock`,
    '--mount', `type=bind,src=${operator.OR3_DEPLOYMENT_DIR},dst=/deployment`,
    '--workdir', '/deployment', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--entrypoint', 'sh', operator.OR3_OPERATOR_IMAGE,
    '-c', `docker version --format '{{.Server.Version}}' >/dev/null && umask 077 && : > .or3-cloud/operator-ipc/${probe} && test -O .or3-cloud/operator-ipc/${probe} && rm .or3-cloud/operator-ipc/${probe}`,
  ], directory);
  if (!result.ok) {
    return false;
  }
  return true;
}

async function prepareVerifiedDashboardOperator(directory: string, version: string) {
  const candidate = await dashboardOperatorEnv(directory, version);
  if (!candidate) return undefined;
  try {
    await prepareDashboardOperatorIpc(directory, true);
    if (await verifyDashboardOperatorBridge(directory, candidate)) return candidate;
  } catch {
    // An existing root-owned or inaccessible IPC directory is not a reason to
    // fail an otherwise supported CLI deployment. Leave this host CLI-only.
  }
  await rm(deploymentPaths(directory).operatorIpc, { recursive: true, force: true }).catch(() => undefined);
  console.warn('Dashboard updates are unavailable on this Docker setup; the deployment will remain host-CLI managed.');
  return undefined;
}

const DASHBOARD_OPERATOR_ENV_KEYS = [
  'OR3_DASHBOARD_UPDATES_ENABLED',
  'OR3_OPERATOR_IMAGE',
  'OR3_DEPLOYMENT_DIR',
  'OR3_OPERATOR_UID',
  'OR3_OPERATOR_GID',
  'OR3_DOCKER_SOCKET',
  'OR3_DOCKER_GID',
] as const;

function withoutDashboardOperator(env: Record<string, string>) {
  const result = { ...env };
  for (const key of DASHBOARD_OPERATOR_ENV_KEYS) delete result[key];
  return result;
}

export function buildEnv(input: {
  mode: Mode;
  version: string;
  directory: string;
  /** Immutable repository@digest reference resolved before this file is written. */
  image?: string;
  deploymentId?: string;
  email: string;
  password: string;
  domain?: string;
  port: number;
  secrets?: Record<string, string>;
  dashboardOperator?: DashboardOperatorEnv;
}) {
  const names = composeProjectNames(input.directory);
  const secrets = input.secrets ?? {};
  const publicOrigin = input.mode === 'public' ? `https://${input.domain}` : `http://127.0.0.1:${input.port}`;
  const values: Record<string, string> = {
    OR3_VERSION: input.version,
    OR3_IMAGE: input.image ?? imageFor(input.version),
    OR3_DEPLOYMENT_ID: input.deploymentId ?? id('deployment'),
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
  if (input.dashboardOperator) Object.assign(values, input.dashboardOperator);
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

export function managedAssetNames(mode: Mode) {
  return ['compose.yaml', 'compose.operator.yaml', 'dashboard-operator.mjs', ...(mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [])];
}

function managedAssetNamesForInventory(mode: Mode, inventoryVersion?: number) {
  if (inventoryVersion === MANAGED_ASSET_INVENTORY_VERSION) return managedAssetNames(mode);
  if (inventoryVersion === 2) {
    return ['compose.yaml', 'dashboard-operator.mjs', ...(mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [])];
  }
  return ['compose.yaml', ...(mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [])];
}

async function installManagedAssets(directory: string, assets: Map<string, Buffer>) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(4).toString('hex');
  const staged: Array<{ destination: string; replacement: string; rollback?: string }> = [];
  try {
    for (const [name, contents] of assets) {
      const destination = join(directory, name);
      const replacement = `${destination}.next-${token}`;
      const entry: { destination: string; replacement: string; rollback?: string } = {
        destination,
        replacement,
      };
      staged.push(entry);
      await writeFile(replacement, contents, { mode: 0o644 });
      await chmod(replacement, 0o644);
      if (await fileExists(destination)) {
        entry.rollback = `${destination}.previous-${token}`;
        await copyFile(destination, entry.rollback);
        await chmod(entry.rollback, 0o644);
      }
    }
    const applied: typeof staged = [];
    try {
      for (const entry of staged) {
        await rename(entry.replacement, entry.destination);
        applied.push(entry);
        await chmod(entry.destination, 0o644);
      }
    } catch (error) {
      for (const entry of applied.reverse()) {
        if (entry.rollback) await rename(entry.rollback, entry.destination);
        else await rm(entry.destination, { force: true });
      }
      throw error;
    }
  } finally {
    for (const entry of staged) {
      await rm(entry.replacement, { force: true }).catch(() => undefined);
      if (entry.rollback) await rm(entry.rollback, { force: true }).catch(() => undefined);
    }
  }
}

export async function copyAssets(directory: string, mode: Mode) {
  const assets = new Map<string, Buffer>();
  for (const name of managedAssetNames(mode)) {
    assets.set(name, await readFile(join(ASSET_ROOT, name)));
  }
  await installManagedAssets(directory, assets);
}

export async function snapshotManagedAssets(directory: string, mode: Mode, backupDir: string) {
  const assetDir = join(backupDir, 'managed-assets');
  await mkdir(assetDir, { recursive: true, mode: 0o700 });
  await chmod(assetDir, 0o700);
  const checksums: Record<string, string> = {};
  for (const name of managedAssetNames(mode)) {
    // The first dashboard-capable update must still snapshot and roll back a
    // deployment created before the operator asset existed.
    if ((name === 'dashboard-operator.mjs' || name === 'compose.operator.yaml') && !await fileExists(join(directory, name))) continue;
    const destination = join(assetDir, name);
    await copySecure(join(directory, name), destination);
    checksums[name] = await sha256File(destination);
  }
  return checksums;
}

async function verifiedManagedAssetContents(backupPath: string, manifest: BackupManifest) {
  const checksums = manifest.managedAssetSha256;
  if (!checksums) return undefined;
  const expected = managedAssetNamesForInventory(manifest.mode, manifest.managedAssetInventoryVersion).sort();
  const actual = Object.keys(checksums).sort();
  if (
    (manifest.managedAssetInventoryVersion !== undefined && manifest.managedAssetInventoryVersion !== 2 && manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION)
    || actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error(`Backup ${manifest.backupId} has an invalid managed asset inventory.`);
  }
  const assets = new Map<string, Buffer>();
  for (const name of expected) {
    const expectedSha = checksums[name];
    if (!expectedSha || !/^[0-9a-f]{64}$/i.test(expectedSha)) {
      throw new Error(`Backup ${manifest.backupId} has an invalid checksum for managed asset ${name}.`);
    }
    const source = join(backupPath, 'managed-assets', name);
    const actualSha = await sha256File(source);
    if (actualSha !== expectedSha) {
      throw new Error(`Backup managed asset checksum mismatch for ${name}. Expected ${expectedSha}, got ${actualSha}.`);
    }
    assets.set(name, await readFile(source));
  }
  return assets;
}

export async function restoreManagedAssets(directory: string, backupPath: string, manifest: BackupManifest) {
  const assets = await verifiedManagedAssetContents(backupPath, manifest);
  if (!assets) return false;
  await installManagedAssets(directory, assets);
  if (manifest.managedAssetInventoryVersion !== 2 && manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION) {
    await rm(join(directory, 'dashboard-operator.mjs'), { force: true });
  }
  if (manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION) {
    await rm(join(directory, 'compose.operator.yaml'), { force: true });
  }
  return true;
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
  const dashboardJobId = process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim();
  operation.origin = dashboardJobId ? 'dashboard' : 'cli';
  if (dashboardJobId) operation.dashboardJobId = dashboardJobId;
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

async function projectServiceRunning(directory: string, mode: Mode) {
  const result = await run('docker', composeArgs(directory, mode, ['ps', '--status', 'running', '-q', 'or3']), directory);
  if (!result.ok) throw new Error(`Could not determine whether OR3 is running. ${result.stderr.trim()}`);
  return Boolean(result.stdout.trim());
}

async function sourceServiceRunning(directory: string, composeFiles: string[]) {
  const result = await run('docker', [...sourceComposeArgs(directory, composeFiles), 'ps', '--status', 'running', '-q', 'or3'], directory);
  if (!result.ok) throw new Error(`Could not determine whether the V1 OR3 service is running. ${result.stderr.trim()}`);
  return Boolean(result.stdout.trim());
}

async function removeDashboardOperator(directory: string, mode: Mode) {
  if (!dashboardUpdatesEnabled(directory)) return;
  await compose(directory, mode, ['rm', '--stop', '--force', 'or3-operator']);
}

async function startProject(directory: string, mode: Mode, env: Record<string, string>) {
  await assertSafeComposeBinding(directory, mode, env);
  // A dashboard-origin update runs inside the operator service. Recreating the
  // whole project here can kill that process before it commits its terminal
  // journal state. Keep its supervisor and proxy running; replace only the
  // application service, then let the operator restart itself after commit.
  const services = process.env.OR3_DASHBOARD_UPDATE_JOB_ID ? ['or3'] : [];
  await compose(directory, mode, ['up', '-d', '--wait', '--wait-timeout', '180', ...services], secretValues(env));
  await waitForDeepHealth(directory, mode, secretValues(env));
  await assertRunningAppImage(directory, mode, env.OR3_IMAGE);
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

async function removeEnumeratedBackupArtifact(directory: string, backup: BackupListing) {
  const backupsRoot = resolve(deploymentPaths(directory).backups);
  const target = resolve(backup.path);
  if (
    dirname(target) !== backupsRoot
    || basename(target) !== backup.backupId
    || !BACKUP_ID_PATTERN.test(backup.backupId)
  ) {
    throw new Error(`Refusing to prune an untrusted backup path ${backup.path}.`);
  }
  await rm(target, { recursive: true, force: true });
  await rm(join(deploymentPaths(directory).exports, `${backup.backupId}.json`), { force: true });
}

type BackupListing = {
  backupId: string;
  createdAt: string;
  appVersion: string;
  path: string;
  bytes: number;
  dataSha256: string;
};

/** Enumerates only fully verified backups; retention must never make policy from corrupt metadata. */
async function enumerateBackups(directory: string): Promise<BackupListing[]> {
  const backupsRoot = deploymentPaths(directory).backups;
  let entries: string[] = [];
  try {
    entries = await readdir(backupsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Could not enumerate managed backups at ${backupsRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result: BackupListing[] = [];
  for (const entry of entries) {
    if (!BACKUP_ID_PATTERN.test(entry)) {
      throw new Error(`Backup store contains an unexpected artifact ${join(backupsRoot, entry)}. Refusing to use it for retention; inspect or remove it explicitly.`);
    }
    const path = join(backupsRoot, entry);
    const manifest = await readManifest(path, directory);
    if (manifest.backupId !== entry) {
      throw new Error(`Backup directory ${path} does not match manifest ID ${manifest.backupId}. Refusing to use it for retention.`);
    }
    if (!Number.isFinite(Date.parse(manifest.createdAt))) {
      throw new Error(`Backup ${manifest.backupId} has an invalid creation time.`);
    }
    let bytes = 0;
    for (const file of ['data.tgz', 'config.env', 'manifest.json', 'manifest.auth']) {
      bytes += (await stat(join(path, file))).size;
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
    const backup = backups.find((entry) => entry.backupId === backupId);
    if (!backup) throw new Error(`Retention selected backup ${backupId}, but its verified path disappeared before deletion.`);
    await removeEnumeratedBackupArtifact(directory, backup);
    console.log(`Deleted backup ${backupId} at ${backup.path}`);
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
  const pending = state.incompleteOperation;
  let pendingTargetImage: string | undefined;
  if (pending?.targetImage) {
    try {
      pendingTargetImage = pending.targetImageDigest
        ? imageAtDigest(pending.targetImage, pending.targetImageDigest)
        : pending.targetImage;
    } catch {
      pendingTargetImage = undefined;
    }
  }
  const journaledTarget = Boolean(
    pending
    && (pending.operation === 'update' || pending.operation === 'restore' || pending.operation === 'rollback')
    && pending.targetVersion
    && pendingTargetImage
    && env.OR3_VERSION === pending.targetVersion
    && env.OR3_IMAGE === pendingTargetImage,
  );
  const journaledIdentityMigration = Boolean(
    journaledTarget
    && !state.deploymentId
    && pending?.targetDeploymentId
    && env[DEPLOYMENT_ID_ENV_KEY] === pending.targetDeploymentId,
  );
  if (state.deploymentId || env[DEPLOYMENT_ID_ENV_KEY]) {
    if ((!state.deploymentId || env[DEPLOYMENT_ID_ENV_KEY] !== state.deploymentId) && !journaledIdentityMigration) {
      throw new Error('Managed state does not match OR3_DEPLOYMENT_ID in .env. Refusing to operate on an unexpected deployment identity.');
    }
  }
  if ((env.OR3_VERSION !== state.appVersion || env.OR3_IMAGE !== state.image) && !journaledTarget) {
    throw new Error('Managed state does not match OR3_VERSION or OR3_IMAGE in .env. Refusing to create a backup or mutate an unverified release configuration.');
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
  if (state.deploymentRoot && resolve(state.deploymentRoot) !== resolved) {
    throw new Error(`Managed deployment root is ${state.deploymentRoot}, not ${resolved}. Refusing to operate on a copied or relocated deployment; perform an explicit relocation before mutation.`);
  }
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
  if (state.deploymentId && (manifest.deploymentId !== state.deploymentId || backupEnv.OR3_DEPLOYMENT_ID !== state.deploymentId)) {
    // The first identity-aware update may retain one authenticated pre-update
    // snapshot whose older assets have no deployment label. It is safe to use
    // only for the same Compose/volume identity checked above; any supplied
    // conflicting identity remains a hard refusal.
    const legacySnapshot = manifest.deploymentId === undefined && backupEnv.OR3_DEPLOYMENT_ID === undefined;
    if (!legacySnapshot) {
      throw new Error(`Backup ${manifest.backupId} belongs to a different immutable deployment identity.`);
    }
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
  const child = spawn(command, args, {
    cwd,
    env: commandEnvironment(command, args, cwd),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  const child = spawn(command, args, {
    cwd,
    env: commandEnvironment(command, args, cwd),
    stdio: ['pipe', 'ignore', 'pipe'],
  });
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
    [
      'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-v', `${volume}:/source:ro`,
      image, 'sh', '-c', 'tar czf - -C /source .',
    ],
    join(backupDir, 'data.tgz'),
  );
}

async function restoreVolumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupPath: string) {
  // Host backups intentionally stay 0700/0600. Stream the archive over stdin
  // so the normal image user can write its owned /data volume without either
  // exposing the backup through a bind mount or forcing a capability-less root.
  const clear = await run('docker', composeArgs(directory, mode, [
    'run', '--rm', '-T', '--no-deps', '--user', '0:0', '--read-only',
    '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
    '--entrypoint', 'sh', 'or3', '-c', 'find /data -mindepth 1 -delete',
  ]), directory);
  if (!clear.ok) {
    throw new Error(`Could not safely clear the managed data volume before restore. ${redact(clear.stderr, secretValues(env))}`);
  }
  await streamFileToCommand(
    'docker',
    composeArgs(directory, mode, [
      'run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'or3', '-c',
      'tar xzf - -C /data',
    ]),
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

async function validateVolumeArchive(directory: string, mode: Mode, env: Record<string, string>, backupPath: string) {
  await streamFileToCommand(
    'docker',
    composeArgs(directory, mode, [
      'run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'or3', '-c',
      'tar tzf - >/dev/null',
    ]),
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

async function createBackup(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  options: { restartAfter?: boolean; backupId?: string; initiallyRunning?: boolean } = {},
) {
  const restartAfter = options.restartAfter ?? true;
  await requireImageDigest(state.image, state.imageDigest, 'Current deployment');
  const backupId = options.backupId ?? id('backup');
  if (!BACKUP_ID_PATTERN.test(backupId)) throw new Error(`Backup ID ${backupId} is invalid.`);
  const backupDir = backupDirectory(directory, backupId);
  const initiallyRunning = options.initiallyRunning ?? await projectServiceRunning(directory, state.mode);
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
    const managedAssetSha256 = await snapshotManagedAssets(directory, state.mode, backupDir);
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
      managedAssetSha256,
      managedAssetInventoryVersion: managedAssetSha256['compose.operator.yaml']
        ? MANAGED_ASSET_INVENTORY_VERSION
        : managedAssetSha256['dashboard-operator.mjs']
          ? 2
          : undefined,
      mode: state.mode,
      domain: state.domain,
      composeProject: state.composeProject,
      volumeName: state.volumeName,
      caddyDataVolume: state.caddyDataVolume,
      caddyConfigVolume: state.caddyConfigVolume,
      deploymentId: state.deploymentId,
      port: state.port,
    };
    const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeSecure(join(backupDir, 'manifest.json'), manifestContents);
    await writeBackupAuthentication(directory, backupDir, manifestContents);
    const verifiedManifest = await readManifest(backupDir, directory);
    manifestWritten = true;
    return { backupId, backupDir, manifest: verifiedManifest };
  } catch (error) {
    if (!manifestWritten) {
      await removeNamedBackupArtifact(directory, backupId).catch(() => undefined);
      throw new Error(`${error instanceof Error ? error.message : String(error)} The partial backup artifact at ${backupDir} was removed.`);
    }
    throw error;
  } finally {
    if (stopAttempted && restartAfter && initiallyRunning) {
      try {
        await startProject(directory, state.mode, env);
      } catch (error) {
        throw new Error(`Backup was created but OR3 could not restart: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function readManifest(backupPath: string, authenticatedForDirectory?: string) {
  const manifestContents = await readText(join(backupPath, 'manifest.json'));
  if (authenticatedForDirectory) await assertBackupAuthentication(authenticatedForDirectory, backupPath, manifestContents);
  const manifest = JSON.parse(manifestContents) as BackupManifest;
  if (
    manifest.schemaVersion !== 1 ||
    !BACKUP_ID_PATTERN.test(manifest.backupId) ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !isVersion(manifest.appVersion) ||
    !manifest.image ||
    !/^sha256:[0-9a-f]{64}$/i.test(manifest.imageDigest) ||
    !/^[0-9a-f]{64}$/i.test(manifest.dataSha256) ||
    !/^[0-9a-f]{64}$/i.test(manifest.configSha256 ?? '') ||
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
  await verifiedManagedAssetContents(backupPath, manifest);
  return manifest;
}

async function cleanupJournaledPartialBackup(directory: string, backupId?: string, backupPath?: string) {
  if (!backupId || !backupPath || !BACKUP_ID_PATTERN.test(backupId)) return;
  const expectedPath = resolve(backupDirectory(directory, backupId));
  if (resolve(backupPath) !== expectedPath || !await fileExists(expectedPath)) return;
  try {
    await readManifest(expectedPath, directory);
  } catch {
    await removeNamedBackupArtifact(directory, backupId);
  }
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
  // Extraction first replaces the current managed volume contents. Its used
  // bytes are reclaimable capacity, unlike a backup archive written beside it.
  const reclaimableBytes = await dataVolumeSize(directory, state.mode, env);
  assertEnoughFreeSpace(freeBytes + reclaimableBytes, requiredBytes, 'Restore');
}

async function restoreBackupData(directory: string, state: ManagedState, env: Record<string, string>, backupPath: string) {
  const manifest = await readManifest(backupPath, directory);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, state, env);
  if (manifest.imageDigest) await requireImageDigest(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  await validateVolumeArchive(directory, state.mode, env, backupPath);
  // Preflight the filesystem Docker will actually extract into. A compressed
  // tarball's byte size and the backup directory's filesystem cannot prove
  // there is room in /data.
  await assertRestoreFreeSpace(directory, state, env, manifest, backupPath);
  // An inventory older than v3 cannot safely re-enable the overlay: its
  // archived assets do not contain compose.operator.yaml. Treat it as a
  // CLI-only snapshot rather than leaving an orphaned Docker-socket sidecar.
  const restoresOperatorOverlay = manifest.managedAssetInventoryVersion === MANAGED_ASSET_INVENTORY_VERSION
    && Boolean(manifest.managedAssetSha256?.['compose.operator.yaml']);
  const restoredEnv = restoresOperatorOverlay
    ? {
        ...backupEnv,
        OR3_IMAGE: imageAtDigest(manifest.image, manifest.imageDigest),
      }
    : withoutDashboardOperator({
        ...backupEnv,
        OR3_IMAGE: imageAtDigest(manifest.image, manifest.imageDigest),
      });

  await stopProject(directory, state.mode);
  if (
    dashboardUpdatesEnabled(directory)
    && restoredEnv.OR3_DASHBOARD_UPDATES_ENABLED !== 'true'
    && !process.env.OR3_DASHBOARD_UPDATE_JOB_ID
  ) {
    await removeDashboardOperator(directory, state.mode);
  }
  // Older releases stored a mutable tag in config.env. The signed manifest
  // records its immutable digest, so rewrite only that reference before
  // Compose sees it; all other backup fields remain the authenticated data.
  await writeSecure(deploymentPaths(directory).env, serializeEnv(restoredEnv));
  await restoreManagedAssets(directory, backupPath, manifest);
  await restoreVolumeArchive(directory, state.mode, restoredEnv, backupPath);
  await startProject(directory, state.mode, restoredEnv);
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
    deploymentId: env.OR3_DEPLOYMENT_ID,
    deploymentRoot: resolve(directory),
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
  npx @or3/cloud verify [--public]
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
  --public                       Require verification through the public HTTPS origin
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
  await assertDockerProjectAbsent(names.project);
  for (const volume of [names.volume, ...(mode === 'public' ? [names.caddyData, names.caddyConfig] : [])]) {
    const existing = await run('docker', ['volume', 'inspect', volume]);
    if (existing.ok) throw new Error(`Docker volume ${volume} already exists. Choose a new directory or inspect it before initializing.`);
    if (existing.exitCode !== 1 || !/no such volume/i.test(`${existing.stdout}\n${existing.stderr}`)) {
      throw new Error(`Could not confirm whether Docker volume ${volume} exists. Refusing initialization until Docker returns an explicit not-found result. ${existing.stderr.trim()}`);
    }
  }
  const email = await resolveAdminEmail(flags);
  const password = await readPassword(flags);
  const version = PACKAGE_VERSION;
  const imageTag = imageFor(version);
  const digest = await pullImage(imageTag, expectedImageDigest(version));
  await assertSupportedHostArchitecture(imageTag);
  await assertImageReleaseIdentity(imageTag, version);
  const image = imageAtDigest(imageTag, digest);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await mkdir(deploymentPaths(directory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(directory).backups, { recursive: true, mode: 0o700 });
  const operator = await prepareVerifiedDashboardOperator(directory, version);
  await copyAssets(directory, mode);
  const env = buildEnv({ mode, version, directory, image, email, password, domain, port, dashboardOperator: operator });
  await writeSecure(deploymentPaths(directory).env, serializeEnv(env));
  await writeSecure(join(directory, '.or3-initial-credentials'), serializeInitialCredentials({
    bootstrapEmail: email,
    bootstrapPassword: password,
    adminUsername: email,
    adminPassword: password,
  }));
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
    if (operator) console.log('Dashboard updates are enabled for super admins in Operations.');
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
  assertDeploymentDirectoryIdentity(resolved, state);
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

async function commitPreMutationRecovery(
  directory: string,
  state: ManagedState,
  message: string,
) {
  const restoredEnv = parseEnv(await readText(deploymentPaths(directory).env));
  const recovered = stateFromEnv(
    directory,
    restoredEnv,
    state.mode,
    state.lastSuccessfulOperation,
    await imageDigest(restoredEnv.OR3_IMAGE),
  );
  recovered.rollback = state.rollback;
  recovered.lastError = message;
  await commitRecoveredState(directory, state, recovered);
  return recovered;
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
    if (pending.phase === 'prepared') {
      if (pending.operation === 'backup' || pending.operation === 'update' || pending.operation === 'adopt') {
        await cleanupJournaledPartialBackup(loaded.directory, pending.backupId, pending.backupPath);
      }
      if (pending.operation === 'restore' || pending.operation === 'rollback') {
        await cleanupJournaledPartialBackup(loaded.directory, pending.previousBackupId, pending.previousBackupPath);
      }
    }
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
      if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
        // The target was not yet allowed to mutate the deployment. A snapshot
        // can leave OR3 stopped, so make the known-good deployment healthy
        // again instead of replaying a requested restore whose boundary is
        // unknown after an interruption.
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
        loaded.state.lastError = undefined;
        await clearPending(loaded.directory, loaded.state);
        console.log(`Recovered the incomplete ${pending.operation} before data replacement. OR3 ${loaded.state.appVersion} is deeply healthy.`);
        return;
      }
      if (!pending.previousBackupPath && !pending.previousBackupId) {
        throw new Error(`The incomplete ${pending.operation} has no verified pre-mutation snapshot. Refusing to replay a target that may have been partially restored; inspect the deployment and restore an authenticated backup explicitly.`);
      }
      const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
      const recovered = await commitPreMutationRecovery(
        loaded.directory,
        loaded.state,
        `Interrupted ${pending.operation} was rolled back to pre-mutation snapshot ${previous.manifest.backupId}.`,
      );
      console.log(`Recovered the incomplete ${pending.operation} by restoring pre-mutation snapshot ${previous.manifest.backupId}. OR3 ${recovered.appVersion} is deeply healthy.`);
      return;
    }

    if (pending.operation === 'update') {
      if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
        await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
        const recovered = stateFromEnv(loaded.directory, loaded.env, loaded.state.mode, loaded.state.lastSuccessfulOperation, await imageDigest(loaded.env.OR3_IMAGE));
        recovered.rollback = loaded.state.rollback;
        recovered.lastError = undefined;
        await commitRecoveredState(loaded.directory, loaded.state, recovered);
        console.log(`Recovered the incomplete update before the replacement was applied. OR3 ${recovered.appVersion} is deeply healthy.`);
        return;
      }
      if (!pending.backupPath && !pending.backupId) {
        throw new Error('The incomplete update has no verified pre-update snapshot. Refusing to guess which image or data should be live.');
      }
      const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
      const recovered = await commitPreMutationRecovery(
        loaded.directory,
        loaded.state,
        `Interrupted update was rolled back to pre-update snapshot ${previous.manifest.backupId}.`,
      );
      console.log(`Recovered the incomplete update by restoring pre-update snapshot ${previous.manifest.backupId}. OR3 ${recovered.appVersion} is deeply healthy.`);
      return;
    }

    if (pending.operation === 'adopt') {
      if (!pending.backupId) throw new Error('The incomplete adoption has no source backup ID. Refusing to claim that data was transferred.');
      const sourceBackupPath = await resolveBackup(loaded.directory, pending.backupId);
      const sourceManifest = await readManifest(sourceBackupPath, loaded.directory);
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

    if (pending.operation === 'backup' && pending.initialAppRunning === false) {
      loaded.state.lastError = undefined;
      await clearPending(loaded.directory, loaded.state);
      console.log('Recovered the incomplete backup operation and preserved the intentionally stopped OR3 service.');
      return;
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
        if (pending.sourceInitiallyRunning !== false) {
          await restartSource(pending.sourceDirectory, sourceFiles, secretValues(sourceEnv));
        }
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
  const backupId = id('backup');
  const initialAppRunning = await projectServiceRunning(loaded.directory, loaded.state.mode);
  const pending: PendingOperation = {
    id: id('backup-operation'),
    operation: 'backup',
    startedAt: now(),
    message: 'Creating a stopped-volume backup',
    backupId,
    backupPath: backupDirectory(loaded.directory, backupId),
    initialAppRunning,
    phase: 'prepared',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const result = await createBackup(loaded.directory, loaded.state, loaded.env, { backupId, initiallyRunning: initialAppRunning });
    await clearPending(loaded.directory, loaded.state);
    // Retention is deliberately after the verified snapshot is committed and
    // OR3 is healthy. A corrupt older artifact must not turn a successful
    // backup into an incomplete operation or cause the new copy to be lost.
    await pruneBackups(loaded.directory, loaded.state, BACKUP_RETENTION_KEEP, false);
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
  const manifest = await readManifest(backupPath, directory);
  const dest = resolve(destination);
  const source = resolve(backupPath);
  const deploymentRoot = await realpath(directory);
  if (source === dest || dest.startsWith(`${source}${sep}`)) {
    throw new Error('Choose a destination directory different from the backup itself.');
  }
  if (await fileExists(dest)) throw new Error(`Destination ${dest} already exists. Choose a new empty destination so an export can never merge with unrelated files.`);
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  const canonicalDestination = join(await realpath(dirname(dest)), basename(dest));
  if (canonicalDestination === deploymentRoot || canonicalDestination.startsWith(`${deploymentRoot}${sep}`)) {
    throw new Error('Backup exports must live outside the managed deployment directory so `remove --purge-data` can never delete the remaining copy.');
  }
  await mkdir(dest, { mode: 0o700 });
  try {
    if (await realpath(dest) !== canonicalDestination) {
      throw new Error('Backup export destination changed while it was being created. Refusing to write an export through an unexpected path.');
    }
    await chmod(dest, 0o700);
    for (const file of ['data.tgz', 'config.env', 'manifest.json', 'manifest.auth']) {
      await copySecure(join(backupPath, file), join(dest, file));
    }
    if (manifest.managedAssetSha256) {
      for (const name of managedAssetNamesForInventory(manifest.mode, manifest.managedAssetInventoryVersion)) {
        await copySecure(join(backupPath, 'managed-assets', name), join(dest, 'managed-assets', name));
      }
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
    await readManifest(dest, directory);
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
    let bytes = (await stat(join(dest, 'data.tgz'))).size + (await stat(join(dest, 'config.env'))).size + (await stat(join(dest, 'manifest.json'))).size + (await stat(join(dest, 'manifest.auth'))).size;
    if (manifest.managedAssetSha256) {
      for (const name of managedAssetNamesForInventory(manifest.mode, manifest.managedAssetInventoryVersion)) {
        bytes += (await stat(join(dest, 'managed-assets', name))).size;
      }
    }
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
  if (targetVersion !== PACKAGE_VERSION) {
    throw new Error(`This CLI contains deployment assets for OR3 ${PACKAGE_VERSION}. Run \`npx --yes @or3/cloud@${targetVersion} update --to ${targetVersion}\` so the image and generated assets match.`);
  }
  if (targetVersion === state.appVersion) throw new Error(`The deployment is already on OR3 ${targetVersion}.`);
  const targetImageTag = imageFor(targetVersion);
  const targetDigest = await pullImage(targetImageTag, expectedImageDigest(targetVersion));
  await assertSupportedHostArchitecture(targetImageTag);
  await assertImageReleaseIdentity(targetImageTag, targetVersion);
  const targetImage = imageAtDigest(targetImageTag, targetDigest);
  const oldEnv = { ...env };
  const targetDeploymentId = env.OR3_DEPLOYMENT_ID ?? state.deploymentId ?? id('deployment');
  const backupId = id('backup');
  const pending: PendingOperation = {
    id: id('update'),
    operation: 'update',
    startedAt: now(),
    message: `Updating from ${state.appVersion} to ${targetVersion}`,
    targetVersion,
    targetImage,
    targetImageDigest: targetDigest,
    targetDeploymentId,
    backupId,
    backupPath: backupDirectory(loaded.directory, backupId),
    phase: 'prepared',
  };
  await markPending(loaded.directory, state, pending);
  try {
    const backup = await createBackup(loaded.directory, state, env, { restartAfter: false, backupId });
    await updatePending(loaded.directory, state, {
      backupId: backup.backupId,
      backupPath: backup.backupDir,
      backupDataSha256: backup.manifest.dataSha256,
      backupConfigSha256: backup.manifest.configSha256,
      phase: 'snapshot-created',
    });
    // Resolve the dedicated operator runtime for every target version. Keeping
    // an old privileged image after an application update defeats the digest
    // binding and leaves security fixes behind. A host-CLI update can safely
    // remove an unavailable bridge before changing the overlay; a dashboard
    // update lets its current supervisor exit cleanly after the commit.
    const operator = await prepareVerifiedDashboardOperator(loaded.directory, targetVersion);
    if (env.OR3_DASHBOARD_UPDATES_ENABLED === 'true' && !operator && !process.env.OR3_DASHBOARD_UPDATE_JOB_ID) {
      await removeDashboardOperator(loaded.directory, state.mode);
    }
    const nextEnv = {
      ...withoutDashboardOperator(env),
      OR3_VERSION: targetVersion,
      OR3_IMAGE: targetImage,
      OR3_DEPLOYMENT_ID: targetDeploymentId,
      ...(operator ?? {}),
    };
    const previousRootOwnership = await managedVolumeRootOwnership(targetImage, state.volumeName);
    const migrateLegacyVolume = previousRootOwnership.uid !== MANAGED_RUNTIME_UID || previousRootOwnership.gid !== MANAGED_RUNTIME_GID;
    await updatePending(loaded.directory, state, {
      phase: 'target-mutating',
      previousRootOwnership,
    });
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
      await copyAssets(loaded.directory, state.mode);
      if (migrateLegacyVolume) {
        await restoreVolumeArchive(loaded.directory, state.mode, nextEnv, backup.backupDir);
      }
      await startProject(loaded.directory, state.mode, nextEnv);
    } catch (error) {
      await updatePending(loaded.directory, state, { phase: 'restoring-previous' });
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
      const recovered = await commitPreMutationRecovery(
        loaded.directory,
        state,
        `Update to ${targetVersion} failed and was restored: ${redact(error instanceof Error ? error.message : String(error), secretValues(oldEnv))}`,
      );
      throw new Error(recovered.lastError);
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
    state.deploymentId = targetDeploymentId;
    state.deploymentRoot = resolve(loaded.directory);
    state.lastSuccessfulOperation = 'update';
    state.lastError = undefined;
    await clearPending(loaded.directory, state);
    await pruneBackups(loaded.directory, state, BACKUP_RETENTION_KEEP, false);
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
  if (!isAbsolute(value) && !BACKUP_ID_PATTERN.test(value)) {
    throw new Error(`Backup ID "${value}" is invalid. Use an OR3-generated backup ID or an absolute external backup path.`);
  }
  const candidate = isAbsolute(value) ? value : backupDirectory(directory, value);
  if (!await fileExists(join(candidate, 'manifest.json'))) throw new Error(`Backup ${value} was not found in ${deploymentPaths(directory).backups}.`);
  return resolve(candidate);
}

async function recordedBackupPath(directory: string, pending: PendingOperation, previous = false) {
  const path = previous ? pending.previousBackupPath : pending.backupPath;
  const backupId = previous ? pending.previousBackupId : pending.backupId;
  const resolved = path
    ? resolve(path)
    : backupId
      ? await resolveBackup(directory, backupId)
      : undefined;
  if (!resolved || !await fileExists(join(resolved, 'manifest.json'))) {
    throw new Error(`The incomplete ${pending.operation} has no readable ${previous ? 'pre-mutation' : 'target'} backup source.`);
  }
  const manifest = await readManifest(resolved, directory);
  if (!previous) {
    if (pending.backupDataSha256 && pending.backupDataSha256 !== manifest.dataSha256) {
      throw new Error(`The recorded target backup at ${resolved} no longer has its expected data checksum.`);
    }
    if (pending.backupConfigSha256 && pending.backupConfigSha256 !== manifest.configSha256) {
      throw new Error(`The recorded target backup at ${resolved} no longer has its expected configuration checksum.`);
    }
  }
  return { path: resolved, manifest };
}

async function createPreMutationSnapshot(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  backupId: string,
) {
  return await createBackup(directory, state, env, { restartAfter: false, backupId });
}

/**
 * Restores the verified snapshot taken immediately before a destructive
 * operation. Keeping this separate from the requested target prevents recovery
 * from "blessing" a partially restored target after an interruption.
 */
async function restorePreMutationSnapshot(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
) {
  const pending = state.incompleteOperation;
  if (!pending) throw new Error('No incomplete operation is available to restore.');
  const previous = await recordedBackupPath(directory, pending, true);
  await updatePending(directory, state, { phase: 'restoring-previous' });
  if (pending.previousRootOwnership) {
    await pullAndRequireImage(state.image, state.imageDigest, 'Previous deployment');
    await setManagedVolumeRootOwnership(state.image, state.volumeName, pending.previousRootOwnership);
  }
  await restoreBackupData(directory, state, env, previous.path);
  return previous;
}

async function restoreCommand(directory: string, flags: Flags, positionals: string[]) {
  if (!boolFlag(flags, 'yes')) throw new Error('Restore replaces live data. Re-run with --yes after confirming the backup and data-loss boundary.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const backupValue = positionals[0];
  if (!backupValue) throw new Error('restore requires a backup ID or path.');
  const backupPath = await resolveBackup(loaded.directory, backupValue);
  const manifest = await readManifest(backupPath, loaded.directory);
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
    backupPath,
    backupDataSha256: manifest.dataSha256,
    backupConfigSha256: manifest.configSha256,
    targetVersion: manifest.appVersion,
    targetImage: manifest.image,
    targetImageDigest: manifest.imageDigest,
    phase: 'prepared',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const previousBackupId = id('backup-before-restore');
    await updatePending(loaded.directory, loaded.state, {
      previousBackupId,
      previousBackupPath: backupDirectory(loaded.directory, previousBackupId),
    });
    const previous = await createPreMutationSnapshot(loaded.directory, loaded.state, loaded.env, previousBackupId);
    await updatePending(loaded.directory, loaded.state, {
      previousBackupId: previous.backupId,
      previousBackupPath: previous.backupDir,
      phase: 'snapshot-created',
    });
    await updatePending(loaded.directory, loaded.state, { phase: 'target-mutating' });
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath);
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const digest = await imageDigest(restoredEnv.OR3_IMAGE);
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', digest);
    nextState.lastError = undefined;
    await removeOperationRecord(loaded.directory, pending.id);
    await writeState(loaded.directory, nextState);
    console.log(`Restored ${manifest.backupId}. Verify sign-in, a conversation, and a previously uploaded file.`);
  } catch (error) {
    const original = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    const phase = loaded.state.incompleteOperation?.phase;
    const targetMayHaveMutated = phase === 'target-mutating' || phase === 'restoring-previous' || phase === 'starting-target';
    if (targetMayHaveMutated && (loaded.state.incompleteOperation?.previousBackupPath || loaded.state.incompleteOperation?.previousBackupId)) {
      let recoveredMessage: string;
      try {
        const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
        recoveredMessage = `Restore of ${manifest.backupId} failed and the pre-restore snapshot ${previous.manifest.backupId} was restored: ${original}`;
        await commitPreMutationRecovery(loaded.directory, loaded.state, recoveredMessage);
      } catch (recoveryError) {
        const recovery = redact(recoveryError instanceof Error ? recoveryError.message : String(recoveryError), secretValues(loaded.env));
        loaded.state.lastError = `Restore of ${manifest.backupId} failed, and automatic restoration of the pre-restore snapshot also failed: ${recovery}. Original restore error: ${original}`;
        await writeState(loaded.directory, loaded.state);
        throw new Error(loaded.state.lastError);
      }
      throw new Error(recoveredMessage!);
    }
    // No target mutation was recorded. A stopped backup snapshot is harmless,
    // but OR3 may be down; return the original deployment to health before
    // removing the no-longer-actionable operation record.
    try {
      await startProject(loaded.directory, loaded.state.mode, loaded.env);
      loaded.state.lastError = `Restore of ${manifest.backupId} stopped before data replacement: ${original}`;
      await clearPending(loaded.directory, loaded.state);
    } catch (restartError) {
      const restart = redact(restartError instanceof Error ? restartError.message : String(restartError), secretValues(loaded.env));
      loaded.state.lastError = `Restore of ${manifest.backupId} stopped before data replacement, but the original deployment could not restart: ${restart}. Original restore error: ${original}`;
      await writeState(loaded.directory, loaded.state);
      throw new Error(loaded.state.lastError);
    }
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
  const manifest = await readManifest(backupPath, loaded.directory);
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
    backupPath,
    backupDataSha256: manifest.dataSha256,
    backupConfigSha256: manifest.configSha256,
    targetVersion: point.appVersion,
    targetImage: point.image,
    targetImageDigest: point.imageDigest,
    phase: 'prepared',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const previousBackupId = id('backup-before-rollback');
    await updatePending(loaded.directory, loaded.state, {
      previousBackupId,
      previousBackupPath: backupDirectory(loaded.directory, previousBackupId),
    });
    const previous = await createPreMutationSnapshot(loaded.directory, loaded.state, loaded.env, previousBackupId);
    await updatePending(loaded.directory, loaded.state, {
      previousBackupId: previous.backupId,
      previousBackupPath: previous.backupDir,
      phase: 'snapshot-created',
    });
    await updatePending(loaded.directory, loaded.state, { phase: 'target-mutating' });
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath);
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', await imageDigest(restoredEnv.OR3_IMAGE));
    nextState.rollback = undefined;
    await removeOperationRecord(loaded.directory, pending.id);
    await writeState(loaded.directory, nextState);
    console.log(`Rolled back to OR3 ${nextState.appVersion}. Verify sign-in, chat, and file access.`);
  } catch (error) {
    const original = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    const phase = loaded.state.incompleteOperation?.phase;
    const targetMayHaveMutated = phase === 'target-mutating' || phase === 'restoring-previous' || phase === 'starting-target';
    if (targetMayHaveMutated && (loaded.state.incompleteOperation?.previousBackupPath || loaded.state.incompleteOperation?.previousBackupId)) {
      let recoveredMessage: string;
      try {
        const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
        recoveredMessage = `Rollback to ${point.appVersion} failed and the pre-rollback snapshot ${previous.manifest.backupId} was restored: ${original}`;
        await commitPreMutationRecovery(loaded.directory, loaded.state, recoveredMessage);
      } catch (recoveryError) {
        const recovery = redact(recoveryError instanceof Error ? recoveryError.message : String(recoveryError), secretValues(loaded.env));
        loaded.state.lastError = `Rollback to ${point.appVersion} failed, and automatic restoration of the pre-rollback snapshot also failed: ${recovery}. Original rollback error: ${original}`;
        await writeState(loaded.directory, loaded.state);
        throw new Error(loaded.state.lastError);
      }
      throw new Error(recoveredMessage!);
    }
    try {
      await startProject(loaded.directory, loaded.state.mode, loaded.env);
      loaded.state.lastError = `Rollback to ${point.appVersion} stopped before data replacement: ${original}`;
      await clearPending(loaded.directory, loaded.state);
    } catch (restartError) {
      const restart = redact(restartError instanceof Error ? restartError.message : String(restartError), secretValues(loaded.env));
      loaded.state.lastError = `Rollback to ${point.appVersion} stopped before data replacement, but the original deployment could not restart: ${restart}. Original rollback error: ${original}`;
      await writeState(loaded.directory, loaded.state);
      throw new Error(loaded.state.lastError);
    }
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

type VerificationHealth = {
  status: 'ok';
  providers: {
    auth: { provider: 'basic-auth' };
    sync: { provider: 'sqlite' };
    storage: { provider: 'fs' };
  };
};

export function validateVerificationHealth(value: unknown): VerificationHealth {
  const health = value as Partial<VerificationHealth> | null;
  if (
    !health ||
    health.status !== 'ok' ||
    health.providers?.auth?.provider !== 'basic-auth' ||
    health.providers?.sync?.provider !== 'sqlite' ||
    health.providers?.storage?.provider !== 'fs'
  ) {
    throw new Error('Public deep health does not report the managed Basic Auth + SQLite + filesystem profile.');
  }
  return health as VerificationHealth;
}

async function verificationFetch(url: URL, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
}

async function verificationJson(
  baseUrl: URL,
  path: string,
  options: { body?: unknown; cookie?: string; method?: 'GET' | 'POST' } = {},
) {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const response = await verificationFetch(new URL(path, baseUrl), {
    method,
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(method === 'GET' ? {} : { origin: baseUrl.origin }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (response.status !== 200) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`${response.url} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.json() as Promise<Record<string, any>>;
}

async function verifyPublicApplication(baseUrl: URL, env: Record<string, string>) {
  const root = await verificationFetch(baseUrl);
  if (root.status !== 200) throw new Error(`${baseUrl} returned HTTP ${root.status}; redirects are not accepted during verification.`);

  const health = validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
  const email = env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const password = env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  if (!email || !password) throw new Error('Bootstrap credentials are missing from the managed .env.');
  const signIn = await verificationFetch(new URL('/api/basic-auth/sign-in', baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  if (signIn.status !== 200) throw new Error(`Public Basic Auth sign-in returned HTTP ${signIn.status}.`);
  const responseHeaders = signIn.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = responseHeaders.getSetCookie?.() ?? [signIn.headers.get('set-cookie')].filter((value): value is string => Boolean(value));
  const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error('Public Basic Auth sign-in did not set a session cookie.');

  const session = await verificationJson(baseUrl, '/api/auth/session', { cookie });
  if (session.session?.user?.email !== email || !session.session?.workspace?.id) {
    throw new Error('Public session hydration did not return the bootstrap user and workspace.');
  }
  const workspaceId = String(session.session.workspace.id);
  const pull = await verificationJson(baseUrl, '/api/sync/pull', {
    cookie,
    body: { scope: { workspaceId }, cursor: 0, limit: 1, tables: ['messages'] },
  });
  if (!Array.isArray(pull.changes) || typeof pull.nextCursor !== 'number') {
    throw new Error('Public SQLite sync pull returned an invalid response.');
  }

  const probeBytes = Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'),
    randomBytes(8),
  ]);
  const hash = `sha256:${createHash('sha256').update(probeBytes).digest('hex')}`;
  let storageId: string | undefined;
  try {
    const presign = await verificationJson(baseUrl, '/api/storage/presign-upload', {
      cookie,
      body: {
        workspace_id: workspaceId,
        hash,
        mime_type: 'image/png',
        size_bytes: probeBytes.length,
        disposition: 'inline',
      },
    });
    storageId = typeof presign.storageId === 'string' ? presign.storageId : undefined;
    if (typeof presign.url !== 'string') throw new Error('Filesystem storage did not return an upload URL.');
    const upload = await verificationFetch(new URL(presign.url, baseUrl), {
      method: typeof presign.method === 'string' ? presign.method : 'PUT',
      headers: {
        'content-type': 'image/png',
        cookie,
        ...(presign.headers && typeof presign.headers === 'object' ? presign.headers : {}),
      },
      body: probeBytes,
    });
    if (!upload.ok) throw new Error(`Filesystem verification upload returned HTTP ${upload.status}.`);
    await verificationJson(baseUrl, '/api/storage/commit', {
      cookie,
      body: {
        workspace_id: workspaceId,
        hash,
        storage_id: storageId,
        storage_provider_id: 'fs',
        mime_type: 'image/png',
        size_bytes: probeBytes.length,
        name: 'or3-production-verification.png',
        kind: 'image',
      },
    });
    const downloadGrant = await verificationJson(baseUrl, '/api/storage/presign-download', {
      cookie,
      body: { workspace_id: workspaceId, hash, storage_id: storageId, disposition: 'attachment' },
    });
    if (typeof downloadGrant.url !== 'string') throw new Error('Filesystem storage did not return a download URL.');
    const download = await verificationFetch(new URL(downloadGrant.url, baseUrl), { headers: { cookie } });
    if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(probeBytes)) {
      throw new Error('Filesystem verification download did not match the uploaded probe.');
    }
  } finally {
    if (storageId) {
      await verificationJson(baseUrl, '/api/storage/delete', {
        cookie,
        body: { workspace_id: workspaceId, hash, storage_id: storageId },
      });
    }
  }
  return health;
}

async function verifyCommand(directory: string, flags: Flags, positionals: string[]) {
  if (positionals.length) throw new Error('verify accepts no positional arguments.');
  if (flags.public !== undefined && !boolFlag(flags, 'public')) throw new Error('--public does not accept a value.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  if (boolFlag(flags, 'public') && loaded.state.mode !== 'public') {
    throw new Error('--public requires a managed public deployment.');
  }
  if (loaded.env.OR3_VERSION !== loaded.state.appVersion || loaded.env.OR3_IMAGE !== loaded.state.image) {
    throw new Error('Managed state and .env version/image do not match.');
  }
  const digest = await imageDigest(loaded.state.image);
  if (digest !== loaded.state.imageDigest) {
    throw new Error(`Managed image digest differs from state. Expected ${loaded.state.imageDigest}, found ${digest}.`);
  }
  await waitForDeepHealth(loaded.directory, loaded.state.mode, secretValues(loaded.env));
  const baseUrl = new URL(
    loaded.state.mode === 'public'
      ? `https://${loaded.state.domain}`
      : `http://127.0.0.1:${loaded.state.port}`,
  );
  await verifyPublicApplication(baseUrl, loaded.env);
  const databaseCheck = await run('docker', [
    ...composeArgs(loaded.directory, loaded.state.mode, ['exec', '-T', 'or3', ...containerNodeCommand(VERIFY_DATABASES_SCRIPT)]),
  ], loaded.directory);
  if (!databaseCheck.ok) throw new Error(`SQLite integrity or runtime proxy verification failed. ${databaseCheck.stderr.trim()}`);
  const databases = JSON.parse(databaseCheck.stdout.trim()) as Array<{ path: string; quickCheck: string; tables: number }>;
  if (databases.length !== 2 || databases.some((entry) => entry.quickCheck !== 'ok' || entry.tables < 1)) {
    throw new Error('SQLite verification did not confirm both managed databases.');
  }
  const services = loaded.state.mode === 'public' ? ['or3', 'caddy'] : ['or3'];
  const logs = await run('docker', composeArgs(loaded.directory, loaded.state.mode, [
    'logs', '--no-color', '--since', '10m', '--tail', '250', ...services,
  ]), loaded.directory);
  if (!logs.ok) throw new Error(`Could not read bounded deployment logs. ${logs.stderr.trim()}`);
  const serious = `${logs.stdout}\n${logs.stderr}`.split(/\r?\n/).filter((line) =>
    /\b(?:fatal|panic|oomkilled)\b|unhandled (?:rejection|exception)|out of memory/i.test(line),
  );
  if (serious.length) throw new Error(`Recent deployment logs contain serious errors:\n${redact(serious.slice(-20).join('\n'), secretValues(loaded.env))}`);
  console.log(`✓ OR3 ${loaded.state.appVersion} image digest matches managed state`);
  console.log(`✓ ${baseUrl.origin} root and deep health return HTTP 200 without redirects`);
  console.log('✓ Basic Auth sign-in, session hydration, and SQLite sync pull passed');
  console.log('✓ Filesystem storage write/read/delete probe passed');
  console.log('✓ auth.sqlite and sync.sqlite quick_check passed with managed ownership');
  console.log('✓ Recent bounded logs contain no fatal, panic, unhandled, or OOM events');
  console.log('OR3 production verification passed.');
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
  if (sourceEnv.OR3_AUTH_REGISTRATION_MODE !== 'invite_only' || sourceEnv.OR3_AUTH_AUTO_PROVISION !== 'false') {
    throw new Error('V1 project does not use the managed invite-only registration policy. Adoption refuses to carry open registration into OR3 Cloud.');
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
  if (release.or3Version !== PACKAGE_VERSION) {
    throw new Error(`V1 is on OR3 ${release.or3Version}, but this CLI ships managed assets for ${PACKAGE_VERSION}. Run the matching @or3/cloud version or perform a qualified host CLI update before adoption.`);
  }
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
  const sourceImage = imageFor(release.or3Version);
  if (sourceEnv.OR3_VERSION && sourceEnv.OR3_VERSION !== release.or3Version) {
    throw new Error(`V1 OR3_VERSION ${sourceEnv.OR3_VERSION} does not match or3-release.json ${release.or3Version}.`);
  }
  const digest = await pullImage(sourceImage, expectedImageDigest(release.or3Version));
  await assertSupportedHostArchitecture(sourceImage);
  await assertImageReleaseIdentity(sourceImage, release.or3Version);
  const image = imageAtDigest(sourceImage, digest);
  if (sourceEnv.OR3_IMAGE && sourceEnv.OR3_IMAGE !== sourceImage && sourceEnv.OR3_IMAGE !== image) {
    throw new Error(`V1 OR3_IMAGE ${sourceEnv.OR3_IMAGE} does not match the authenticated image for ${release.or3Version}.`);
  }
  const sourceVolume = await readSourceVolume(sourceDirectory);
  const email = sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const password = sourceEnv.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  validateEmail(email);
  validatePassword(password);
  const sourcePort = Number(sourceEnv.OR3_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) throw new Error('V1 project has an invalid OR3 port.');
  if (mode === 'public' && [80, 443].includes(sourcePort)) throw new Error('V1 public deployment uses a Caddy port for OR3; adoption requires a separate OR3 port.');
  assertSupportedSourceCompose(sourceConfig.stdout, sourceVolume, sourcePort);
  const sourceInitiallyRunning = await sourceServiceRunning(sourceDirectory, sourceComposeFiles);
  const targetNames = composeProjectNames(targetDirectory);
  await assertDockerProjectAbsent(targetNames.project);
  for (const volume of [targetNames.volume, ...(mode === 'public' ? [targetNames.caddyData, targetNames.caddyConfig] : [])]) {
    const existing = await run('docker', ['volume', 'inspect', volume]);
    if (existing.ok) throw new Error(`Docker volume ${volume} already exists. Choose a new adoption target directory.`);
    if (existing.exitCode !== 1 || !/no such volume/i.test(`${existing.stdout}\n${existing.stderr}`)) {
      throw new Error(`Could not confirm whether Docker volume ${volume} exists. Refusing adoption until Docker returns an explicit not-found result. ${existing.stderr.trim()}`);
    }
  }
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  await chmod(targetDirectory, 0o700);
  await mkdir(deploymentPaths(targetDirectory).operations, { recursive: true, mode: 0o700 });
  await mkdir(deploymentPaths(targetDirectory).backups, { recursive: true, mode: 0o700 });
  const operator = await prepareVerifiedDashboardOperator(targetDirectory, release.or3Version);
  await copyAssets(targetDirectory, mode);
  const copiedSecrets: Record<string, string> = {};
  for (const key of SECRET_KEYS) if (sourceEnv[key]) copiedSecrets[key] = sourceEnv[key];
  const targetEnv = buildEnv({
    mode,
    version: release.or3Version,
    directory: targetDirectory,
    image,
    email,
    password,
    domain,
    port: sourcePort,
    secrets: copiedSecrets,
    dashboardOperator: operator,
  });
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
    OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false',
    OR3_GUEST_ACCESS_ENABLED: 'false',
  });
  await writeSecure(deploymentPaths(targetDirectory).env, serializeEnv(targetEnv));
  await writeSecure(join(targetDirectory, '.or3-initial-credentials'), serializeInitialCredentials({
    bootstrapEmail: email,
    bootstrapPassword: password,
    adminUsername: email,
    adminPassword: password,
  }));
  const state = stateFromEnv(targetDirectory, targetEnv, mode, 'adopt', digest);
  const sourceBackupId = id('backup-adopt-source');
  const sourceBackupDir = backupDirectory(targetDirectory, sourceBackupId);
  await markPending(targetDirectory, state, {
    id: id('adopt'),
    operation: 'adopt',
    startedAt: now(),
    message: `Adopting ${sourceDirectory}`,
    sourceDirectory,
    sourceInitiallyRunning,
    backupId: sourceBackupId,
    backupPath: sourceBackupDir,
    phase: 'prepared',
  });
  let sourceStopAttempted = false;
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
    await mkdir(sourceBackupDir, { recursive: true, mode: 0o700 });
    await copySecure(join(sourceDirectory, '.env'), join(sourceBackupDir, 'config.env'));
    await archiveExternalVolume(sourceImage, sourceVolume, sourceBackupDir);
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
    const sourceManifestContents = `${JSON.stringify(sourceManifest, null, 2)}\n`;
    await writeSecure(join(sourceBackupDir, 'manifest.json'), sourceManifestContents);
    await writeBackupAuthentication(targetDirectory, sourceBackupDir, sourceManifestContents);
    await readManifest(sourceBackupDir, targetDirectory);
    await updatePending(targetDirectory, state, { phase: 'snapshot-created' });
    await restoreVolumeArchive(targetDirectory, mode, targetEnv, sourceBackupDir);
    await startProject(targetDirectory, mode, targetEnv);
    await clearPending(targetDirectory, state);
    console.log(`Adopted ${sourceDirectory} into ${targetDirectory} at OR3 ${release.or3Version}.`);
    console.log(`Source backup: ${sourceBackupDir}`);
    console.log(`The original deployment is preserved and stopped. Verify sign-in, chat, and file access before removing anything.`);
  } catch (error) {
    await compose(targetDirectory, mode, ['down']).catch(() => undefined);
    let sourceRecoveryError = '';
    if (sourceStopAttempted && sourceInitiallyRunning) {
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
    const deploymentRoot = await realpath(directory);
    try {
      const canonicalDestination = await realpath(receipt.destination);
      if (canonicalDestination === deploymentRoot || canonicalDestination.startsWith(`${deploymentRoot}${sep}`)) continue;
      const exported = await readManifest(receipt.destination, directory);
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
  const managedFiles = [
    '.env',
    '.or3-cloud',
    ...managedAssetNames(state.mode),
    '.or3-initial-credentials',
  ];
  console.log('Removing exactly these targets:');
  for (const volume of volumes) console.log(`  docker volume ${volume}`);
  for (const file of managedFiles) console.log(`  ${join(directory, file)}`);
  await compose(directory, state.mode, ['down']);
  // Recheck immediately before deletion. A moved mount or symlink cannot turn
  // the receipt that authorized this purge into a descendant of the purge
  // target after the operator confirmed it.
  await assertPurgeHasVerifiedExport(directory, await enumerateBackups(directory), Date.now());
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

const MUTATING_COMMANDS = new Set([
  'init',
  'update',
  'backup',
  'verify',
  'restore',
  'rollback',
  'credentials',
  'recover',
  'adopt',
  'start',
  'stop',
  'restart',
  'remove',
]);

function mutationDirectory(command: string, positionals: string[], flags: Flags) {
  if (command === 'init') return resolve(process.cwd(), positionals[0] ?? 'or3-cloud');
  if (command === 'adopt') {
    const sourceDirectory = requireStringFlag(flags, 'from');
    return resolve(process.cwd(), positionals[0] ?? `${basename(sourceDirectory)}-managed`);
  }
  return process.cwd();
}

async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  if (command === '--help' || command === 'help') return help();
  if (command === '--version' || command === 'version') return console.log(PACKAGE_VERSION);
  const parsed = parseFlags(rest);
  try {
    if (parsed.flags.help) return help();
    assertCommandFlags(command, parsed.flags);
    assertCommandPositionals(command, parsed.positionals);
    const dispatch = async () => {
      if (command === 'init') return await initCommand(parsed.positionals, parsed.flags);
      if (command === 'update') return await updateCommand(process.cwd(), parsed.flags);
      if (command === 'backup') return await backupCommand(process.cwd(), parsed.positionals, parsed.flags);
      if (command === 'restore') return await restoreCommand(process.cwd(), parsed.flags, parsed.positionals);
      if (command === 'rollback') return await rollbackCommand(process.cwd(), parsed.flags);
      if (command === 'credentials') return await credentialsCommand(process.cwd(), parsed.positionals, parsed.flags);
      if (command === 'doctor') return await doctorCommand(process.cwd());
      if (command === 'verify') return await verifyCommand(process.cwd(), parsed.flags, parsed.positionals);
      if (command === 'recover') return await recoverCommand(process.cwd());
      if (command === 'adopt') return await adoptCommand(parsed.positionals, parsed.flags);
      if (command === 'status') return await statusCommand(process.cwd());
      if (command === 'logs') return await logsCommand(process.cwd(), parsed.flags, parsed.positionals);
      if (command === 'start') return await startCommand(process.cwd());
      if (command === 'stop') return await stopCommand(process.cwd());
      if (command === 'restart') return await restartCommand(process.cwd());
      if (command === 'remove') return await removeCommand(process.cwd(), parsed.flags);
      throw new Error(`Unknown command "${command}". Run npx @or3/cloud --help.`);
    };
    if (MUTATING_COMMANDS.has(command)) {
      return await withDeploymentLease(mutationDirectory(command, parsed.positionals, parsed.flags), command, dispatch);
    }
    return await dispatch();
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
