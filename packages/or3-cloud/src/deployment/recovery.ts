import { recordedBackupPath } from '../backup/manifests';
import { BACKUP_RETENTION_KEEP, pruneBackups } from '../backup/retention';
import { expectedOperatorImageDigest, PACKAGE_VERSION, packagedSourceRevision } from '../package-info';
import { run } from '../runtime/command-runner';
import { assertRunningAppImage, composeArgs } from '../runtime/compose';
import { scheduleDashboardOperatorHandoff } from '../runtime/dashboard-operator';
import {
  containerNodeCommand,
  HEALTH_SCRIPT,
  VERIFY_DATABASES_SCRIPT,
  waitForDeepHealth,
} from '../runtime/health';
import { imageDigest, pullAndRequireImage } from '../runtime/images';
import { validateVerificationHealth, verificationJson } from '../runtime/verification';
import { readText, sha256File } from '../util/fs';
import { now, redact } from '../util/primitives';
import { installedManagedAssetChecksums } from './assets';
import type {
  CheckResult,
  Diagnostic,
  ManagedState,
  Mode,
  Operation,
  OperationReceipt,
  PendingOperation,
} from './contracts';
import { parseEnv, secretValues } from './env';
import { deploymentPaths } from './paths';
import {
  commitRecoveredState,
  commitTerminalState,
  exportTerminalReceipt,
  persistReceiptWarnings,
  removeOperationRecordSafely,
  stateFromEnv,
  writeState,
} from './state-store';

export function operationToStateOperation(operation: PendingOperation['operation'], fallback: Operation): Operation {
  if (operation === 'init' || operation === 'update' || operation === 'adopt') return operation;
  return fallback;
}

export async function commitPreMutationRecovery(
  directory: string,
  state: ManagedState,
  message: string,
) {
  const restoredEnv = parseEnv(await readText(deploymentPaths(directory).env));
  const recovered = stateFromEnv(
    directory,
    restoredEnv,
    state.mode,
    state.lastSuccessfulOperation,
    await imageDigest(restoredEnv.OR3_IMAGE),
  );
  recovered.rollback = state.rollback;
  recovered.lastError = message;
  await commitRecoveredState(directory, state, recovered);
  return recovered;
}

export type RecoveryDecision =
  | { action: 'none'; detail: string }
  | { action: 'resume'; detail: string }
  | { action: 'finish'; detail: string }
  | { action: 'require-explicit-restore'; detail: string; snapshotId?: string }
  | { action: 'reconcile-handoff'; detail: string };

/**
 * Pure recovery policy. Finish is allowed only for an update that recorded a
 * durable target-ready milestone; a deployment that may have replaced data
 * without completion proof requires the operator to choose a destructive
 * restore explicitly. Legacy ambiguity deliberately never becomes an implicit
 * restore.
 */
export function decideRecoveryAction(state: ManagedState): RecoveryDecision {
  const pending = state.incompleteOperation;
  if (!pending) {
    // The application commit may already be complete while the privileged
    // operator handoff is unfinished. Reconcile only that handoff; never
    // replace application data.
    const handoff = state.lastReceipt?.operatorHandoff;
    if (handoff === 'pending' || handoff === 'needs-attention') {
      return { action: 'reconcile-handoff', detail: `The application is complete but the dashboard operator handoff is ${handoff}. Reconcile only the recorded handoff.` };
    }
    return { action: 'none', detail: 'No incomplete operation is recorded.' };
  }
  if (pending.operation === 'update' && pending.phase === 'target-ready' && pending.evidence) {
    return { action: 'finish', detail: 'A completed replacement carries durable target-ready evidence and can be committed without restoring data.' };
  }
  if (pending.phase === 'prepared' || pending.phase === 'snapshot-created') {
    return { action: 'resume', detail: `The ${pending.operation} had not replaced data; resume the known-good source.` };
  }
  if (pending.operation === 'update' || pending.operation === 'restore' || pending.operation === 'rollback') {
    const snapshotId = pending.operation === 'update' ? pending.backupId : (pending.previousBackupId ?? pending.backupId);
    return {
      action: 'require-explicit-restore',
      detail: `The ${pending.operation} may have changed data and has no completion proof. Health alone cannot authorize adoption.`,
      snapshotId,
    };
  }
  return { action: 'resume', detail: `Resume the ${pending.operation} using its durable evidence.` };
}

/**
 * Reconciles only the privileged operator handoff recorded for a completed
 * application update. It never replaces application data: it reschedules the
 * exact recorded job and leaves the receipt marked pending until the successor
 * operator confirms it is running.
 */
export async function reconcileOperatorHandoff(directory: string, state: ManagedState, report: (...args: unknown[]) => void = console.log) {
  const env = parseEnv(await readText(deploymentPaths(directory).env));
  if (env.OR3_DASHBOARD_UPDATES_ENABLED !== 'true') {
    const detail = 'Dashboard updates are disabled in this deployment; no operator handoff needs reconciliation.';
    report(detail);
    return detail;
  }
  const receipt = state.lastReceipt;
  const jobId = receipt?.dashboardJobId ?? process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim();
  if (!jobId) {
    throw new Error('The completed update recorded no dashboard job for its operator handoff. Re-run the host CLI update, or disable dashboard updates until the operator is restored.');
  }
  await scheduleDashboardOperatorHandoff(directory, env, jobId);
  if (receipt) {
    receipt.operatorHandoff = 'pending';
    await writeState(directory, state);
    await exportTerminalReceipt(directory, receipt).catch(() => undefined);
  }
  const detail = `Rescheduled the dashboard operator handoff for job ${jobId.slice(0, 8)}. The successor operator marks it verified once it is running.`;
  report(detail);
  return detail;
}

/**
 * Commits an update that already reached the target-ready milestone, without
 * restoring data. Revalidates the recorded proof under the lease (exact image
 * binding, configuration and managed assets unchanged since target-ready,
 * authenticated rollback snapshot, deep health) before adopting the live
 * target.
 */
/**
 * Required completion-proof checks for a replaced target: the observed
 * container binding, SQLite integrity/ownership, and public/local deep health.
 * Reused when recording the milestone and when revalidating it at finish.
 */
export async function collectTargetReadyChecks(
  directory: string,
  mode: Mode,
  env: Record<string, string>,
): Promise<{ containerId: string | undefined; checks: CheckResult[] }> {
  const checks: CheckResult[] = [];
  let containerId: string | undefined;
  const container = await run('docker', composeArgs(directory, mode, ['ps', '-q', 'or3']), directory);
  containerId = container.ok ? container.stdout.trim() || undefined : undefined;
  checks.push(containerId
    ? { code: 'container-binding', status: 'passed', detail: `Observed target container ${containerId}.` }
    : { code: 'container-binding', status: 'failed', detail: 'Could not resolve the running target container.' });

  const databaseCheck = await run('docker', [
    ...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(VERIFY_DATABASES_SCRIPT)]),
  ], directory);
  let databasesOk = false;
  if (databaseCheck.ok) {
    try {
      const databases = JSON.parse(databaseCheck.stdout.trim()) as Array<{ path: string; quickCheck: string; tables: number }>;
      databasesOk = databases.length === 2 && databases.every((entry) => entry.quickCheck === 'ok' && entry.tables >= 1);
    } catch {
      databasesOk = false;
    }
  }
  checks.push(databasesOk
    ? { code: 'database-integrity', status: 'passed', detail: 'auth.sqlite and sync.sqlite quick_check passed with managed ownership.' }
    : { code: 'database-integrity', status: 'failed', detail: `SQLite integrity or ownership verification failed. ${redact(databaseCheck.stderr.trim(), secretValues(env))}` });

  // Deep health must be provable from the caller's network context. A public
  // deployment is checked through its real HTTPS origin. A local deployment is
  // proven from inside its own container, because the updater may run inside
  // the dashboard operator container, where the host loopback port is not
  // reachable (the operator has its own network namespace).
  if (mode === 'public') {
    const baseUrl = new URL(`https://${env.OR3_PUBLIC_DOMAIN}`);
    try {
      validateVerificationHealth(await verificationJson(baseUrl, '/api/health?deep=true'));
      checks.push({ code: 'public-health', status: 'passed', detail: `${baseUrl.origin} deep health reports the managed profile.` });
    } catch (error) {
      checks.push({ code: 'public-health', status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)) });
    }
  } else {
    const internal = await run('docker', [
      ...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(HEALTH_SCRIPT)]),
    ], directory);
    checks.push(internal.ok
      ? { code: 'public-health', status: 'passed', detail: 'Container-internal deep health reports the managed profile.' }
      : { code: 'public-health', status: 'failed', detail: `Container-internal deep health failed. ${redact(internal.stderr.trim(), secretValues(env))}` });
  }
  return { containerId, checks };
}

export async function finishTargetReadyUpdate(
  directory: string,
  state: ManagedState,
  env: Record<string, string>,
  report: (...args: unknown[]) => void = console.log,
): Promise<string> {
  const pending = state.incompleteOperation;
  if (!pending?.evidence || !pending.targetVersion || !pending.targetImage) {
    throw new Error('recover --finish requires a recorded target-ready milestone; none is present.');
  }
  const targetEnv = parseEnv(await readText(deploymentPaths(directory).env));
  if (targetEnv.OR3_VERSION !== pending.targetVersion || targetEnv.OR3_IMAGE !== pending.targetImage) {
    throw new Error('The live .env no longer matches the recorded target-ready identities; refusing to finish.');
  }
  const expectedTargetDigest = pending.targetImageDigest ?? await imageDigest(targetEnv.OR3_IMAGE);
  await pullAndRequireImage(targetEnv.OR3_IMAGE, expectedTargetDigest, 'Target deployment');
  await assertRunningAppImage(directory, state.mode, targetEnv.OR3_IMAGE);
  const actualDigest = await imageDigest(targetEnv.OR3_IMAGE);
  if (actualDigest !== pending.evidence.imageDigest) {
    throw new Error(`The running target image ${actualDigest} does not match the recorded target-ready proof ${pending.evidence.imageDigest}.`);
  }
  const configurationSha256 = await sha256File(deploymentPaths(directory).env);
  if (configurationSha256 !== pending.evidence.configurationSha256) {
    throw new Error('The managed configuration changed after the target-ready milestone; refusing to finish. Inspect the change, or run `recover --restore --yes` to return to the recorded snapshot.');
  }
  const assets = await installedManagedAssetChecksums(directory, state.mode);
  for (const [name, expected] of Object.entries(pending.evidence.managedAssetSha256)) {
    if (assets[name] !== expected) {
      throw new Error(`Managed asset ${name} changed after the target-ready milestone; refusing to finish.`);
    }
  }
  const expectedDeploymentId = targetEnv.OR3_DEPLOYMENT_ID ?? pending.targetDeploymentId;
  if (pending.evidence.deploymentId && expectedDeploymentId && pending.evidence.deploymentId !== expectedDeploymentId) {
    throw new Error('The recorded target-ready deployment identity no longer matches the live deployment.');
  }
  // The rollback source must still authenticate, even though we are not restoring it.
  await recordedBackupPath(directory, pending);
  // Required completion evidence must be present and re-proven. A milestone
  // that omitted database integrity, public health, or the observed container
  // binding cannot be finished from internal health alone.
  for (const required of ['container-binding', 'database-integrity', 'public-health']) {
    const recorded = pending.evidence.checks.find((check) => check.code === required);
    if (!recorded || recorded.status !== 'passed') {
      throw new Error(`The recorded target-ready proof is missing ${required}; refusing to finish. Run "npx @or3/cloud recover --restore --yes" to return to the recorded snapshot.`);
    }
  }
  await waitForDeepHealth(directory, state.mode, secretValues(targetEnv));
  const revalidated = await collectTargetReadyChecks(directory, state.mode, targetEnv);
  if (!revalidated.containerId || revalidated.containerId !== pending.evidence.containerId) {
    throw new Error('The running target container no longer matches the recorded target-ready proof; refusing to finish.');
  }
  const failedChecks = revalidated.checks.filter((check) => check.status !== 'passed');
  if (failedChecks.length > 0) {
    throw new Error(`Target verification failed at finish (${failedChecks.map((check) => check.code).join(', ')}); refusing to finish.`);
  }

  const sourceVersion = state.appVersion;
  const sourceImage = state.image;
  const sourceDigest = state.imageDigest;
  const digest = actualDigest;
  const recordedDashboardJobId = pending.dashboardJobId ?? (process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim() || undefined);
  const receipt: OperationReceipt = {
    schemaVersion: 1,
    operationId: pending.id,
    dashboardJobId: recordedDashboardJobId,
    cliVersion: PACKAGE_VERSION,
    source: { appVersion: sourceVersion, image: sourceImage, imageDigest: sourceDigest, sourceRevision: packagedSourceRevision(sourceVersion), operatorImageDigest: expectedOperatorImageDigest(sourceVersion) },
    target: { appVersion: pending.targetVersion, image: pending.targetImage, imageDigest: digest, sourceRevision: packagedSourceRevision(pending.targetVersion), operatorImageDigest: expectedOperatorImageDigest(pending.targetVersion) },
    observed: { appVersion: pending.targetVersion, image: pending.targetImage, imageDigest: digest },
    completedAt: now(),
    rollbackBackupId: pending.backupId ?? '',
    checks: revalidated.checks,
    warnings: [],
    phaseDurationsMs: {},
    operatorHandoff: 'not-required',
  };
  const next = stateFromEnv(directory, targetEnv, state.mode, 'update', digest);
  next.rollback = {
    appVersion: sourceVersion,
    image: sourceImage,
    imageDigest: sourceDigest,
    backupId: pending.backupId ?? '',
    createdAt: now(),
  };
  next.lastError = undefined;
  if (targetEnv.OR3_DASHBOARD_UPDATES_ENABLED === 'true' && recordedDashboardJobId) {
    try {
      await scheduleDashboardOperatorHandoff(directory, targetEnv, recordedDashboardJobId);
      receipt.operatorHandoff = 'pending';
    } catch (error) {
      receipt.operatorHandoff = 'needs-attention';
      receipt.warnings.push({ code: 'operator-handoff-schedule-failed', severity: 'warning', message: redact(error instanceof Error ? error.message : String(error), secretValues(targetEnv)) });
    }
  }
  const commit = await commitTerminalState(directory, next, receipt);
  await removeOperationRecordSafely(directory, commit.operationId);
  const maintenance: Diagnostic[] = [];
  const prune = await pruneBackups(directory, next, BACKUP_RETENTION_KEEP, false, {
    automatic: true,
    log: (message) => report(message),
    warn: (message) => report(message),
  }).catch((error) => {
    // A prune failure is a maintenance warning, never a silent suppression.
    maintenance.push({ code: 'retention-failed', severity: 'warning', message: redact(error instanceof Error ? error.message : String(error), secretValues(targetEnv)) });
    return { removed: 0, deferred: [] as Diagnostic[] };
  });
  maintenance.push(...prune.deferred);
  // Persist the post-commit maintenance warnings into the authoritative receipt
  // so a reload, the dashboard, or a later `recover --finish` still sees them.
  await persistReceiptWarnings(directory, next, maintenance);
  const detail = `Finished the recorded update as OR3 ${pending.targetVersion}. Post-replacement writes were preserved.`;
  report(detail);
  for (const warning of [...receipt.warnings, ...maintenance]) report(`  ⚠ ${warning.code}: ${warning.message}`);
  void env;
  return detail;
}
