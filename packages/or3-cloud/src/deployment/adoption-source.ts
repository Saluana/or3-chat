import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { run } from '../runtime/command-runner';
import {
  checkResolvedLoopbackBinding,
  composeEnvironmentValue,
  parseComposeConfig,
} from '../runtime/compose';
import { waitForDeepHealthWithArgs } from '../runtime/health';
import { redact } from '../util/primitives';
import { sanitizeName } from './identity';

export async function sourceServiceRunning(directory: string, composeFiles: string[]) {
  const result = await run('docker', [...sourceComposeArgs(directory, composeFiles), 'ps', '--status', 'running', '-q', 'or3'], directory);
  if (!result.ok) throw new Error(`Could not determine whether the V1 OR3 service is running. ${result.stderr.trim()}`);
  return Boolean(result.stdout.trim());
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
