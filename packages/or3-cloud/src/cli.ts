#!/usr/bin/env node

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { lookup } from 'node:dns/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
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

export const PACKAGE_VERSION = '0.1.69';
export const IMAGE_REPOSITORY = 'ghcr.io/saluana/or3-chat';
const ASSET_ROOT = resolve(fileURLToPath(new URL('../assets/', import.meta.url)));
/** Schema this bridge release writes by default; schema 2 is opt-in metadata. */
const LEGACY_STATE_SCHEMA_VERSION = 1;
const DEFAULT_PORT = 3000;
const DEEP_HEALTH_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 180_000;
const STREAM_COMMAND_TIMEOUT_MS = 15 * 60_000;
const BACKUP_RETENTION_KEEP = 5;
const PURGE_REQUIRES_BACKUP_WITHIN_MS = 24 * 60 * 60 * 1000;
const FREE_SPACE_HEADROOM_BYTES = 64 * 1024 * 1024;
const BACKUP_ID_PATTERN = /^backup-[0-9A-Za-z-]+$/;
const DASHBOARD_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPOSE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const MANAGED_ASSET_INVENTORY_VERSION = 3;
const DASHBOARD_LEASE_STALE_MS = 30_000;
const PROVISIONING_CREDENTIAL_KEYS = [
  'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
  'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_ADMIN_PASSWORD',
] as const;
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
  schemaVersion: StateSchemaVersion;
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
  /** Bounded latest terminal receipt; regenerable from terminal state. */
  lastReceipt?: OperationReceipt;
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
    phase?: 'prepared' | 'snapshot-created' | 'target-mutating' | 'target-ready' | 'restoring-previous' | 'starting-target' | 'starting-previous';
    /** Durable proof of a completed replacement boundary for schema-2 updates. */
    evidence?: TargetReadyEvidence;
    verifiedSnapshot?: VerifiedSnapshot;
    previousRootOwnership?: { uid: number; gid: number };
    /** A legacy unlabeled volume must be recreated from its verified snapshot. */
    recreateDataVolume?: boolean;
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

/**
 * Operation, diagnostic, receipt, and compatibility contracts.
 *
 * Terminal outcomes are deliberately distinct from per-check or maintenance
 * status: a completed deployment can still carry cleanup warnings, and a
 * deferred check is not a passed one. Update phases that require durable
 * evidence carry it explicitly so a crash cannot be inferred as completion.
 */
export type ReleaseIdentity = {
  appVersion: string;
  image: string;
  imageDigest: string;
  sourceRevision?: string;
  operatorImageDigest?: string;
};

export type CheckResult = {
  code: string;
  status: 'passed' | 'failed' | 'deferred' | 'unknown';
  detail: string;
};

export type DiagnosticSeverity = 'blocker' | 'warning' | 'info';

export type Diagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  resource?: string;
  message: string;
  nextCommand?: string;
};

export type OperationReceipt = {
  schemaVersion: 1;
  operationId: string;
  /** Dashboard job that owns an operator handoff, when one is required. */
  dashboardJobId?: string;
  cliVersion: string;
  source: ReleaseIdentity;
  target: ReleaseIdentity;
  observed: ReleaseIdentity;
  completedAt: string;
  rollbackBackupId: string;
  checks: CheckResult[];
  warnings: Diagnostic[];
  phaseDurationsMs: Record<string, number>;
  operatorHandoff: 'not-required' | 'verified' | 'pending' | 'needs-attention';
};

export type OperationOutcome =
  | { kind: 'blocked'; findings: Diagnostic[] }
  | { kind: 'completed'; receipt: OperationReceipt }
  | { kind: 'completed-with-warnings'; receipt: OperationReceipt; warnings: Diagnostic[] }
  | { kind: 'restored'; receipt: OperationReceipt; cause: Diagnostic }
  | { kind: 'needs-recovery'; operationId: string; findings: Diagnostic[] }
  | { kind: 'no-op'; detail: string; currentVersion?: string; targetVersion?: string }
  | { kind: 'recovered'; operation: string; detail: string };

/** Serializes exactly one machine-readable operation result to stdout. */
function emitOperationResult(outcome: OperationOutcome) {
  console.log(JSON.stringify({ schemaVersion: 1, kind: 'or3-operation-result', outcome }, null, 2));
}

export type VerifiedSnapshot = {
  backupId: string;
  path: string;
  dataSha256: string;
  configSha256: string;
  createdAt: string;
};

export type TargetReadyEvidence = {
  checkedAt: string;
  deploymentId: string;
  deploymentRoot: string;
  /** Observed application container id bound to this replacement. */
  containerId?: string;
  imageDigest: string;
  configurationSha256: string;
  managedAssetSha256: Record<string, string>;
  dataReplacementCompleted: true;
  checks: CheckResult[];
};

type UpdateJournalV2 = {
  schemaVersion: 2;
  id: string;
  operation: 'update';
  startedAt: string;
  origin: 'cli' | 'dashboard';
  dashboardJobId?: string;
  source: ReleaseIdentity;
  target: ReleaseIdentity;
  backupId: string;
  backupPath: string;
  phase: 'prepared' | 'snapshot-created' | 'target-mutating' | 'target-ready' | 'restoring-previous';
  snapshot?: VerifiedSnapshot;
  evidence?: TargetReadyEvidence;
};

export type BackupEntry =
  | { kind: 'verified'; backup: BackupListing }
  | {
      kind: 'legacy-unsigned' | 'legacy-adoption' | 'unsupported' | 'invalid' | 'unreadable';
      entryName: string;
      code: string;
      message: string;
    };

export type BackupInventory = {
  entries: BackupEntry[];
  storeErrors: Diagnostic[];
};

export type RetentionPlan = {
  keep: string[];
  remove: string[];
  preserve: Array<{ entryName: string; reason: string }>;
  warnings: Diagnostic[];
  canPrune: boolean;
};

export type UpdateAssessment = {
  schemaVersion: 1;
  observedAt: string;
  source: ReleaseIdentity | null;
  target: ReleaseIdentity;
  checks: CheckResult[];
  findings: Diagnostic[];
  retention: RetentionPlan;
  stateFingerprint: string;
};

/**
 * Compatibility transition table (R13.AC1): for each persisted state schema,
 * which readers may observe it and which writer may mutate it. The bridge and
 * schema-2 readers recognize both formats; unknown future schemas are refused
 * before any mutation.
 */
export const STATE_SCHEMA_COMPATIBILITY = {
  1: { readers: ['bridge', 'schema-2'], writer: 'migrating', mutable: false },
  2: { readers: ['bridge', 'schema-2'], writer: 'schema-2', mutable: true },
} as const;

export const MAX_SUPPORTED_STATE_SCHEMA = 2;
export const READER_SUPPORTED_STATE_SCHEMAS = [1, 2] as const;

export type StateSchemaVersion = 1 | 2;

/** Fails closed before mutation when a future format is encountered. */
export function assertKnownStateSchema(schemaVersion: unknown): asserts schemaVersion is StateSchemaVersion {
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error(
      `Unsupported managed state schema ${String(schemaVersion)}. This CLI reads schemas 1 and 2. Run a compatible exact-version @or3/cloud CLI for this deployment instead of editing managed state.`,
    );
  }
}

/**
 * Test-only lifecycle fault seams. Production logic always calls these slots,
 * but a published CLI/flag cannot set them: tests import this module and assign
 * a slot to exercise write/rename/fsync, delete, command, and handoff failures
 * through the real transition code.
 */
export const lifecycleFaults: {
  beforeStateWrite?: () => void | Promise<void>;
  afterStateWrite?: () => void | Promise<void>;
  beforeMirrorDelete?: () => void | Promise<void>;
  beforeArchiveRead?: () => void | Promise<void>;
  beforeArtifactDelete?: () => void | Promise<void>;
  beforeCommand?: (command: string, args: string[]) => void | Promise<void>;
  beforeHandoff?: () => void | Promise<void>;
} = {};

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
  'OR3_MANAGED_OWNER_EMAIL',
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
  update: ['to', 'dry-run', 'json'],
  backup: ['keep', 'force', 'yes', 'json'],
  restore: ['yes'],
  rollback: ['yes'],
  doctor: [],
  verify: ['public', 'verification-email', 'verification-password-file', 'read-only', 'json'],
  recover: ['dry-run', 'finish', 'restore', 'yes', 'json'],
  adopt: ['from'],
  credentials: ['yes', 'owner-password', 'owner-password-file', 'admin-password', 'admin-password-file'],
  status: ['json'],
  logs: ['tail'],
  start: [],
  stop: [],
  restart: [],
  remove: ['purge-data', 'yes'],
};

/**
 * Explicit command mutation policy (R4.AC4). Read-only invocation bypasses the
 * deployment lease entirely; full verification and every other mutation keep
 * the existing single-writer lease and pending-operation gate.
 */
export function verifyIsReadOnly(flags: Flags) {
  return flags['read-only'] === true;
}

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

/** Compares two release versions by major.minor.patch (prerelease ignored). */
export function compareReleaseVersions(left: string, right: string) {
  const leftParts = left.split('-', 1)[0].split('.').map(Number);
  const rightParts = right.split('-', 1)[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
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
  await lifecycleFaults.beforeCommand?.(command, args);
  try {
    const result = await execFile(command, args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      killSignal: 'SIGKILL',
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
  await durableRename(temporary, path);
}

async function syncFile(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableRename(source: string, destination: string) {
  await syncFile(source);
  await rename(source, destination);
  await syncDirectory(dirname(destination));
}

async function copySecure(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  await syncFile(destination);
  await syncDirectory(dirname(destination));
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

async function readOwnerOnlyText(path: string, label: string) {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular owner-only file with no group/world permissions.`);
  }
  return readText(path);
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
    lastOperation: join(cloud, 'last-operation.json'),
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
  assertKnownStateSchema(parsed.schemaVersion);
  if (!parsed.appVersion || !parsed.image || !parsed.composeProject || !parsed.mode) {
    throw new Error(`Invalid managed state at ${paths.state}. Run "npx @or3/cloud doctor" for diagnostics.`);
  }
  return parsed as ManagedState;
}

async function writeState(directory: string, state: ManagedState) {
  await lifecycleFaults.beforeStateWrite?.();
  await writeSecure(deploymentPaths(directory).state, `${JSON.stringify(state, null, 2)}\n`);
  await lifecycleFaults.afterStateWrite?.();
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
  const startedAt = Date.now();
  const deadline = startedAt + DEEP_HEALTH_TIMEOUT_MS;
  let lastError = 'health check did not complete';
  let lastProgressAt = startedAt;
  while (Date.now() < deadline) {
    const result = await run('docker', [
      ...composeCommand,
      'exec', '-T', 'or3', ...containerNodeCommand(HEALTH_SCRIPT),
    ], directory);
    if (result.ok) return;
    lastError = redact(result.stderr, secrets);
    // Bounded waits must still surface progress every 15 seconds.
    if (Date.now() - lastProgressAt >= 15_000) {
      console.error(`Waiting for OR3 deep health (${Math.round((Date.now() - startedAt) / 1000)}s elapsed)…`);
      lastProgressAt = Date.now();
    }
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

export function updateRequiresVolumeRecreation(state: ManagedState, env: Record<string, string>) {
  return !state.deploymentId && !env.OR3_DEPLOYMENT_ID;
}

export function restoreRequiresVolumeRecreation(currentEnv: Record<string, string>, targetEnv: Record<string, string>) {
  return currentEnv.OR3_DEPLOYMENT_ID !== targetEnv.OR3_DEPLOYMENT_ID;
}

/**
 * Removes only the app containers and data volume bound to this managed
 * deployment. Callers must already hold a verified backup. This is used for
 * the one-time migration from legacy Compose volumes that cannot acquire the
 * immutable deployment label in place.
 */
async function removeManagedDataVolumeForRecreation(directory: string, state: ManagedState) {
  const containers = await run('docker', [
    'ps', '-aq',
    '--filter', `label=com.docker.compose.project=${state.composeProject}`,
    '--filter', 'label=com.docker.compose.service=or3',
  ], directory);
  if (!containers.ok) throw new Error(`Could not resolve the managed OR3 container. ${containers.stderr.trim()}`);
  const containerIds = containers.stdout.trim().split(/\s+/).filter(Boolean);
  if (containerIds.some((value) => !/^[0-9a-f]{12,64}$/i.test(value))) {
    throw new Error('Docker returned an invalid managed OR3 container ID. Refusing to recreate the data volume.');
  }
  if (containerIds.length) {
    const removedContainers = await run('docker', ['rm', '--force', ...containerIds], directory);
    if (!removedContainers.ok) throw new Error(`Could not remove the stopped managed OR3 container. ${removedContainers.stderr.trim()}`);
  }

  const inspected = await run('docker', ['volume', 'inspect', state.volumeName, '--format', '{{json .}}'], directory);
  if (!inspected.ok) return;
  let volume: { Name?: unknown; Labels?: Record<string, unknown> };
  try {
    volume = JSON.parse(inspected.stdout.trim()) as typeof volume;
  } catch {
    throw new Error(`Docker returned unreadable metadata for managed volume ${state.volumeName}.`);
  }
  if (
    volume.Name !== state.volumeName
    || volume.Labels?.['com.docker.compose.project'] !== state.composeProject
    || volume.Labels?.['com.docker.compose.volume'] !== 'or3-data'
  ) {
    throw new Error(`Volume ${state.volumeName} is not bound to this managed Compose deployment. Refusing to recreate it.`);
  }
  const removedVolume = await run('docker', ['volume', 'rm', state.volumeName], directory);
  if (!removedVolume.ok) throw new Error(`Could not remove the verified legacy data volume for recreation. ${removedVolume.stderr.trim()}`);
}

async function ensureManagedDataVolume(
  directory: string,
  mode: Mode,
  state: ManagedState,
  env: Record<string, string>,
) {
  const existing = await run('docker', ['volume', 'inspect', state.volumeName, '--format', '{{.Name}}'], directory);
  if (existing.ok && existing.stdout.trim() === state.volumeName) return;
  const created = await run('docker', composeArgs(directory, mode, [
    'run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'or3', '-c', 'true',
  ]), directory);
  if (!created.ok) throw new Error(`Could not create the managed data volume. ${redact(created.stderr, secretValues(env))}`);
  const inspected = await run('docker', ['volume', 'inspect', state.volumeName, '--format', '{{json .Labels}}'], directory);
  if (!inspected.ok) throw new Error(`Could not verify the recreated managed data volume ${state.volumeName}.`);
  let labels: Record<string, unknown>;
  try {
    labels = JSON.parse(inspected.stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(`Docker returned unreadable labels for recreated managed volume ${state.volumeName}.`);
  }
  if (!labels || typeof labels !== 'object') {
    throw new Error(`Recreated volume ${state.volumeName} has no managed deployment labels.`);
  }
  if (
    labels['com.docker.compose.project'] !== state.composeProject
    || labels['com.docker.compose.volume'] !== 'or3-data'
    || (env.OR3_DEPLOYMENT_ID && labels['io.or3.cloud.deployment-id'] !== env.OR3_DEPLOYMENT_ID)
  ) {
    throw new Error(`Recreated volume ${state.volumeName} does not carry the expected managed deployment labels.`);
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

async function dockerDaemonIsLocal() {
  const configured = process.env.DOCKER_HOST?.trim();
  if (configured) return configured.startsWith('unix://') || configured.startsWith('npipe://');
  const context = await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (!context.ok) throw new Error(`Could not resolve the active Docker context endpoint. ${context.stderr.trim()}`);
  const endpoint = context.stdout.trim();
  return endpoint.startsWith('unix://') || endpoint.startsWith('npipe://');
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
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as typeof manifest;
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
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as typeof manifest;
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

function packagedSourceRevision(version: string) {
  let manifest: { version?: unknown; or3Cloud?: { sourceRevision?: unknown } };
  try {
    manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as typeof manifest;
  } catch {
    return undefined;
  }
  if (manifest.version !== version || manifest.or3Cloud?.sourceRevision === undefined) return undefined;
  const revision = manifest.or3Cloud.sourceRevision;
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('This @or3/cloud package contains an invalid source revision. Refusing to run an unbound release image.');
  }
  return revision;
}

type PackagedOr3CloudMetadata = {
  stateSchema?: unknown;
  dashboardUpdateMinimumSourceVersion?: unknown;
};

function packagedOr3CloudMetadata(): PackagedOr3CloudMetadata {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { or3Cloud?: PackagedOr3CloudMetadata };
    return manifest.or3Cloud ?? {};
  } catch {
    return {};
  }
}

/**
 * Persisted state schema this CLI is qualified to write. A release that only
 * reads schema 2 keeps writing schema 1 (the compatibility bridge); a release
 * explicitly qualified to write the new recovery journal sets
 * `or3Cloud.stateSchema` to 2. Migration to schema 2 is refused below.
 */
export function writeStateSchema(): StateSchemaVersion {
  const value = packagedOr3CloudMetadata().stateSchema;
  if (value === undefined) return LEGACY_STATE_SCHEMA_VERSION;
  if (value === 1 || value === 2) return value;
  throw new Error('This @or3/cloud package declares an unsupported managed state schema. Refusing to write managed state.');
}

/** Bridge version a schema-2 writer requires before migrating a schema-1 deployment. */
export function packagedMinimumSourceVersion(): string | undefined {
  const value = packagedOr3CloudMetadata().dashboardUpdateMinimumSourceVersion;
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
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

export function assertImageReleaseLabels(image: string, labels: Record<string, unknown>, version: string, expectedRevision?: string) {
  const revision = labels['org.opencontainers.image.revision'];
  if (
    labels['org.opencontainers.image.source'] !== 'https://github.com/Saluana/or3-chat'
    || labels['org.opencontainers.image.version'] !== version
    || typeof revision !== 'string'
    || !/^[0-9a-f]{40}$/i.test(revision)
    || (expectedRevision !== undefined && revision.toLowerCase() !== expectedRevision)
  ) {
    throw new Error(`OR3 image ${image} does not carry the expected source/version release labels for ${version}.`);
  }
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
  assertImageReleaseLabels(image, labels, version, packagedSourceRevision(version));
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

async function dockerDaemonArchitecture(): Promise<'arm64' | 'amd64'> {
  const result = await run('docker', ['info', '--format', '{{.Architecture}}']);
  if (!result.ok) throw new Error(`Could not determine the selected Docker daemon architecture. ${result.stderr.trim()}`);
  const architecture = result.stdout.trim().toLowerCase();
  if (architecture === 'arm64' || architecture === 'aarch64') return 'arm64';
  if (architecture === 'amd64' || architecture === 'x86_64') return 'amd64';
  throw new Error(`OR3 supports only linux/amd64 and linux/arm64 Docker daemons; the selected daemon reports ${architecture || 'no architecture'}.`);
}

async function assertSupportedHostArchitecture(image: string) {
  const hostArch = await dockerDaemonArchitecture();
  // pullImage runs before this check. The exact local image configuration is
  // therefore authoritative for the selected daemon and avoids making a
  // second client-side registry request from the dashboard operator.
  const local = await run('docker', ['image', 'inspect', '--format', '{{.Architecture}}', image]);
  if (local.ok && local.stdout.trim()) {
    assertSupportedArchitecture({ architecture: local.stdout.trim() }, hostArch);
    return;
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

export function dashboardOperatorHandoffArgs(
  directory: string,
  env: Record<string, string>,
  jobId: string,
) {
  const project = env.OR3_COMPOSE_PROJECT;
  if (
    !isAbsolute(directory)
    || !DASHBOARD_JOB_ID_PATTERN.test(jobId)
    || !COMPOSE_PROJECT_PATTERN.test(project ?? '')
    || !/^\d+$/.test(env.OR3_OPERATOR_UID ?? '')
    || !/^\d+$/.test(env.OR3_OPERATOR_GID ?? '')
    || !/^\d+$/.test(env.OR3_DOCKER_GID ?? '')
    || !isAbsolute(env.OR3_DOCKER_SOCKET ?? '')
    || !/@sha256:[0-9a-f]{64}$/i.test(env.OR3_OPERATOR_IMAGE ?? '')
  ) {
    throw new Error('Refusing to schedule an invalid dashboard operator handoff.');
  }
  return [
    'run', '--detach', '--rm', '--network', 'none', '--read-only',
    '--name', `${project}-operator-handoff-${jobId}`,
    '--user', `${env.OR3_OPERATOR_UID}:${env.OR3_OPERATOR_GID}`,
    '--group-add', env.OR3_DOCKER_GID,
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
    '--mount', `type=bind,src=${env.OR3_DOCKER_SOCKET},dst=/var/run/docker.sock`,
    '--mount', `type=bind,src=${directory},dst=${directory},readonly`,
    '--workdir', directory, '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--entrypoint', '/usr/local/bin/node', env.OR3_OPERATOR_IMAGE,
    join(directory, 'dashboard-operator.mjs'), '--complete-handoff', jobId, project,
  ];
}

async function scheduleDashboardOperatorHandoff(directory: string, env: Record<string, string>, jobIdOverride?: string) {
  const jobId = jobIdOverride ?? process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim();
  if (!jobId || env.OR3_DASHBOARD_UPDATES_ENABLED !== 'true') return;
  await lifecycleFaults.beforeHandoff?.();
  const scheduled = await run('docker', dashboardOperatorHandoffArgs(directory, env, jobId), directory);
  if (!scheduled.ok || !/^[0-9a-f]{12,64}$/i.test(scheduled.stdout.trim())) {
    throw new Error(`Could not schedule the dashboard operator handoff. ${scheduled.stderr.trim()}`);
  }
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

export function withoutProvisioningCredentials(env: Record<string, string>) {
  const result = { ...env };
  for (const key of PROVISIONING_CREDENTIAL_KEYS) delete result[key];
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
    OR3_MANAGED_OWNER_EMAIL: input.email,
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
  let retainRollbackCopies = false;
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
        applied.push(entry);
        await durableRename(entry.replacement, entry.destination);
      }
      for (const [name, contents] of assets) {
        if (!(await readFile(join(directory, name))).equals(contents)) {
          throw new Error(`Managed asset ${name} did not match its staged replacement after commit.`);
        }
      }
    } catch (error) {
      const rollbackErrors: Error[] = [];
      for (const entry of applied.reverse()) {
        try {
          if (entry.rollback) await durableRename(entry.rollback, entry.destination);
          else await rm(entry.destination, { force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
        }
      }
      if (rollbackErrors.length > 0) {
        retainRollbackCopies = true;
        throw new AggregateError([error, ...rollbackErrors], 'Managed asset installation failed and one or more rollback copies could not be restored. Recovery copies were retained.');
      }
      throw error;
    }
  } finally {
    for (const entry of staged) {
      await rm(entry.replacement, { force: true }).catch(() => undefined);
      if (entry.rollback && !retainRollbackCopies) await rm(entry.rollback, { force: true }).catch(() => undefined);
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

/** Checksums of the managed assets currently installed in the deployment. */
export async function installedManagedAssetChecksums(directory: string, mode: Mode) {
  const checksums: Record<string, string> = {};
  for (const name of managedAssetNames(mode)) {
    if (!await fileExists(join(directory, name))) continue;
    checksums[name] = await sha256File(join(directory, name));
  }
  return checksums;
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
  if (!assets) {
    throw new Error(`Backup ${manifest.backupId} predates authenticated managed-asset snapshots. Refusing to run its image under today's Compose/Caddy assets; restore with the exact historical @or3/cloud release after separately authenticating its assets.`);
  }
  await installManagedAssets(directory, assets);
  if (manifest.managedAssetInventoryVersion !== 2 && manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION) {
    await rm(join(directory, 'dashboard-operator.mjs'), { force: true });
  }
  if (manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION) {
    await rm(join(directory, 'compose.operator.yaml'), { force: true });
  }
  return true;
}

function assertRestorableManagedAssets(manifest: BackupManifest) {
  if (!manifest.managedAssetSha256) {
    throw new Error(`Backup ${manifest.backupId} predates authenticated managed-asset snapshots. Refusing to run its image under today's Compose/Caddy assets; restore with the exact historical @or3/cloud release after separately authenticating its assets.`);
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
  await lifecycleFaults.beforeMirrorDelete?.();
  await rm(join(deploymentPaths(directory).operations, `${operationId}.json`), { force: true });
}

/**
 * Housekeeping mirror deletion after a terminal commit. A failure here must
 * only warn: the authoritative state is already committed, and throwing would
 * let an enclosing destructive-recovery handler undo the completed operation.
 */
async function removeOperationRecordSafely(directory: string, operationId?: string) {
  try {
    await removeOperationRecord(directory, operationId);
  } catch (error) {
    console.warn(`Could not remove the redundant operation mirror ${operationId ?? '(none)'}: ${redact(error instanceof Error ? error.message : String(error))}`);
  }
}

/**
 * Commits a terminal state write before touching the redundant operation
 * mirror. The state file is the single authority: if the mirror delete fails
 * or the process dies afterwards, the deployment is already complete and a
 * leftover mirror is removable housekeeping rather than a pending operation.
 *
 * Returns the operation ID whose mirror (if any) still needs removal so callers
 * can treat a failed delete as completed-with-warnings.
 */
async function commitTerminalState(
  directory: string,
  state: ManagedState,
  receipt?: OperationReceipt,
): Promise<{ committed: true; operationId?: string }> {
  const operationId = state.incompleteOperation?.id;
  delete state.incompleteOperation;
  if (receipt) state.lastReceipt = receipt;
  state.updatedAt = now();
  await writeState(directory, state);
  if (receipt) {
    // A convenience mirror, not a second transaction authority. Export failure
    // must never invalidate a durable deployment commit.
    try {
      await exportTerminalReceipt(directory, receipt);
    } catch (error) {
      console.warn(`Could not export the latest operation receipt: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  }
  return { committed: true, operationId };
}

/**
 * Writes the latest bounded terminal receipt to `.or3-cloud/last-operation.json`
 * (mode 0600). The receipt schema deliberately contains no secrets,
 * credentials, raw configuration, or log contents.
 */
async function exportTerminalReceipt(directory: string, receipt: OperationReceipt) {
  const payload = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeSecure(deploymentPaths(directory).lastOperation, payload);
}

/**
 * Persists post-commit maintenance warnings (for example a failed mirror
 * delete or deferred retention) into the already-committed receipt. The
 * authoritative state is terminal, so this only updates `lastReceipt.warnings`
 * and never recreates a pending operation. A failure warns rather than throwing:
 * the deployment is already complete and the warnings are advisory.
 */
async function persistReceiptWarnings(directory: string, state: ManagedState, warnings: Diagnostic[]) {
  if (warnings.length === 0 || !state.lastReceipt) return;
  const existing = state.lastReceipt.warnings;
  const additions = warnings.filter((warning) => !existing.some((current) => current.code === warning.code && current.message === warning.message));
  if (additions.length === 0) return;
  const merged: OperationReceipt = { ...state.lastReceipt, warnings: [...existing, ...additions] };
  try {
    if (state.incompleteOperation) return;
    state.lastReceipt = merged;
    state.updatedAt = now();
    await writeState(directory, state);
    await exportTerminalReceipt(directory, merged).catch((error) => {
      console.warn(`Could not re-export the operation receipt: ${redact(error instanceof Error ? error.message : String(error))}`);
    });
  } catch (error) {
    console.warn(`Could not persist maintenance warnings to the receipt: ${redact(error instanceof Error ? error.message : String(error))}`);
  }
}

/** Convenience wrapper: commit terminal state, then warning-only mirror cleanup. */
async function clearPending(directory: string, state: ManagedState, receipt?: OperationReceipt) {
  const { operationId } = await commitTerminalState(directory, state, receipt);
  await removeOperationRecordSafely(directory, operationId);
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
  const fallback = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '-v', `${env.OR3_VOLUME_NAME}:/data:ro`, '--entrypoint', 'sh', env.OR3_IMAGE,
    '-c', 'du -sb /data 2>/dev/null',
  ], directory);
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
  await lifecycleFaults.beforeArtifactDelete?.();
  assertRemovableArtifactName(backupId);
  const target = backupDirectory(directory, backupId);
  if (dirname(target) !== deploymentPaths(directory).backups) {
    throw new Error(`Refusing to remove a path outside the backups directory: ${target}.`);
  }
  await rm(target, { recursive: true, force: true });
  await rm(join(deploymentPaths(directory).exports, `${backupId}.json`), { force: true });
}

async function removeEnumeratedBackupArtifact(directory: string, backup: BackupListing) {
  await lifecycleFaults.beforeArtifactDelete?.();
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

function classifyBackupError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication failed|no valid deployment authentication tag|invalid authentication tag/i.test(message)) {
    return { code: 'backup-authentication-failed', message };
  }
  if (/checksum mismatch/i.test(message)) return { code: 'backup-checksum-mismatch', message };
  if (/invalid managed asset inventory|managed asset checksum mismatch/i.test(message)) {
    return { code: 'backup-assets-invalid', message };
  }
  if (/Invalid backup manifest/i.test(message)) return { code: 'backup-manifest-invalid', message };
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { code: 'backup-entry-incomplete', message };
  return { code: 'backup-entry-invalid', message };
}

type BackupEntryInspection = BackupEntry;

/**
 * Classifies one direct backup-store entry. Uses `lstat` so a symlink is never
 * followed; metadata reads are bounded to the six expected files. Missing
 * authentication is legacy (preserved), while unreadable/malformed/invalid
 * authentication is reported as invalid rather than aborting the scan.
 */
async function inspectBackupEntry(backupsRoot: string, entry: string, directory: string): Promise<BackupEntryInspection> {
  const path = join(backupsRoot, entry);
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    return { kind: 'unreadable', entryName: entry, ...classifyBackupError(error) };
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    return {
      kind: 'invalid',
      entryName: entry,
      code: 'backup-entry-not-directory',
      message: `Backup store entry ${entry} is not a regular directory; symlinks and non-directories are never trusted.`,
    };
  }
  // Older adopters stored source archives outside the authenticated format.
  if (/^adopt-source-[0-9A-Za-z-]+$/.test(entry)) {
    return {
      kind: 'legacy-adoption',
      entryName: entry,
      code: 'backup-legacy-adoption',
      message: `Preserved legacy adoption source ${entry}; it is not an authenticated managed backup.`,
    };
  }
  if (!BACKUP_ID_PATTERN.test(entry)) {
    return {
      kind: 'invalid',
      entryName: entry,
      code: 'backup-entry-unexpected',
      message: `Backup store contains an unexpected artifact ${path}; inspect or remove it explicitly.`,
    };
  }
  try {
    await lstat(join(path, 'manifest.auth'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        kind: 'legacy-unsigned',
        entryName: entry,
        code: 'backup-unsigned',
        message: `Preserved unauthenticated backup ${entry} (no manifest.auth); never trusted for restore.`,
      };
    }
    return { kind: 'unreadable', entryName: entry, ...classifyBackupError(error) };
  }
  try {
    const raw = JSON.parse(await readText(join(path, 'manifest.json'))) as { schemaVersion?: unknown };
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > 1) {
      return {
        kind: 'unsupported',
        entryName: entry,
        code: 'backup-format-unsupported',
        message: `Backup ${entry} uses manifest schema ${raw.schemaVersion}; preserved for a newer reader.`,
      };
    }
  } catch (error) {
    return { kind: 'invalid', entryName: entry, ...classifyBackupError(error) };
  }
  try {
    const manifest = await readManifest(path, directory);
    if (manifest.backupId !== entry) {
      return {
        kind: 'invalid',
        entryName: entry,
        code: 'backup-id-mismatch',
        message: `Backup directory ${path} does not match manifest ID ${manifest.backupId}.`,
      };
    }
    if (!Number.isFinite(Date.parse(manifest.createdAt))) {
      return {
        kind: 'invalid',
        entryName: entry,
        code: 'backup-created-at-invalid',
        message: `Backup ${manifest.backupId} has an invalid creation time.`,
      };
    }
    let bytes = 0;
    for (const file of ['data.tgz', 'config.env', 'manifest.json', 'manifest.auth']) {
      bytes += (await lstat(join(path, file))).size;
    }
    return {
      kind: 'verified',
      backup: {
        backupId: manifest.backupId,
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        path,
        bytes,
        dataSha256: manifest.dataSha256,
      },
    };
  } catch (error) {
    return { kind: 'invalid', entryName: entry, ...classifyBackupError(error) };
  }
}

const BACKUP_ENTRY_SEVERITY: Record<BackupEntry['kind'], number> = {
  verified: 0,
  'legacy-unsigned': 1,
  'legacy-adoption': 2,
  unsupported: 3,
  invalid: 4,
  unreadable: 5,
};

/**
 * Observations of the whole backup store: one classification per direct entry,
 * in deterministic severity/name order, plus any store-level diagnostic. It is
 * never authority to restore or delete; authentication still gates trust.
 */
export async function inventoryBackups(directory: string): Promise<BackupInventory> {
  const backupsRoot = deploymentPaths(directory).backups;
  let names: string[];
  try {
    names = await readdir(backupsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], storeErrors: [] };
    return {
      entries: [],
      storeErrors: [{
        code: 'backup-store-unreadable',
        severity: 'blocker',
        resource: backupsRoot,
        message: `Could not enumerate managed backups at ${backupsRoot}: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
  const entries: BackupEntry[] = [];
  for (const name of [...names].sort()) entries.push(await inspectBackupEntry(backupsRoot, name, directory));
  entries.sort((a, b) => {
    const severity = BACKUP_ENTRY_SEVERITY[a.kind] - BACKUP_ENTRY_SEVERITY[b.kind];
    if (severity !== 0) return severity;
    const aName = a.kind === 'verified' ? a.backup.backupId : a.entryName;
    const bName = b.kind === 'verified' ? b.backup.backupId : b.entryName;
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  });
  return { entries, storeErrors: [] };
}

/** Enumerates only fully verified backups (newest first) for restore/listing. */
export async function enumerateBackups(directory: string): Promise<BackupListing[]> {
  const inventory = await inventoryBackups(directory);
  return inventory.entries
    .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
    .map((entry) => entry.backup)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Pure retention rule: keeps the newest `keep` verified backups. Backups
 * referenced by the rollback point, an update, or a restore/rollback are never
 * removed. This helper keeps the legacy force-override only for its original
 * unit contract; `planRetention` is the production planner.
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

/**
 * Separated retention decision. No force path can override protected IDs
 * (rollback point, update snapshot, or a pending restore/rollback source).
 * Suspect or legacy entries are preserved; automatic pruning is deferred when
 * any entry is invalid/unreadable/unsupported, but a fresh authenticated
 * snapshot and update are never blocked by an unrelated suspect entry.
 */
export function planRetention(
  entries: BackupEntry[],
  keep: number,
  protectedIds: ReadonlySet<string>,
  options: { automatic?: boolean } = {},
): RetentionPlan {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Backup retention must be an integer of at least 1.');
  const automatic = options.automatic ?? true;
  const warnings: Diagnostic[] = [];
  const preserve: Array<{ entryName: string; reason: string }> = [];
  let canPrune = true;
  for (const entry of entries) {
    if (entry.kind === 'verified') continue;
    preserve.push({ entryName: entry.entryName, reason: entry.message });
    if (entry.kind === 'legacy-unsigned' || entry.kind === 'legacy-adoption') continue;
    warnings.push({
      code: entry.code,
      severity: entry.kind === 'unreadable' ? 'blocker' : 'warning',
      resource: entry.entryName,
      message: entry.message,
    });
    if (automatic) canPrune = false;
  }
  const verified = entries
    .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
    .map((entry) => entry.backup)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const removable = verified.filter((backup) => !protectedIds.has(backup.backupId));
  const remove = removable.slice(keep).map((backup) => backup.backupId);
  const removeSet = new Set(remove);
  return {
    keep: verified.filter((backup) => !removeSet.has(backup.backupId)).map((backup) => backup.backupId),
    remove,
    preserve,
    warnings,
    canPrune,
  };
}

function parseKeep(flags: Flags) {
  const value = stringFlag(flags, 'keep') ?? String(BACKUP_RETENTION_KEEP);
  const keep = Number(value);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be an integer of at least 1.');
  return keep;
}

type PruneResult = { removed: number; deferred: Diagnostic[] };

function retentionProtectedIds(state: ManagedState) {
  const protectedIds = new Set<string>();
  if (state.rollback?.backupId) protectedIds.add(state.rollback.backupId);
  const pending = state.incompleteOperation;
  if (pending?.backupId) protectedIds.add(pending.backupId);
  if (pending?.previousBackupId) protectedIds.add(pending.previousBackupId);
  return protectedIds;
}

/**
 * Enforces bounded backup retention from a classified inventory. Automatic
 * housekeeping defers (never deletes) when a suspect entry is present, and no
 * path removes protected recovery sources. `force` (explicit, already
 * confirmed) bypasses the suspect-entry deferral but not protection.
 */
async function pruneBackups(
  directory: string,
  state: ManagedState,
  keep: number,
  force: boolean,
  options: { automatic?: boolean; log?: (message: string) => void; warn?: (message: string) => void } = {},
): Promise<PruneResult> {
  const automatic = options.automatic ?? !force;
  const log = options.log ?? ((message: string) => console.log(message));
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const inventory = await inventoryBackups(directory);
  if (inventory.storeErrors.length > 0) {
    if (automatic) return { removed: 0, deferred: inventory.storeErrors };
    throw new Error(inventory.storeErrors.map((diagnostic) => diagnostic.message).join(' '));
  }
  const plan = planRetention(inventory.entries, keep, retentionProtectedIds(state), { automatic });
  if (!plan.canPrune && !force) {
    warn('Automatic backup pruning was deferred because the store contains entries that need inspection.');
    for (const warning of plan.warnings) warn(`  ${warning.code}: ${warning.message}`);
    return { removed: 0, deferred: plan.warnings };
  }
  const verified = new Map(
    inventory.entries
      .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
      .map((entry) => [entry.backup.backupId, entry.backup]),
  );
  if (force && plan.remove.length > 0) {
    log(`--force --yes will permanently delete: ${plan.remove.join(', ')}`);
  }
  // Inventory once above, then revalidate only the selected entry immediately
  // before its deletion. Re-inventorying the whole store per deletion rehashed
  // every remaining archive, which is quadratic on large histories.
  let removed = 0;
  for (const backupId of plan.remove) {
    const backup = verified.get(backupId);
    if (!backup) throw new Error(`Retention selected backup ${backupId}, but its verified path disappeared before deletion.`);
    const revalidated = await inspectBackupEntry(deploymentPaths(directory).backups, backupId, directory);
    const current = revalidated.kind === 'verified' ? revalidated.backup : undefined;
    if (!current || current.path !== backup.path || current.dataSha256 !== backup.dataSha256) {
      throw new Error(`Backup ${backupId} changed while pruning was in progress. Aborting retention before deletion.`);
    }
    await removeEnumeratedBackupArtifact(directory, current);
    log(`Deleted backup ${backupId} at ${current.path}`);
    removed += 1;
  }
  return { removed, deferred: plan.warnings };
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

function terminateChildProcess(child: ReturnType<typeof spawn>) {
  if (child.killed) return;
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); return; } catch {}
  }
  child.kill('SIGKILL');
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
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChildProcess(child);
  }, STREAM_COMMAND_TIMEOUT_MS);
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
    if (timedOut) throw new Error(`${command} exceeded the ${STREAM_COMMAND_TIMEOUT_MS / 1000}-second archive deadline.`);
    if (exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}. ${redact(stderr, secrets)}`.trim());
    }
    await chmod(temporary, 0o600);
    await durableRename(temporary, destination);
  } catch (error) {
    terminateChildProcess(child);
    await rm(temporary, { force: true }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr && !detail.includes(stderr) ? `\n${redact(stderr, secrets)}` : ''}`);
  } finally {
    clearTimeout(timeout);
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
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChildProcess(child);
  }, STREAM_COMMAND_TIMEOUT_MS);
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
    if (timedOut) throw new Error(`${command} exceeded the ${STREAM_COMMAND_TIMEOUT_MS / 1000}-second archive deadline.`);
    if (exitCode !== 0) {
      throw new Error(`${command} ${args.join(' ')} exited with ${exitCode}. ${redact(stderr, secrets)}`.trim());
    }
  } catch (error) {
    terminateChildProcess(child);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr && !detail.includes(stderr) ? `\n${redact(stderr, secrets)}` : ''}`);
  } finally {
    clearTimeout(timeout);
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
  const state = await readState(directory);
  await ensureManagedDataVolume(directory, mode, state, env);
  const clear = await run('docker', [
    'run', '--rm', '--network', 'none', '--user', '0:0', '--read-only',
    '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
    '--security-opt', 'no-new-privileges:true', '-v', `${state.volumeName}:/data`,
    '--entrypoint', 'sh', env.OR3_IMAGE, '-c', 'find /data -mindepth 1 -delete',
  ], directory);
  if (!clear.ok) {
    throw new Error(`Could not safely clear the managed data volume before restore. ${redact(clear.stderr, secretValues(env))}`);
  }
  await streamFileToCommand(
    'docker',
    [
      'run', '--rm', '-i', '--network', 'none', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
      '-v', `${state.volumeName}:/data`, '--entrypoint', 'sh', env.OR3_IMAGE, '-c',
      'tar xzf - -C /data',
    ],
    join(backupPath, 'data.tgz'),
    directory,
    secretValues(env),
  );
}

async function validateVolumeArchive(directory: string, _mode: Mode, env: Record<string, string>, backupPath: string) {
  await streamFileToCommand(
    'docker',
    [
      'run', '--rm', '-i', '--network', 'none', '--read-only',
      '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
      '--entrypoint', 'sh', env.OR3_IMAGE, '-c',
      'tar tzf - >/dev/null',
    ],
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
  let backupFailure: Error | undefined;
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
      backupFailure = new Error(`${error instanceof Error ? error.message : String(error)} The partial backup artifact at ${backupDir} was removed.`);
      throw backupFailure;
    }
    backupFailure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    if (stopAttempted && restartAfter && initiallyRunning) {
      try {
        await startProject(directory, state.mode, env);
      } catch (error) {
        const restartFailure = error instanceof Error ? error : new Error(String(error));
        if (backupFailure) {
          throw new AggregateError(
            [backupFailure, restartFailure],
            `Backup failed and OR3 could not restart. Primary failure: ${backupFailure.message}. Restart failure: ${restartFailure.message}`,
          );
        }
        throw new Error(`Backup was created but OR3 could not restart: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function readManifest(backupPath: string, authenticatedForDirectory?: string) {
  await lifecycleFaults.beforeArchiveRead?.();
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
  const fallback = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '-v', `${env.OR3_VOLUME_NAME}:/data:ro`, '--entrypoint', 'sh', env.OR3_IMAGE,
    '-c', script,
  ], directory);
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

async function restoreBackupData(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  backupPath: string,
  options: { recreateDataVolume?: boolean } = {},
) {
  const manifest = await readManifest(backupPath, directory);
  assertRestorableManagedAssets(manifest);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, state, env);
  if (manifest.imageDigest) await requireImageDigest(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  await validateVolumeArchive(directory, state.mode, env, backupPath);
  await ensureManagedDataVolume(directory, state.mode, state, env);
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

  if (options.recreateDataVolume) await removeManagedDataVolumeForRecreation(directory, state);
  else await stopProject(directory, state.mode);
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
    schemaVersion: writeStateSchema(),
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
  npx @or3/cloud update [--to <exact-version>] [--dry-run] [--json]
  npx @or3/cloud backup [list [--json]|prune [--keep <n>]|export <backup-id> <destination-dir>]
  npx @or3/cloud restore <backup-id-or-path> --yes
  npx @or3/cloud rollback --yes
  npx @or3/cloud credentials reset --yes [--owner-password-file <path> --admin-password-file <path>]
  npx @or3/cloud doctor
  npx @or3/cloud verify [--read-only] [--public] [--verification-email <email> --verification-password-file <path>]
  npx @or3/cloud recover [--dry-run | --finish | --restore --yes]
  npx @or3/cloud adopt --from <v1-directory> [directory]
  npx @or3/cloud status [--json]
  npx @or3/cloud logs [--tail <n>] [service]
  npx @or3/cloud start | stop | restart
  npx @or3/cloud remove [--purge-data --yes]

Options:
  --admin-email <email>          Administrator email for first login
  --admin-password <password>    Explicit password (prefer --admin-password-file); for credentials reset, the new admin password
  --admin-password-file <path>   Read the bootstrap/reset admin password without shell history
  --owner-password <password>    New owner (basic auth) password for credentials reset
  --owner-password-file <path>   Read the new owner password without shell history
  --verification-email <email>   Current owner email used only for this verification
  --verification-password-file <path>  Read the current owner password for this verification
  --port <port>                  Local OR3 port (default: 3000)
  --keep <n>                     Backups to retain when pruning (default: 5)
  --force                        Prune backups even when referenced by the rollback point
  --tail <n>                     Log lines to show (default: 200)
  --public                       Require verification through the public HTTPS origin
  --read-only                    Verify without the lease, login, storage, or database writes
  --dry-run                      Preview an update or recovery without changing anything
  --finish                       Commit a proven completed replacement without restoring data
  --restore                      Explicitly restore the recorded snapshot (requires --yes)
  --json                         Emit one machine-readable result object on stdout
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
  const localDockerDaemon = await dockerDaemonIsLocal();
  if (localDockerDaemon && !await portAvailable(port)) throw new Error(`Port ${port} is already in use. Choose another port with --port.`);
  if (mode === 'public' && localDockerDaemon) {
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
    await provisionManagedCredentials(
      mode === 'public' ? new URL(`https://${domain}`) : new URL(`http://127.0.0.1:${port}`),
      email,
      password,
    );
    const runtimeEnv = withoutProvisioningCredentials(env);
    await writeSecure(deploymentPaths(directory).env, serializeEnv(runtimeEnv));
    await stopProject(directory, mode);
    await startProject(directory, mode, runtimeEnv);
    await clearPending(directory, state);
    console.log(`\nOR3 Cloud ${version} is running at ${mode === 'public' ? `https://${domain}` : `http://127.0.0.1:${port}`}`);
    console.log(`Credentials were written to ${join(directory, '.or3-initial-credentials')} (mode 0600). Move them to protected storage (a password manager), then remove that file.`);
    console.log('The bootstrap owner signs in to the app; the admin account manages the deployment. Rotate either later with "npx @or3/cloud credentials reset --yes".');
    console.log(`\nCheck: cd ${quote(directory)} && npx @or3/cloud doctor`);
    if (operator) console.log('Dashboard updates are enabled for super admins in Operations.');
  } catch (error) {
    state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(env));
    await writeState(directory, state);
    await compose(directory, mode, ['down']).catch(() => undefined);
    throw new Error(`${state.lastError}\nThe new deployment files were preserved at ${directory}.`);
  }
}

/**
 * Refuses to mutate state written by a newer schema than this CLI is qualified
 * to write. The bridge reads schema 2 but must not downgrade or edit it; the
 * owner is directed to the compatible exact-target CLI instead.
 */
export function assertStateSchemaWritable(state: ManagedState) {
  const writer = writeStateSchema();
  if (state.schemaVersion > writer) {
    throw new Error(`This CLI reads managed state schema ${state.schemaVersion} but is qualified to write schema ${writer}. Run the compatible exact-version @or3/cloud CLI for this deployment; do not edit or hand-migrate managed state.`);
  }
}

async function loadManaged(directory = process.cwd(), options: { writable?: boolean } = {}) {
  const resolved = resolve(directory);
  const state = await readState(resolved);
  if (options.writable !== false) assertStateSchemaWritable(state);
  const env = parseEnv(await readText(deploymentPaths(resolved).env));
  assertDeploymentIdentity(state, env);
  assertDeploymentDirectoryIdentity(resolved, state);
  return { directory: resolved, state, env };
}

export type LeaseObservation =
  | { status: 'none' }
  | { status: 'active'; owner: LeaseOwner }
  | { status: 'stale'; owner: LeaseOwner }
  | { status: 'unreadable' };

/**
 * Independent, non-mutating observations of one deployment. Each source is
 * collected separately so a corrupt state file, a missing `.env`, an
 * unreadable lease, or an unavailable Docker daemon still yields the evidence
 * that is readable, instead of failing solely through `loadManaged`.
 */
export type DeploymentObservation = {
  directory: string;
  observedAt: string;
  state: ManagedState | null;
  stateError: string | null;
  env: Record<string, string> | null;
  envError: string | null;
  lease: LeaseObservation;
  docker: boolean;
  recordedImageDigest: string | null;
  actualImageDigest: string | null;
  identityMatches: boolean | null;
  backups: BackupInventory | null;
  backupErrors: Diagnostic[];
  /** True when a live lease or a state rewrite makes the snapshot non-authoritative. */
  changing: boolean;
  partial: boolean;
};

export async function observeDeployment(
  directory: string,
  options: { checkDocker?: boolean; checkImage?: boolean } = {},
): Promise<DeploymentObservation> {
  const resolved = resolve(directory);
  const observedAt = now();
  let state: ManagedState | null = null;
  let stateError: string | null = null;
  try {
    state = await readState(resolved);
  } catch (error) {
    stateError = redact(error instanceof Error ? error.message : String(error));
  }
  let env: Record<string, string> | null = null;
  let envError: string | null = null;
  try {
    env = parseEnv(await readText(deploymentPaths(resolved).env));
  } catch (error) {
    envError = redact(error instanceof Error ? error.message : String(error));
  }
  const leasePath = deploymentPaths(resolved).lease;
  let lease: LeaseObservation = { status: 'none' };
  if (await fileExists(leasePath)) {
    const owner = await readLeaseOwner(leasePath);
    if (!owner) lease = { status: 'unreadable' };
    else if (cliLeaseOwnerIsGone(owner) || dashboardLeaseOwnerIsStale(owner)) lease = { status: 'stale', owner };
    else lease = { status: 'active', owner };
  }
  let backups: BackupInventory | null = null;
  const backupErrors: Diagnostic[] = [];
  try {
    backups = await inventoryBackups(resolved);
    backupErrors.push(...backups.storeErrors);
  } catch (error) {
    backupErrors.push({ code: 'backup-store-unreadable', severity: 'blocker', message: redact(error instanceof Error ? error.message : String(error)) });
  }

  const checkDocker = options.checkDocker ?? true;
  const checkImage = options.checkImage ?? true;
  let docker = false;
  let recordedImageDigest: string | null = state?.imageDigest ?? null;
  let actualImageDigest: string | null = null;
  let identityMatches: boolean | null = null;
  if (checkDocker) {
    try {
      await ensureDocker();
      docker = true;
    } catch {
      docker = false;
    }
  }
  if (checkImage && docker && state?.image) {
    try {
      actualImageDigest = await runningContainerImageDigest(resolved, state.mode, state.image);
      identityMatches = actualImageDigest === state.imageDigest;
    } catch {
      actualImageDigest = null;
      identityMatches = null;
    }
  }
  const partial = Boolean(stateError || envError || backupErrors.length > 0 || (checkDocker && !docker));
  return {
    directory: resolved,
    observedAt,
    state,
    stateError,
    env,
    envError,
    lease,
    docker,
    recordedImageDigest,
    actualImageDigest,
    identityMatches,
    backups,
    backupErrors,
    changing: lease.status === 'active',
    partial,
  };
}

/**
 * Repository digest of the image actually running the `or3` service. It resolves
 * the running container's image id and then that image's repo digest, so a stale
 * locally cached tag cannot masquerade as the observed running deployment. It
 * falls back to the locally cached image only when no container is running.
 */
async function runningContainerImageDigest(directory: string, mode: Mode, fallbackImage: string): Promise<string> {
  let containerId = '';
  try {
    const ps = await run('docker', composeArgs(directory, mode, ['ps', '-q', 'or3']), directory);
    containerId = ps.ok ? ps.stdout.trim() : '';
  } catch {
    containerId = '';
  }
  if (!containerId) return await imageDigest(fallbackImage);
  const image = await run('docker', ['inspect', '--format', '{{.Image}}', containerId], directory);
  const imageId = image.ok ? image.stdout.trim() : '';
  if (!imageId) throw new Error('Could not inspect the running OR3 container image.');
  const digests = await run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', imageId], directory);
  if (!digests.ok) throw new Error('Could not inspect repository digests for the running OR3 container.');
  let values: string[];
  try {
    values = JSON.parse(digests.stdout.trim()) as string[];
  } catch {
    throw new Error('The running OR3 container has no readable repository digests.');
  }
  const match = values.map((value) => value.match(/@(sha256:[0-9a-f]{64})$/i)?.[1]).find((value): value is string => Boolean(value));
  if (!match) throw new Error('The running OR3 container image is not digest-qualified.');
  return match;
}

/**
 * Explicit public projection of managed state for JSON output. It deliberately
 * omits recovery secrets (for example `credentialReset.nextEnv`) and raw
 * configuration, and reports only the safe identity/status fields an operator
 * or automation needs. Never serialize `ManagedState` directly.
 */
export function publicStateProjection(state: ManagedState) {
  const pending = state.incompleteOperation;
  return {
    schemaVersion: state.schemaVersion,
    mode: state.mode,
    appVersion: state.appVersion,
    image: state.image,
    imageDigest: state.imageDigest,
    domain: state.domain ?? null,
    port: state.port,
    deploymentId: state.deploymentId ?? null,
    lastSuccessfulOperation: state.lastSuccessfulOperation,
    updatedAt: state.updatedAt,
    rollback: state.rollback
      ? { appVersion: state.rollback.appVersion, imageDigest: state.rollback.imageDigest, backupId: state.rollback.backupId, createdAt: state.rollback.createdAt }
      : null,
    incompleteOperation: pending
      ? {
          id: pending.id,
          operation: pending.operation,
          phase: pending.phase ?? null,
          origin: pending.origin ?? null,
          dashboardJobId: pending.dashboardJobId ?? null,
          targetVersion: pending.targetVersion ?? null,
          targetImageDigest: pending.targetImageDigest ?? null,
          // Credential-reset recovery payloads and any environment snapshots are
          // intentionally excluded.
        }
      : null,
    lastReceipt: state.lastReceipt ?? null,
    lastError: state.lastError ? redact(state.lastError) : null,
  };
}

/** Diagnostic/summary rendering shared by status, doctor, and preview. */
export function observationFindings(observation: DeploymentObservation): Diagnostic[] {
  const findings: Diagnostic[] = [];
  if (observation.stateError) findings.push({ code: 'state-unreadable', severity: 'blocker', resource: deploymentPaths(observation.directory).state, message: observation.stateError });
  if (observation.envError) findings.push({ code: 'env-unreadable', severity: 'blocker', resource: deploymentPaths(observation.directory).env, message: observation.envError });
  if (observation.lease.status === 'active') {
    findings.push({ code: 'operation-in-progress', severity: 'info', message: `A ${observation.lease.owner.origin} operation (${observation.lease.owner.command}) is active; this observation is not authoritative.` });
  }
  if (observation.lease.status === 'unreadable') findings.push({ code: 'lease-unreadable', severity: 'warning', message: 'The deployment lease owner record is unreadable; run doctor before any mutation.' });
  if (observation.identityMatches === false) {
    findings.push({ code: 'image-digest-mismatch', severity: 'blocker', resource: observation.state?.image, message: `Recorded digest ${observation.recordedImageDigest} does not match the local image ${observation.actualImageDigest}.` });
  }
  return findings;
}

function operationToStateOperation(operation: PendingOperation['operation'], fallback: Operation): Operation {
  if (operation === 'init' || operation === 'update' || operation === 'adopt') return operation;
  return fallback;
}

async function commitRecoveredState(directory: string, previous: ManagedState, next: ManagedState) {
  // Terminal state is authoritative and must land before the redundant mirror
  // is removed. Mirror cleanup is warning-only: an enclosing catch must not be
  // able to turn a completed commit back into pending state.
  await writeState(directory, next);
  await removeOperationRecordSafely(directory, previous.incompleteOperation?.id);
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

export type RecoveryDecision =
  | { action: 'none'; detail: string }
  | { action: 'resume'; detail: string }
  | { action: 'finish'; detail: string }
  | { action: 'require-explicit-restore'; detail: string; snapshotId?: string }
  | { action: 'reconcile-handoff'; detail: string };

/**
 * Pure recovery policy. Finish is allowed only for an update that recorded a
 * durable target-ready milestone; a deployment that may have replaced data
 * without completion proof requires the operator to choose a destructive
 * restore explicitly. Legacy ambiguity deliberately never becomes an implicit
 * restore.
 */
export function decideRecoveryAction(state: ManagedState): RecoveryDecision {
  const pending = state.incompleteOperation;
  if (!pending) {
    // The application commit may already be complete while the privileged
    // operator handoff is unfinished. Reconcile only that handoff; never
    // replace application data.
    const handoff = state.lastReceipt?.operatorHandoff;
    if (handoff === 'pending' || handoff === 'needs-attention') {
      return { action: 'reconcile-handoff', detail: `The application is complete but the dashboard operator handoff is ${handoff}. Reconcile only the recorded handoff.` };
    }
    return { action: 'none', detail: 'No incomplete operation is recorded.' };
  }
  if (pending.operation === 'update' && pending.phase === 'target-ready' && pending.evidence) {
    return { action: 'finish', detail: 'A completed replacement carries durable target-ready evidence and can be committed without restoring data.' };
  }
  if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
    return { action: 'resume', detail: `The ${pending.operation} had not replaced data; resume the known-good source.` };
  }
  if (pending.operation === 'update' || pending.operation === 'restore' || pending.operation === 'rollback') {
    const snapshotId = pending.operation === 'update' ? pending.backupId : (pending.previousBackupId ?? pending.backupId);
    return {
      action: 'require-explicit-restore',
      detail: `The ${pending.operation} may have changed data and has no completion proof. Health alone cannot authorize adoption.`,
      snapshotId,
    };
  }
  return { action: 'resume', detail: `Resume the ${pending.operation} using its durable evidence.` };
}

function assertRecoverFlags(flags: Flags) {
  const dryRun = boolFlag(flags, 'dry-run');
  const finish = boolFlag(flags, 'finish');
  const restore = boolFlag(flags, 'restore');
  if (finish && restore) throw new Error('Use either --finish or --restore, not both.');
  if (dryRun && (finish || restore)) throw new Error('--dry-run cannot be combined with --finish or --restore.');
  if (restore && !boolFlag(flags, 'yes')) {
    throw new Error('recover --restore replaces live data. Review `npx @or3/cloud recover --dry-run` first, then re-run with `recover --restore --yes`.');
  }
}

/**
 * Reconciles only the privileged operator handoff recorded for a completed
 * application update. It never replaces application data: it reschedules the
 * exact recorded job and leaves the receipt marked pending until the successor
 * operator confirms it is running.
 */
async function reconcileOperatorHandoff(directory: string, state: ManagedState, report: (...args: unknown[]) => void = console.log) {
  const env = parseEnv(await readText(deploymentPaths(directory).env));
  if (env.OR3_DASHBOARD_UPDATES_ENABLED !== 'true') {
    const detail = 'Dashboard updates are disabled in this deployment; no operator handoff needs reconciliation.';
    report(detail);
    return detail;
  }
  const receipt = state.lastReceipt;
  const jobId = receipt?.dashboardJobId ?? process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim();
  if (!jobId) {
    throw new Error('The completed update recorded no dashboard job for its operator handoff. Re-run the host CLI update, or disable dashboard updates until the operator is restored.');
  }
  await scheduleDashboardOperatorHandoff(directory, env, jobId);
  if (receipt) {
    receipt.operatorHandoff = 'pending';
    await writeState(directory, state);
    await exportTerminalReceipt(directory, receipt).catch(() => undefined);
  }
  const detail = `Rescheduled the dashboard operator handoff for job ${jobId.slice(0, 8)}. The successor operator marks it verified once it is running.`;
  report(detail);
  return detail;
}

/**
 * Commits an update that already reached the target-ready milestone, without
 * restoring data. Revalidates the recorded proof under the lease (exact image
 * binding, configuration and managed assets unchanged since target-ready,
 * authenticated rollback snapshot, deep health) before adopting the live
 * target.
 */
/**
 * Required completion-proof checks for a replaced target: the observed
 * container binding, SQLite integrity/ownership, and public/local deep health.
 * Reused when recording the milestone and when revalidating it at finish.
 */
async function collectTargetReadyChecks(
  directory: string,
  mode: Mode,
  env: Record<string, string>,
): Promise<{ containerId: string | undefined; checks: CheckResult[] }> {
  const checks: CheckResult[] = [];
  let containerId: string | undefined;
  const container = await run('docker', composeArgs(directory, mode, ['ps', '-q', 'or3']), directory);
  containerId = container.ok ? container.stdout.trim() || undefined : undefined;
  checks.push(containerId
    ? { code: 'container-binding', status: 'passed', detail: `Observed target container ${containerId}.` }
    : { code: 'container-binding', status: 'failed', detail: 'Could not resolve the running target container.' });

  const databaseCheck = await run('docker', [
    ...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(VERIFY_DATABASES_SCRIPT)]),
  ], directory);
  let databasesOk = false;
  if (databaseCheck.ok) {
    try {
      const databases = JSON.parse(databaseCheck.stdout.trim()) as Array<{ path: string; quickCheck: string; tables: number }>;
      databasesOk = databases.length === 2 && databases.every((entry) => entry.quickCheck === 'ok' && entry.tables >= 1);
    } catch {
      databasesOk = false;
    }
  }
  checks.push(databasesOk
    ? { code: 'database-integrity', status: 'passed', detail: 'auth.sqlite and sync.sqlite quick_check passed with managed ownership.' }
    : { code: 'database-integrity', status: 'failed', detail: `SQLite integrity or ownership verification failed. ${redact(databaseCheck.stderr.trim(), secretValues(env))}` });

  const baseUrl = new URL(mode === 'public' ? `https://${env.OR3_PUBLIC_DOMAIN}` : `http://127.0.0.1:${env.OR3_PORT}`);
  try {
    validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
    checks.push({ code: 'public-health', status: 'passed', detail: `${baseUrl.origin} deep health reports the managed profile.` });
  } catch (error) {
    checks.push({ code: 'public-health', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  return { containerId, checks };
}

async function finishTargetReadyUpdate(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  report: (...args: unknown[]) => void = console.log,
): Promise<string> {
  const pending = state.incompleteOperation;
  if (!pending?.evidence || !pending.targetVersion || !pending.targetImage) {
    throw new Error('recover --finish requires a recorded target-ready milestone; none is present.');
  }
  const targetEnv = parseEnv(await readText(deploymentPaths(directory).env));
  if (targetEnv.OR3_VERSION !== pending.targetVersion || targetEnv.OR3_IMAGE !== pending.targetImage) {
    throw new Error('The live .env no longer matches the recorded target-ready identities; refusing to finish.');
  }
  const expectedTargetDigest = pending.targetImageDigest ?? await imageDigest(targetEnv.OR3_IMAGE);
  await pullAndRequireImage(targetEnv.OR3_IMAGE, expectedTargetDigest, 'Target deployment');
  await assertRunningAppImage(directory, state.mode, targetEnv.OR3_IMAGE);
  const actualDigest = await imageDigest(targetEnv.OR3_IMAGE);
  if (actualDigest !== pending.evidence.imageDigest) {
    throw new Error(`The running target image ${actualDigest} does not match the recorded target-ready proof ${pending.evidence.imageDigest}.`);
  }
  const configurationSha256 = await sha256File(deploymentPaths(directory).env);
  if (configurationSha256 !== pending.evidence.configurationSha256) {
    throw new Error('The managed configuration changed after the target-ready milestone; refusing to finish. Inspect the change, or run `recover --restore --yes` to return to the recorded snapshot.');
  }
  const assets = await installedManagedAssetChecksums(directory, state.mode);
  for (const [name, expected] of Object.entries(pending.evidence.managedAssetSha256)) {
    if (assets[name] !== expected) {
      throw new Error(`Managed asset ${name} changed after the target-ready milestone; refusing to finish.`);
    }
  }
  const expectedDeploymentId = targetEnv.OR3_DEPLOYMENT_ID ?? pending.targetDeploymentId;
  if (pending.evidence.deploymentId && expectedDeploymentId && pending.evidence.deploymentId !== expectedDeploymentId) {
    throw new Error('The recorded target-ready deployment identity no longer matches the live deployment.');
  }
  // The rollback source must still authenticate, even though we are not restoring it.
  await recordedBackupPath(directory, pending);
  // Required completion evidence must be present and re-proven. A milestone
  // that omitted database integrity, public health, or the observed container
  // binding cannot be finished from internal health alone.
  for (const required of ['container-binding', 'database-integrity', 'public-health']) {
    const recorded = pending.evidence.checks.find((check) => check.code === required);
    if (!recorded || recorded.status !== 'passed') {
      throw new Error(`The recorded target-ready proof is missing ${required}; refusing to finish. Run "npx @or3/cloud recover --restore --yes" to return to the recorded snapshot.`);
    }
  }
  await waitForDeepHealth(directory, state.mode, secretValues(targetEnv));
  const revalidated = await collectTargetReadyChecks(directory, state.mode, targetEnv);
  if (!revalidated.containerId || revalidated.containerId !== pending.evidence.containerId) {
    throw new Error('The running target container no longer matches the recorded target-ready proof; refusing to finish.');
  }
  const failedChecks = revalidated.checks.filter((check) => check.status !== 'passed');
  if (failedChecks.length > 0) {
    throw new Error(`Target verification failed at finish (${failedChecks.map((check) => check.code).join(', ')}); refusing to finish.`);
  }

  const sourceVersion = state.appVersion;
  const sourceImage = state.image;
  const sourceDigest = state.imageDigest;
  const digest = actualDigest;
  const recordedDashboardJobId = pending.dashboardJobId ?? (process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim() || undefined);
  const receipt: OperationReceipt = {
    schemaVersion: 1,
    operationId: pending.id,
    dashboardJobId: recordedDashboardJobId,
    cliVersion: PACKAGE_VERSION,
    source: { appVersion: sourceVersion, image: sourceImage, imageDigest: sourceDigest, sourceRevision: packagedSourceRevision(sourceVersion), operatorImageDigest: expectedOperatorImageDigest(sourceVersion) },
    target: { appVersion: pending.targetVersion, image: pending.targetImage, imageDigest: digest, sourceRevision: packagedSourceRevision(pending.targetVersion), operatorImageDigest: expectedOperatorImageDigest(pending.targetVersion) },
    observed: { appVersion: pending.targetVersion, image: pending.targetImage, imageDigest: digest },
    completedAt: now(),
    rollbackBackupId: pending.backupId ?? '',
    checks: revalidated.checks,
    warnings: [],
    phaseDurationsMs: {},
    operatorHandoff: 'not-required',
  };
  const next = stateFromEnv(directory, targetEnv, state.mode, 'update', digest);
  next.rollback = {
    appVersion: sourceVersion,
    image: sourceImage,
    imageDigest: sourceDigest,
    backupId: pending.backupId ?? '',
    createdAt: now(),
  };
  next.lastError = undefined;
  if (targetEnv.OR3_DASHBOARD_UPDATES_ENABLED === 'true' && recordedDashboardJobId) {
    try {
      await scheduleDashboardOperatorHandoff(directory, targetEnv, recordedDashboardJobId);
      receipt.operatorHandoff = 'pending';
    } catch (error) {
      receipt.operatorHandoff = 'needs-attention';
      receipt.warnings.push({ code: 'operator-handoff-schedule-failed', severity: 'warning', message: redact(error instanceof Error ? error.message : String(error), secretValues(targetEnv)) });
    }
  }
  const commit = await commitTerminalState(directory, next, receipt);
  await removeOperationRecordSafely(directory, commit.operationId);
  const maintenance: Diagnostic[] = [];
  const prune = await pruneBackups(directory, next, BACKUP_RETENTION_KEEP, false, {
    automatic: true,
    log: (message) => report(message),
    warn: (message) => report(message),
  }).catch((error) => {
    // A prune failure is a maintenance warning, never a silent suppression.
    maintenance.push({ code: 'retention-failed', severity: 'warning', message: redact(error instanceof Error ? error.message : String(error), secretValues(targetEnv)) });
    return { removed: 0, deferred: [] as Diagnostic[] };
  });
  maintenance.push(...prune.deferred);
  // Persist the post-commit maintenance warnings into the authoritative receipt
  // so a reload, the dashboard, or a later `recover --finish` still sees them.
  await persistReceiptWarnings(directory, next, maintenance);
  const detail = `Finished the recorded update as OR3 ${pending.targetVersion}. Post-replacement writes were preserved.`;
  report(detail);
  for (const warning of [...receipt.warnings, ...maintenance]) report(`  ⚠ ${warning.code}: ${warning.message}`);
  void env;
  return detail;
}

async function recoverCommand(directory: string, flags: Flags = {}) {
  assertRecoverFlags(flags);
  const explicitRestore = boolFlag(flags, 'restore');
  const finishRequested = boolFlag(flags, 'finish');
  const dryRun = boolFlag(flags, 'dry-run');

  if (dryRun) {
    const observation = await observeDeployment(directory, { checkDocker: true, checkImage: true });
    const state = observation.state;
    const decision = state ? decideRecoveryAction(state) : { action: 'none' as const, detail: 'Managed state is unreadable; only diagnosis is available.' };
    const pending = state?.incompleteOperation;
    const payload = {
      schemaVersion: 1,
      kind: 'or3-recover-preview',
      observedAt: observation.observedAt,
      directory: observation.directory,
      partial: observation.partial,
      inProgress: observation.changing,
      source: state ? { appVersion: state.appVersion, image: state.image, imageDigest: state.imageDigest } : null,
      target: pending?.targetVersion ? { appVersion: pending.targetVersion, image: pending.targetImage ?? null, imageDigest: pending.targetImageDigest ?? null } : null,
      phase: pending?.phase ?? null,
      operation: pending?.operation ?? null,
      decision,
      dataLoss: decision.action === 'require-explicit-restore',
      findings: observationFindings(observation),
    };
    if (boolFlag(flags, 'json')) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`OR3 recovery preview for ${observation.directory}`);
      console.log(`  source: ${payload.source ? `OR3 ${payload.source.appVersion} (${payload.source.imageDigest})` : 'unknown'}`);
      console.log(`  target: ${payload.target ? `OR3 ${payload.target.appVersion}` : 'none'}`);
      console.log(`  operation: ${payload.operation ?? 'none'}${payload.phase ? ` (${payload.phase})` : ''}`);
      console.log(`  action: ${decision.action} — ${decision.detail}`);
      if (payload.dataLoss) console.log('  data loss: yes — restoring the recorded snapshot discards writes made after it.');
      for (const finding of payload.findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
      console.log('\nPreview only: nothing was changed.');
    }
    return;
  }

  const asJson = boolFlag(flags, 'json');
  const report = (...args: unknown[]) => {
    if (asJson) console.error(...args);
    else console.log(...args);
  };
  await ensureDocker();
  try {
    const outcome = await runRecovery(directory, { explicitRestore, finishRequested, report });
    if (asJson) emitOperationResult(outcome);
  } catch (error) {
    if (!asJson) throw error;
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(`OR3 Cloud failed: ${message}`);
    emitOperationResult({ kind: 'blocked', findings: [{ code: 'recovery-failed', severity: 'blocker', message, nextCommand: 'npx @or3/cloud recover --dry-run' }] });
    process.exitCode = 1;
  }
}

/**
 * Performs one non-dry-run recovery. Returns the terminal outcome so the JSON
 * path can serialize exactly one result and the human path can print one
 * summary; it never prints its own result document.
 */
async function runRecovery(
  directory: string,
  context: { explicitRestore: boolean; finishRequested: boolean; report: (...args: unknown[]) => void },
): Promise<OperationOutcome> {
  const { explicitRestore, finishRequested, report } = context;
  const loaded = await loadManaged(directory);
  const pending = loaded.state.incompleteOperation;
  const decision = decideRecoveryAction(loaded.state);
  // Handoff reconciliation is evaluated before the no-pending early return: an
  // application commit can be complete while its privileged handoff is not, and
  // that state records no pending operation.
  if (decision.action === 'reconcile-handoff') {
    if (explicitRestore) throw new Error('This deployment completed its application update; only the dashboard operator handoff needs reconciliation. Run `npx @or3/cloud recover --finish` without --restore.');
    const detail = await reconcileOperatorHandoff(loaded.directory, loaded.state, report);
    return { kind: 'recovered', operation: 'update', detail };
  }
  if (!pending) {
    if (finishRequested) {
      if (loaded.state.lastReceipt) {
        const detail = `No incomplete operation is recorded; the last ${loaded.state.lastReceipt.operationId} completion remains authoritative. Nothing to finish.`;
        report(detail);
        return { kind: 'no-op', detail };
      }
      throw new Error('recover --finish requires an incomplete operation, but none is recorded.');
    }
    const detail = 'No incomplete OR3 Cloud operation is recorded.';
    report(detail);
    return { kind: 'no-op', detail };
  }
  if (finishRequested) {
    if (decision.action !== 'finish') {
      throw new Error(`recover --finish is not admissible: ${decision.detail} Run "npx @or3/cloud recover --dry-run" to inspect the supported actions.`);
    }
    const detail = await finishTargetReadyUpdate(loaded.directory, loaded.state, loaded.env, report);
    return { kind: 'recovered', operation: 'update', detail };
  }
  // Plain recover finishes only proven non-destructive work. A deployment that
  // may have replaced data requires the explicit `--restore --yes` choice.
  const requiresExplicitRestore = decision.action === 'require-explicit-restore';
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
      const detail = 'Recovered the incomplete credential reset. Owner and admin credentials were verified inside the OR3 container.';
      report(detail);
      return { kind: 'recovered', operation: 'credentials-reset', detail };
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
        const detail = `Recovered the incomplete ${pending.operation} before data replacement. OR3 ${loaded.state.appVersion} is deeply healthy.`;
        report(detail);
        return { kind: 'recovered', operation: pending.operation, detail };
      }
      if (requiresExplicitRestore && !explicitRestore) {
        throw new Error(`The incomplete ${pending.operation} may have replaced data and has no completion proof. Nothing was changed. Review "npx @or3/cloud recover --dry-run", then restore deliberately with "npx @or3/cloud recover --restore --yes" (this discards writes made after the recorded snapshot).`);
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
      const detail = `Recovered the incomplete ${pending.operation} by restoring pre-mutation snapshot ${previous.manifest.backupId}. OR3 ${recovered.appVersion} is deeply healthy.`;
      report(detail);
      return { kind: 'recovered', operation: pending.operation, detail };
    }

    if (pending.operation === 'update') {
      if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
        await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
        const recovered = stateFromEnv(loaded.directory, loaded.env, loaded.state.mode, loaded.state.lastSuccessfulOperation, await imageDigest(loaded.env.OR3_IMAGE));
        recovered.rollback = loaded.state.rollback;
        recovered.lastError = undefined;
        await commitRecoveredState(loaded.directory, loaded.state, recovered);
        const detail = `Recovered the incomplete update before the replacement was applied. OR3 ${recovered.appVersion} is deeply healthy.`;
        report(detail);
        return { kind: 'recovered', operation: 'update', detail };
      }
      // A recorded target-ready milestone means the replacement succeeded; finish
      // forward and preserve post-replacement writes. An explicit --restore
      // request takes precedence so the advertised escape path always works.
      if (decision.action === 'finish' && !explicitRestore) {
        const detail = await finishTargetReadyUpdate(loaded.directory, loaded.state, loaded.env, report);
        return { kind: 'recovered', operation: 'update', detail };
      }
      if (requiresExplicitRestore && !explicitRestore) {
        throw new Error(`The incomplete update may have replaced data and has no completion proof. Nothing was changed. Review "npx @or3/cloud recover --dry-run", then restore deliberately with "npx @or3/cloud recover --restore --yes" (this discards writes made after the recorded pre-update snapshot).`);
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
      const detail = `Recovered the incomplete update by restoring pre-update snapshot ${previous.manifest.backupId}. OR3 ${recovered.appVersion} is deeply healthy.`;
      report(detail);
      return { kind: 'recovered', operation: 'update', detail };
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
      const detail = 'Recovered the incomplete backup operation and preserved the intentionally stopped OR3 service.';
      report(detail);
      return { kind: 'recovered', operation: 'backup', detail };
    }

    // Init and backup keep the current .env as the intended deployment.
    // Starting is idempotent and commits only its observed image digest after
    // deep health passes. Adoption additionally replays its verified source
    // archive before starting, so a crash cannot silently adopt an empty or
    // partially copied volume.
    await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
    await startProject(loaded.directory, loaded.state.mode, loaded.env);
    let recoveredEnv = loaded.env;
    if (
      (pending.operation === 'init' || pending.operation === 'adopt')
      && loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL
      && loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD
      && loaded.env.OR3_ADMIN_PASSWORD
    ) {
      await provisionManagedCredentials(
        loaded.state.mode === 'public'
          ? new URL(`https://${loaded.env.OR3_PUBLIC_DOMAIN}`)
          : new URL(`http://127.0.0.1:${loaded.env.OR3_PORT}`),
        loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL,
        loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD,
        loaded.env.OR3_ADMIN_USERNAME,
        loaded.env.OR3_ADMIN_PASSWORD,
      );
      recoveredEnv = withoutProvisioningCredentials(loaded.env);
      await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(recoveredEnv));
      await stopProject(loaded.directory, loaded.state.mode);
      await startProject(loaded.directory, loaded.state.mode, recoveredEnv);
    }
    const digest = await imageDigest(recoveredEnv.OR3_IMAGE);
    const recovered = stateFromEnv(
      loaded.directory,
      recoveredEnv,
      loaded.state.mode,
      operationToStateOperation(pending.operation, loaded.state.lastSuccessfulOperation),
      digest,
    );
    recovered.rollback = loaded.state.rollback;
    recovered.lastError = undefined;
    await commitRecoveredState(loaded.directory, loaded.state, recovered);
    const detail = `Recovered the incomplete ${pending.operation} operation. OR3 ${recovered.appVersion} is deeply healthy.`;
    report(detail);
    return { kind: 'recovered', operation: pending.operation, detail };
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

/**
 * Explicit phase policy for container lifecycle commands (R4.AC4). Stopping is
 * always safe. Starting or restarting while an interrupted operation is
 * recorded would bypass recovery bookkeeping and can resurrect an ambiguous
 * deployment, so it requires the operator to run recovery first.
 */
export function assertPhaseAllowsCommand(command: 'start' | 'stop' | 'restart', state: ManagedState) {
  const pending = state.incompleteOperation;
  if (!pending || command === 'stop') return;
  throw new Error(
    `An incomplete ${pending.operation}${pending.phase ? ` (${pending.phase})` : ''} is recorded. Refusing to ${command} an ambiguous deployment. Run "npx @or3/cloud recover --dry-run" to inspect the supported actions, then "npx @or3/cloud recover --finish" or "npx @or3/cloud recover --restore --yes".`,
  );
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
    const prune = await pruneBackups(loaded.directory, loaded.state, BACKUP_RETENTION_KEEP, false, { automatic: true });
    console.log(`Backup ${result.backupId} created at ${result.backupDir}`);
    console.log(`SHA-256: ${result.manifest.dataSha256}`);
    if (prune.deferred.length > 0) {
      console.warn(`Maintenance warning: ${prune.deferred.length} backup entr${prune.deferred.length === 1 ? 'y' : 'ies'} need inspection; all backups were preserved. Run "npx @or3/cloud backup list" for details.`);
    }
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    await writeState(loaded.directory, loaded.state);
    throw error;
  }
}

async function backupListCommand(directory: string, flags: Flags = {}) {
  const loaded = await loadManaged(directory, { writable: false });
  const inventory = await inventoryBackups(loaded.directory);
  const verified = inventory.entries
    .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
    .map((entry) => entry.backup);
  const findings = inventory.entries.filter((entry) => entry.kind !== 'verified');
  if (boolFlag(flags, 'json')) {
    // One versioned object on stdout; a store-level failure is reported in-band
    // so automation can parse it without losing the diagnostic.
    console.log(JSON.stringify({
      schemaVersion: 1,
      directory: loaded.directory,
      backups: verified.map((backup) => ({
        backupId: backup.backupId,
        createdAt: backup.createdAt,
        appVersion: backup.appVersion,
        bytes: backup.bytes,
        dataSha256: backup.dataSha256,
        trust: 'verified',
      })),
      findings: findings.map((entry) => ({ entryName: entry.entryName, kind: entry.kind, code: entry.code, message: entry.message })),
      storeErrors: inventory.storeErrors,
    }, null, 2));
    return;
  }
  if (verified.length === 0 && findings.length === 0) {
    console.log(`No backups are available for ${loaded.directory}. Run "npx @or3/cloud backup" to create one.`);
    return;
  }
  if (verified.length === 0) {
    console.log(`No authenticated backups are available for ${loaded.directory}.`);
  } else {
    console.log(`OR3 Cloud backups for ${loaded.directory} (${verified.length} verified):`);
    console.log('backupId                      createdAt                      version  bytes     trust     checksum');
    for (const backup of verified) {
      console.log(
        `${backup.backupId.padEnd(30)} ${backup.createdAt.padEnd(30)} ${backup.appVersion.padEnd(8)} ${String(backup.bytes).padStart(9)}  ${'verified'.padEnd(9)} ${backup.dataSha256.slice(0, 12)}`,
      );
    }
  }
  if (findings.length > 0) {
    console.log(`\nPreserved history (${findings.length}; never trusted for restore):`);
    for (const entry of findings) {
      console.log(`  ${entry.entryName.padEnd(30)} ${entry.kind.padEnd(16)} ${entry.code}`);
      console.log(`    ${entry.message}`);
    }
    console.log('\nTo obtain a trusted restore point, create a new backup of the current healthy deployment: npx @or3/cloud backup');
  }
  for (const diagnostic of inventory.storeErrors) {
    console.log(`\nStore error (${diagnostic.severity}): ${diagnostic.message}`);
  }
  console.log('\nBackups contain credentials and secrets; keep them owner-only and export off-host.');
}

async function backupPruneCommand(directory: string, flags: Flags) {
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const keep = parseKeep(flags);
  const force = boolFlag(flags, 'force');
  if (force && !boolFlag(flags, 'yes')) throw new Error('--force may delete backups beyond the retention count. Re-run with --force --yes after confirming the exact backups shown by `backup list`.');
  const result = await pruneBackups(loaded.directory, loaded.state, keep, force, { automatic: !force });
  if (!force && result.deferred.length > 0 && result.removed === 0) {
    throw new Error(`Backup pruning is blocked because the store contains entries that need inspection:\n${result.deferred.map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.message}`).join('\n')}\nNo backups were deleted. Run "npx @or3/cloud backup list" to inspect them, or re-run with --force --yes to prune only verified backups while preserving protected recovery sources.`);
  }
  console.log(result.removed > 0
    ? `Pruned ${result.removed} backup(s); keeping the newest ${keep}.`
    : `Nothing to prune: keeping all backups (newest ${keep}).`);
  if (result.deferred.length > 0) {
    console.warn(`Preserved ${result.deferred.length} suspect or legacy entr${result.deferred.length === 1 ? 'y' : 'ies'} without deletion.`);
  }
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
    return await backupListCommand(directory, flags);
  }
  if (boolFlag(flags, 'json')) throw new Error('--json is supported only by `backup list`.');
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

/** Stable explanatory fingerprint; never used as an authorization token. */
export function stateFingerprint(state: ManagedState) {
  return createHash('sha256')
    .update(JSON.stringify({
      schema: state.schemaVersion,
      appVersion: state.appVersion,
      image: state.image,
      imageDigest: state.imageDigest,
      pending: state.incompleteOperation?.id ?? null,
    }))
    .digest('hex')
    .slice(0, 16);
}

/**
 * One shared update assessment used by both `update --dry-run` and the real
 * update's execution-time revalidation. It performs no deployment or Docker
 * mutation: assets are rendered in memory, disk space is read via statfs, and
 * anything that would need a pull, writable probe, or fresh snapshot is marked
 * deferred rather than passed.
 */
export async function assessUpdate(
  directory: string,
  targetVersion: string,
  options: { inspectAssets?: boolean; checkDocker?: boolean; underLease?: boolean } = {},
): Promise<UpdateAssessment> {
  // `checkDocker` performs the read-only daemon/architecture probe when a caller
  // wants live evidence (preview and execution). `underLease` tells the shared
  // assessment that the active mutation lease is the caller's own, so its own
  // in-progress state is not reported as a blocker.
  const checkDocker = options.checkDocker ?? false;
  const observation = await observeDeployment(directory, { checkDocker, checkImage: false });
  const state = observation.state;
  const checks: CheckResult[] = [];
  const findings: Diagnostic[] = [...observationFindings(observation)];
  const targetImage = imageFor(targetVersion);

  if (!state) {
    findings.push({ code: 'state-unreadable', severity: 'blocker', message: 'Managed state must be readable to preview an update.' });
  } else if (state.incompleteOperation) {
    findings.push({
      code: 'operation-incomplete',
      severity: 'blocker',
      message: `An incomplete ${state.incompleteOperation.operation} is recorded. Run "npx @or3/cloud recover" before updating.`,
      nextCommand: 'npx @or3/cloud recover',
    });
  }
  if (observation.changing && !options.underLease) {
    findings.push({ code: 'operation-in-progress', severity: 'blocker', message: 'A mutation lease is active; preview is non-executable until it settles.' });
  }

  let noOp = false;
  if (state && targetVersion === state.appVersion && !state.incompleteOperation) {
    noOp = true;
    checks.push({ code: 'already-installed', status: 'passed', detail: `OR3 ${targetVersion} is already the installed release; execution is a no-op.` });
  } else {
    checks.push({ code: 'target-version', status: 'passed', detail: `Target OR3 ${targetVersion} (${targetImage}).` });
  }

  // Disk headroom on the backup filesystem (read-only statfs). The data volume
  // requirement is deferred to execution-time validation.
  try {
    const stats = await statfs(deploymentPaths(directory).backups);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    checks.push({ code: 'backup-filesystem-space', status: 'passed', detail: `${freeBytes} bytes available on the backup filesystem.` });
  } catch (error) {
    checks.push({ code: 'backup-filesystem-space', status: 'unknown', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  checks.push({ code: 'data-volume-space', status: 'deferred', detail: 'The live data-volume requirement is validated after the snapshot, before downtime.' });
  if (checkDocker) {
    // Read-only daemon/architecture probe. It never pulls or changes images, so
    // it is safe to run during preview instead of deferring the whole check.
    if (observation.docker) {
      try {
        const architecture = await dockerDaemonArchitecture();
        checks.push({ code: 'docker-availability', status: 'passed', detail: `Docker daemon is reachable (${architecture}).` });
      } catch (error) {
        checks.push({ code: 'docker-availability', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
      }
    } else {
      checks.push({ code: 'docker-availability', status: 'unknown', detail: 'The Docker daemon is not reachable from this host; it is revalidated at execution time.' });
    }
  } else {
    checks.push({ code: 'docker-availability', status: 'deferred', detail: 'Docker availability and daemon architecture are revalidated at execution time.' });
  }
  checks.push({ code: 'image-pull', status: 'deferred', detail: 'The target image pull and architecture/provenance checks run at execution time.' });
  checks.push({ code: 'fresh-snapshot', status: 'deferred', detail: 'A fresh authenticated snapshot is created at execution time.' });

  // Retention plan: show what automatic pruning would keep/remove/preserve.
  const plan = planRetention(
    observation.backups?.entries ?? [],
    BACKUP_RETENTION_KEEP,
    state ? retentionProtectedIds(state) : new Set(),
    { automatic: true },
  );
  checks.push({
    code: 'retention',
    status: plan.canPrune ? 'passed' : 'deferred',
    detail: plan.canPrune
      ? `Would keep ${plan.keep.length} verified backup(s) and prune ${plan.remove.length}.`
      : `${plan.warnings.length} entry(ies) need inspection; automatic pruning is deferred and all backups are preserved.`,
  });
  for (const warning of plan.warnings) findings.push(warning);

  // Asset changes: compare the installed generated files with the target CLI.
  if (options.inspectAssets !== false) {
    const changed: string[] = [];
    for (const name of managedAssetNames(state?.mode ?? 'local')) {
      // A required asset that this CLI cannot read is a hard blocker: without it
      // the target deployment cannot be rendered, and silently reporting
      // "assets unchanged" would hide the failure until execution.
      let desired: Buffer;
      try {
        desired = await readFile(join(ASSET_ROOT, name));
      } catch (error) {
        findings.push({
          code: 'managed-asset-unreadable',
          severity: 'blocker',
          resource: name,
          message: `Required generated asset ${name} could not be read from this CLI: ${redact(error instanceof Error ? error.message : String(error))}`,
        });
        continue;
      }
      try {
        const installedPath = join(directory, name);
        if (!await fileExists(installedPath)) {
          changed.push(`${name} (add)`);
          continue;
        }
        const installed = await readFile(installedPath);
        if (!installed.equals(desired)) changed.push(`${name} (update)`);
      } catch (error) {
        findings.push({
          code: 'managed-asset-unreadable',
          severity: 'blocker',
          resource: name,
          message: `Installed generated asset ${name} could not be read from ${directory}: ${redact(error instanceof Error ? error.message : String(error))}`,
        });
      }
    }
    checks.push(changed.length
      ? { code: 'managed-assets', status: 'passed', detail: `Generated assets change: ${changed.join(', ')}.` }
      : { code: 'managed-assets', status: 'passed', detail: 'Generated assets are unchanged.' });
  }

  // Compatibility: unknown/future schemas are refused before mutation.
  try {
    assertKnownStateSchema(state?.schemaVersion);
    checks.push({ code: 'state-schema', status: 'passed', detail: `Managed state schema ${String(state?.schemaVersion)} is supported.` });
  } catch (error) {
    findings.push({ code: 'state-schema-unsupported', severity: 'blocker', message: error instanceof Error ? error.message : String(error) });
  }

  const blockers = findings.filter((finding) => finding.severity === 'blocker');
  blockers.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    schemaVersion: 1,
    observedAt: observation.observedAt,
    source: state ? { appVersion: state.appVersion, image: state.image, imageDigest: state.imageDigest } : null,
    target: { appVersion: targetVersion, image: targetImage, imageDigest: expectedImageDigest(targetVersion) ?? 'unknown' },
    checks,
    findings: [...blockers, ...findings.filter((finding) => finding.severity !== 'blocker')],
    retention: plan,
    stateFingerprint: state ? stateFingerprint(state) : 'unavailable',
  };
}

async function updatePreviewCommand(directory: string, flags: Flags) {
  const targetVersion = stringFlag(flags, 'to')?.trim() ?? PACKAGE_VERSION;
  if (!isVersion(targetVersion)) throw new Error(`--to must be a complete semantic version such as ${PACKAGE_VERSION}.`);
  if (targetVersion !== PACKAGE_VERSION) {
    throw new Error(`This CLI contains deployment assets for OR3 ${PACKAGE_VERSION}. Preview the matching CLI with \`npx --yes @or3/cloud@${targetVersion} update --to ${targetVersion} --dry-run\`.`);
  }
  const assessment = await assessUpdate(directory, targetVersion, { checkDocker: true });
  if (boolFlag(flags, 'json')) {
    console.log(JSON.stringify({ ...assessment, kind: 'or3-update-preview' }, null, 2));
  } else {
    console.log(`OR3 update preview for ${directory}`);
    console.log(`  source: ${assessment.source ? `OR3 ${assessment.source.appVersion} (${assessment.source.imageDigest})` : 'unknown'}`);
    console.log(`  target: OR3 ${assessment.target.appVersion} (${assessment.target.imageDigest})`);
    console.log(`  state fingerprint: ${assessment.stateFingerprint}`);
    console.log();
    for (const check of assessment.checks) console.log(`  [${check.status}] ${check.code}: ${check.detail}`);
    console.log();
    for (const finding of assessment.findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
    if (assessment.retention.preserve.length) {
      console.log('\n  Preserved backups:');
      for (const entry of assessment.retention.preserve) console.log(`    ${entry.entryName}: ${entry.reason}`);
    }
    console.log('\nDry run only: no state, assets, lease, images, services, snapshots, or backups were changed.');
  }
  if (assessment.findings.some((finding) => finding.severity === 'blocker')) process.exitCode = 1;
}

async function updateCommand(directory: string, flags: Flags) {
  // With --json, stdout carries exactly one result object for every terminal
  // path (success, no-op, blocked, or failure) and all progress goes to stderr.
  const asJson = boolFlag(flags, 'json');
  try {
    return await runUpdateCommand(directory, flags, asJson);
  } catch (error) {
    if (!asJson) throw error;
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(`OR3 Cloud failed: ${message}`);
    emitOperationResult({
      kind: 'blocked',
      findings: [{ code: 'update-failed', severity: 'blocker', message, nextCommand: 'npx @or3/cloud recover --dry-run' }],
    });
    process.exitCode = 1;
  }
}

async function runUpdateCommand(directory: string, flags: Flags, asJson: boolean) {
  const progress = (...args: unknown[]) => {
    if (asJson) console.error(...args);
    else console.log(...args);
  };
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
  if (targetVersion === state.appVersion) {
    if (asJson) emitOperationResult({ kind: 'no-op', detail: `OR3 ${targetVersion} is already installed.`, currentVersion: state.appVersion, targetVersion });
    else progress(`OR3 ${targetVersion} is already installed. Nothing to do.`);
    return;
  }
  // Shared preflight: the same assessment the dashboard previews now runs at
  // execution time under the lease and blocks before any pull or data change.
  const preflight = await assessUpdate(loaded.directory, targetVersion, { underLease: true, checkDocker: true });
  const preflightBlockers = preflight.findings.filter((finding) => finding.severity === 'blocker');
  if (preflightBlockers.length > 0) {
    throw new Error(`Update to ${targetVersion} is blocked by preflight: ${preflightBlockers.map((finding) => `${finding.code} (${finding.message})`).join(' ')}`);
  }
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
  const startedAtMs = Date.now();
  try {
    // Resolve the dedicated operator runtime for every target version before
    // downtime. Keeping an old privileged image after an application update
    // defeats the digest binding and leaves security fixes behind. The app
    // image was already pulled and provenance-checked above, so both artifacts
    // are prepared while the source is still running.
    const operator = await prepareVerifiedDashboardOperator(loaded.directory, targetVersion);
    const backup = await createBackup(loaded.directory, state, env, { restartAfter: false, backupId });
    // The bridge release reads schema 2 but keeps writing schema 1. Only a
    // release explicitly qualified to write schema 2 migrates, and only after
    // the compatibility bridge is present (declared minimum source). Migration
    // and the initial pending update share one atomic write, so an empty
    // new-format state is never published on its own.
    const writeSchema = writeStateSchema();
    if (writeSchema >= 2) {
      const minimumSource = packagedMinimumSourceVersion();
      if (minimumSource && compareReleaseVersions(state.appVersion, minimumSource) < 0) {
        throw new Error(`OR3 ${targetVersion} writes managed state schema 2, which requires the compatibility bridge (source ${minimumSource} or newer). Run the host CLI bridge update first, then retry this schema-2 release.`);
      }
      state.schemaVersion = writeSchema;
    }
    await updatePending(loaded.directory, state, {
      backupId: backup.backupId,
      backupPath: backup.backupDir,
      backupDataSha256: backup.manifest.dataSha256,
      backupConfigSha256: backup.manifest.configSha256,
      phase: 'snapshot-created',
      verifiedSnapshot: {
        backupId: backup.backupId,
        path: backup.backupDir,
        dataSha256: backup.manifest.dataSha256,
        configSha256: backup.manifest.configSha256 ?? '',
        createdAt: backup.manifest.createdAt,
      },
    });
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
    const recreateDataVolume = updateRequiresVolumeRecreation(state, env);
    await updatePending(loaded.directory, state, {
      phase: 'target-mutating',
      previousRootOwnership,
      recreateDataVolume,
    });
    try {
      if (recreateDataVolume) {
        await removeManagedDataVolumeForRecreation(loaded.directory, state);
      } else {
        await stopProject(loaded.directory, state.mode);
      }
      if (migrateLegacyVolume && !recreateDataVolume) {
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
      if (migrateLegacyVolume || recreateDataVolume) {
        await restoreVolumeArchive(loaded.directory, state.mode, nextEnv, backup.backupDir);
      }
    } catch (error) {
      // Failure before the target can accept writes: the deployment is still
      // the known-good source, so automatic restoration is safe.
      await updatePending(loaded.directory, state, { phase: 'restoring-previous' });
      try {
        if (!recreateDataVolume) await stopProject(loaded.directory, state.mode).catch(() => undefined);
        if (migrateLegacyVolume && !recreateDataVolume) {
          await setManagedVolumeRootOwnership(targetImage, state.volumeName, previousRootOwnership);
        }
        await restoreBackupData(loaded.directory, state, oldEnv, backup.backupDir, { recreateDataVolume });
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
    // The target is about to start and may accept writes. Persist this boundary
    // first; a failure from here must never silently discard those writes.
    await updatePending(loaded.directory, state, { phase: 'starting-target' });
    try {
      await startProject(loaded.directory, state.mode, nextEnv);
    } catch (error) {
      throw new Error(`Update to ${targetVersion} started the target but it did not pass verification: ${redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv))}. Writes may have been accepted, so the deployment was NOT restored automatically. Run "npx @or3/cloud recover --dry-run", then "npx @or3/cloud recover --finish" if the target is proven, or "npx @or3/cloud recover --restore --yes" to return to the pre-update snapshot.`);
    }
    const digest = await requireImageDigest(targetImage, targetDigest, `OR3 ${targetVersion}`);
    // Durable target-ready proof: the replacement boundary completed, the
    // configuration and generated assets are bound, the observed container and
    // image match, and the required database/public-health checks passed. A
    // crash before this point cannot be inferred as success from health alone.
    const targetChecks = await collectTargetReadyChecks(loaded.directory, state.mode, nextEnv);
    const failedTargetChecks = targetChecks.checks.filter((check) => check.status !== 'passed');
    if (!targetChecks.containerId || failedTargetChecks.length > 0) {
      throw new Error(`Update to ${targetVersion} did not pass the required target checks (${failedTargetChecks.map((check) => check.code).join(', ') || 'container-binding'}). Writes may have been accepted, so the deployment was NOT restored automatically. Run "npx @or3/cloud recover --dry-run", then "npx @or3/cloud recover --restore --yes" to return to the pre-update snapshot.`);
    }
    const targetReadyEvidence: TargetReadyEvidence = {
      checkedAt: now(),
      deploymentId: targetDeploymentId,
      deploymentRoot: resolve(loaded.directory),
      containerId: targetChecks.containerId,
      imageDigest: digest,
      configurationSha256: await sha256File(deploymentPaths(loaded.directory).env),
      managedAssetSha256: await installedManagedAssetChecksums(loaded.directory, state.mode),
      dataReplacementCompleted: true,
      checks: [
        { code: 'image-digest', status: 'passed', detail: `${targetImage}@${digest}` },
        { code: 'deep-health', status: 'passed', detail: 'OR3 deep health and running-image identity verified' },
        ...targetChecks.checks,
      ],
    };
    if (writeSchema >= 2) {
      // Only a schema-2 writer records the target-ready milestone: a schema-1
      // reader would misroute the new phase to its destructive restore path.
      await updatePending(loaded.directory, state, { phase: 'target-ready', evidence: targetReadyEvidence });
    }

    const warnings: Diagnostic[] = [];
    const hadDashboardJob = Boolean(process.env.OR3_DASHBOARD_UPDATE_JOB_ID);
    let operatorHandoff: OperationReceipt['operatorHandoff'] = 'not-required';
    // Schedule the privileged handoff while the lease/operation are still
    // active; the helper waits on the authoritative terminal operation and job.
    if (nextEnv.OR3_DASHBOARD_UPDATES_ENABLED === 'true' && hadDashboardJob) {
      try {
        await scheduleDashboardOperatorHandoff(loaded.directory, nextEnv);
        operatorHandoff = 'pending';
      } catch (error) {
        operatorHandoff = 'needs-attention';
        warnings.push({
          code: 'operator-handoff-schedule-failed',
          severity: 'warning',
          resource: pending.id,
          message: `The application is upgraded, but the dashboard operator handoff could not be scheduled: ${redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv))}. Run "npx @or3/cloud recover --finish" on the host.`,
          nextCommand: 'npx @or3/cloud recover --finish',
        });
      }
    }

    const sourceVersion = state.appVersion;
    const sourceImage = state.image;
    const sourceDigest = state.imageDigest;
    const receipt: OperationReceipt = {
      schemaVersion: 1,
      operationId: pending.id,
      dashboardJobId: process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim() || undefined,
      cliVersion: PACKAGE_VERSION,
      source: {
        appVersion: sourceVersion,
        image: sourceImage,
        imageDigest: sourceDigest,
        sourceRevision: packagedSourceRevision(sourceVersion),
        operatorImageDigest: expectedOperatorImageDigest(sourceVersion),
      },
      target: {
        appVersion: targetVersion,
        image: targetImage,
        imageDigest: digest,
        sourceRevision: packagedSourceRevision(targetVersion),
        operatorImageDigest: expectedOperatorImageDigest(targetVersion),
      },
      observed: { appVersion: targetVersion, image: targetImage, imageDigest: digest },
      completedAt: now(),
      rollbackBackupId: backup.backupId,
      checks: targetReadyEvidence.checks,
      warnings,
      phaseDurationsMs: { 'replace-and-verify': Date.now() - startedAtMs },
      operatorHandoff,
    };
    state.rollback = {
      appVersion: sourceVersion,
      image: sourceImage,
      imageDigest: sourceDigest,
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
    // Terminal commit before any cleanup: target identity, rollback reference,
    // receipt, and absence of a pending operation land in one atomic write.
    let commit: { committed: true; operationId?: string };
    try {
      commit = await commitTerminalState(loaded.directory, state, receipt);
    } catch (error) {
      throw new Error(`OR3 ${targetVersion} replaced the running release, but the terminal state write could not be confirmed. Recovery evidence was preserved; re-run status/doctor and "npx @or3/cloud recover" to resolve the durable outcome before any further mutation. ${redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv))}`);
    }
    // The application commit has succeeded; the following are housekeeping and
    // operational results only. They never reopen pending state.
    try {
      await removeOperationRecord(loaded.directory, commit.operationId);
    } catch (error) {
      warnings.push({ code: 'operation-mirror-delete-failed', severity: 'warning', resource: commit.operationId, message: redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv)) });
    }
    const prune = await pruneBackups(loaded.directory, state, BACKUP_RETENTION_KEEP, false, { automatic: true, log: progress, warn: progress }).catch((error) => {
      warnings.push({ code: 'retention-failed', severity: 'warning', message: redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv)) });
      return { removed: 0, deferred: [] } as PruneResult;
    });
    for (const diagnostic of prune.deferred) warnings.push(diagnostic);
    progress(`OR3 updated to ${targetVersion}. Image digest: ${digest}`);
    progress(`Rollback point: ${backup.backupId}. Keep it until login, chat, and file checks pass.`);
    progress('Not checked: live OpenRouter authorization (complete it in the browser).');
    if (warnings.length > 0) {
      warnings.forEach((warning) => console.warn(`⚠ ${warning.code}: ${warning.message}`));
    }
    // Persist any post-commit maintenance warnings into the authoritative
    // receipt before reporting, so a reload or the dashboard still sees them.
    await persistReceiptWarnings(loaded.directory, state, warnings);
    if (asJson) {
      const outcome: OperationOutcome = warnings.length > 0
        ? { kind: 'completed-with-warnings', receipt, warnings }
        : { kind: 'completed', receipt };
      emitOperationResult(outcome);
    } else if (warnings.length > 0) {
      console.log(`Update complete with ${warnings.length} maintenance warning(s).`);
      console.log('Next: npx @or3/cloud backup list');
    } else {
      console.log('Update complete. No maintenance warnings.');
    }
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

export function assertDashboardOperatorMounts(mounts: Array<{ Destination?: string }>, directory: string) {
  const destinations = new Set(mounts.map((mount) => mount.Destination));
  for (const destination of ['/var/run/docker.sock', resolve(directory), '/run/or3-operator']) {
    if (!destinations.has(destination)) throw new Error(`Dashboard operator is missing its required ${destination} mount.`);
  }
}

export async function recordedBackupPath(directory: string, pending: PendingOperation) {
  // Updates have one pre-update backup. Restore/rollback have a requested
  // target backup plus a separate snapshot of the deployment being replaced.
  const previous = pending.operation !== 'update';
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
  const previous = await recordedBackupPath(directory, pending);
  await updatePending(directory, state, { phase: 'restoring-previous' });
  if (pending.recreateDataVolume) {
    await restoreBackupData(directory, state, env, previous.path, { recreateDataVolume: true });
    return previous;
  }
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
  assertRestorableManagedAssets(manifest);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
  const recreateDataVolume = restoreRequiresVolumeRecreation(loaded.env, backupEnv);
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
    recreateDataVolume,
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
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath, { recreateDataVolume });
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const digest = await imageDigest(restoredEnv.OR3_IMAGE);
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', digest);
    nextState.lastError = undefined;
    // Terminal state first; the redundant mirror is warning-only housekeeping so
    // its failure cannot send a completed restore into the destructive handler.
    await writeState(loaded.directory, nextState);
    await removeOperationRecordSafely(loaded.directory, pending.id);
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
  assertRestorableManagedAssets(manifest);
  if (manifest.appVersion !== point.appVersion || manifest.image !== point.image || manifest.imageDigest !== point.imageDigest) {
    throw new Error(`Rollback point ${point.backupId} no longer matches its recorded image/version. Refusing to mutate the deployment.`);
  }
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
  const recreateDataVolume = restoreRequiresVolumeRecreation(loaded.env, backupEnv);
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
    recreateDataVolume,
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
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath, { recreateDataVolume });
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', await imageDigest(restoredEnv.OR3_IMAGE));
    nextState.rollback = undefined;
    // Terminal state first; the redundant mirror is warning-only housekeeping so
    // its failure cannot send a completed rollback into the destructive handler.
    await writeState(loaded.directory, nextState);
    await removeOperationRecordSafely(loaded.directory, pending.id);
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
  for (const file of [paths.env, paths.state, join(resolved, '.or3-initial-credentials')]) {
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
      try {
        const operatorEnabled = env.OR3_DASHBOARD_UPDATES_ENABLED === 'true';
        const operatorContainer = await run('docker', [
          'ps', '-aq',
          '--filter', `label=com.docker.compose.project=${state.composeProject}`,
          '--filter', 'label=com.docker.compose.service=or3-operator',
        ], resolved);
        if (!operatorContainer.ok) throw new Error(`Could not inspect the dashboard operator service. ${operatorContainer.stderr.trim()}`);
        const containerId = operatorContainer.stdout.trim();
        if (!operatorEnabled) {
          if (containerId) throw new Error('A dashboard operator container exists even though the bridge is disabled.');
          console.log('✓ Dashboard operator is disabled with no orphaned service');
        } else {
          if (!containerId) throw new Error('Dashboard updates are enabled but the operator container is missing.');
          const inspected = await run('docker', ['inspect', containerId]);
          if (!inspected.ok) throw new Error(`Could not inspect dashboard operator container ${containerId}.`);
          const container = JSON.parse(inspected.stdout)?.[0] as {
            Config?: { Image?: string; Labels?: Record<string, string> };
            Mounts?: Array<{ Destination?: string }>;
          };
          if (container.Config?.Image !== env.OR3_OPERATOR_IMAGE) throw new Error('Dashboard operator runtime image does not match the digest-qualified managed environment.');
          if (state.deploymentId && container.Config?.Labels?.['io.or3.cloud.deployment-id'] !== state.deploymentId) {
            throw new Error('Dashboard operator deployment identity does not match managed state.');
          }
          assertDashboardOperatorMounts(container.Mounts ?? [], resolved);
          const ipcDirectory = await stat(paths.operatorIpc);
          const operatorSocket = await stat(join(paths.operatorIpc, 'operator.sock'));
          const operatorUid = Number(env.OR3_OPERATOR_UID);
          const operatorGid = Number(env.OR3_OPERATOR_GID);
          if (
            (ipcDirectory.mode & 0o777) !== 0o710
            || ipcDirectory.uid !== operatorUid
            || ipcDirectory.gid !== operatorGid
            || !operatorSocket.isSocket()
            || (operatorSocket.mode & 0o777) !== 0o660
            || operatorSocket.uid !== operatorUid
            || operatorSocket.gid !== operatorGid
          ) {
            throw new Error('Dashboard operator IPC ownership boundary has unexpected owners, types, or modes.');
          }
          console.log('✓ Dashboard operator image, identity, mounts, and IPC modes are valid');
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Dashboard operator boundary is invalid');
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
        const mapping = await run('docker', composeArgs(resolved, state.mode, ['port', 'caddy', String(port)]), resolved);
        if (!mapping.ok || !mapping.stdout.trim().split(/\r?\n/).some((line) => line.trim().endsWith(`:${port}`))) {
          failures.push(`Caddy does not publish TCP ${port} through the selected Docker daemon.`);
          console.log(`✗ Caddy does not publish TCP ${port}`);
        } else {
          console.log(`✓ Caddy publishes TCP ${port}`);
        }
      }
      try {
        const response = await verificationFetch(new URL(`https://${state.domain}`));
        if (response.status !== 200) throw new Error(`Public HTTPS root returned HTTP ${response.status}; redirects are not accepted.`);
        console.log('✓ Public HTTPS root returns HTTP 200 without redirects');
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        console.log('✗ Public HTTPS root is unreachable or redirects');
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

export function sameOriginVerificationUrl(baseUrl: URL, value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`Filesystem storage did not return a ${label} URL.`);
  const url = new URL(value, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error(`Filesystem storage returned a cross-origin ${label} URL. Refusing to send the verification session to ${url.origin}.`);
  }
  return url;
}

export function assertVerificationGrant(value: Record<string, any>, expectedMethod: 'GET' | 'PUT', label: string) {
  if (value.method !== undefined && value.method !== expectedMethod) {
    throw new Error(`Filesystem storage returned unexpected ${label} method ${String(value.method)}.`);
  }
  if (value.headers !== undefined && (!value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers) || Object.keys(value.headers).length > 0)) {
    throw new Error(`Filesystem storage returned unexpected ${label} headers.`);
  }
}

async function verificationCredentials(directory: string, flags: Flags, env: Record<string, string>) {
  const passwordFile = stringFlag(flags, 'verification-password-file');
  if (flags['verification-email'] !== undefined && !stringFlag(flags, 'verification-email')) {
    throw new Error('--verification-email requires a value.');
  }
  if (flags['verification-password-file'] !== undefined && !passwordFile) {
    throw new Error('--verification-password-file requires a path.');
  }
  const configuredEmail = stringFlag(flags, 'verification-email')?.trim()
    || env.OR3_MANAGED_OWNER_EMAIL
    || env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  let initialCredentials: Record<string, string> = {};
  if ((!configuredEmail || (!passwordFile && !env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD))) {
    const initialCredentialsPath = join(directory, '.or3-initial-credentials');
    if (await fileExists(initialCredentialsPath)) {
      initialCredentials = parseEnv(await readOwnerOnlyText(initialCredentialsPath, 'The initial credentials file'));
    }
  }
  const email = configuredEmail || initialCredentials.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  if (!email) throw new Error('A current owner email is required for verification.');
  validateEmail(email);
  const password = passwordFile
    ? (await readOwnerOnlyText(resolve(passwordFile), 'The verification password file')).trim()
    : env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD || initialCredentials.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD;
  if (!password) {
    throw new Error('A current owner password is required. Pass --verification-password-file after changing the bootstrap password.');
  }
  if (password.includes('\0') || /\r|\n/.test(password)) throw new Error('The verification password file must contain exactly one password line.');
  return { email, password };
}

async function verifyPublicApplication(baseUrl: URL, credentials: { email: string; password: string }) {
  const root = await verificationFetch(baseUrl);
  if (root.status !== 200) throw new Error(`${baseUrl} returned HTTP ${root.status}; redirects are not accepted during verification.`);

  const health = validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
  const { email, password } = credentials;
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

  try {
    const session = await verificationJson(baseUrl, '/api/auth/session', { cookie });
    if (session.session?.user?.email !== email || !session.session?.workspace?.id) {
      throw new Error('Public session hydration did not return the verification user and workspace.');
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
    let metadataAttempted = false;
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
      storageId = typeof presign.storageId === 'string' && presign.storageId.trim() ? presign.storageId : undefined;
      if (!storageId) throw new Error('Filesystem storage did not return a non-empty storage ID.');
      assertVerificationGrant(presign, 'PUT', 'upload');
      const upload = await verificationFetch(sameOriginVerificationUrl(baseUrl, presign.url, 'upload'), {
        method: 'PUT',
        headers: { 'content-type': 'image/png', cookie },
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
      const metadataCreatedAt = Date.now();
      const metadataOpId = randomUUID();
      metadataAttempted = true;
      const pushed = await verificationJson(baseUrl, '/api/sync/push', {
        cookie,
        body: {
          scope: { workspaceId },
          ops: [{
            id: `or3-verification-${metadataOpId}`,
            tableName: 'file_meta',
            operation: 'put',
            pk: hash,
            payload: {
              hash,
              kind: 'image',
              mime_type: 'image/png',
              size_bytes: probeBytes.length,
              storage_id: storageId,
              name: 'or3-production-verification.png',
              deleted: false,
              created_at: metadataCreatedAt,
              updated_at: metadataCreatedAt,
              clock: metadataCreatedAt,
            },
            stamp: {
              deviceId: 'or3-cloud-verification',
              opId: metadataOpId,
              hlc: `${String(metadataCreatedAt).padStart(13, '0')}:0000:or3-cloud-verification`,
              clock: metadataCreatedAt,
            },
            createdAt: metadataCreatedAt,
            attempts: 0,
            status: 'pending',
          }],
        },
      });
      if (pushed.results?.[0]?.success !== true) {
        throw new Error(`Filesystem verification metadata sync failed: ${JSON.stringify(pushed)}`);
      }
      const downloadGrant = await verificationJson(baseUrl, '/api/storage/presign-download', {
        cookie,
        body: { workspace_id: workspaceId, hash, storage_id: storageId, disposition: 'attachment' },
      });
      assertVerificationGrant(downloadGrant, 'GET', 'download');
      const download = await verificationFetch(sameOriginVerificationUrl(baseUrl, downloadGrant.url, 'download'), { headers: { cookie } });
      if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(probeBytes)) {
        throw new Error('Filesystem verification download did not match the uploaded probe.');
      }
    } finally {
      if (storageId) {
        try {
          await verificationJson(baseUrl, '/api/storage/delete', {
            cookie,
            body: { workspace_id: workspaceId, hash, storage_id: storageId },
          });
        } finally {
          if (metadataAttempted) {
            const metadataDeleteAt = Date.now();
            const metadataDeleteOpId = randomUUID();
            const deleted = await verificationJson(baseUrl, '/api/sync/push', {
              cookie,
              body: {
                scope: { workspaceId },
                ops: [{
                  id: `or3-verification-${metadataDeleteOpId}`,
                  tableName: 'file_meta',
                  operation: 'delete',
                  pk: hash,
                  payload: { hash },
                  stamp: {
                    deviceId: 'or3-cloud-verification',
                    opId: metadataDeleteOpId,
                    hlc: `${String(metadataDeleteAt).padStart(13, '0')}:0000:or3-cloud-verification`,
                    clock: metadataDeleteAt,
                  },
                  createdAt: metadataDeleteAt,
                  attempts: 0,
                  status: 'pending',
                }],
              },
            });
            if (deleted.results?.[0]?.success !== true) {
              throw new Error(`Filesystem verification metadata cleanup failed: ${JSON.stringify(deleted)}`);
            }
          }
        }
      }
    }
    return health;
  } finally {
    await verificationJson(baseUrl, '/api/basic-auth/sign-out', {
      cookie,
      method: 'POST',
    });
  }
}

function responseCookie(response: Response, label: string) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie')].filter((value): value is string => Boolean(value));
  const cookie = values.map((value) => value.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error(`${label} did not set a session cookie.`);
  return cookie;
}

async function provisionManagedCredentialsOnce(
  baseUrl: URL,
  email: string,
  password: string,
  adminUsername = email,
  adminPassword = password,
) {
  const appSignIn = await verificationFetch(new URL('/api/basic-auth/sign-in', baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  if (appSignIn.status !== 200) throw new Error(`Managed owner provisioning returned HTTP ${appSignIn.status}.`);
  const appCookie = responseCookie(appSignIn, 'Managed owner provisioning');
  try {
    const session = await verificationJson(baseUrl, '/api/auth/session', { cookie: appCookie });
    if (session.session?.user?.email !== email || !session.session?.workspace?.id) {
      throw new Error('Managed owner provisioning did not create the expected account and workspace.');
    }
  } finally {
    await verificationJson(baseUrl, '/api/basic-auth/sign-out', { cookie: appCookie, method: 'POST' });
  }

  const adminSignIn = await verificationFetch(new URL('/api/admin/auth/login', baseUrl), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  if (adminSignIn.status !== 200) throw new Error(`Managed admin provisioning returned HTTP ${adminSignIn.status}.`);
  const adminCookie = responseCookie(adminSignIn, 'Managed admin provisioning');
  await verificationJson(baseUrl, '/api/admin/auth/logout', { cookie: adminCookie, method: 'POST' });
}

async function provisionManagedCredentials(
  baseUrl: URL,
  email: string,
  password: string,
  adminUsername = email,
  adminPassword = password,
) {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  do {
    try {
      await provisionManagedCredentialsOnce(baseUrl, email, password, adminUsername, adminPassword);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
  } while (Date.now() < deadline);
  throw new Error(`Managed credential provisioning did not become ready within 60 seconds: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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
  await verifyPublicApplication(baseUrl, await verificationCredentials(loaded.directory, flags, loaded.env));
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

/**
 * Explicitly read-only verification (R4.AC1–AC2). It never acquires or
 * reclaims the lease, logs in, uploads probes, opens SQLite read/write, pulls
 * images, creates helper containers, or repairs files. Checks that would
 * require one of those are reported as deferred/unknown instead of passed.
 */
async function verifyReadOnlyCommand(directory: string, flags: Flags) {
  const observation = await observeDeployment(directory, { checkDocker: true, checkImage: true });
  const state = observation.state;
  if (!state) {
    throw new Error(`Read-only verification needs readable managed state.${observation.stateError ? ` ${observation.stateError}` : ''} Run "npx @or3/cloud doctor" for diagnostics.`);
  }
  if (boolFlag(flags, 'public') && state.mode !== 'public') throw new Error('--public requires a managed public deployment.');
  const checks: CheckResult[] = [];
  const findings = observationFindings(observation);

  checks.push(observation.identityMatches === true
    ? { code: 'image-digest', status: 'passed', detail: `Recorded digest matches the local image (${state.imageDigest}).` }
    : observation.identityMatches === false
      ? { code: 'image-digest', status: 'failed', detail: `Recorded ${observation.recordedImageDigest} does not match local ${observation.actualImageDigest}.` }
      : { code: 'image-digest', status: 'unknown', detail: 'The managed image could not be inspected safely.' });

  const baseUrl = new URL(
    state.mode === 'public' ? `https://${state.domain}` : `http://127.0.0.1:${state.port}`,
  );
  try {
    const root = await verificationFetch(baseUrl);
    checks.push(root.status === 200
      ? { code: 'http-root', status: 'passed', detail: `${baseUrl.origin} returned HTTP 200 without redirects.` }
      : { code: 'http-root', status: 'failed', detail: `${baseUrl.origin} returned HTTP ${root.status}.` });
  } catch (error) {
    checks.push({ code: 'http-root', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  try {
    validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
    checks.push({ code: 'deep-health', status: 'passed', detail: 'Deep health reports the managed Basic Auth + SQLite + filesystem profile.' });
  } catch (error) {
    checks.push({ code: 'deep-health', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  // Deliberately skipped (not failures): these require writes, credentials, or
  // container exec, so read-only verification reports them as deferred and does
  // not fail the run for them.
  checks.push({ code: 'auth-and-storage-journey', status: 'deferred', detail: 'Sign-in, sync, and storage probes are excluded from read-only verification.' });
  checks.push({ code: 'sqlite-integrity', status: 'deferred', detail: 'SQLite inspection is deferred because a safe read-only mechanism is unavailable.' });
  checks.push({ code: 'bounded-logs', status: 'deferred', detail: 'Log scanning is deliberately skipped by read-only verification; run full verify for it.' });

  if (boolFlag(flags, 'json')) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'or3-verify-read-only',
      observedAt: observation.observedAt,
      directory: observation.directory,
      readOnly: true,
      checks,
      findings,
    }, null, 2));
  } else {
    for (const check of checks) console.log(`  [${check.status}] ${check.code}: ${check.detail}`);
    for (const finding of findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
  }
  // Only an actual failure is nonzero. Deliberately deferred/skipped checks and
  // an inconclusive (unknown) observation must not fail a read-only run.
  if (checks.some((check) => check.status === 'failed')) {
    process.exitCode = 1;
  }
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
    adminUsername: targetEnv.OR3_ADMIN_USERNAME,
    adminPassword: targetEnv.OR3_ADMIN_PASSWORD,
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
    const localDockerDaemon = await dockerDaemonIsLocal();
    if (localDockerDaemon && !await portAvailable(Number(targetEnv.OR3_PORT))) throw new Error(`Port ${targetEnv.OR3_PORT} is still in use after stopping the V1 deployment.`);
    if (mode === 'public' && localDockerDaemon) {
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
    await provisionManagedCredentials(
      mode === 'public' ? new URL(`https://${domain}`) : new URL(`http://127.0.0.1:${sourcePort}`),
      email,
      password,
      targetEnv.OR3_ADMIN_USERNAME,
      targetEnv.OR3_ADMIN_PASSWORD,
    );
    const runtimeEnv = withoutProvisioningCredentials(targetEnv);
    await writeSecure(deploymentPaths(targetDirectory).env, serializeEnv(runtimeEnv));
    await stopProject(targetDirectory, mode);
    await startProject(targetDirectory, mode, runtimeEnv);
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
  const ownerPasswordFile = stringFlag(flags, 'owner-password-file');
  const adminPassword = stringFlag(flags, 'admin-password');
  const adminPasswordFile = stringFlag(flags, 'admin-password-file');
  if (flags['owner-password'] !== undefined && ownerPassword === undefined) throw new Error('--owner-password requires a value.');
  if (flags['admin-password'] !== undefined && adminPassword === undefined) throw new Error('--admin-password requires a value.');
  if (flags['owner-password-file'] !== undefined && !ownerPasswordFile) throw new Error('--owner-password-file requires a path.');
  if (flags['admin-password-file'] !== undefined && !adminPasswordFile) throw new Error('--admin-password-file requires a path.');
  if (ownerPassword !== undefined && ownerPasswordFile) throw new Error('Use either --owner-password or --owner-password-file, not both.');
  if (adminPassword !== undefined && adminPasswordFile) throw new Error('Use either --admin-password or --admin-password-file, not both.');
  const suppliedOwner = ownerPassword ?? (ownerPasswordFile ? (await readText(resolve(ownerPasswordFile))).trim() : undefined);
  const suppliedAdmin = adminPassword ?? (adminPasswordFile ? (await readText(resolve(adminPasswordFile))).trim() : undefined);
  if (suppliedOwner !== undefined || suppliedAdmin !== undefined) {
    if (suppliedOwner === undefined || suppliedAdmin === undefined) {
      throw new Error('Supply both owner and admin passwords so a reset never applies one credential without the other.');
    }
    validatePassword(suppliedOwner);
    validatePassword(suppliedAdmin);
    return { ownerPassword: suppliedOwner, adminPassword: suppliedAdmin };
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('--owner-password-file and --admin-password-file are required in a non-interactive session. Credentials are never generated automatically.');
  }
  const owner = (await maskedQuestion('New owner (basic auth) password: ')).trim();
  validatePassword(owner);
  const admin = (await maskedQuestion('New admin password: ')).trim();
  validatePassword(admin);
  return { ownerPassword: owner, adminPassword: admin };
}

async function maskedQuestion(question: string) {
  let muted = false;
  const maskedOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  const prompt = readline.createInterface({ input, output: maskedOutput, terminal: true });
  try {
    const answer = prompt.question(question);
    muted = true;
    return await answer;
  } finally {
    prompt.close();
    output.write('\n');
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
const atomicWrite = (target, contents) => {
  const temporary = target + '.reset-' + process.pid + '-' + Date.now();
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  const directory = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
};
try {
  db.transaction(() => {
    db.prepare('UPDATE basic_auth_accounts SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(ownerHash, now, account.id);
    db.prepare('UPDATE basic_auth_sessions SET revoked_at = COALESCE(revoked_at, ?), rotation_grace_until = NULL, rotation_grace_refresh_token = NULL WHERE account_id = ?').run(now, account.id);
    atomicWrite(adminCredentialsPath, JSON.stringify(credentials, null, 2) + '\\n');
  })();
} catch (error) {
  if (previousCredentials !== null) {
    try { atomicWrite(adminCredentialsPath, previousCredentials); } catch {}
  } else {
    try { fs.rmSync(adminCredentialsPath, { force: true }); } catch {}
  }
  console.error('OR3 credentials reset failed: the atomic database/file update did not complete. Replay is safe through the managed recovery journal. ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
db.close();
console.log('credentials-reset: owner hash, sessions, and admin credentials updated.');
`;
}

function credentialResetValues(env: Record<string, string>) {
  const ownerEmail = env.OR3_MANAGED_OWNER_EMAIL || env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
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
  const resetEnvironment = {
    ...composeProcessEnv(directory),
    OR3_RESET_OWNER_EMAIL: values.ownerEmail,
    OR3_RESET_OWNER_PASSWORD: values.ownerPassword,
    OR3_RESET_ADMIN_USERNAME: values.adminUsername,
    OR3_RESET_ADMIN_PASSWORD: values.adminPassword,
  };
  const result = await run('docker', [
    ...composeArgs(directory, mode, [
      'exec', '-T',
      '-e', 'OR3_RESET_OWNER_EMAIL',
      '-e', 'OR3_RESET_OWNER_PASSWORD',
      '-e', 'OR3_RESET_ADMIN_USERNAME',
      '-e', 'OR3_RESET_ADMIN_PASSWORD',
      'or3', ...containerNodeCommand(script),
    ]),
  ], directory, resetEnvironment);
  if (!result.ok) throw new Error(`${result.command}\n${redact(result.stderr, [values.ownerPassword, values.adminPassword])}`);
}

async function verifyCredentialsInsideContainer(directory: string, mode: Mode, values: ReturnType<typeof credentialResetValues>) {
  const resetEnvironment = {
    ...composeProcessEnv(directory),
    OR3_RESET_OWNER_EMAIL: values.ownerEmail,
    OR3_RESET_OWNER_PASSWORD: values.ownerPassword,
    OR3_RESET_ADMIN_USERNAME: values.adminUsername,
    OR3_RESET_ADMIN_PASSWORD: values.adminPassword,
  };
  const result = await run('docker', [
    ...composeArgs(directory, mode, [
      'exec', '-T',
      '-e', 'OR3_RESET_OWNER_EMAIL',
      '-e', 'OR3_RESET_OWNER_PASSWORD',
      '-e', 'OR3_RESET_ADMIN_USERNAME',
      '-e', 'OR3_RESET_ADMIN_PASSWORD',
      'or3', ...containerNodeCommand(CREDENTIALS_VERIFY_SCRIPT),
    ]),
  ], directory, resetEnvironment);
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
  const runtimeEnv = withoutProvisioningCredentials(nextEnv);
  await writeSecure(deploymentPaths(directory).env, serializeEnv(runtimeEnv));
  const initialCredentials = join(directory, '.or3-initial-credentials');
  // The caller supplied the new values; retaining another credential copy
  // after rotation only expands the secret blast radius.
  await rm(initialCredentials, { force: true });
  await stopProject(directory, state.mode);
  await startProject(directory, state.mode, runtimeEnv);
  await verifyCredentialsInsideContainer(directory, state.mode, values);
}

async function credentialsResetCommand(directory: string, flags: Flags) {
  if (!boolFlag(flags, 'yes')) throw new Error('Credentials reset changes the owner password, revokes all app sessions, and changes the admin password. Re-run with --yes after confirming the impact.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  const ownerEmail = loaded.env.OR3_MANAGED_OWNER_EMAIL || loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL;
  const adminUsername = loaded.env.OR3_ADMIN_USERNAME;
  if (!ownerEmail) throw new Error('The managed owner email is missing from .env, so the owner account cannot be reset.');
  if (!adminUsername) throw new Error('OR3_ADMIN_USERNAME is missing from .env, so the admin password cannot be reset.');
  const { ownerPassword, adminPassword } = await resolveResetPasswords(flags);
  const nextEnv = {
    ...loaded.env,
    OR3_MANAGED_OWNER_EMAIL: ownerEmail,
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
    console.log('Admin session cookies were invalidated by rotating OR3_ADMIN_JWT_SECRET. New passwords persist only as account hashes; sign in again with them.');
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

/**
 * Reports deployment summary, container status, and a bounded deep-health
 * probe. Uses independent observations so a corrupt state/env/backup source
 * still reports the evidence that is readable, and labels a live lease as
 * in-progress rather than authoritative.
 */
async function statusCommand(directory: string, flags: Flags = {}) {
  const observation = await observeDeployment(directory, { checkDocker: true, checkImage: true });
  const findings = observationFindings(observation);
  const state = observation.state;
  if (boolFlag(flags, 'json')) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'or3-deployment-status',
      observedAt: observation.observedAt,
      partial: observation.partial,
      inProgress: observation.changing,
      directory: observation.directory,
      state: state ? publicStateProjection(state) : null,
      stateError: observation.stateError,
      envError: observation.envError,
      lease: observation.lease.status,
      docker: observation.docker,
      recordedImageDigest: observation.recordedImageDigest,
      actualImageDigest: observation.actualImageDigest,
      identityMatches: observation.identityMatches,
      lastReceipt: state?.lastReceipt ?? null,
      backups: observation.backups,
      findings,
    }, null, 2));
    return;
  }
  console.log(`OR3 Cloud deployment: ${observation.directory}`);
  if (observation.changing) console.log('  status: in progress (a mutation lease is active; this observation is not authoritative)');
  if (!state) {
    console.log(`  state: unreadable${observation.stateError ? ` — ${observation.stateError}` : ''}`);
  } else {
    console.log(`  mode: ${state.mode}`);
    console.log(`  version: ${state.appVersion}`);
    if (state.domain) console.log(`  domain: ${state.domain}`);
    console.log(`  port: ${state.port}`);
    console.log(`  image digest: ${state.imageDigest}`);
    console.log(`  last successful operation: ${state.lastSuccessfulOperation} (${state.updatedAt})`);
    if (state.incompleteOperation) console.log(`  incomplete operation: ${state.incompleteOperation.operation} (${state.incompleteOperation.id})`);
    if (state.lastError) console.log(`  last error: ${state.lastError}`);
  }
  if (observation.envError) console.log(`  environment: unreadable — ${observation.envError}`);
  if (observation.identityMatches === false) console.log(`  image: MISMATCH (recorded ${observation.recordedImageDigest}, local ${observation.actualImageDigest})`);
  else if (observation.identityMatches === true) console.log('  image: digest matches managed state');
  console.log();
  if (state && observation.docker && observation.env) {
    try {
      const ps = await run('docker', [...composeArgs(directory, state.mode, ['ps'])], directory);
      console.log(ps.ok ? ps.stdout.trim() : `Could not list containers: ${ps.stderr}`);
      const health = await probeDeepHealth(directory, state.mode);
      if (health === 'ok') console.log('Deep health: OK');
      else if (health === 'degraded') console.log('Deep health: DEGRADED (the container is running but /api/health?deep=true is failing).');
      else console.log('Deep health: unreachable (the or3 container is not running).');
      await printMaintenanceSummary(directory, state.mode);
    } catch (error) {
      // Compose needs the managed .env for the project name; a failure here is
      // reported as a skipped check rather than failing the whole status.
      console.log(`Container and health checks were skipped: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  } else if (state && !observation.docker) {
    console.log('Docker is unavailable; container and health checks were skipped.');
  } else if (state && !observation.env) {
    console.log('The managed environment is unreadable; container and health checks were skipped.');
  }
  for (const finding of findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
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
  const loaded = await loadManaged(directory, { writable: false });
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
  assertPhaseAllowsCommand('start', loaded.state);
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
  assertPhaseAllowsCommand('restart', loaded.state);
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
      if (command === 'update') {
        if (boolFlag(parsed.flags, 'dry-run')) return await updatePreviewCommand(process.cwd(), parsed.flags);
        return await updateCommand(process.cwd(), parsed.flags);
      }
      if (command === 'backup') return await backupCommand(process.cwd(), parsed.positionals, parsed.flags);
      if (command === 'restore') return await restoreCommand(process.cwd(), parsed.flags, parsed.positionals);
      if (command === 'rollback') return await rollbackCommand(process.cwd(), parsed.flags);
      if (command === 'credentials') return await credentialsCommand(process.cwd(), parsed.positionals, parsed.flags);
      if (command === 'doctor') return await doctorCommand(process.cwd());
      if (command === 'verify') {
        if (verifyIsReadOnly(parsed.flags)) return await verifyReadOnlyCommand(process.cwd(), parsed.flags);
        return await verifyCommand(process.cwd(), parsed.flags, parsed.positionals);
      }
      if (command === 'recover') return await recoverCommand(process.cwd(), parsed.flags);
      if (command === 'adopt') return await adoptCommand(parsed.positionals, parsed.flags);
      if (command === 'status') return await statusCommand(process.cwd(), parsed.flags);
      if (command === 'logs') return await logsCommand(process.cwd(), parsed.flags, parsed.positionals);
      if (command === 'start') return await startCommand(process.cwd());
      if (command === 'stop') return await stopCommand(process.cwd());
      if (command === 'restart') return await restartCommand(process.cwd());
      if (command === 'remove') return await removeCommand(process.cwd(), parsed.flags);
      throw new Error(`Unknown command "${command}". Run npx @or3/cloud --help.`);
    };
    // Read-only previews and verification bypass the deployment lease entirely;
    // they must never acquire, reclaim, or rewrite the single-writer lock.
    const readOnlyInvocation = (command === 'verify' && verifyIsReadOnly(parsed.flags))
      || (command === 'update' && boolFlag(parsed.flags, 'dry-run'))
      || (command === 'recover' && boolFlag(parsed.flags, 'dry-run'))
      // Backup inventory is an observation: it must not acquire or reclaim the
      // mutation lease while an operation is pending.
      || (command === 'backup' && parsed.positionals[0] === 'list');
    if (!readOnlyInvocation && MUTATING_COMMANDS.has(command)) {
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
