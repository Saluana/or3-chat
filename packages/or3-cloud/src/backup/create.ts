import { chmod, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MANAGED_ASSET_INVENTORY_VERSION, snapshotManagedAssets } from '../deployment/assets';
import type { BackupManifest, ManagedState } from '../deployment/contracts';
import { backupDirectory, deploymentPaths } from '../deployment/paths';
import { requireImageDigest } from '../runtime/images';
import { projectServiceRunning, startProject, stopProject } from '../runtime/project';
import { dataVolumeSize } from '../runtime/volumes';
import { copySecure, fileExists, sha256File, writeSecure } from '../util/fs';
import { id, now } from '../util/primitives';
import { assertFreeSpaceForArchive, volumeArchive } from './archive';
import { BACKUP_ID_PATTERN, readManifest, writeBackupAuthentication } from './manifests';
import { removeNamedBackupArtifact } from './retention';

export async function createBackup(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  options: { restartAfter?: boolean; backupId?: string; initiallyRunning?: boolean } = {},
) {
  const restartAfter = options.restartAfter ?? true;
  await requireImageDigest(state.image, state.imageDigest, 'Current deployment');
  const backupId = options.backupId ?? id('backup');
  if (!BACKUP_ID_PATTERN.test(backupId)) throw new Error(`Backup ID ${backupId} is invalid.`);
  const backupDir = backupDirectory(directory, backupId);
  const initiallyRunning = options.initiallyRunning ?? await projectServiceRunning(directory, state.mode);
  // Preflight before anything is created: the archive needs the live volume
  // size plus reserve headroom on the deployment filesystem.
  const volumeSize = await dataVolumeSize(directory, state.mode, env);
  await assertFreeSpaceForArchive(backupDir, volumeSize, 'Backup');
  let manifestWritten = false;
  let stopAttempted = false;
  let backupFailure: Error | undefined;
  try {
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await chmod(backupDir, 0o700);
    stopAttempted = true;
    await stopProject(directory, state.mode);
    await volumeArchive(directory, state.mode, env, backupDir);
    await copySecure(deploymentPaths(directory).env, join(backupDir, 'config.env'));
    const managedAssetSha256 = await snapshotManagedAssets(directory, state.mode, backupDir);
    const manifest: BackupManifest = {
      schemaVersion: 1,
      backupId,
      createdAt: now(),
      appVersion: state.appVersion,
      image: state.image,
      imageDigest: state.imageDigest,
      dataSha256: await sha256File(join(backupDir, 'data.tgz')),
      dataBytes: volumeSize,
      configSha256: await sha256File(join(backupDir, 'config.env')),
      managedAssetSha256,
      managedAssetInventoryVersion: managedAssetSha256['compose.operator.yaml']
        ? MANAGED_ASSET_INVENTORY_VERSION
        : managedAssetSha256['dashboard-operator.mjs']
          ? 2
          : undefined,
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
    const verifiedManifest = await readManifest(backupDir, directory);
    manifestWritten = true;
    return { backupId, backupDir, manifest: verifiedManifest };
  } catch (error) {
    if (!manifestWritten) {
      await removeNamedBackupArtifact(directory, backupId).catch(() => undefined);
      backupFailure = new Error(`${error instanceof Error ? error.message : String(error)} The partial backup artifact at ${backupDir} was removed.`);
      throw backupFailure;
    }
    backupFailure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    if (stopAttempted && restartAfter && initiallyRunning) {
      try {
        await startProject(directory, state.mode, env);
      } catch (error) {
        const restartFailure = error instanceof Error ? error : new Error(String(error));
        if (backupFailure) {
          throw new AggregateError(
            [backupFailure, restartFailure],
            `Backup failed and OR3 could not restart. Primary failure: ${backupFailure.message}. Restart failure: ${restartFailure.message}`,
          );
        }
        throw new Error(`Backup was created but OR3 could not restart: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export async function cleanupJournaledPartialBackup(directory: string, backupId?: string, backupPath?: string) {
  if (!backupId || !backupPath || !BACKUP_ID_PATTERN.test(backupId)) return;
  const expectedPath = resolve(backupDirectory(directory, backupId));
  if (resolve(backupPath) !== expectedPath || !await fileExists(expectedPath)) return;
  try {
    await readManifest(expectedPath, directory);
  } catch {
    await removeNamedBackupArtifact(directory, backupId);
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
