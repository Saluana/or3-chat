import { join } from 'node:path';
import { restoreVolumeArchive } from '../backup/archive';
import { cleanupJournaledPartialBackup, inspectUnclaimedBackupArtifacts } from '../backup/create';
import { readManifest, resolveBackup } from '../backup/manifests';
import { restorePreMutationSnapshot } from '../backup/restore';
import { boolFlag, type Flags } from '../cli/args';
import { applyCredentialReset } from '../credentials/reset';
import { restartSource, sourceMode } from '../deployment/adoption-source';
import { emitOperationResult, type Mode, type OperationOutcome } from '../deployment/contracts';
import { parseEnv, secretValues, serializeEnv, withoutProvisioningCredentials } from '../deployment/env';
import { observationFindings, observeDeployment } from '../deployment/observation';
import { deploymentPaths } from '../deployment/paths';
import {
  commitPreMutationRecovery,
  decideRecoveryAction,
  finishTargetReadyUpdate,
  operationToStateOperation,
  reconcileOperatorHandoff,
} from '../deployment/recovery';
import {
  clearPending,
  commitRecoveredState,
  loadManaged,
  stateFromEnv,
  writeState,
} from '../deployment/state-store';
import { compose } from '../runtime/compose';
import { ensureDocker } from '../runtime/docker';
import { imageDigest, pullAndRequireImage } from '../runtime/images';
import { startProject, stopProject } from '../runtime/project';
import { provisionManagedCredentials } from '../runtime/verification';
import { readText, writeSecure } from '../util/fs';
import { redact } from '../util/primitives';

function assertRecoverFlags(flags: Flags) {
  const dryRun = boolFlag(flags, 'dry-run');
  const finish = boolFlag(flags, 'finish');
  const restore = boolFlag(flags, 'restore');
  if (finish && restore) throw new Error('Use either --finish or --restore, not both.');
  if (dryRun && (finish || restore)) throw new Error('--dry-run cannot be combined with --finish or --restore.');
  if (restore && !boolFlag(flags, 'yes')) {
    throw new Error('recover --restore replaces live data. Review `npx @or3/cloud recover --dry-run` first, then re-run with `recover --restore --yes`.');
  }
}

export async function recoverCommand(directory: string, flags: Flags = {}) {
  assertRecoverFlags(flags);
  const explicitRestore = boolFlag(flags, 'restore');
  const finishRequested = boolFlag(flags, 'finish');
  const dryRun = boolFlag(flags, 'dry-run');

  if (dryRun) {
    const observation = await observeDeployment(directory, { checkDocker: true, checkImage: true });
    const state = observation.state;
    const decision = state ? decideRecoveryAction(state) : { action: 'none' as const, detail: 'Managed state is unreadable; only diagnosis is available.' };
    const pending = state?.incompleteOperation;
    const payload = {
      schemaVersion: 1,
      kind: 'or3-recover-preview',
      observedAt: observation.observedAt,
      directory: observation.directory,
      partial: observation.partial,
      inProgress: observation.changing,
      source: state ? { appVersion: state.appVersion, image: state.image, imageDigest: state.imageDigest } : null,
      target: pending?.targetVersion ? { appVersion: pending.targetVersion, image: pending.targetImage ?? null, imageDigest: pending.targetImageDigest ?? null } : null,
      phase: pending?.phase ?? null,
      operation: pending?.operation ?? null,
      decision,
      dataLoss: decision.action === 'require-explicit-restore',
      findings: observationFindings(observation),
    };
    if (boolFlag(flags, 'json')) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`OR3 recovery preview for ${observation.directory}`);
      console.log(`  source: ${payload.source ? `OR3 ${payload.source.appVersion} (${payload.source.imageDigest})` : 'unknown'}`);
      console.log(`  target: ${payload.target ? `OR3 ${payload.target.appVersion}` : 'none'}`);
      console.log(`  operation: ${payload.operation ?? 'none'}${payload.phase ? ` (${payload.phase})` : ''}`);
      console.log(`  action: ${decision.action} — ${decision.detail}`);
      if (payload.dataLoss) console.log('  data loss: yes — restoring the recorded snapshot discards writes made after it.');
      for (const finding of payload.findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
      console.log('\nPreview only: nothing was changed.');
    }
    return;
  }

  const asJson = boolFlag(flags, 'json');
  const report = (...args: unknown[]) => {
    if (asJson) console.error(...args);
    else console.log(...args);
  };
  await ensureDocker();
  try {
    const outcome = await runRecovery(directory, { explicitRestore, finishRequested, report });
    if (asJson) emitOperationResult(outcome);
  } catch (error) {
    if (!asJson) throw error;
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(`OR3 Cloud failed: ${message}`);
    emitOperationResult({ kind: 'blocked', findings: [{ code: 'recovery-failed', severity: 'blocker', message, nextCommand: 'npx @or3/cloud recover --dry-run' }] });
    process.exitCode = 1;
  }
}

/**
 * Performs one non-dry-run recovery. Returns the terminal outcome so the JSON
 * path can serialize exactly one result and the human path can print one
 * summary; it never prints its own result document.
 */
async function runRecovery(
  directory: string,
  context: { explicitRestore: boolean; finishRequested: boolean; report: (...args: unknown[]) => void },
): Promise<OperationOutcome> {
  const { explicitRestore, finishRequested, report } = context;
  const loaded = await loadManaged(directory);
  const pending = loaded.state.incompleteOperation;
  const decision = decideRecoveryAction(loaded.state);
  // Handoff reconciliation is evaluated before the no-pending early return: an
  // application commit can be complete while its privileged handoff is not, and
  // that state records no pending operation.
  if (decision.action === 'reconcile-handoff') {
    if (explicitRestore) throw new Error('This deployment completed its application update; only the dashboard operator handoff needs reconciliation. Run `npx @or3/cloud recover --finish` without --restore.');
    const detail = await reconcileOperatorHandoff(loaded.directory, loaded.state, report);
    return { kind: 'recovered', operation: 'update', detail };
  }
  if (!pending) {
    if (finishRequested) {
      if (loaded.state.lastReceipt) {
        const detail = `No incomplete operation is recorded; the last ${loaded.state.lastReceipt.operationId} completion remains authoritative. Nothing to finish.`;
        report(detail);
        return { kind: 'no-op', detail };
      }
      throw new Error('recover --finish requires an incomplete operation, but none is recorded.');
    }
    const detail = 'No incomplete OR3 Cloud operation is recorded.';
    report(detail);
    return { kind: 'no-op', detail };
  }
  if (finishRequested) {
    if (decision.action !== 'finish') {
      throw new Error(`recover --finish is not admissible: ${decision.detail} Run "npx @or3/cloud recover --dry-run" to inspect the supported actions.`);
    }
    const detail = await finishTargetReadyUpdate(loaded.directory, loaded.state, loaded.env, report);
    return { kind: 'recovered', operation: 'update', detail };
  }
  // Plain recover finishes only proven non-destructive work. A deployment that
  // may have replaced data requires the explicit `--restore --yes` choice.
  const requiresExplicitRestore = decision.action === 'require-explicit-restore';
  try {
    if (pending.operation === 'backup') {
      // A failed artifact deletion must not strand a known-good deployment in
      // maintenance. Recover the service independently, then retry cleanup.
      const failures: Error[] = [];
      let service: 'stopped' | 'healthy' | 'unknown' = pending.initialAppRunning === false ? 'stopped' : 'unknown';
      let artifact = pending.backupProgress?.artifact ?? 'unknown';
      let artifactDetail = '';
      if (pending.initialAppRunning !== false) {
        report('Restart: recovering OR3 and checking deep health before backup cleanup.');
        try {
          await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
          await startProject(loaded.directory, loaded.state.mode, loaded.env);
          service = 'healthy';
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        if (artifact === 'not-created') {
          // A crash before the mkdir milestone and a pre-existing collision
          // have the same journal. Observation must never grant deletion rights,
          // including when a failed service restart keeps this operation pending.
          artifactDetail = await inspectUnclaimedBackupArtifacts(loaded.directory, pending.backupId, pending.backupPath) ?? '';
        } else {
          const cleanup = await cleanupJournaledPartialBackup(loaded.directory, pending.backupId, pending.backupPath);
          if (cleanup) {
            artifact = cleanup.artifact;
            report(cleanup.detail);
          }
        }
      } catch (error) {
        if (artifact !== 'not-created') artifact = 'unknown';
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
      const serviceDetail = service === 'healthy' ? 'OR3 is deeply healthy.'
        : service === 'stopped' ? 'The intentionally stopped OR3 service was preserved.'
          : 'Service recovery is unverified; OR3 may be unavailable.';
      if (failures.length > 0) {
        const message = [failures.map((error) => error.message).join(' '), serviceDetail, artifactDetail].filter(Boolean).join(' ');
        pending.backupProgress = { stage: 'failed', service, artifact, message: redact(message, secretValues(loaded.env)) };
        throw new AggregateError(failures, message);
      }
      const completed = structuredClone(loaded.state);
      completed.lastError = undefined;
      await clearPending(loaded.directory, completed);
      const detail = [`Recovered the incomplete backup operation. ${serviceDetail}`, artifactDetail].filter(Boolean).join(' ');
      report(detail);
      return { kind: 'recovered', operation: 'backup', detail };
    }
    if (pending.phase === 'prepared') {
      if (pending.operation === 'update' || pending.operation === 'adopt') {
        await cleanupJournaledPartialBackup(loaded.directory, pending.backupId, pending.backupPath);
      }
      if (pending.operation === 'restore' || pending.operation === 'rollback') {
        await cleanupJournaledPartialBackup(loaded.directory, pending.previousBackupId, pending.previousBackupPath);
      }
    }
    if (pending.operation === 'credentials-reset') {
      const nextEnv = pending.credentialReset?.nextEnv;
      if (!nextEnv) throw new Error('The incomplete credential reset has no protected recovery data. Restore a backup rather than guessing credentials.');
      await applyCredentialReset(loaded.directory, loaded.state, nextEnv);
      loaded.state.lastError = undefined;
      await clearPending(loaded.directory, loaded.state);
      const detail = 'Recovered the incomplete credential reset. Owner and admin credentials were verified inside the OR3 container.';
      report(detail);
      return { kind: 'recovered', operation: 'credentials-reset', detail };
    }

    if (pending.operation === 'restore' || pending.operation === 'rollback') {
      if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
        // The target was not yet allowed to mutate the deployment. A snapshot
        // can leave OR3 stopped, so make the known-good deployment healthy
        // again instead of replaying a requested restore whose boundary is
        // unknown after an interruption.
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
        loaded.state.lastError = undefined;
        await clearPending(loaded.directory, loaded.state);
        const detail = `Recovered the incomplete ${pending.operation} before data replacement. OR3 ${loaded.state.appVersion} is deeply healthy.`;
        report(detail);
        return { kind: 'recovered', operation: pending.operation, detail };
      }
      if (requiresExplicitRestore && !explicitRestore) {
        throw new Error(`The incomplete ${pending.operation} may have replaced data and has no completion proof. Nothing was changed. Review "npx @or3/cloud recover --dry-run", then restore deliberately with "npx @or3/cloud recover --restore --yes" (this discards writes made after the recorded snapshot).`);
      }
      if (!pending.previousBackupPath && !pending.previousBackupId) {
        throw new Error(`The incomplete ${pending.operation} has no verified pre-mutation snapshot. Refusing to replay a target that may have been partially restored; inspect the deployment and restore an authenticated backup explicitly.`);
      }
      const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
      const recovered = await commitPreMutationRecovery(
        loaded.directory,
        loaded.state,
        `Interrupted ${pending.operation} was rolled back to pre-mutation snapshot ${previous.manifest.backupId}.`,
      );
      const detail = `Recovered the incomplete ${pending.operation} by restoring pre-mutation snapshot ${previous.manifest.backupId}. OR3 ${recovered.appVersion} is deeply healthy.`;
      report(detail);
      return { kind: 'recovered', operation: pending.operation, detail };
    }

    if (pending.operation === 'update') {
      if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
        await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
        await startProject(loaded.directory, loaded.state.mode, loaded.env);
        const recovered = stateFromEnv(loaded.directory, loaded.env, loaded.state.mode, loaded.state.lastSuccessfulOperation, await imageDigest(loaded.env.OR3_IMAGE));
        recovered.rollback = loaded.state.rollback;
        recovered.lastError = undefined;
        await commitRecoveredState(loaded.directory, loaded.state, recovered);
        const detail = `Recovered the incomplete update before the replacement was applied. OR3 ${recovered.appVersion} is deeply healthy.`;
        report(detail);
        return { kind: 'recovered', operation: 'update', detail };
      }
      // A recorded target-ready milestone means the replacement succeeded; finish
      // forward and preserve post-replacement writes. An explicit --restore
      // request takes precedence so the advertised escape path always works.
      if (decision.action === 'finish' && !explicitRestore) {
        const detail = await finishTargetReadyUpdate(loaded.directory, loaded.state, loaded.env, report);
        return { kind: 'recovered', operation: 'update', detail };
      }
      if (requiresExplicitRestore && !explicitRestore) {
        throw new Error(`The incomplete update may have replaced data and has no completion proof. Nothing was changed. Review "npx @or3/cloud recover --dry-run", then restore deliberately with "npx @or3/cloud recover --restore --yes" (this discards writes made after the recorded pre-update snapshot).`);
      }
      if (!pending.backupPath && !pending.backupId) {
        throw new Error('The incomplete update has no verified pre-update snapshot. Refusing to guess which image or data should be live.');
      }
      const previous = await restorePreMutationSnapshot(loaded.directory, loaded.state, loaded.env);
      const recovered = await commitPreMutationRecovery(
        loaded.directory,
        loaded.state,
        `Interrupted update was rolled back to pre-update snapshot ${previous.manifest.backupId}.`,
      );
      const detail = `Recovered the incomplete update by restoring pre-update snapshot ${previous.manifest.backupId}. OR3 ${recovered.appVersion} is deeply healthy.`;
      report(detail);
      return { kind: 'recovered', operation: 'update', detail };
    }

    if (pending.operation === 'adopt') {
      if (!pending.backupId) throw new Error('The incomplete adoption has no source backup ID. Refusing to claim that data was transferred.');
      const sourceBackupPath = await resolveBackup(loaded.directory, pending.backupId);
      const sourceManifest = await readManifest(sourceBackupPath, loaded.directory);
      if (
        sourceManifest.mode !== loaded.state.mode ||
        sourceManifest.appVersion !== loaded.state.appVersion ||
        sourceManifest.image !== loaded.state.image ||
        sourceManifest.imageDigest !== loaded.state.imageDigest
      ) {
        throw new Error(`Source backup ${sourceManifest.backupId} does not match the managed adoption target.`);
      }
      await stopProject(loaded.directory, loaded.state.mode);
      await restoreVolumeArchive(loaded.directory, loaded.state.mode, loaded.env, sourceBackupPath);
    }

    // Init keeps the current .env as the intended deployment.
    // Starting is idempotent and commits only its observed image digest after
    // deep health passes. Adoption additionally replays its verified source
    // archive before starting, so a crash cannot silently adopt an empty or
    // partially copied volume.
    await pullAndRequireImage(loaded.state.image, loaded.state.imageDigest, 'Current deployment');
    await startProject(loaded.directory, loaded.state.mode, loaded.env);
    let recoveredEnv = loaded.env;
    if (
      loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL
      && loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD
      && loaded.env.OR3_ADMIN_PASSWORD
    ) {
      await provisionManagedCredentials(
        loaded.state.mode === 'public'
          ? new URL(`https://${loaded.env.OR3_PUBLIC_DOMAIN}`)
          : new URL(`http://127.0.0.1:${loaded.env.OR3_PORT}`),
        loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL,
        loaded.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD,
        loaded.env.OR3_ADMIN_USERNAME,
        loaded.env.OR3_ADMIN_PASSWORD,
      );
      recoveredEnv = withoutProvisioningCredentials(loaded.env);
      await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(recoveredEnv));
      await stopProject(loaded.directory, loaded.state.mode);
      await startProject(loaded.directory, loaded.state.mode, recoveredEnv);
    }
    const digest = await imageDigest(recoveredEnv.OR3_IMAGE);
    const recovered = stateFromEnv(
      loaded.directory,
      recoveredEnv,
      loaded.state.mode,
      operationToStateOperation(pending.operation, loaded.state.lastSuccessfulOperation),
      digest,
    );
    recovered.rollback = loaded.state.rollback;
    recovered.lastError = undefined;
    await commitRecoveredState(loaded.directory, loaded.state, recovered);
    const detail = `Recovered the incomplete ${pending.operation} operation. OR3 ${recovered.appVersion} is deeply healthy.`;
    report(detail);
    return { kind: 'recovered', operation: pending.operation, detail };
  } catch (error) {
    const recoverySecrets = pending.operation === 'credentials-reset'
      ? secretValues(pending.credentialReset?.nextEnv ?? loaded.env)
      : secretValues(loaded.env);
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), recoverySecrets);
    if (pending.operation === 'adopt' && pending.sourceDirectory) {
      try {
        await compose(loaded.directory, loaded.state.mode, ['down']).catch(() => undefined);
        const sourceEnv = parseEnv(await readText(join(pending.sourceDirectory, '.env')));
        const sourceFiles = ['-f', join(pending.sourceDirectory, 'compose.yaml')];
        const sourceModeValue = sourceMode(pending.sourceDirectory, sourceEnv) as Mode;
        if (sourceModeValue === 'public') sourceFiles.push('-f', join(pending.sourceDirectory, 'compose.public.yaml'));
        if (pending.sourceInitiallyRunning !== false) {
          await restartSource(pending.sourceDirectory, sourceFiles, secretValues(sourceEnv));
        }
      } catch (recovery) {
        loaded.state.lastError += ` Original deployment recovery failed: ${recovery instanceof Error ? recovery.message : String(recovery)}`;
      }
    }
    await writeState(loaded.directory, loaded.state);
    throw new Error(`Recovery could not safely complete ${pending.operation}. Keep the operation record and run doctor. ${loaded.state.lastError}`);
  }
}
