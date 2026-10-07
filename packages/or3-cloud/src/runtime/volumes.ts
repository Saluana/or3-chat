import type { ManagedState, Mode } from '../deployment/contracts';
import { secretValues } from '../deployment/env';
import { redact } from '../util/primitives';
import { run } from './command-runner';
import { composeArgs } from './compose';

export const MANAGED_RUNTIME_UID = 65532;
export const MANAGED_RUNTIME_GID = 65532;

type VolumeRootOwnership = { uid: number; gid: number };

export async function managedVolumeRootOwnership(image: string, volume: string): Promise<VolumeRootOwnership> {
  const result = await run('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL',
    '-v', `${volume}:/data:ro`, '--entrypoint', 'sh', image, '-c', "stat -c '%u:%g' /data",
  ]);
  if (!result.ok) throw new Error(`Could not inspect managed volume ${volume}. ${result.stderr.trim()}`);
  const match = result.stdout.trim().match(/^(\d+):(\d+)$/);
  if (!match) throw new Error(`Managed volume ${volume} returned an invalid root ownership value.`);
  return { uid: Number(match[1]), gid: Number(match[2]) };
}

export async function setManagedVolumeRootOwnership(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  image: string,
  ownership: VolumeRootOwnership,
) {
  if (!Number.isSafeInteger(ownership.uid) || ownership.uid < 0 || !Number.isSafeInteger(ownership.gid) || ownership.gid < 0) {
    throw new Error('Refusing an invalid managed volume root UID/GID.');
  }
  await ensureManagedDataVolume(directory, state.mode, state, env);
  const volume = state.volumeName;
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
export async function removeManagedDataVolumeForRecreation(directory: string, state: ManagedState) {
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
    || volume.Labels['com.docker.compose.volume'] !== 'or3-data'
  ) {
    throw new Error(`Volume ${state.volumeName} is not bound to this managed Compose deployment. Refusing to recreate it.`);
  }
  const removedVolume = await run('docker', ['volume', 'rm', state.volumeName], directory);
  if (!removedVolume.ok) throw new Error(`Could not remove the verified legacy data volume for recreation. ${removedVolume.stderr.trim()}`);
}

export async function ensureManagedDataVolume(
  directory: string,
  mode: Mode,
  state: ManagedState,
  env: Record<string, string>,
) {
  const existing = await run('docker', ['volume', 'inspect', state.volumeName, '--format', '{{.Name}}'], directory);
  if (existing.ok && existing.stdout.trim() !== state.volumeName) {
    throw new Error(`Docker returned an unexpected name for managed volume ${state.volumeName}.`);
  }
  if (!existing.ok) {
    if (existing.exitCode !== 1 || !/no such volume/i.test(`${existing.stdout}\n${existing.stderr}`)) {
      throw new Error(`Could not inspect managed volume ${state.volumeName}. Refusing to assume it is missing. ${redact(existing.stderr, secretValues(env))}`);
    }
    const created = await run('docker', composeArgs(directory, mode, [
      'run', '--rm', '-T', '--no-deps', '--entrypoint', 'sh', 'or3', '-c', 'true',
    ]), directory);
    if (!created.ok) throw new Error(`Could not create the managed data volume. ${redact(created.stderr, secretValues(env))}`);
  }
  // A matching name does not prove ownership. Check existing and recreated
  // volumes before any caller can clear, extract into, or change their owner.
  const inspected = await run('docker', ['volume', 'inspect', state.volumeName, '--format', '{{json .Labels}}'], directory);
  if (!inspected.ok) throw new Error(`Could not verify managed data volume ${state.volumeName}.`);
  let labels: Record<string, unknown> | null;
  try {
    labels = JSON.parse(inspected.stdout.trim()) as Record<string, unknown> | null;
  } catch {
    throw new Error(`Docker returned unreadable labels for managed volume ${state.volumeName}.`);
  }
  if (!labels || typeof labels !== 'object') {
    throw new Error(`Volume ${state.volumeName} has no managed deployment labels.`);
  }
  if (
    labels['com.docker.compose.project'] !== state.composeProject
    || labels['com.docker.compose.volume'] !== 'or3-data'
    || (env.OR3_DEPLOYMENT_ID && labels['io.or3.cloud.deployment-id'] !== env.OR3_DEPLOYMENT_ID)
  ) {
    throw new Error(`Volume ${state.volumeName} does not carry the expected managed deployment labels.`);
  }
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
export async function dataVolumeSize(directory: string, mode: Mode, env: Record<string, string>) {
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

export async function dataVolumeFreeBytes(directory: string, mode: Mode, env: Record<string, string>) {
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
