import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inventoryBackups } from '../backup/manifests';
import { run } from '../runtime/command-runner';
import { composeArgs } from '../runtime/compose';
import { ensureDocker } from '../runtime/docker';
import { imageDigest } from '../runtime/images';
import { fileExists, readText } from '../util/fs';
import { now, redact } from '../util/primitives';
import type { BackupInventory, Diagnostic, ManagedState, Mode } from './contracts';
import { parseEnv } from './env';
import { cliLeaseOwnerIsGone, dashboardLeaseOwnerIsStale, type LeaseOwner, readLeaseOwner } from './lease';
import { deploymentPaths } from './paths';
import { readState } from './state-store';

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
