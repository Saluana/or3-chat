import { join } from 'node:path';
import { createPreMutationSnapshot } from '../backup/create';
import { validateVolumeArchive } from '../backup/archive';
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

export async function rollbackCommand(directory: string, flags: Flags) {
  if (!boolFlag(flags, 'yes')) throw new Error('Rollback restores the previous image and data snapshot. Re-run with --yes after confirming post-update data loss.');
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const point = loaded.state.rollback;
  if (!point) throw new Error('No immediate rollback point is recorded for this deployment.');
  const backupPath = await resolveBackup(loaded.directory, point.backupId);
  const manifest = await readManifest(backupPath, loaded.directory);
  assertRestorableManagedAssets(manifest);
  if (manifest.appVersion !== point.appVersion || manifest.image !== point.image || manifest.imageDigest !== point.imageDigest) {
    throw new Error(`Rollback point ${point.backupId} no longer matches its recorded image/version. Refusing to mutate the deployment.`);
  }
  const backupEnv = parseEnv(await readText(join(backupPath, 'config.env')));
  if (backupEnv.OR3_VERSION !== manifest.appVersion || backupEnv.OR3_IMAGE !== manifest.image) {
    throw new Error(`Backup ${manifest.backupId} configuration does not match its manifest.`);
  }
  assertBackupMatchesDeployment(manifest, backupEnv, loaded.state, loaded.env);
  const recreateDataVolume = restoreRequiresVolumeRecreation(loaded.env, backupEnv);
  await pullAndRequireImage(point.image, point.imageDigest, 'Rollback');
  await assertSupportedHostArchitecture(point.image);
  await assertRestoreFreeSpace(loaded.directory, loaded.state, loaded.env, manifest, backupPath);
  // Snapshot capture already stops the app. Validate before journaling/capture,
  // using the authenticated archived FS root and retaining the later recheck.
  await validateVolumeArchive(loaded.directory, loaded.state.mode, loaded.env, backupPath, backupEnv.OR3_STORAGE_FS_ROOT);
  // The authenticated immediate rollback point is an internal byte-preservation
  // snapshot. Its previous published image may predate the canonical inspector.
  // Preserve that recovery path, with physical integrity checks still enforced.
  const pending: PendingOperation = {
    id: id('rollback'),
    operation: 'rollback',
    startedAt: now(),
    message: `Rolling back to ${point.appVersion}`,
    backupId: point.backupId,
    backupPath,
    backupDataSha256: manifest.dataSha256,
    backupConfigSha256: manifest.configSha256,
    targetVersion: point.appVersion,
    targetImage: point.image,
    targetImageDigest: point.imageDigest,
    recreateDataVolume,
    phase: 'prepared',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const previousBackupId = id('backup-before-rollback');
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
    await restoreBackupData(loaded.directory, loaded.state, loaded.env, backupPath, {
      recreateDataVolume,
      previousSafetySnapshot: true,
      beforeStart: () => updatePending(loaded.directory, loaded.state, { phase: 'starting-target' }),
    });
    const restoredEnv = parseEnv(await readText(deploymentPaths(loaded.directory).env));
    const nextState = stateFromEnv(loaded.directory, restoredEnv, loaded.state.mode, 'restore', await imageDigest(restoredEnv.OR3_IMAGE));
    nextState.rollback = undefined;
    // Terminal state first; the redundant mirror is warning-only housekeeping so
    // its failure cannot send a completed rollback into the destructive handler.
    await writeState(loaded.directory, nextState);
    await removeOperationRecordSafely(loaded.directory, pending.id);
    console.log(`Rolled back to OR3 ${nextState.appVersion}. Verify sign-in, chat, and file access.`);
  } catch (error) {
    const original = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    const phase = loaded.state.incompleteOperation?.phase;
    if (phase === 'starting-target') {
      loaded.state.lastError = `Rollback to ${point.appVersion} started the target but did not complete: ${original}. Writes may have been accepted, so the deployment was NOT restored automatically. Keep the operation record and run "npx @or3/cloud recover --dry-run", then "npx @or3/cloud recover --restore --yes" only after confirming loss of post-replacement writes.`;
      await writeState(loaded.directory, loaded.state);
      throw new Error(loaded.state.lastError, { cause: error });
    }
    const targetMayHaveMutated = phase === 'target-mutating' || phase === 'restoring-previous';
    if (targetMayHaveMutated && (loaded.state.incompleteOperation?.previousBackupPath || loaded.state.incompleteOperation?.previousBackupId)) {
      let recoveredMessage: string;
      try {
        const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
        recoveredMessage = `Rollback to ${point.appVersion} failed and the pre-rollback snapshot ${previous.manifest.backupId} was restored: ${original}`;
        await commitPreMutationRecovery(loaded.directory, loaded.state, recoveredMessage);
      } catch (recoveryError) {
        const recovery = redact(recoveryError instanceof Error ? recoveryError.message : String(recoveryError), secretValues(loaded.env));
        loaded.state.lastError = `Rollback to ${point.appVersion} failed, and automatic restoration of the pre-rollback snapshot also failed: ${recovery}. Original rollback error: ${original}`;
        await writeState(loaded.directory, loaded.state);
        throw new Error(loaded.state.lastError);
      }
      throw new Error(recoveredMessage!);
    }
    try {
      await startProject(loaded.directory, loaded.state.mode, loaded.env);
      loaded.state.lastError = `Rollback to ${point.appVersion} stopped before data replacement: ${original}`;
      await clearPending(loaded.directory, loaded.state);
    } catch (restartError) {
      const restart = redact(restartError instanceof Error ? restartError.message : String(restartError), secretValues(loaded.env));
      loaded.state.lastError = `Rollback to ${point.appVersion} stopped before data replacement, but the original deployment could not restart: ${restart}. Original rollback error: ${original}`;
      await writeState(loaded.directory, loaded.state);
      throw new Error(loaded.state.lastError);
    }
    throw error;
  }
}
