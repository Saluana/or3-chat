import { readFile, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { restoreVolumeArchive } from '../backup/archive';
import { createBackup } from '../backup/create';
import { restoreBackupData } from '../backup/restore';
import {
  BACKUP_RETENTION_KEEP,
  planRetention,
  pruneBackups,
  type PruneResult,
  retentionProtectedIds,
} from '../backup/retention';
import { boolFlag, type Flags, stringFlag } from '../cli/args';
import { copyAssets, installedManagedAssetChecksums, managedAssetNames } from '../deployment/assets';
import {
  assertKnownStateSchema,
  type CheckResult,
  type Diagnostic,
  emitOperationResult,
  type OperationOutcome,
  type OperationReceipt,
  type PendingOperation,
  type TargetReadyEvidence,
  type UpdateAssessment,
} from '../deployment/contracts';
import { secretValues, serializeEnv, withoutDashboardOperator } from '../deployment/env';
import { compareReleaseVersions, imageAtDigest, imageFor, isVersion } from '../deployment/identity';
import { observationFindings, observeDeployment, stateFingerprint } from '../deployment/observation';
import { backupDirectory, deploymentPaths } from '../deployment/paths';
import { collectTargetReadyChecks, commitPreMutationRecovery } from '../deployment/recovery';
import {
  assertNoPending,
  commitTerminalState,
  loadManaged,
  markPending,
  persistReceiptWarnings,
  removeOperationRecord,
  updatePending,
  writeState,
  writeStateSchema,
} from '../deployment/state-store';
import {
  ASSET_ROOT,
  expectedImageDigest,
  expectedOperatorImageDigest,
  PACKAGE_VERSION,
  packagedMinimumSourceVersion,
  packagedSourceRevision,
} from '../package-info';
import {
  prepareVerifiedDashboardOperator,
  removeDashboardOperator,
  scheduleDashboardOperatorHandoff,
} from '../runtime/dashboard-operator';
import { ensureDocker } from '../runtime/docker';
import { waitForDeepHealth } from '../runtime/health';
import {
  assertImageReleaseIdentity,
  assertSupportedHostArchitecture,
  dockerDaemonArchitecture,
  pullImage,
  requireImageDigest,
} from '../runtime/images';
import { startProject, stopProject } from '../runtime/project';
import {
  MANAGED_RUNTIME_GID,
  MANAGED_RUNTIME_UID,
  managedVolumeRootOwnership,
  removeManagedDataVolumeForRecreation,
  setManagedVolumeRootOwnership,
  updateRequiresVolumeRecreation,
} from '../runtime/volumes';
import { fileExists, sha256File, writeSecure } from '../util/fs';
import { id, now, redact } from '../util/primitives';

/**
 * One shared update assessment used by both `update --dry-run` and the real
 * update's execution-time revalidation. It performs no deployment or Docker
 * mutation: assets are rendered in memory, disk space is read via statfs, and
 * anything that would need a pull, writable probe, or fresh snapshot is marked
 * deferred rather than passed.
 */
export async function assessUpdate(
  directory: string,
  targetVersion: string,
  options: { inspectAssets?: boolean; checkDocker?: boolean; underLease?: boolean } = {},
): Promise<UpdateAssessment> {
  // `checkDocker` performs the read-only daemon/architecture probe when a caller
  // wants live evidence (preview and execution). `underLease` tells the shared
  // assessment that the active mutation lease is the caller's own, so its own
  // in-progress state is not reported as a blocker.
  const checkDocker = options.checkDocker ?? false;
  const observation = await observeDeployment(directory, { checkDocker, checkImage: false });
  const state = observation.state;
  const checks: CheckResult[] = [];
  const findings: Diagnostic[] = [...observationFindings(observation)];
  const targetImage = imageFor(targetVersion);

  if (!state) {
    findings.push({ code: 'state-unreadable', severity: 'blocker', message: 'Managed state must be readable to preview an update.' });
  } else if (state.incompleteOperation) {
    findings.push({
      code: 'operation-incomplete',
      severity: 'blocker',
      message: `An incomplete ${state.incompleteOperation.operation} is recorded. Run "npx @or3/cloud recover" before updating.`,
      nextCommand: 'npx @or3/cloud recover',
    });
  }
  if (observation.changing && !options.underLease) {
    findings.push({ code: 'operation-in-progress', severity: 'blocker', message: 'A mutation lease is active; preview is non-executable until it settles.' });
  }

  let noOp = false;
  if (state && targetVersion === state.appVersion && !state.incompleteOperation) {
    noOp = true;
    checks.push({ code: 'already-installed', status: 'passed', detail: `OR3 ${targetVersion} is already the installed release; execution is a no-op.` });
  } else {
    checks.push({ code: 'target-version', status: 'passed', detail: `Target OR3 ${targetVersion} (${targetImage}).` });
  }

  // Disk headroom on the backup filesystem (read-only statfs). The data volume
  // requirement is deferred to execution-time validation.
  try {
    const stats = await statfs(deploymentPaths(directory).backups);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    checks.push({ code: 'backup-filesystem-space', status: 'passed', detail: `${freeBytes} bytes available on the backup filesystem.` });
  } catch (error) {
    checks.push({ code: 'backup-filesystem-space', status: 'unknown', detail: redact(error instanceof Error ? error.message : String(error)) });
  }
  checks.push({ code: 'data-volume-space', status: 'deferred', detail: 'The live data-volume requirement is validated after the snapshot, before downtime.' });
  if (checkDocker) {
    // Read-only daemon/architecture probe. It never pulls or changes images, so
    // it is safe to run during preview instead of deferring the whole check.
    if (observation.docker) {
      try {
        const architecture = await dockerDaemonArchitecture();
        checks.push({ code: 'docker-availability', status: 'passed', detail: `Docker daemon is reachable (${architecture}).` });
      } catch (error) {
        checks.push({ code: 'docker-availability', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
      }
    } else {
      checks.push({ code: 'docker-availability', status: 'unknown', detail: 'The Docker daemon is not reachable from this host; it is revalidated at execution time.' });
    }
  } else {
    checks.push({ code: 'docker-availability', status: 'deferred', detail: 'Docker availability and daemon architecture are revalidated at execution time.' });
  }
  checks.push({ code: 'image-pull', status: 'deferred', detail: 'The target image pull and architecture/provenance checks run at execution time.' });
  checks.push({ code: 'fresh-snapshot', status: 'deferred', detail: 'A fresh authenticated snapshot is created at execution time.' });

  // Retention plan: show what automatic pruning would keep/remove/preserve.
  const plan = planRetention(
    observation.backups?.entries ?? [],
    BACKUP_RETENTION_KEEP,
    state ? retentionProtectedIds(state) : new Set(),
    { automatic: true },
  );
  checks.push({
    code: 'retention',
    status: plan.canPrune ? 'passed' : 'deferred',
    detail: plan.canPrune
      ? `Would keep ${plan.keep.length} verified backup(s) and prune ${plan.remove.length}.`
      : `${plan.warnings.length} entry(ies) need inspection; automatic pruning is deferred and all backups are preserved.`,
  });
  for (const warning of plan.warnings) findings.push(warning);

  // Asset changes: compare the installed generated files with the target CLI.
  if (options.inspectAssets !== false) {
    const changed: string[] = [];
    for (const name of managedAssetNames(state?.mode ?? 'local')) {
      // A required asset that this CLI cannot read is a hard blocker: without it
      // the target deployment cannot be rendered, and silently reporting
      // "assets unchanged" would hide the failure until execution.
      let desired: Buffer;
      try {
        desired = await readFile(join(ASSET_ROOT, name));
      } catch (error) {
        findings.push({
          code: 'managed-asset-unreadable',
          severity: 'blocker',
          resource: name,
          message: `Required generated asset ${name} could not be read from this CLI: ${redact(error instanceof Error ? error.message : String(error))}`,
        });
        continue;
      }
      try {
        const installedPath = join(directory, name);
        if (!await fileExists(installedPath)) {
          changed.push(`${name} (add)`);
          continue;
        }
        const installed = await readFile(installedPath);
        if (!installed.equals(desired)) changed.push(`${name} (update)`);
      } catch (error) {
        findings.push({
          code: 'managed-asset-unreadable',
          severity: 'blocker',
          resource: name,
          message: `Installed generated asset ${name} could not be read from ${directory}: ${redact(error instanceof Error ? error.message : String(error))}`,
        });
      }
    }
    checks.push(changed.length
      ? { code: 'managed-assets', status: 'passed', detail: `Generated assets change: ${changed.join(', ')}.` }
      : { code: 'managed-assets', status: 'passed', detail: 'Generated assets are unchanged.' });
  }

  // Compatibility: unknown/future schemas are refused before mutation.
  try {
    assertKnownStateSchema(state?.schemaVersion);
    checks.push({ code: 'state-schema', status: 'passed', detail: `Managed state schema ${String(state.schemaVersion)} is supported.` });
  } catch (error) {
    findings.push({ code: 'state-schema-unsupported', severity: 'blocker', message: error instanceof Error ? error.message : String(error) });
  }

  const blockers = findings.filter((finding) => finding.severity === 'blocker');
  blockers.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    schemaVersion: 1,
    observedAt: observation.observedAt,
    source: state ? { appVersion: state.appVersion, image: state.image, imageDigest: state.imageDigest } : null,
    target: { appVersion: targetVersion, image: targetImage, imageDigest: expectedImageDigest(targetVersion) ?? 'unknown' },
    checks,
    findings: [...blockers, ...findings.filter((finding) => finding.severity !== 'blocker')],
    retention: plan,
    stateFingerprint: state ? stateFingerprint(state) : 'unavailable',
  };
}

export async function updatePreviewCommand(directory: string, flags: Flags) {
  const targetVersion = stringFlag(flags, 'to')?.trim() ?? PACKAGE_VERSION;
  if (!isVersion(targetVersion)) throw new Error(`--to must be a complete semantic version such as ${PACKAGE_VERSION}.`);
  if (targetVersion !== PACKAGE_VERSION) {
    throw new Error(`This CLI contains deployment assets for OR3 ${PACKAGE_VERSION}. Preview the matching CLI with \`npx --yes @or3/cloud@${targetVersion} update --to ${targetVersion} --dry-run\`.`);
  }
  const assessment = await assessUpdate(directory, targetVersion, { checkDocker: true });
  if (boolFlag(flags, 'json')) {
    console.log(JSON.stringify({ ...assessment, kind: 'or3-update-preview' }, null, 2));
  } else {
    console.log(`OR3 update preview for ${directory}`);
    console.log(`  source: ${assessment.source ? `OR3 ${assessment.source.appVersion} (${assessment.source.imageDigest})` : 'unknown'}`);
    console.log(`  target: OR3 ${assessment.target.appVersion} (${assessment.target.imageDigest})`);
    console.log(`  state fingerprint: ${assessment.stateFingerprint}`);
    console.log();
    for (const check of assessment.checks) console.log(`  [${check.status}] ${check.code}: ${check.detail}`);
    console.log();
    for (const finding of assessment.findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
    if (assessment.retention.preserve.length) {
      console.log('\n  Preserved backups:');
      for (const entry of assessment.retention.preserve) console.log(`    ${entry.entryName}: ${entry.reason}`);
    }
    console.log('\nDry run only: no state, assets, lease, images, services, snapshots, or backups were changed.');
  }
  if (assessment.findings.some((finding) => finding.severity === 'blocker')) process.exitCode = 1;
}

export async function updateCommand(directory: string, flags: Flags) {
  // With --json, stdout carries exactly one result object for every terminal
  // path (success, no-op, blocked, or failure) and all progress goes to stderr.
  const asJson = boolFlag(flags, 'json');
  try {
    return await runUpdateCommand(directory, flags, asJson);
  } catch (error) {
    if (!asJson) throw error;
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(`OR3 Cloud failed: ${message}`);
    emitOperationResult({
      kind: 'blocked',
      findings: [{ code: 'update-failed', severity: 'blocker', message, nextCommand: 'npx @or3/cloud recover --dry-run' }],
    });
    process.exitCode = 1;
  }
}

async function runUpdateCommand(directory: string, flags: Flags, asJson: boolean) {
  const progress = (...args: unknown[]) => {
    if (asJson) console.error(...args);
    else console.log(...args);
  };
  await ensureDocker();
  const loaded = await loadManaged(directory);
  const { state, env } = loaded;
  assertNoPending(state);
  await waitForDeepHealth(loaded.directory, state.mode, secretValues(env));
  const targetVersion = stringFlag(flags, 'to')?.trim() ?? PACKAGE_VERSION;
  if (!isVersion(targetVersion)) throw new Error(`--to must be a complete semantic version such as ${PACKAGE_VERSION}.`);
  if (targetVersion !== PACKAGE_VERSION) {
    throw new Error(`This CLI contains deployment assets for OR3 ${PACKAGE_VERSION}. Run \`npx --yes @or3/cloud@${targetVersion} update --to ${targetVersion}\` so the image and generated assets match.`);
  }
  if (targetVersion === state.appVersion) {
    if (asJson) emitOperationResult({ kind: 'no-op', detail: `OR3 ${targetVersion} is already installed.`, currentVersion: state.appVersion, targetVersion });
    else progress(`OR3 ${targetVersion} is already installed. Nothing to do.`);
    return;
  }
  // Shared preflight: the same assessment the dashboard previews now runs at
  // execution time under the lease and blocks before any pull or data change.
  const preflight = await assessUpdate(loaded.directory, targetVersion, { underLease: true, checkDocker: true });
  const preflightBlockers = preflight.findings.filter((finding) => finding.severity === 'blocker');
  if (preflightBlockers.length > 0) {
    throw new Error(`Update to ${targetVersion} is blocked by preflight: ${preflightBlockers.map((finding) => `${finding.code} (${finding.message})`).join(' ')}`);
  }
  const targetImageTag = imageFor(targetVersion);
  const targetDigest = await pullImage(targetImageTag, expectedImageDigest(targetVersion));
  await assertSupportedHostArchitecture(targetImageTag);
  await assertImageReleaseIdentity(targetImageTag, targetVersion);
  const targetImage = imageAtDigest(targetImageTag, targetDigest);
  const oldEnv = { ...env };
  const targetDeploymentId = env.OR3_DEPLOYMENT_ID ?? state.deploymentId ?? id('deployment');
  const backupId = id('backup');
  const pending: PendingOperation = {
    id: id('update'),
    operation: 'update',
    startedAt: now(),
    message: `Updating from ${state.appVersion} to ${targetVersion}`,
    targetVersion,
    targetImage,
    targetImageDigest: targetDigest,
    targetDeploymentId,
    backupId,
    backupPath: backupDirectory(loaded.directory, backupId),
    phase: 'prepared',
  };
  await markPending(loaded.directory, state, pending);
  const startedAtMs = Date.now();
  try {
    // Resolve the dedicated operator runtime for every target version before
    // downtime. Keeping an old privileged image after an application update
    // defeats the digest binding and leaves security fixes behind. The app
    // image was already pulled and provenance-checked above, so both artifacts
    // are prepared while the source is still running.
    const operator = await prepareVerifiedDashboardOperator(loaded.directory, targetVersion);
    const backup = await createBackup(loaded.directory, state, env, { restartAfter: false, backupId });
    // The bridge release reads schema 2 but keeps writing schema 1. Only a
    // release explicitly qualified to write schema 2 migrates, and only after
    // the compatibility bridge is present (declared minimum source). Migration
    // and the initial pending update share one atomic write, so an empty
    // new-format state is never published on its own.
    const writeSchema = writeStateSchema();
    if (writeSchema >= 2) {
      const minimumSource = packagedMinimumSourceVersion();
      if (minimumSource && compareReleaseVersions(state.appVersion, minimumSource) < 0) {
        throw new Error(`OR3 ${targetVersion} writes managed state schema 2, which requires the compatibility bridge (source ${minimumSource} or newer). Run the host CLI bridge update first, then retry this schema-2 release.`);
      }
      state.schemaVersion = writeSchema;
    }
    await updatePending(loaded.directory, state, {
      backupId: backup.backupId,
      backupPath: backup.backupDir,
      backupDataSha256: backup.manifest.dataSha256,
      backupConfigSha256: backup.manifest.configSha256,
      phase: 'snapshot-created',
      verifiedSnapshot: {
        backupId: backup.backupId,
        path: backup.backupDir,
        dataSha256: backup.manifest.dataSha256,
        configSha256: backup.manifest.configSha256 ?? '',
        createdAt: backup.manifest.createdAt,
      },
    });
    if (env.OR3_DASHBOARD_UPDATES_ENABLED === 'true' && !operator && !process.env.OR3_DASHBOARD_UPDATE_JOB_ID) {
      await removeDashboardOperator(loaded.directory, state.mode);
    }
    const nextEnv = {
      ...withoutDashboardOperator(env),
      OR3_VERSION: targetVersion,
      OR3_IMAGE: targetImage,
      OR3_DEPLOYMENT_ID: targetDeploymentId,
      ...(operator ?? {}),
    };
    const previousRootOwnership = await managedVolumeRootOwnership(targetImage, state.volumeName);
    const migrateLegacyVolume = previousRootOwnership.uid !== MANAGED_RUNTIME_UID || previousRootOwnership.gid !== MANAGED_RUNTIME_GID;
    const recreateDataVolume = updateRequiresVolumeRecreation(state, env);
    await updatePending(loaded.directory, state, {
      phase: 'target-mutating',
      previousRootOwnership,
      recreateDataVolume,
    });
    try {
      if (recreateDataVolume) {
        await removeManagedDataVolumeForRecreation(loaded.directory, state);
      } else {
        await stopProject(loaded.directory, state.mode);
      }
      if (migrateLegacyVolume && !recreateDataVolume) {
        // Change only the mount root, then recreate every data entry from the
        // checksummed backup as the target runtime user. Avoid recursive chown:
        // it would erase heterogeneous ownership without a reversible record.
        await setManagedVolumeRootOwnership(loaded.directory, state, oldEnv, targetImage, {
          uid: MANAGED_RUNTIME_UID,
          gid: MANAGED_RUNTIME_GID,
        });
      }
      await writeSecure(deploymentPaths(loaded.directory).env, serializeEnv(nextEnv));
      await copyAssets(loaded.directory, state.mode);
      if (migrateLegacyVolume || recreateDataVolume) {
        await restoreVolumeArchive(loaded.directory, state.mode, nextEnv, backup.backupDir);
      }
    } catch (error) {
      // Failure before the target can accept writes: the deployment is still
      // the known-good source, so automatic restoration is safe.
      await updatePending(loaded.directory, state, { phase: 'restoring-previous' });
      try {
        if (!recreateDataVolume) await stopProject(loaded.directory, state.mode).catch(() => undefined);
        if (migrateLegacyVolume && !recreateDataVolume) {
          await setManagedVolumeRootOwnership(loaded.directory, state, oldEnv, targetImage, previousRootOwnership);
        }
        await restoreBackupData(loaded.directory, state, oldEnv, backup.backupDir, { recreateDataVolume });
      } catch (restoreError) {
        throw new Error(`Update to ${targetVersion} failed, and automatic backup restoration also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. Original update error: ${error instanceof Error ? error.message : String(error)}`);
      }
      const recovered = await commitPreMutationRecovery(
        loaded.directory,
        state,
        `Update to ${targetVersion} failed and was restored: ${redact(error instanceof Error ? error.message : String(error), secretValues(oldEnv))}`,
      );
      throw new Error(recovered.lastError);
    }
    // The target is about to start and may accept writes. Persist this boundary
    // first; a failure from here must never silently discard those writes.
    await updatePending(loaded.directory, state, { phase: 'starting-target' });
    try {
      await startProject(loaded.directory, state.mode, nextEnv);
    } catch (error) {
      throw new Error(`Update to ${targetVersion} started the target but it did not pass verification: ${redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv))}. Writes may have been accepted, so the deployment was NOT restored automatically. Run "npx @or3/cloud recover --dry-run", then "npx @or3/cloud recover --finish" if the target is proven, or "npx @or3/cloud recover --restore --yes" to return to the pre-update snapshot.`);
    }
    const digest = await requireImageDigest(targetImage, targetDigest, `OR3 ${targetVersion}`);
    // Durable target-ready proof: the replacement boundary completed, the
    // configuration and generated assets are bound, the observed container and
    // image match, and the required database/public-health checks passed. A
    // crash before this point cannot be inferred as success from health alone.
    const targetChecks = await collectTargetReadyChecks(loaded.directory, state.mode, nextEnv);
    const failedTargetChecks = targetChecks.checks.filter((check) => check.status !== 'passed');
    if (!targetChecks.containerId || failedTargetChecks.length > 0) {
      throw new Error(`Update to ${targetVersion} did not pass the required target checks (${failedTargetChecks.map((check) => check.code).join(', ') || 'container-binding'}). Writes may have been accepted, so the deployment was NOT restored automatically. Run "npx @or3/cloud recover --dry-run", then "npx @or3/cloud recover --restore --yes" to return to the pre-update snapshot.`);
    }
    const targetReadyEvidence: TargetReadyEvidence = {
      checkedAt: now(),
      deploymentId: targetDeploymentId,
      deploymentRoot: resolve(loaded.directory),
      containerId: targetChecks.containerId,
      imageDigest: digest,
      configurationSha256: await sha256File(deploymentPaths(loaded.directory).env),
      managedAssetSha256: await installedManagedAssetChecksums(loaded.directory, state.mode),
      dataReplacementCompleted: true,
      checks: [
        { code: 'image-digest', status: 'passed', detail: `${targetImage}@${digest}` },
        { code: 'deep-health', status: 'passed', detail: 'OR3 deep health and running-image identity verified' },
        ...targetChecks.checks,
      ],
    };
    if (writeSchema >= 2) {
      // Only a schema-2 writer records the target-ready milestone: a schema-1
      // reader would misroute the new phase to its destructive restore path.
      await updatePending(loaded.directory, state, { phase: 'target-ready', evidence: targetReadyEvidence });
    }

    const warnings: Diagnostic[] = [];
    const hadDashboardJob = Boolean(process.env.OR3_DASHBOARD_UPDATE_JOB_ID);
    let operatorHandoff: OperationReceipt['operatorHandoff'] = 'not-required';
    // Schedule the privileged handoff while the lease/operation are still
    // active; the helper waits on the authoritative terminal operation and job.
    if (nextEnv.OR3_DASHBOARD_UPDATES_ENABLED === 'true' && hadDashboardJob) {
      try {
        await scheduleDashboardOperatorHandoff(loaded.directory, nextEnv);
        operatorHandoff = 'pending';
      } catch (error) {
        operatorHandoff = 'needs-attention';
        warnings.push({
          code: 'operator-handoff-schedule-failed',
          severity: 'warning',
          resource: pending.id,
          message: `The application is upgraded, but the dashboard operator handoff could not be scheduled: ${redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv))}. Run "npx @or3/cloud recover --finish" on the host.`,
          nextCommand: 'npx @or3/cloud recover --finish',
        });
      }
    }

    const sourceVersion = state.appVersion;
    const sourceImage = state.image;
    const sourceDigest = state.imageDigest;
    const receipt: OperationReceipt = {
      schemaVersion: 1,
      operationId: pending.id,
      dashboardJobId: process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim() || undefined,
      cliVersion: PACKAGE_VERSION,
      source: {
        appVersion: sourceVersion,
        image: sourceImage,
        imageDigest: sourceDigest,
        sourceRevision: packagedSourceRevision(sourceVersion),
        operatorImageDigest: expectedOperatorImageDigest(sourceVersion),
      },
      target: {
        appVersion: targetVersion,
        image: targetImage,
        imageDigest: digest,
        sourceRevision: packagedSourceRevision(targetVersion),
        operatorImageDigest: expectedOperatorImageDigest(targetVersion),
      },
      observed: { appVersion: targetVersion, image: targetImage, imageDigest: digest },
      completedAt: now(),
      rollbackBackupId: backup.backupId,
      checks: targetReadyEvidence.checks,
      warnings,
      phaseDurationsMs: { 'replace-and-verify': Date.now() - startedAtMs },
      operatorHandoff,
    };
    state.rollback = {
      appVersion: sourceVersion,
      image: sourceImage,
      imageDigest: sourceDigest,
      backupId: backup.backupId,
      createdAt: now(),
    };
    state.appVersion = targetVersion;
    state.image = targetImage;
    state.imageDigest = digest;
    state.deploymentId = targetDeploymentId;
    state.deploymentRoot = resolve(loaded.directory);
    state.lastSuccessfulOperation = 'update';
    state.lastError = undefined;
    // Terminal commit before any cleanup: target identity, rollback reference,
    // receipt, and absence of a pending operation land in one atomic write.
    let commit: { committed: true; operationId?: string };
    try {
      commit = await commitTerminalState(loaded.directory, state, receipt);
    } catch (error) {
      throw new Error(`OR3 ${targetVersion} replaced the running release, but the terminal state write could not be confirmed. Recovery evidence was preserved; re-run status/doctor and "npx @or3/cloud recover" to resolve the durable outcome before any further mutation. ${redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv))}`);
    }
    // The application commit has succeeded; the following are housekeeping and
    // operational results only. They never reopen pending state.
    try {
      await removeOperationRecord(loaded.directory, commit.operationId);
    } catch (error) {
      warnings.push({ code: 'operation-mirror-delete-failed', severity: 'warning', resource: commit.operationId, message: redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv)) });
    }
    const prune = await pruneBackups(loaded.directory, state, BACKUP_RETENTION_KEEP, false, { automatic: true, log: progress, warn: progress }).catch((error) => {
      warnings.push({ code: 'retention-failed', severity: 'warning', message: redact(error instanceof Error ? error.message : String(error), secretValues(nextEnv)) });
      return { removed: 0, deferred: [] } as PruneResult;
    });
    for (const diagnostic of prune.deferred) warnings.push(diagnostic);
    progress(`OR3 updated to ${targetVersion}. Image digest: ${digest}`);
    progress(`Rollback point: ${backup.backupId}. Keep it until login, chat, and file checks pass.`);
    progress('Not checked: live OpenRouter authorization (complete it in the browser).');
    if (warnings.length > 0) {
      warnings.forEach((warning) => console.warn(`⚠ ${warning.code}: ${warning.message}`));
    }
    // Persist any post-commit maintenance warnings into the authoritative
    // receipt before reporting, so a reload or the dashboard still sees them.
    await persistReceiptWarnings(loaded.directory, state, warnings);
    if (asJson) {
      const outcome: OperationOutcome = warnings.length > 0
        ? { kind: 'completed-with-warnings', receipt, warnings }
        : { kind: 'completed', receipt };
      emitOperationResult(outcome);
    } else if (warnings.length > 0) {
      console.log(`Update complete with ${warnings.length} maintenance warning(s).`);
      console.log('Next: npx @or3/cloud backup list');
    } else {
      console.log('Update complete. No maintenance warnings.');
    }
  } catch (error) {
    if (state.incompleteOperation) {
      state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(env));
      await writeState(loaded.directory, state);
    }
    throw error;
  }
}
