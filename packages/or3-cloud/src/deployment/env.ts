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
  'OR3_ADMIN_JWT_SECRET',
  'OR3_ADMIN_PASSWORD',
];

export type DashboardOperatorEnv = {
  OR3_DASHBOARD_UPDATES_ENABLED: 'true';
  OR3_OPERATOR_IMAGE: string;
  OR3_DEPLOYMENT_DIR: string;
  OR3_OPERATOR_UID: string;
  OR3_OPERATOR_GID: string;
  OR3_DOCKER_SOCKET: string;
  OR3_DOCKER_GID: string;
};

export const ALLOWED_ENV_KEYS = new Set([
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
  return SECRET_KEYS.map((key) => env[key]).filter((value): value is string => Boolean(value));
}
