import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Mode } from '../deployment/contracts';
import { type DashboardOperatorEnv, dashboardUpdatesEnabled } from '../deployment/env';
import { imageAtDigest, operatorImageFor } from '../deployment/identity';
import { deploymentPaths } from '../deployment/paths';
import { lifecycleFaults } from '../lifecycle-faults';
import { expectedOperatorImageDigest } from '../package-info';
import { run } from './command-runner';
import { compose } from './compose';
import { assertImageReleaseIdentity, assertSupportedHostArchitecture, pullImage } from './images';

const DASHBOARD_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPOSE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

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

export async function prepareVerifiedDashboardOperator(directory: string, version: string) {
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

export async function scheduleDashboardOperatorHandoff(directory: string, env: Record<string, string>, jobIdOverride?: string) {
  const jobId = jobIdOverride ?? process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim();
  if (!jobId || env.OR3_DASHBOARD_UPDATES_ENABLED !== 'true') return;
  await lifecycleFaults.beforeHandoff?.();
  const scheduled = await run('docker', dashboardOperatorHandoffArgs(directory, env, jobId), directory);
  if (!scheduled.ok || !/^[0-9a-f]{12,64}$/i.test(scheduled.stdout.trim())) {
    throw new Error(`Could not schedule the dashboard operator handoff. ${scheduled.stderr.trim()}`);
  }
}

export async function removeDashboardOperator(directory: string, mode: Mode) {
  if (!dashboardUpdatesEnabled(directory)) return;
  await compose(directory, mode, ['rm', '--stop', '--force', 'or3-operator']);
}

export function assertDashboardOperatorMounts(mounts: Array<{ Destination?: string }>, directory: string) {
  const destinations = new Set(mounts.map((mount) => mount.Destination));
  for (const destination of ['/var/run/docker.sock', resolve(directory), '/run/or3-operator']) {
    if (!destinations.has(destination)) throw new Error(`Dashboard operator is missing its required ${destination} mount.`);
  }
}
