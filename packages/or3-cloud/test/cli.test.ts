import { expect, test } from 'bun:test';
import {
  assertSupportedSource,
  assertSupportedSourceCompose,
  assertBackupMatchesDeployment,
  buildEnv,
  checkResolvedLoopbackBinding,
  isVersion,
  parseEnv,
  parseFlags,
  redact,
  serializeEnv,
  stateFromEnv,
} from '../src/cli';

test('round trips the generated env format without losing values', () => {
  const source = {
    OR3_VERSION: '0.1.12',
    OR3_ALLOWED_ORIGINS: 'https://cloud.example.com,http://127.0.0.1:3000',
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'A secret with no newline',
  };
  expect(parseEnv(serializeEnv(source))).toEqual(source);
});

test('serializes Compose-sensitive values literally and rejects newlines', () => {
  const source = { OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: "A$word with \\slashes and 'quotes' 123" };
  expect(parseEnv(serializeEnv(source))).toEqual(source);
  expect(() => serializeEnv({ SECRET: 'bad\nvalue' })).toThrow('newline');
});

test('builds the fixed local cloud profile with persistent paths', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  expect(env.AUTH_PROVIDER).toBe('basic-auth');
  expect(env.OR3_SYNC_PROVIDER).toBe('sqlite');
  expect(env.NUXT_PUBLIC_STORAGE_PROVIDER).toBe('fs');
  expect(env.OR3_BASIC_AUTH_DB_PATH).toBe('/data/auth.sqlite');
  expect(env.OR3_SQLITE_DB_PATH).toBe('/data/sync.sqlite');
  expect(env.OR3_STORAGE_FS_ROOT).toBe('/data/storage');
  expect(env.OR3_ADMIN_USERNAME).toBe('admin@example.com');
  expect(env.OR3_ADMIN_PASSWORD).toBe('AValidPassword123');
  expect(env.OR3_FORCE_HTTPS).toBe('false');
  expect(env.OR3_TRUST_PROXY).toBe('false');
});

test('builds public origin settings without exposing secrets in the origin', () => {
  const env = buildEnv({
    mode: 'public',
    version: '0.1.12',
    directory: '/tmp/cloud.example.com',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    domain: 'cloud.example.com',
    port: 3000,
  });
  expect(env.OR3_PUBLIC_DOMAIN).toBe('cloud.example.com');
  expect(env.OR3_ALLOWED_ORIGINS).toBe('https://cloud.example.com');
  expect(env.OR3_FORCE_HTTPS).toBe('true');
  expect(env.OR3_TRUST_PROXY).toBe('true');
  expect(env.OR3_ALLOWED_ORIGINS).not.toContain(env.OR3_BASIC_AUTH_JWT_SECRET);
});

test('parses exact flags and accepts only complete release versions', () => {
  expect(parseFlags(['target', '--local', '--port=3100', '--admin-email', 'admin@example.com'])).toEqual({
    positionals: ['target'],
    flags: { local: true, port: '3100', 'admin-email': 'admin@example.com' },
  });
  expect(isVersion('0.1.12')).toBe(true);
  expect(isVersion('0.1')).toBe(false);
  expect(isVersion('latest')).toBe(false);
});

test('redacts known values and secret-shaped environment output', () => {
  expect(redact('OR3_BASIC_AUTH_JWT_SECRET=abc123 password=hidden', ['abc123'])).toBe(
    'OR3_BASIC_AUTH_JWT_SECRET=[REDACTED] password=[REDACTED]',
  );
});

test('records immutable state metadata', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-state-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  expect(stateFromEnv('/tmp/or3-cloud-state-test', env, 'local', 'init', 'sha256:test')).toMatchObject({
    appVersion: '0.1.12',
    image: env.OR3_IMAGE,
    imageDigest: 'sha256:test',
    volumeName: env.OR3_VOLUME_NAME,
  });
});

test('rejects any resolved Compose binding that exposes OR3 beyond loopback', () => {
  const safe = JSON.stringify({ services: { or3: { ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }] } } });
  const unsafe = JSON.stringify({ services: { or3: { ports: [
    { target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' },
    { target: 3000, published: 3999, host_ip: '0.0.0.0', protocol: 'tcp' },
  ] } } });
  expect(checkResolvedLoopbackBinding(safe, 3000)).toBe(true);
  expect(checkResolvedLoopbackBinding(unsafe, 3000)).toBe(false);
});

test('accepts only the fixed V1 Compose data layout', () => {
  const config = JSON.stringify({
    services: {
      or3: {
        environment: {
          OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
          OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
          OR3_STORAGE_FS_ROOT: '/data/storage',
        },
        ports: [{ target: 3000, published: 3000, host_ip: '127.0.0.1', protocol: 'tcp' }],
        volumes: [{ type: 'volume', source: 'or3-data', target: '/data' }],
      },
    },
    volumes: { 'or3-data': { name: 'source-data' } },
  });
  expect(() => assertSupportedSourceCompose(config, 'source-data', 3000)).not.toThrow();
  expect(() => assertSupportedSourceCompose(config.replace('/data/storage', '/tmp/storage'), 'source-data', 3000)).toThrow('custom data layouts');
});

test('refuses a backup whose deployment identity does not match the live volume', () => {
  const env = buildEnv({
    mode: 'local',
    version: '0.1.12',
    directory: '/tmp/or3-cloud-identity-test',
    email: 'admin@example.com',
    password: 'AValidPassword123',
    port: 3000,
  });
  const state = stateFromEnv('/tmp/or3-cloud-identity-test', env, 'local', 'init', 'sha256:test');
  const backupEnv = { ...env, OR3_VOLUME_NAME: 'another-deployment-data' };
  expect(() => assertBackupMatchesDeployment({
    schemaVersion: 1,
    backupId: 'backup-test',
    createdAt: new Date().toISOString(),
    appVersion: state.appVersion,
    image: state.image,
    imageDigest: state.imageDigest,
    dataSha256: 'sha256:test',
    mode: 'local',
  }, backupEnv, state, env)).toThrow('different deployment identity');
});

test('refuses unsupported V1 provider modules before adoption', () => {
  expect(() => assertSupportedSource('/tmp/v1', {
    AUTH_PROVIDER: 'basic-auth',
    OR3_SYNC_PROVIDER: 'sqlite',
    OR3_STORAGE_FS_ROOT: '/data/storage',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
    OR3_BASIC_AUTH_BOOTSTRAP_EMAIL: 'admin@example.com',
    OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD: 'AValidPassword123',
  }, 'or3-provider-basic-auth/nuxt\nor3-provider-sqlite/nuxt\nor3-provider-s3/nuxt')).toThrow(
    'V1 provider modules are unsupported',
  );
});
