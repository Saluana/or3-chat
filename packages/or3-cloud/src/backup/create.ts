import { chmod, lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MANAGED_ASSET_INVENTORY_VERSION, snapshotManagedAssets } from '../deployment/assets';
import type { BackupManifest, BackupProgress, ManagedState } from '../deployment/contracts';
import { backupDirectory, deploymentPaths } from '../deployment/paths';
import { requireImageDigest } from '../runtime/images';
import { projectServiceRunning, startProject, stopProject } from '../runtime/project';
import { dataVolumeSize } from '../runtime/volumes';
import { copySecure, sha256File, writeSecure } from '../util/fs';
import { id, now } from '../util/primitives';
import { assertFreeSpaceForArchive, volumeArchive } from './archive';
import { BACKUP_ID_PATTERN, readManifest, writeBackupAuthentication } from './manifests';
import { removeNamedBackupArtifact } from './retention';

const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));
const RECOVERY_STEPS = 'Keep the operation record. Inspect the named paths and their permissions, then run "npx @or3/cloud recover --dry-run" and "npx @or3/cloud recover" from the deployment directory. Do not restore an unverified artifact or remove recovery locks manually.';

async function artifactStatus(path: string) {
  try {
    await lstat(path);
    return { absent: false, detail: `Still present: ${path}.` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { absent: true, detail: `Confirmed absent: ${path}.` };
    return { absent: false, detail: `Could not inspect ${path}: ${asError(error).message}. Its removal is unverified.` };
  }
}

async function cleanupPartialBackup(directory: string, backupId: string) {
  let error: Error | undefined;
  try {
    await removeNamedBackupArtifact(directory, backupId);
  } catch (failure) {
    error = asError(failure);
  }
  // Deletion has two steps and can fail after the directory but before its
  // export receipt. Report each observed outcome, including unreadable paths.
  const statuses = await Promise.all([
    artifactStatus(backupDirectory(directory, backupId)),
    artifactStatus(join(deploymentPaths(directory).exports, `${backupId}.json`)),
  ]);
  const removed = statuses.every((status) => status.absent);
  const detail = statuses.map((status) => status.detail).join(' ');
  if (!removed && !error) error = new Error('Backup cleanup did not confirm removal of every artifact.');
  return { error, removed, detail };
}

export async function createBackup(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  options: {
    restartAfter?: boolean;
    backupId?: string;
    initiallyRunning?: boolean;
    onProgress?: (progress: BackupProgress) => void | Promise<void>;
  } = {},
) {
  const restartAfter = options.restartAfter ?? true;
  await requireImageDigest(state.image, state.imageDigest, 'Current deployment');
  const backupId = options.backupId ?? id('backup');
  if (!BACKUP_ID_PATTERN.test(backupId)) throw new Error(`Backup ID ${backupId} is invalid.`);
  const backupDir = backupDirectory(directory, backupId);
  const initiallyRunning = options.initiallyRunning ?? await projectServiceRunning(directory, state.mode);
  let service: BackupProgress['service'] = initiallyRunning ? 'running' : 'stopped';
  let artifact: BackupProgress['artifact'] = 'not-created';
  let downtimeMs: number | undefined;
  const report = async (stage: BackupProgress['stage'], message: string) => {
    await options.onProgress?.({ stage, service, artifact, message, downtimeMs });
  };
  await report('preflight', 'Preflight: checking image identity and backup disk space; service state is unchanged.');
  const volumeSize = await dataVolumeSize(directory, state.mode, env);
  await assertFreeSpaceForArchive(backupDir, volumeSize, 'Backup');

  let created = false;
  let stopAttempted = false;
  let stopStartedAt = 0;
  let capturedAt = now();
  let primaryFailure: Error | undefined;
  let restartFailure: Error | undefined;
  const progressFailures: Error[] = [];
  let managedAssetSha256: Record<string, string> | undefined;
  let verifiedManifest: BackupManifest | undefined;
  try {
    // Exclusive creation: a collision must never overwrite or clean up a
    // pre-existing backup, even when the caller supplies a backup ID.
    await mkdir(backupDir, { mode: 0o700 });
    created = true;
    artifact = 'partial';
    await chmod(backupDir, 0o700);
    await report('maintenance', 'Maintenance: stopping OR3 to capture the databases and files together.');
    stopAttempted = true;
    stopStartedAt = Date.now();
    service = 'unknown';
    await stopProject(directory, state.mode);
    service = 'stopped';
    capturedAt = now();
    await report('capturing', `Backup capture: OR3 is stopped; writing ${backupDir}.`);
    await volumeArchive(directory, state.mode, env, backupDir);
    await copySecure(deploymentPaths(directory).env, join(backupDir, 'config.env'));
    managedAssetSha256 = await snapshotManagedAssets(directory, state.mode, backupDir);
    artifact = 'captured';
  } catch (error) {
    primaryFailure = asError(error);
  } finally {
    if (stopAttempted && restartAfter && initiallyRunning) {
      service = 'restarting';
      // A progress/journal error must not prevent an attempted service restart.
      try { await report('restarting', 'Restart: bringing OR3 back and checking deep health; backup verification is still pending.'); }
      catch (error) { progressFailures.push(asError(error)); }
      try {
        await startProject(directory, state.mode, env);
        service = 'healthy';
        downtimeMs = Date.now() - stopStartedAt;
      } catch (error) {
        service = 'unknown';
        restartFailure = asError(error);
      }
    }
  }

  // Captured files are private and no longer depend on the live volume. For a
  // standalone backup, hash/authenticate them after service recovery. Mutation
  // snapshots deliberately keep the source stopped through verification.
  if (!primaryFailure) {
    try {
      await report('verifying', `Verification: checking the captured backup; ${service === 'healthy' ? 'OR3 is deeply healthy' : service === 'stopped' ? 'OR3 remains stopped' : 'service recovery is unverified'}.`);
      const manifest: BackupManifest = {
        schemaVersion: 1,
        backupId,
        createdAt: capturedAt,
        appVersion: state.appVersion,
        image: state.image,
        imageDigest: state.imageDigest,
        dataSha256: await sha256File(join(backupDir, 'data.tgz')),
        dataBytes: volumeSize,
        configSha256: await sha256File(join(backupDir, 'config.env')),
        managedAssetSha256,
        managedAssetInventoryVersion: managedAssetSha256?.['compose.operator.yaml']
          ? MANAGED_ASSET_INVENTORY_VERSION
          : managedAssetSha256?.['dashboard-operator.mjs'] ? 2 : undefined,
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
      verifiedManifest = await readManifest(backupDir, directory);
      artifact = 'verified';
    } catch (error) {
      primaryFailure = asError(error);
    }
  }

  let cleanupFailure: Error | undefined;
  let cleanupDetail = '';
  if (primaryFailure && created && !verifiedManifest) {
    try { await report('cleanup', 'Cleanup: removing only this operation’s unverified backup artifacts.'); }
    catch (error) { progressFailures.push(asError(error)); }
    const cleanup = await cleanupPartialBackup(directory, backupId);
    cleanupFailure = cleanup.error;
    cleanupDetail = cleanup.detail;
    artifact = cleanup.removed ? 'removed' : 'unknown';
  }
  const failures = [primaryFailure, cleanupFailure, restartFailure, ...progressFailures].filter((error): error is Error => Boolean(error));
  const serviceDetail = service === 'healthy'
    ? `OR3 restarted and is deeply healthy (maintenance interval ${downtimeMs} ms).`
    : service === 'stopped' ? 'OR3 remains stopped as requested.'
      : service === 'running' ? 'OR3 was not stopped; deep health has not been checked.'
        : 'Service recovery is unverified; OR3 may be unavailable.';
  if (failures.length > 0) {
    const message = [
      primaryFailure ? `Backup failed: ${primaryFailure.message}` : `Verified backup retained at ${backupDir}.`,
      cleanupFailure ? `Cleanup failed: ${cleanupFailure.message}` : '',
      cleanupDetail,
      restartFailure ? `Restart failed: ${restartFailure.message}` : '',
      ...progressFailures.map((error) => `Progress recording failed: ${error.message}`),
      serviceDetail,
      RECOVERY_STEPS,
    ].filter(Boolean).join(' ');
    try { await report('failed', message); }
    catch (error) { failures.push(asError(error)); }
    throw new AggregateError(failures, message);
  }
  try {
    await report('complete', `Backup verified at ${backupDir}. ${serviceDetail}`);
  } catch (error) {
    throw new Error(`Verified backup retained at ${backupDir}. ${serviceDetail} Could not record backup completion: ${asError(error).message}. ${RECOVERY_STEPS}`, { cause: error });
  }
  return { backupId, backupDir, manifest: verifiedManifest! };
}

export async function cleanupJournaledPartialBackup(directory: string, backupId?: string, backupPath?: string) {
  if (!backupId || !backupPath || !BACKUP_ID_PATTERN.test(backupId)) return;
  const expectedPath = resolve(backupDirectory(directory, backupId));
  if (resolve(backupPath) !== expectedPath) return;
  try {
    await readManifest(expectedPath, directory);
    return { artifact: 'verified' as const, detail: `Verified backup retained at ${expectedPath}.` };
  } catch {
    const cleanup = await cleanupPartialBackup(directory, backupId);
    if (cleanup.error) throw new Error(`Partial backup cleanup failed: ${cleanup.error.message} ${cleanup.detail} ${RECOVERY_STEPS}`, { cause: cleanup.error });
    return { artifact: 'removed' as const, detail: cleanup.detail };
  }
}

export async function createPreMutationSnapshot(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  backupId: string,
) {
  return await createBackup(directory, state, env, { restartAfter: false, backupId });
}
