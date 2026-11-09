import { join } from 'node:path';
import type { ManagedState } from '../deployment/contracts';
import { managedProviderProfile } from '../deployment/env';
import { assertCapturedComposeMounts, assertCapturedHostMounts, assertSafeComposeBinding, composeArgs, parseComposeConfig, resolvedComposeConfig } from '../runtime/compose';
import { run } from '../runtime/command-runner';
import { managedVaultEnabled } from '../runtime/project';
import { withBackupHelper } from './helper';

const INSPECTOR = '/app/scripts/docker/backup-inspect.mjs';
const NODE = 'if [ -x /nodejs/bin/node ]; then exec /nodejs/bin/node "$@"; else exec node "$@"; fi';

/** No managed snapshot can claim completeness for an unsupported profile. */
export function assertSupportedBackupProfile(env: Record<string, string>) {
  let profile: ReturnType<typeof managedProviderProfile> | undefined;
  try { profile = managedProviderProfile(env); } catch { /* Preserve the established public refusal below. */ }
  const expectedOverrides: Record<string, string> = {
    OR3_STORAGE_PROVIDER: 'fs', NUXT_AUTH_ENABLED: 'true', NUXT_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_AUTH_PROVIDER: 'basic-auth', NUXT_PUBLIC_SSR_AUTH_ENABLED: 'true',
    NUXT_SYNC_ENABLED: 'true', NUXT_PUBLIC_SYNC_ENABLED: 'true', NUXT_SYNC_PROVIDER: 'sqlite', NUXT_PUBLIC_SYNC_PROVIDER: 'sqlite',
    NUXT_STORAGE_ENABLED: 'true', NUXT_PUBLIC_STORAGE_ENABLED: 'true', NUXT_STORAGE_PROVIDER: 'fs',
  };
  const ambiguous = /^(?:RUNTIME_CONFIG$|NUXT_(?:AUTH|SYNC|STORAGE|SECRETS|PUBLIC)$|NITRO_ENV_(?:PREFIX|EXPANSION)$|NITRO_(?:AUTH|SYNC|STORAGE|SECRETS|PUBLIC)(?:_|$))/;
  if (profile !== 'basic-sqlite-fs' || !(env.AUTH_PROVIDER || env.OR3_AUTH_PROVIDER) || env.OR3_SYNC_PROVIDER !== 'sqlite' || env.NUXT_PUBLIC_STORAGE_PROVIDER !== 'fs' || env.OR3_SQLITE_DRIVER && env.OR3_SQLITE_DRIVER !== 'better-sqlite3'
    || env.SSR_AUTH_ENABLED !== 'true' || (env.OR3_CLOUD_SYNC_ENABLED ?? env.OR3_SYNC_ENABLED) !== 'true' || (env.OR3_CLOUD_STORAGE_ENABLED ?? env.OR3_STORAGE_ENABLED) !== 'true'
    || Object.entries(expectedOverrides).some(([key, expected]) => env[key] !== undefined && env[key] !== expected)
    || Object.keys(env).some((key) => ambiguous.test(key))) {
    throw new Error('Unsupported offline backup inspection provider profile; SQLite/FS is required.');
  }
}

/** Prove the archived volume belongs to the profile that actually ran. */
export async function assertBackupSourceProfile(directory: string, state: ManagedState, env: Record<string, string>) {
  assertSupportedBackupProfile(env);
  if (state.image !== env.OR3_IMAGE || state.volumeName !== env.OR3_VOLUME_NAME) throw new Error('Backup source identity differs from managed state.');
  await assertSafeComposeBinding(directory, state.mode, env);
  const config = parseComposeConfig(await resolvedComposeConfig(directory, state.mode));
  const service = config.services?.or3;
  if (!service) throw new Error('Backup source Compose service is missing.');
  const readEnv = (input: unknown): Record<string, string> => {
    const values: Record<string, string> = {};
    const entries = Array.isArray(input) ? input.map((line) => {
      if (typeof line !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) throw new Error('Backup source environment is malformed.');
      const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
    }) : input && typeof input === 'object' ? Object.entries(input) : [];
    for (const [key, value] of entries) {
      if (typeof key !== 'string' || typeof value !== 'string' || Object.hasOwn(values, key)) throw new Error('Backup source environment is incomplete or ambiguous.');
      values[key] = value;
    }
    return values;
  };
  const resolved = readEnv(service.environment);
  assertSupportedBackupProfile(resolved);
  if (service.entrypoint != null || service.command != null || service.working_dir != null || service.read_only !== true) throw new Error('Backup source Compose changes the managed application startup.');
  const matches = (candidate: Record<string, string>) => {
    assertSupportedBackupProfile(candidate);
    for (const [key, value] of [['OR3_BASIC_AUTH_DB_PATH', '/data/auth.sqlite'], ['OR3_SQLITE_DB_PATH', '/data/sync.sqlite'], ['OR3_STORAGE_FS_ROOT', '/data/storage']] as const) {
      if (env[key] !== value || resolved[key] !== value || candidate[key] !== value) throw new Error(`Backup source ${key} does not use the captured managed path.`);
    }
    for (const [key, value] of [['OR3_ADMIN_DATA_DIR', '/data/admin'], ['OR3_EXTENSIONS_ROOT', '/data/extensions']] as const) {
      if ((env[key] !== undefined && env[key] !== value) || resolved[key] !== value || candidate[key] !== value) throw new Error(`Backup source ${key} does not use the captured managed path.`);
    }
    const profileKey = /^(?:AUTH_PROVIDER|SSR_AUTH_ENABLED|OR3_(?:AUTH_PROVIDER|SYNC_(?:ENABLED|PROVIDER)|CLOUD_SYNC_ENABLED|STORAGE_(?:ENABLED|PROVIDER|FS_ROOT)|CLOUD_STORAGE_ENABLED|SQLITE_(?:DB_PATH|DRIVER)|BASIC_AUTH_DB_PATH)|NUXT_(?:AUTH|SYNC|STORAGE|PUBLIC)(?:_.*)?|NITRO_(?:AUTH|SYNC|STORAGE|PUBLIC|ENV)(?:_.*)?|RUNTIME_CONFIG)$/;
    for (const key of new Set([...Object.keys(env), ...Object.keys(resolved), ...Object.keys(candidate)])) {
      if (profileKey.test(key) && (resolved[key] !== env[key] || candidate[key] !== resolved[key])) throw new Error(`Backup source profile configuration differs for ${key}.`);
    }
  };
  matches(resolved);
  if ((service.volumes ?? []).some((mount) => typeof mount.target === 'string' && mount.target.startsWith('/data/'))) throw new Error('Backup source Compose has an uncaptured mount inside /data.');
  const listed = await run('docker', composeArgs(directory, state.mode, ['ps', '-aq', 'or3']), directory);
  const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (!listed.ok || ids.length !== 1) throw new Error('Backup requires exactly one existing source container, running or stopped.');
  const inspect = await run('docker', ['inspect', '--format', '{{json .Config.Env}}\n{{json .Image}}\n{{json .Mounts}}\n{{json .Config.Labels}}', ids[0]], directory);
  const image = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', env.OR3_IMAGE], directory);
  if (!inspect.ok || !image.ok || !image.stdout.trim()) throw new Error('Backup source container or image cannot be inspected.');
  let actual: unknown, imageId: unknown, mounts: unknown, labels: unknown;
  try {
    const lines = inspect.stdout.trimEnd().split('\n'); if (lines.length !== 4) throw new Error('incomplete');
    [actual, imageId, mounts, labels] = lines.map((line): unknown => JSON.parse(line));
  } catch { throw new Error('Backup source container inspection is incomplete or malformed.'); }
  if (imageId !== image.stdout.trim() || !labels || typeof labels !== 'object' || Array.isArray(labels)
    || (labels as Record<string, unknown>)['com.docker.compose.project'] !== state.composeProject
    || (labels as Record<string, unknown>)['com.docker.compose.service'] !== 'or3') throw new Error('Backup source container identity does not match the managed deployment.');
  if (!Array.isArray(mounts)) throw new Error('Backup source container mounts are unavailable.');
  const onlyMounts = (items: unknown[], property: 'target' | 'Destination', allowed: string[]) => {
    if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item) || !allowed.includes((item as Record<string, string>)[property]))) throw new Error('Backup source has an unexpected mount.');
  };
  onlyMounts(service.volumes ?? [], 'target', ['/data', '/run/or3-secrets', '/run/or3-secrets-client']);
  assertCapturedComposeMounts(service);
  onlyMounts(mounts, 'Destination', ['/data', '/run/or3-secrets', '/run/or3-secrets-client']);
  const data = mounts.filter((mount) => mount && typeof mount === 'object' && mount.Destination === '/data');
  if (data.length !== 1 || data[0].Type !== 'volume' || data[0].Name !== state.volumeName
    || mounts.some((mount) => typeof mount?.Destination === 'string' && mount.Destination.startsWith('/data/'))) throw new Error('Backup source container does not use the captured data volume exclusively.');
  matches(readEnv(actual));
  const actualEnv = readEnv(actual);
  const imageExecution = await run('docker', ['image', 'inspect', '--format', '{{json .Config.Entrypoint}}\n{{json .Config.Cmd}}\n{{json .Config.WorkingDir}}\n{{json .Config.Env}}', env.OR3_IMAGE], directory);
  if (!imageExecution.ok) throw new Error('Backup source image startup cannot be inspected.');
  let imageEntry: unknown, imageCommand: unknown, imageWorkingDir: unknown, imageEnvironment: unknown;
  try {
    const lines = imageExecution.stdout.trimEnd().split('\n'); if (lines.length !== 4) throw new Error('incomplete');
    [imageEntry, imageCommand, imageWorkingDir, imageEnvironment] = lines.map((line): unknown => JSON.parse(line));
  } catch { throw new Error('Backup source image startup inspection is malformed.'); }
  const defaultEnv = readEnv(imageEnvironment);
  const executionKey = /^(?:PATH|NODE_.+|BUN_.+|LD_.+|DYLD_.+)$/;
  const checkExecutionEnv = (source: Record<string, string>, isResolved: boolean) => {
    for (const key of new Set([...Object.keys(source), ...Object.keys(defaultEnv)])) {
      if (executionKey.test(key) && (isResolved ? source[key] ?? defaultEnv[key] : source[key]) !== defaultEnv[key]) throw new Error(`Backup source changes execution environment ${key}.`);
    }
  };
  checkExecutionEnv(actualEnv, false);
  checkExecutionEnv(resolved, true);
  const checkExecution = async (container: string, expectedEntry: unknown, expectedCommand: unknown) => {
    const result = await run('docker', ['inspect', '--format', '{{json .Config.Entrypoint}}\n{{json .Config.Cmd}}\n{{json .Config.WorkingDir}}\n{{json .HostConfig.ReadonlyRootfs}}\n{{json .HostConfig.Tmpfs}}\n{{json .HostConfig.Mounts}}', container], directory);
    let entry: unknown, command: unknown, cwd: unknown, readonly: unknown, tmpfs: unknown, hostMounts: unknown;
    try {
      const lines = result.stdout.trimEnd().split('\n'); if (!result.ok || lines.length !== 6) throw new Error('incomplete');
      [entry, command, cwd, readonly, tmpfs, hostMounts] = lines.map((line): unknown => JSON.parse(line));
    } catch { throw new Error('Backup source startup inspection is incomplete.'); }
    if (JSON.stringify(entry) !== JSON.stringify(expectedEntry) || JSON.stringify(command) !== JSON.stringify(expectedCommand) || cwd !== imageWorkingDir || readonly !== true) throw new Error('Backup source container changes the managed startup or writable root.');
    assertCapturedHostMounts(tmpfs, hostMounts);
    const diff = await run('docker', ['diff', container], directory);
    if (!diff.ok || diff.stdout.trim()) throw new Error('Backup source container writable layer is changed or cannot be inspected.');
  };
  await checkExecution(ids[0]!, imageEntry, imageCommand);
  const vaultEnabled = managedVaultEnabled(directory, env);
  const provider = env.NUXT_SECRETS_PROVIDER ?? 'or3-secrets';
  if ((provider !== '' && provider !== 'or3-secrets') || resolved.NUXT_SECRETS_PROVIDER !== provider || actualEnv.NUXT_SECRETS_PROVIDER !== provider || (provider === 'or3-secrets') !== vaultEnabled) {
    throw new Error('Backup source secret provider differs from managed vault custody.');
  }
  if (vaultEnabled) {
    for (const [key, value] of [['NUXT_SECRETS_SOCKET_PATH', '/run/or3-secrets/api.sock'], ['NUXT_SECRETS_TOKEN_FILE', '/run/or3-secrets-client/service.token'], ['OR3_MANAGED_VAULT_CONFIG', '/run/or3-secrets-client/config.json']] as const) {
      if (resolved[key] !== value || actualEnv[key] !== value) throw new Error('Backup source vault connection is not the managed connection.');
    }
    for (const key of new Set([...Object.keys(resolved), ...Object.keys(actualEnv)])) {
      if (key.startsWith('NUXT_SECRETS_') && resolved[key] !== actualEnv[key]) throw new Error(`Backup source vault configuration differs for ${key}.`);
    }
    const expected = [
      ['/vault-data', `${state.volumeName}-vault-data`], ['/vault-key', `${state.volumeName}-vault-key`],
      ['/run/or3-secrets', `${state.volumeName}-vault-run`], ['/run/or3-secrets-client', `${state.volumeName}-vault-client`],
    ] as const;
    const checkComposeMounts = (mountsToCheck: Array<Record<string, unknown>>, required: readonly (readonly [string, string])[]) => {
      for (const [target, volume] of required) {
        const matches = mountsToCheck.filter((mount) => mount.target === target);
        const source = matches[0]?.source;
        if (matches.length !== 1 || matches[0]?.type !== 'volume' || typeof source !== 'string' || (config.volumes?.[source]?.name ?? source) !== volume
          || mountsToCheck.some((mount) => typeof mount.target === 'string' && mount.target.startsWith(`${target}/`))) throw new Error('Backup source Compose vault mounts do not match managed custody.');
      }
    };
    const checkActualMounts = (mountsToCheck: unknown[], required: readonly (readonly [string, string])[]) => {
      if (!mountsToCheck.every((mount) => mount && typeof mount === 'object' && !Array.isArray(mount))) throw new Error('Backup source container vault mounts are malformed.');
      const typed = mountsToCheck as Array<Record<string, unknown>>;
      for (const [target, volume] of required) {
        const matches = typed.filter((mount) => mount.Destination === target);
        if (matches.length !== 1 || matches[0]?.Type !== 'volume' || matches[0]?.Name !== volume
          || typed.some((mount) => typeof mount.Destination === 'string' && mount.Destination.startsWith(`${target}/`))) throw new Error('Backup source container vault mounts do not match managed custody.');
      }
    };
    checkComposeMounts(service.volumes ?? [], expected.slice(2));
    checkActualMounts(mounts, expected.slice(2));
    const vaultService = config.services?.['or3-vault'];
    if (!vaultService || vaultService.image !== env.OR3_IMAGE) throw new Error('Backup source vault service does not use the managed image.');
    const vaultResolved = readEnv(vaultService.environment);
    checkExecutionEnv(vaultResolved, true);
    if (JSON.stringify(vaultService.entrypoint) !== JSON.stringify(['/nodejs/bin/node', '/app/vault/entrypoint.mjs']) || vaultService.command != null || vaultService.working_dir != null || vaultService.read_only !== true) throw new Error('Backup source Compose changes the managed vault startup.');
    onlyMounts(vaultService.volumes ?? [], 'target', expected.map(([target]) => target));
    assertCapturedComposeMounts(vaultService);
    checkComposeMounts(vaultService.volumes ?? [], expected);
    const vaultListed = await run('docker', composeArgs(directory, state.mode, ['ps', '-aq', 'or3-vault']), directory);
    const vaultIds = vaultListed.stdout.trim().split(/\s+/).filter(Boolean);
    if (!vaultListed.ok || vaultIds.length !== 1) throw new Error('Backup requires exactly one existing source vault container.');
    const vaultInspect = await run('docker', ['inspect', '--format', '{{json .Config.Env}}\n{{json .Image}}\n{{json .Mounts}}\n{{json .Config.Labels}}', vaultIds[0]], directory);
    if (!vaultInspect.ok) throw new Error('Backup source vault container cannot be inspected.');
    let vaultEnv: unknown, vaultImage: unknown, vaultMounts: unknown, vaultLabels: unknown;
    try {
      const lines = vaultInspect.stdout.trimEnd().split('\n'); if (lines.length !== 4) throw new Error('incomplete');
      [vaultEnv, vaultImage, vaultMounts, vaultLabels] = lines.map((line): unknown => JSON.parse(line));
    } catch { throw new Error('Backup source vault inspection is incomplete or malformed.'); }
    if (vaultImage !== image.stdout.trim() || !vaultLabels || typeof vaultLabels !== 'object' || Array.isArray(vaultLabels)
      || (vaultLabels as Record<string, unknown>)['com.docker.compose.project'] !== state.composeProject
      || (vaultLabels as Record<string, unknown>)['com.docker.compose.service'] !== 'or3-vault' || !Array.isArray(vaultMounts)) {
      throw new Error('Backup source vault container identity does not match the managed deployment.');
    }
    checkActualMounts(vaultMounts, expected);
    const actualVaultEnv = readEnv(vaultEnv);
    checkExecutionEnv(actualVaultEnv, false);
    if (vaultResolved.OR3_VAULT_NAMESPACE !== (resolved.NUXT_SECRETS_NAMESPACE || 'or3') || actualVaultEnv.OR3_VAULT_NAMESPACE !== vaultResolved.OR3_VAULT_NAMESPACE) throw new Error('Backup source vault namespace differs from the managed connection.');
    onlyMounts(vaultMounts, 'Destination', [...expected.map(([target]) => target), '/data']);
    await checkExecution(vaultIds[0]!, ['/nodejs/bin/node', '/app/vault/entrypoint.mjs'], null);
  }
}

/** App-owned contract v1. Unsupported profiles never certify partial coverage. */
export async function validateCanonicalBackupReferences(directory: string, env: Record<string, string>, backupPath: string) {
  assertSupportedBackupProfile(env);
  await withBackupHelper(directory, env.OR3_IMAGE, env, { network: 'none' }, async helper => {
    await helper.loadSqlite(join(backupPath, 'data.tgz'));
    const result = JSON.parse(await helper.exec(['sh', '-c', NODE, 'or3-backup-inspection', INSPECTOR, 'references', env.OR3_STORAGE_FS_ROOT ?? '/data/storage'])) as { contract: number; complete: boolean; liveAttachments: number };
    if (result.contract !== 1 || result.complete !== true || !Number.isSafeInteger(result.liveAttachments) || result.liveAttachments < 0) throw new Error('Offline canonical backup reference inspection did not complete.');
  });
}
