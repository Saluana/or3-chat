import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { id, randomSecret } from '../util/primitives';
import type { Mode } from './contracts';
import { composeProjectNames, imageFor } from './identity';

export const DEFAULT_PORT = 3000;

const PROVISIONING_CREDENTIAL_KEYS = [
  'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
  'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_ADMIN_PASSWORD',
] as const;
export const SECRET_KEYS = [
  'OR3_BASIC_AUTH_JWT_SECRET',
  'OR3_BASIC_AUTH_REFRESH_SECRET',
  'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_AUTH_INVITE_TOKEN_SECRET',
  'OR3_STORAGE_FS_TOKEN_SECRET',
  'OR3_STORAGE_S3_ACCESS_KEY_ID',
  'OR3_STORAGE_S3_SECRET_ACCESS_KEY',
  'OR3_STORAGE_S3_SESSION_TOKEN',
  'NUXT_CLERK_SECRET_KEY',
  'NUXT_AUTH_INVITE_TOKEN_SECRET',
  'NUXT_ADMIN_AUTH_PASSWORD',
  'NUXT_ADMIN_AUTH_JWT_SECRET',
  'OR3_LIBRARY_LINK_SECRET',
  'NUXT_ADMIN_LIBRARY_LINK_SECRET',
  'OR3_PLUGIN_CONNECTION_SECRET',
  'NUXT_ADMIN_PLUGIN_CONNECTION_SECRET',
  'OR3_BACKGROUND_ENCRYPTION_KEY',
  'NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY',
  'OR3_WEBHOOKS_ENCRYPTION_KEY',
  'NUXT_WEBHOOKS_ENCRYPTION_KEY',
  'OR3_CONNECT_ENCRYPTION_KEY',
  'NUXT_CONNECT_ENCRYPTION_KEY',
  'OR3_CONNECT_CLOUDFLARE_API_TOKEN',
  'NUXT_CONNECT_CLOUDFLARE_API_TOKEN',
  'OPENROUTER_API_KEY',
  'NUXT_OPENROUTER_API_KEY',
  'OR3_OPENAI_API_KEY',
  'NUXT_OPENAI_API_KEY',
  'OR3_BILLING_STRIPE_SECRET_KEY',
  'OR3_BILLING_STRIPE_WEBHOOK_SECRET',
  'CONVEX_SELF_HOSTED_ADMIN_KEY',
  'CONVEX_DEPLOY_KEY',
  'OR3_ADMIN_JWT_SECRET',
  'OR3_ADMIN_PASSWORD',
];

export type ManagedProviderProfile = 'basic-sqlite-fs' | 'clerk-sqlite-s3';

/** The managed backup contract supports only these complete provider profiles. */
export function managedProviderProfile(env: Record<string, string>): ManagedProviderProfile {
  const auth = env.AUTH_PROVIDER ?? env.OR3_AUTH_PROVIDER ?? 'basic-auth';
  const sync = env.OR3_SYNC_PROVIDER ?? 'sqlite';
  const storage = env.NUXT_PUBLIC_STORAGE_PROVIDER ?? 'fs';
  if (env.AUTH_PROVIDER && env.OR3_AUTH_PROVIDER && env.AUTH_PROVIDER !== env.OR3_AUTH_PROVIDER || sync !== 'sqlite') {
    throw new Error('backup-profile-mismatch: unsupported or inconsistent managed provider profile.');
  }
  if (auth === 'basic-auth' && storage === 'fs') return 'basic-sqlite-fs';
  if (auth === 'clerk' && storage === 's3') return 'clerk-sqlite-s3';
  throw new Error('backup-profile-mismatch: unsupported managed provider profile.');
}

/** Schemas 1 and 2 cannot record or authorize a different provider profile. */
export function assertLegacyManagedProfile(env: Record<string, string>) {
  const overrides: Record<string, string> = {
    SSR_AUTH_ENABLED: 'true', OR3_SYNC_ENABLED: 'true', OR3_CLOUD_SYNC_ENABLED: 'true',
    OR3_STORAGE_ENABLED: 'true', OR3_CLOUD_STORAGE_ENABLED: 'true', OR3_SQLITE_DRIVER: 'better-sqlite3',
    OR3_STORAGE_PROVIDER: 'fs', NUXT_AUTH_ENABLED: 'true', NUXT_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_SSR_AUTH_ENABLED: 'true',
    NUXT_SYNC_ENABLED: 'true', NUXT_PUBLIC_SYNC_ENABLED: 'true', NUXT_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_SYNC_PROVIDER: 'sqlite',
    NUXT_STORAGE_ENABLED: 'true', NUXT_PUBLIC_STORAGE_ENABLED: 'true', NUXT_STORAGE_PROVIDER: 'fs',
  };
  const ambiguous = /^(?:RUNTIME_CONFIG$|NUXT_(?:AUTH|SYNC|STORAGE|PUBLIC)$|NITRO_ENV_(?:PREFIX|EXPANSION)$|NITRO_(?:AUTH|SYNC|STORAGE|PUBLIC)(?:_|$))/;
  if (managedProviderProfile(env) !== 'basic-sqlite-fs' ||
      Object.entries(overrides).some(([key, expected]) => env[key] !== undefined && env[key] !== expected) ||
      Object.keys(env).some((key) => ambiguous.test(key))) {
    throw new Error('Legacy managed state supports only the Basic/SQLite/filesystem profile; provider conversion requires a separate qualified deployment.');
  }
}

/** Retain the deployment-local S3 target when restoring authenticated config. */
export function restoreStorageConfiguration(backup: Record<string, string>, current: Record<string, string>): Record<string, string> {
  const sourceProvider = backup.NUXT_PUBLIC_STORAGE_PROVIDER;
  const targetProvider = current.NUXT_PUBLIC_STORAGE_PROVIDER;
  if (sourceProvider !== targetProvider && (sourceProvider === 's3' || targetProvider === 's3' || sourceProvider && targetProvider)) {
    throw new Error('backup-profile-mismatch: backup and deployment use different storage providers.');
  }
  if (sourceProvider !== 's3') return { ...backup };
  // Match the S3 provider's prefix normalization; stored IDs include it.
  const prefix = (value: string | undefined) => {
    const trimmed = (value ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    return trimmed ? `${trimmed}/` : '';
  };
  if (prefix(backup.OR3_STORAGE_S3_KEY_PREFIX) !== prefix(current.OR3_STORAGE_S3_KEY_PREFIX)) {
    throw new Error('backup-prefix-mismatch: backup and target S3 key prefixes differ.');
  }
  const restored = Object.fromEntries(Object.entries(backup).filter(([key]) => !key.startsWith('OR3_STORAGE_S3_')));
  for (const [key, value] of Object.entries(current)) if (key.startsWith('OR3_STORAGE_S3_')) restored[key] = value;
  return restored;
}

export type DashboardOperatorEnv = {
  OR3_DASHBOARD_UPDATES_ENABLED: 'true';
  OR3_OPERATOR_IMAGE: string;
  OR3_DEPLOYMENT_DIR: string;
  OR3_OPERATOR_UID: string;
  OR3_OPERATOR_GID: string;
  OR3_DOCKER_SOCKET: string;
  OR3_DOCKER_GID: string;
};

// Adoption copies these values only after both resolved Compose and the
// existing container have been checked against the source environment.
export const ADOPTION_SECRET_KEYS = [
  'OR3_BASIC_AUTH_JWT_SECRET', 'OR3_BASIC_AUTH_REFRESH_SECRET', 'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
  'OR3_AUTH_INVITE_TOKEN_SECRET', 'OR3_STORAGE_FS_TOKEN_SECRET', 'OR3_ADMIN_PASSWORD', 'OR3_ADMIN_JWT_SECRET',
  'NUXT_AUTH_INVITE_TOKEN_SECRET', 'NUXT_ADMIN_AUTH_JWT_SECRET',
  'OR3_LIBRARY_LINK_SECRET', 'NUXT_ADMIN_LIBRARY_LINK_SECRET',
  'OR3_PLUGIN_CONNECTION_SECRET', 'NUXT_ADMIN_PLUGIN_CONNECTION_SECRET',
  'OR3_BACKGROUND_ENCRYPTION_KEY', 'NUXT_BACKGROUND_JOBS_ENCRYPTION_KEY',
  'OR3_WEBHOOKS_ENCRYPTION_KEY', 'NUXT_WEBHOOKS_ENCRYPTION_KEY',
  'OR3_CONNECT_ENCRYPTION_KEY', 'NUXT_CONNECT_ENCRYPTION_KEY',
  'OR3_CONNECT_CLOUDFLARE_API_TOKEN', 'NUXT_CONNECT_CLOUDFLARE_API_TOKEN',
  'OPENROUTER_API_KEY', 'NUXT_OPENROUTER_API_KEY', 'OR3_OPENAI_API_KEY', 'NUXT_OPENAI_API_KEY',
] as const;

export const ADOPTION_RUNTIME_KEYS = [
  'OR3_MARKETPLACE_REGISTRY_ORIGIN', 'OR3_MARKETPLACE_INSTALL_ENABLED',
  'OR3_MARKETPLACE_RELEASE_KEYS', 'OR3_INSTANCE_ID', 'OR3_MARKETPLACE_MAX_ARTIFACT_BYTES', 'OR3_MARKETPLACE_RESERVE_BYTES',
  'OR3_BACKGROUND_STREAMING_ENABLED', 'OR3_BACKGROUND_STREAMING_PROVIDER', 'OR3_BACKGROUND_MAX_JOBS', 'OR3_BACKGROUND_MAX_JOBS_PER_USER', 'OR3_BACKGROUND_JOB_TIMEOUT',
  'NUXT_BACKGROUND_JOBS_ENABLED', 'NUXT_PUBLIC_BACKGROUND_STREAMING_ENABLED', 'NUXT_BACKGROUND_JOBS_STORAGE_PROVIDER', 'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS', 'NUXT_BACKGROUND_JOBS_MAX_CONCURRENT_JOBS_PER_USER', 'NUXT_BACKGROUND_JOBS_JOB_TIMEOUT_MS',
  'OR3_PLUGIN_ALLOWED_MODELS', 'OR3_PLUGIN_MODEL_PRICES', 'NUXT_ADMIN_PLUGIN_ALLOWED_MODELS', 'NUXT_ADMIN_PLUGIN_MODEL_PRICES',
] as const;

export const ALLOWED_ENV_KEYS = new Set([
  ...ADOPTION_SECRET_KEYS,
  ...ADOPTION_RUNTIME_KEYS,
  'SSR_AUTH_ENABLED',
  'NUXT_SECRETS_PROVIDER',
  'NUXT_SECRETS_NAMESPACE',
  'NUXT_SECRETS_SOCKET_PATH',
  'NUXT_SECRETS_TOKEN_FILE',
  'NUXT_SECRETS_VAULT_ID',
  'NUXT_SECRETS_SERVICE_UID',
  'AUTH_PROVIDER',
  'OR3_AUTH_PROVIDER',
  'OR3_AUTH_REGISTRATION_MODE',
  'OR3_AUTH_AUTO_PROVISION',
  'OR3_GUEST_ACCESS_ENABLED',
  'OR3_BASIC_AUTH_JWT_SECRET',
  'OR3_BASIC_AUTH_REFRESH_SECRET',
  'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
  'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS',
  'OR3_SQLITE_DRIVER',
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
  'OR3_STORAGE_FS_CLEANUP_NAMESPACE_ID',
  'OR3_STORAGE_RETENTION_WORKSPACES',
  'OR3_STORAGE_FS_TOKEN_SECRET',
  'OR3_STORAGE_FS_URL_TTL_SECONDS',
  'OR3_ADMIN_USERNAME',
  'OR3_ADMIN_PASSWORD',
  'OR3_ADMIN_JWT_SECRET',
  'OR3_ADMIN_JWT_EXPIRY',
  'OR3_ADMIN_ALLOW_RESTART',
  'OR3_PUBLIC_DOMAIN',
  'OR3_ALLOWED_ORIGINS',
  'OR3_FORCE_HTTPS',
  'OR3_TRUST_PROXY',
  'OR3_FORWARDED_FOR_HEADER',
]);

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

export function serializeEnv(values: Record<string, string | undefined>) {
  return `${Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${serializeEnvValue(value)}`)
    .join('\n')}\n`;
}

export function dashboardUpdatesEnabled(directory: string) {
  try {
    return parseEnv(readFileSync(join(directory, '.env'), 'utf8')).OR3_DASHBOARD_UPDATES_ENABLED === 'true';
  } catch {
    return false;
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

export function withoutDashboardOperator(env: Record<string, string>) {
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

export function secretValues(env: Record<string, string>) {
  const known = new Set(SECRET_KEYS);
  const secretName = /(?:^|_)(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|AUTH_KEY)(?:_|$)/i;
  return Object.entries(env).filter(([key, value]) => Boolean(value) && (known.has(key) || secretName.test(key))).map(([, value]) => value);
}
