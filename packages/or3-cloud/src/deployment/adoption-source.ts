import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { run } from '../runtime/command-runner';
import {
  assertCapturedComposeMounts,
  assertCapturedHostMounts,
  checkResolvedLoopbackBinding,
  composeEnvironmentValue,
  parseComposeConfig,
} from '../runtime/compose';
import { waitForDeepHealthWithArgs } from '../runtime/health';
import { redact } from '../util/primitives';
import { ALLOWED_ENV_KEYS } from './env';
import { sanitizeName } from './identity';

export async function sourceServiceRunning(directory: string, composeFiles: string[]) {
  const result = await run('docker', [...sourceComposeArgs(directory, composeFiles), 'ps', '--status', 'running', '-q', 'or3'], directory);
  if (!result.ok) throw new Error(`Could not determine whether the V1 OR3 service is running. ${result.stderr.trim()}`);
  return Boolean(result.stdout.trim());
}

/** Verify the container's actual configuration, including when it is stopped. */
export async function assertSourceContainer(directory: string, composeFiles: string[], expectedImage: string, configText: string, sourceVolume: string, expectedPort: number, sourceEnv: Record<string, string>) {
  const listed = await run('docker', [...sourceComposeArgs(directory, composeFiles), 'ps', '-aq', 'or3'], directory);
  const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (!listed.ok || ids.length !== 1) throw new Error('Could not identify exactly one existing source container.');
  const inspect = await run('docker', ['inspect', '--format', '{{json .Image}}\n{{json .Config.Env}}\n{{json .Mounts}}\n{{json .Config.Labels}}\n{{json .Config.Entrypoint}}\n{{json .Config.Cmd}}\n{{json .Config.WorkingDir}}\n{{json .HostConfig.ReadonlyRootfs}}\n{{json .HostConfig.Tmpfs}}\n{{json .HostConfig.Mounts}}', ids[0]], directory);
  const expected = await run('docker', ['image', 'inspect', '--format', '{{.Id}}\n{{json .Config.Entrypoint}}\n{{json .Config.Cmd}}\n{{json .Config.WorkingDir}}\n{{json .Config.Env}}', expectedImage], directory);
  if (!inspect.ok || !expected.ok || !expected.stdout.trim()) throw new Error('Could not inspect the existing source container or its authenticated image.');
  let image: unknown, env: unknown, mounts: unknown, labels: unknown, entrypoint: unknown, command: unknown, cwd: unknown, readonly: unknown, tmpfs: unknown, hostMounts: unknown, imageId: string, defaultEntrypoint: unknown, defaultCommand: unknown, defaultCwd: unknown, defaultEnv: unknown;
  try {
    const lines = inspect.stdout.trimEnd().split('\n');
    const expectedLines = expected.stdout.trimEnd().split('\n');
    if (lines.length !== 10 || expectedLines.length !== 5) throw new Error('invalid inspection');
    [image, env, mounts, labels, entrypoint, command, cwd, readonly, tmpfs, hostMounts] = lines.map((line): unknown => JSON.parse(line));
    imageId = expectedLines[0]!;
    defaultEntrypoint = JSON.parse(expectedLines[1]!); defaultCommand = JSON.parse(expectedLines[2]!);
    defaultCwd = JSON.parse(expectedLines[3]!); defaultEnv = JSON.parse(expectedLines[4]!);
  } catch { throw new Error('The source container inspection is incomplete or malformed.'); }
  if (image !== imageId) throw new Error('The source container image does not match the authenticated release image.');
  if (readonly !== true) throw new Error('The source container root filesystem is not read-only; its code cannot be qualified for adoption.');
  assertCapturedHostMounts(tmpfs, hostMounts);
  const diff = await run('docker', ['diff', ids[0]], directory);
  if (!diff.ok || diff.stdout.trim()) throw new Error('The source container writable layer is changed or cannot be inspected; adoption is refused.');
  const validCommand = (value: unknown) => value === null || Array.isArray(value) && value.every((part) => typeof part === 'string');
  if (![entrypoint, command, defaultEntrypoint, defaultCommand].every(validCommand) || JSON.stringify(entrypoint) !== JSON.stringify(defaultEntrypoint) || JSON.stringify(command) !== JSON.stringify(defaultCommand)) {
    throw new Error('The source container changes the authenticated image entrypoint or command.');
  }
  if (typeof cwd !== 'string' || cwd !== defaultCwd) throw new Error('The source container changes the authenticated image working directory.');
  const config = parseComposeConfig(configText);
  if (!config.name || !labels || typeof labels !== 'object' || Array.isArray(labels)
    || (labels as Record<string, unknown>)['com.docker.compose.project'] !== config.name
    || (labels as Record<string, unknown>)['com.docker.compose.service'] !== 'or3') {
    throw new Error('The source container Compose labels do not match the selected project and service.');
  }
  const parseInspectionEnv = (value: unknown) => {
    if (value === null) return {} as Record<string, string>;
    if (!Array.isArray(value) || !value.every((line) => typeof line === 'string' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))) throw new Error('The inspected environment is incomplete or malformed.');
    const result: Record<string, string> = {};
    for (const line of value as string[]) {
      const split = line.indexOf('='); const key = line.slice(0, split);
      if (Object.hasOwn(result, key)) throw new Error(`The inspected environment contains a duplicate ${key} entry.`);
      result[key] = line.slice(split + 1);
    }
    return result;
  };
  const actualEnv = parseInspectionEnv(env), imageEnv = parseInspectionEnv(defaultEnv);
  const executionKey = /^(?:PATH|NODE_.+|BUN_.+|LD_.+|DYLD_.+)$/;
  for (const key of new Set([...Object.keys(actualEnv), ...Object.keys(imageEnv)])) {
    if (executionKey.test(key) && actualEnv[key] !== imageEnv[key]) throw new Error(`The source container changes execution environment ${key}.`);
  }
  if (!Array.isArray(mounts) || !mounts.every((mount) => mount && typeof mount === 'object' && typeof mount.Type === 'string' && typeof mount.Destination === 'string')) {
    throw new Error('The source container mounts are incomplete or malformed.');
  }
  const actualMounts = mounts as Array<{ Type: string; Name?: string; Destination: string }>;
  if (new Set(actualMounts.map((mount) => mount.Destination)).size !== actualMounts.length) throw new Error('The source container has ambiguous duplicate mount destinations.');
  if (actualMounts.length !== 1) throw new Error('The source container has additional mounts that adoption cannot safely migrate.');
  const actualDataMount = actualMounts.find((mount) => mount.Destination === '/data');
  if (!actualDataMount || actualDataMount.Type !== 'volume' || actualDataMount.Name !== sourceVolume) {
    throw new Error('The source container data mount does not match the selected Docker volume.');
  }
  const actualService = config.services?.or3;
  if (!actualService) throw new Error('V1 Compose configuration does not define an or3 service.');
  actualService.environment = actualEnv;
  actualService.volumes = actualMounts.map((mount) => ({ type: mount.Type, source: mount.Name, target: mount.Destination }));
  assertSupportedSourceCompose(JSON.stringify(config), sourceVolume, expectedPort, sourceEnv, [actualService.image ?? '']);
}

export async function readSourceVolume(sourceDirectory: string) {
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

export function sourceMode(sourceDirectory: string, sourceEnv: Record<string, string>) {
  const publicDeployment = sourceEnv.OR3_PUBLIC_DOMAIN && sourceEnv.OR3_PUBLIC_DOMAIN !== 'localhost'
    && sourceEnv.OR3_FORCE_HTTPS !== 'false';
  return publicDeployment && existsSync(join(sourceDirectory, 'compose.public.yaml')) ? 'public' : 'local';
}

export function sourceComposeArgs(sourceDirectory: string, sourceComposeFiles: string[]) {
  return [
    'compose', '--project-directory', sourceDirectory, '--env-file', join(sourceDirectory, '.env'),
    ...sourceComposeFiles,
  ];
}

export async function restartSource(sourceDirectory: string, sourceComposeFiles: string[], secrets: string[]) {
  const args = sourceComposeArgs(sourceDirectory, sourceComposeFiles);
  const started = await run('docker', [...args, 'start'], sourceDirectory);
  if (!started.ok) throw new Error(`The original V1 deployment could not be started. ${redact(started.stderr, secrets)}`);
  await waitForDeepHealthWithArgs(args, sourceDirectory, secrets);
}

export function assertSupportedSource(sourceDirectory: string, sourceEnv: Record<string, string>, providers: string) {
  const values = [sourceEnv.AUTH_PROVIDER, sourceEnv.OR3_AUTH_PROVIDER].filter(Boolean);
  if (values.length === 0 || values.some((value) => value !== 'basic-auth')) throw new Error(`V1 project uses ${values.join(', ') || 'an unknown auth provider'}, not the supported Basic Auth profile.`);
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

export function assertSupportedSourceCompose(configText: string, sourceVolume: string, expectedPort: number, sourceEnv: Record<string, string>, allowedImages: readonly string[]) {
  const config = parseComposeConfig(configText);
  const service = config.services?.or3;
  if (!service) throw new Error('V1 Compose configuration does not define an or3 service.');
  assertCapturedComposeMounts(service);
  if (!service.image || !allowedImages.includes(service.image)) throw new Error('V1 Compose image does not match the authenticated release image.');
  // The archive covers /data only. Do not replace a vault-bearing deployment
  // until custody has its own authenticated migration and recovery procedure.
  const vault = composeEnvironmentValue(service, 'NUXT_SECRETS_PROVIDER');
  const vaultMount = (service.volumes ?? []).some((mount) => typeof mount.target === 'string' && /^\/(?:run\/or3-secrets(?:-client)?|vault-data|vault-key)(?:\/|$)/.test(mount.target));
  if (sourceEnv.NUXT_SECRETS_PROVIDER || vault !== '' || vaultMount || Object.keys(config.services ?? {}).some((name) => /vault/i.test(name))) {
    throw new Error('V1 source may use a secret vault; adoption cannot migrate vault custody. Preserve the source and use a separately reviewed migration.');
  }
  if (Object.keys(config.services ?? {}).some((name) => name !== 'or3')) {
    throw new Error('V1 Compose has additional services that adoption cannot safely migrate.');
  }
  const selected = (key: string) => composeEnvironmentValue(service, key);
  const regenerated = new Set(['OR3_BASIC_AUTH_DB_PATH', 'OR3_SQLITE_DB_PATH', 'OR3_STORAGE_FS_ROOT', 'OR3_PUBLIC_DOMAIN', 'OR3_ALLOWED_ORIGINS', 'OR3_FORCE_HTTPS', 'OR3_TRUST_PROXY']);
  for (const key of ALLOWED_ENV_KEYS) {
    if (regenerated.has(key)) continue;
    if (selected(key) !== sourceEnv[key]) throw new Error(`V1 Compose ${key} differs from its source environment; adoption refuses configuration drift.`);
  }
  if (!sourceEnv.OR3_INSTANCE_ID?.trim()) throw new Error('V1 source needs an explicitly configured stable acquisition identity (OR3_INSTANCE_ID) before adoption.');
  for (const key of ['NUXT_ADMIN_AUTH_USERNAME', 'NUXT_ADMIN_AUTH_PASSWORD']) {
    if (selected(key) !== undefined || sourceEnv[key] !== undefined) throw new Error(`V1 Compose ${key} cannot be safely provisioned during adoption.`);
  }
  // Nitro applies its own overrides before Nuxt's; aggregate config and a
  // custom prefix can select a different profile without changing these
  // canonical keys. Refuse ambiguity instead of attempting a partial merge.
  const effectiveKeys = Array.isArray(service.environment)
    ? service.environment.map((entry) => entry.split('=', 1)[0])
    : Object.keys(service.environment ?? {});
  const ambiguous = /^(?:RUNTIME_CONFIG$|NUXT_(?:ADMIN|ADMIN_AUTH|AUTH|AUTH_INVITE|SYNC|STORAGE|SECRETS|PUBLIC|BACKGROUND_JOBS|CONNECT|CONNECT_CLOUDFLARE|WEBHOOKS)$|NITRO_ENV_(?:PREFIX|EXPANSION)$|NITRO_(?:ADMIN|AUTH|SYNC|STORAGE|SECRETS|PUBLIC|BACKGROUND_JOBS|CONNECT|WEBHOOKS)(?:_|$))/;
  if (effectiveKeys.some((key) => ambiguous.test(key))) throw new Error('V1 Compose contains an unsupported aggregate or Nitro runtime profile override.');
  const allowedOverrides: Record<string, string> = {
    OR3_STORAGE_PROVIDER: 'fs', NUXT_AUTH_ENABLED: 'true', NUXT_AUTH_PROVIDER: 'basic-auth',
    NUXT_PUBLIC_SSR_AUTH_ENABLED: 'true', NUXT_PUBLIC_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_GUEST_ACCESS_ENABLED: 'false',
    NUXT_AUTH_REGISTRATION_MODE: 'invite_only', NUXT_AUTH_AUTO_PROVISION: 'false',
    NUXT_SYNC_ENABLED: 'true', NUXT_PUBLIC_SYNC_ENABLED: 'true', NUXT_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_SYNC_PROVIDER: 'sqlite',
    NUXT_STORAGE_ENABLED: 'true', NUXT_PUBLIC_STORAGE_ENABLED: 'true', NUXT_STORAGE_PROVIDER: 'fs',
  };
  for (const [key, expected] of Object.entries(allowedOverrides)) {
    const value = selected(key);
    if (value !== undefined && value !== expected) throw new Error(`V1 Compose ${key} selects an unsupported runtime profile.`);
  }
  if (selected('OR3_SQLITE_DRIVER') && selected('OR3_SQLITE_DRIVER') !== 'better-sqlite3') {
    throw new Error('V1 Compose selects an unsupported SQLite driver. Adoption requires better-sqlite3.');
  }
  // Only copy settings whose meaning is understood by the managed target.
  // Refuse additional application overrides rather than silently changing
  // behavior or losing data when the target environment is regenerated.
  const managedOnly = new Set(['OR3_VERSION', 'OR3_IMAGE', 'OR3_PORT', 'OR3_COMPOSE_PROJECT', 'OR3_VOLUME_NAME', 'OR3_CADDY_DATA_VOLUME', 'OR3_CADDY_CONFIG_VOLUME', 'OR3_DEPLOYMENT_ID', 'OR3_ADMIN_DATA_DIR', 'OR3_EXTENSIONS_ROOT']);
  for (const key of effectiveKeys) {
    if (/^(?:OR3|NUXT|NITRO)_/.test(key) && !ALLOWED_ENV_KEYS.has(key) && !managedOnly.has(key) && !(key in allowedOverrides)) {
      throw new Error(`V1 Compose has unsupported application setting ${key}; adoption refuses to drop it.`);
    }
  }
  const auth = [selected('AUTH_PROVIDER'), selected('OR3_AUTH_PROVIDER')].filter((value): value is string => Boolean(value));
  const guest = selected('OR3_GUEST_ACCESS_ENABLED');
  if (!auth.length || auth.some((value) => value !== 'basic-auth') || selected('OR3_SYNC_PROVIDER') !== 'sqlite' || selected('NUXT_PUBLIC_STORAGE_PROVIDER') !== 'fs' || selected('OR3_AUTH_REGISTRATION_MODE') !== 'invite_only' || selected('OR3_AUTH_AUTO_PROVISION') !== 'false' || selected('SSR_AUTH_ENABLED') !== 'true' || guest && guest !== 'false' || (selected('OR3_CLOUD_SYNC_ENABLED') || selected('OR3_SYNC_ENABLED')) !== 'true' || (selected('OR3_CLOUD_STORAGE_ENABLED') || selected('OR3_STORAGE_ENABLED')) !== 'true') {
    throw new Error('V1 Compose resolves to an unsupported authentication, sync, storage or registration profile.');
  }
  for (const key of ['AUTH_PROVIDER', 'OR3_AUTH_PROVIDER', 'OR3_SYNC_PROVIDER', 'NUXT_PUBLIC_STORAGE_PROVIDER', 'OR3_AUTH_REGISTRATION_MODE', 'OR3_AUTH_AUTO_PROVISION', 'SSR_AUTH_ENABLED', 'OR3_GUEST_ACCESS_ENABLED', 'OR3_SYNC_ENABLED', 'OR3_CLOUD_SYNC_ENABLED', 'OR3_STORAGE_ENABLED', 'OR3_CLOUD_STORAGE_ENABLED']) {
    if (sourceEnv[key] !== undefined && selected(key) !== sourceEnv[key]) throw new Error(`V1 Compose resolves ${key} differently from its source environment; adoption refuses profile drift.`);
  }
  for (const [key, expected] of [
    ['OR3_BASIC_AUTH_DB_PATH', '/data/auth.sqlite'],
    ['OR3_SQLITE_DB_PATH', '/data/sync.sqlite'],
    ['OR3_STORAGE_FS_ROOT', '/data/storage'],
    ['OR3_ADMIN_DATA_DIR', '/data/admin'],
    ['OR3_EXTENSIONS_ROOT', '/data/extensions'],
  ] as const) {
    if (composeEnvironmentValue(service, key) !== expected) {
      throw new Error(`V1 Compose configuration does not resolve ${key} to ${expected}. Adoption refuses custom data layouts.`);
    }
  }
  const mounts = service.volumes ?? [];
  if (mounts.length !== 1) throw new Error('V1 Compose has additional mounts that adoption cannot safely migrate.');
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
