import { join } from 'node:path';
import { createPreMutationSnapshot } from '../backup/create';
import { assertBackupMatchesDeployment, readManifest, resolveBackup } from '../backup/manifests';
import { assertRestoreFreeSpace, restoreBackupData, restorePreMutationSnapshot } from '../backup/restore';
import { boolFlag, type Flags } from '../cli/args';
import { assertRestorableManagedAssets } from '../deployment/assets';
import type { PendingOperation } from '../deployment/contracts';
import { parseEnv, secretValues } from '../deployment/env';
import { backupDirectory, deploymentPaths } from '../deployment/paths';
import { commitPreMutationRecovery } from '../deployment/recovery';
import {
  assertNoPending,
  clearPending,
  loadManaged,
  markPending,
  removeOperationRecordSafely,
  stateFromEnv,
  updatePending,
  writeState,
} from '../deployment/state-store';
import { ensureDocker } from '../runtime/docker';
import { assertSupportedHostArchitecture, imageDigest, pullAndRequireImage } from '../runtime/images';
import { startProject } from '../runtime/project';
import { restoreRequiresVolumeRecreation } from '../runtime/volumes';
import { readText } from '../util/fs';
import { id, now, redact } from '../util/primitives';

export async function restoreCommand(directory: string, flags: Flags, positionals: string[]) {
  if (!boolFlag(flags, 'yes')) throw new Error('Restore replaces live data. Re-run with --yes after confirming the backup and data-loss boundary.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const backupValue = positionals[0];
  if (!backupValue) throw new Error('restore requires a backup ID or path.');
  const backupPath = await resolveBackup(loaded.directory, backupValue);
  const manifest = await readManifest(backupPath, loaded.directory);
  assertRestorableManagedAssets(manifest);
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
  const recreateDataVolume = restoreRequiresVolumeRecreation(loaded.env, backupEnv);
  if (manifest.imageDigest) await pullAndRequireImage(manifest.image, manifest.imageDigest, `Backup ${manifest.backupId}`);
  await assertSupportedHostArchitecture(manifest.image);
  // Do this before recording a recovery operation: a capacity refusal has not
  // touched the live deployment and should not require an operator recovery.
  await assertRestoreFreeSpace(loaded.directory, loaded.state, loaded.env, manifest, backupPath);
  const pending: PendingOperation = {
    id: id('restore'),
    operation: 'restore',
    startedAt: now(),
    message: `Restoring backup ${manifest.backupId}`,
    backupId: manifest.backupId,
    backupPath,
    backupDataSha256: manifest.dataSha256,
    backupConfigSha256: manifest.configSha256,
    targetVersion: manifest.appVersion,
    targetImage: manifest.image,
    targetImageDigest: manifest.imageDigest,
    recreateDataVolume,
    phase: 'prepared',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const previousBackupId = id('backup-before-restore');
    await updatePending(loaded.directory, loaded.state, {
      previousBackupId,
      previousBackupPath: backupDirectory(loaded.directory, previousBackupId),
    });
    const previous = await createPreMutationSnapshot(loaded.directory, loaded.state, loaded.env, previousBackupId);
    await updatePending(loaded.directory, loaded.state, {
      previousBackupId: previous.backupId,
      previousBackupPath: previous.backupDir,
      phase: 'snapshot-created',
    });
    await updatePending(loaded.directory, loaded.state, { phase: 'target-mutating' });
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath, { recreateDataVolume });
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const digest = await imageDigest(restoredEnv.OR3_IMAGE);
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', digest);
    nextState.lastError = undefined;
    // Terminal state first; the redundant mirror is warning-only housekeeping so
    // its failure cannot send a completed restore into the destructive handler.
    await writeState(loaded.directory, nextState);
    await removeOperationRecordSafely(loaded.directory, pending.id);
    console.log(`Restored ${manifest.backupId}. Verify sign-in, a conversation, and a previously uploaded file.`);
  } catch (error) {
    const original = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    const phase = loaded.state.incompleteOperation?.phase;
    const targetMayHaveMutated = phase === 'target-mutating' || phase === 'restoring-previous' || phase === 'starting-target';
    if (targetMayHaveMutated && (loaded.state.incompleteOperation?.previousBackupPath || loaded.state.incompleteOperation?.previousBackupId)) {
      let recoveredMessage: string;
      try {
        const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
        recoveredMessage = `Restore of ${manifest.backupId} failed and the pre-restore snapshot ${previous.manifest.backupId} was restored: ${original}`;
        await commitPreMutationRecovery(loaded.directory, loaded.state, recoveredMessage);
      } catch (recoveryError) {
        const recovery = redact(recoveryError instanceof Error ? recoveryError.message : String(recoveryError), secretValues(loaded.env));
        loaded.state.lastError = `Restore of ${manifest.backupId} failed, and automatic restoration of the pre-restore snapshot also failed: ${recovery}. Original restore error: ${original}`;
        await writeState(loaded.directory, loaded.state);
        throw new Error(loaded.state.lastError);
      }
      throw new Error(recoveredMessage!);
    }
    // No target mutation was recorded. A stopped backup snapshot is harmless,
    // but OR3 may be down; return the original deployment to health before
    // removing the no-longer-actionable operation record.
    try {
      await startProject(loaded.directory, loaded.state.mode, loaded.env);
      loaded.state.lastError = `Restore of ${manifest.backupId} stopped before data replacement: ${original}`;
      await clearPending(loaded.directory, loaded.state);
    } catch (restartError) {
      const restart = redact(restartError instanceof Error ? restartError.message : String(restartError), secretValues(loaded.env));
      loaded.state.lastError = `Restore of ${manifest.backupId} stopped before data replacement, but the original deployment could not restart: ${restart}. Original restore error: ${original}`;
      await writeState(loaded.directory, loaded.state);
      throw new Error(loaded.state.lastError);
    }
    throw error;
  }
}
