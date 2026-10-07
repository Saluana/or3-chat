import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { lifecycleFaults } from '../lifecycle-faults';
import { packagedOr3CloudMetadata } from '../package-info';
import { readText, writeSecure } from '../util/fs';
import { now, redact } from '../util/primitives';
import {
  assertKnownStateSchema,
  type Diagnostic,
  type ManagedState,
  type Mode,
  type Operation,
  type OperationReceipt,
  type PendingOperation,
  type StateSchemaVersion,
} from './contracts';
import { parseEnv } from './env';
import { assertDeploymentDirectoryIdentity, assertDeploymentIdentity } from './identity';
import { deploymentPaths } from './paths';

/** Schema this bridge release writes by default; schema 2 is opt-in metadata. */
const LEGACY_STATE_SCHEMA_VERSION = 1;

export async function readState(directory: string): Promise<ManagedState> {
  const paths = deploymentPaths(directory);
  const parsed = JSON.parse(await readText(paths.state)) as Partial<ManagedState>;
  assertKnownStateSchema(parsed.schemaVersion);
  if (!parsed.appVersion || !parsed.image || !parsed.composeProject || !parsed.mode) {
    throw new Error(`Invalid managed state at ${paths.state}. Run "npx @or3/cloud doctor" for diagnostics.`);
  }
  return parsed as ManagedState;
}

export async function writeState(directory: string, state: ManagedState) {
  await lifecycleFaults.beforeStateWrite?.();
  await writeSecure(deploymentPaths(directory).state, `${JSON.stringify(state, null, 2)}\n`);
  await lifecycleFaults.afterStateWrite?.();
}

/**
 * Persisted state schema this CLI is qualified to write. A release that only
 * reads schema 2 keeps writing schema 1 (the compatibility bridge); a release
 * explicitly qualified to write the new recovery journal sets
 * `or3Cloud.stateSchema` to 2. Migration to schema 2 is refused below.
 */
export function writeStateSchema(): StateSchemaVersion {
  const value = packagedOr3CloudMetadata().stateSchema;
  if (value === undefined) return LEGACY_STATE_SCHEMA_VERSION;
  if (value === 1 || value === 2) return value;
  throw new Error('This @or3/cloud package declares an unsupported managed state schema. Refusing to write managed state.');
}

export async function markPending(directory: string, state: ManagedState, operation: PendingOperation) {
  const dashboardJobId = process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim();
  operation.origin = dashboardJobId ? 'dashboard' : 'cli';
  if (dashboardJobId) operation.dashboardJobId = dashboardJobId;
  state.incompleteOperation = operation;
  await writeState(directory, state);
  await writeSecure(join(deploymentPaths(directory).operations, `${operation.id}.json`), `${JSON.stringify(operation, null, 2)}\n`);
}

export async function updatePending(directory: string, state: ManagedState, patch: Partial<PendingOperation>) {
  if (!state.incompleteOperation) throw new Error('No incomplete operation is available to update.');
  Object.assign(state.incompleteOperation, patch);
  state.updatedAt = now();
  await writeState(directory, state);
  await writeSecure(
    join(deploymentPaths(directory).operations, `${state.incompleteOperation.id}.json`),
    `${JSON.stringify(state.incompleteOperation, null, 2)}\n`,
  );
}

export async function removeOperationRecord(directory: string, operationId?: string) {
  if (!operationId) return;
  await lifecycleFaults.beforeMirrorDelete?.();
  await rm(join(deploymentPaths(directory).operations, `${operationId}.json`), { force: true });
}

/**
 * Housekeeping mirror deletion after a terminal commit. A failure here must
 * only warn: the authoritative state is already committed, and throwing would
 * let an enclosing destructive-recovery handler undo the completed operation.
 */
export async function removeOperationRecordSafely(directory: string, operationId?: string) {
  try {
    await removeOperationRecord(directory, operationId);
  } catch (error) {
    console.warn(`Could not remove the redundant operation mirror ${operationId ?? '(none)'}: ${redact(error instanceof Error ? error.message : String(error))}`);
  }
}

/**
 * Commits a terminal state write before touching the redundant operation
 * mirror. The state file is the single authority: if the mirror delete fails
 * or the process dies afterwards, the deployment is already complete and a
 * leftover mirror is removable housekeeping rather than a pending operation.
 *
 * Returns the operation ID whose mirror (if any) still needs removal so callers
 * can treat a failed delete as completed-with-warnings.
 */
export async function commitTerminalState(
  directory: string,
  state: ManagedState,
  receipt?: OperationReceipt,
): Promise<{ committed: true; operationId?: string }> {
  const operationId = state.incompleteOperation?.id;
  delete state.incompleteOperation;
  if (receipt) state.lastReceipt = receipt;
  state.updatedAt = now();
  await writeState(directory, state);
  if (receipt) {
    // A convenience mirror, not a second transaction authority. Export failure
    // must never invalidate a durable deployment commit.
    try {
      await exportTerminalReceipt(directory, receipt);
    } catch (error) {
      console.warn(`Could not export the latest operation receipt: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  }
  return { committed: true, operationId };
}

/**
 * Writes the latest bounded terminal receipt to `.or3-cloud/last-operation.json`
 * (mode 0600). The receipt schema deliberately contains no secrets,
 * credentials, raw configuration, or log contents.
 */
export async function exportTerminalReceipt(directory: string, receipt: OperationReceipt) {
  const payload = `${JSON.stringify(receipt, null, 2)}\n`;
  await writeSecure(deploymentPaths(directory).lastOperation, payload);
}

/**
 * Persists post-commit maintenance warnings (for example a failed mirror
 * delete or deferred retention) into the already-committed receipt. The
 * authoritative state is terminal, so this only updates `lastReceipt.warnings`
 * and never recreates a pending operation. A failure warns rather than throwing:
 * the deployment is already complete and the warnings are advisory.
 */
export async function persistReceiptWarnings(directory: string, state: ManagedState, warnings: Diagnostic[]) {
  if (warnings.length === 0 || !state.lastReceipt) return;
  const existing = state.lastReceipt.warnings;
  const additions = warnings.filter((warning) => !existing.some((current) => current.code === warning.code && current.message === warning.message));
  if (additions.length === 0) return;
  const merged: OperationReceipt = { ...state.lastReceipt, warnings: [...existing, ...additions] };
  try {
    if (state.incompleteOperation) return;
    state.lastReceipt = merged;
    state.updatedAt = now();
    await writeState(directory, state);
    await exportTerminalReceipt(directory, merged).catch((error) => {
      console.warn(`Could not re-export the operation receipt: ${redact(error instanceof Error ? error.message : String(error))}`);
    });
  } catch (error) {
    console.warn(`Could not persist maintenance warnings to the receipt: ${redact(error instanceof Error ? error.message : String(error))}`);
  }
}

/** Convenience wrapper: commit terminal state, then warning-only mirror cleanup. */
export async function clearPending(directory: string, state: ManagedState, receipt?: OperationReceipt) {
  const { operationId } = await commitTerminalState(directory, state, receipt);
  await removeOperationRecordSafely(directory, operationId);
}

export function stateFromEnv(directory: string, env: Record<string, string>, mode: Mode, operation: Operation, digest: string): ManagedState {
  return {
    schemaVersion: writeStateSchema(),
    mode,
    composeProject: env.OR3_COMPOSE_PROJECT,
    volumeName: env.OR3_VOLUME_NAME,
    caddyDataVolume: mode === 'public' ? env.OR3_CADDY_DATA_VOLUME : undefined,
    caddyConfigVolume: mode === 'public' ? env.OR3_CADDY_CONFIG_VOLUME : undefined,
    deploymentId: env.OR3_DEPLOYMENT_ID,
    deploymentRoot: resolve(directory),
    appVersion: env.OR3_VERSION,
    image: env.OR3_IMAGE,
    imageDigest: digest,
    domain: mode === 'public' ? env.OR3_PUBLIC_DOMAIN : undefined,
    port: Number(env.OR3_PORT),
    lastSuccessfulOperation: operation,
    updatedAt: now(),
  };
}

/**
 * Refuses to mutate state written by a newer schema than this CLI is qualified
 * to write. The bridge reads schema 2 but must not downgrade or edit it; the
 * owner is directed to the compatible exact-target CLI instead.
 */
export function assertStateSchemaWritable(state: ManagedState) {
  const writer = writeStateSchema();
  if (state.schemaVersion > writer) {
    throw new Error(`This CLI reads managed state schema ${state.schemaVersion} but is qualified to write schema ${writer}. Run the compatible exact-version @or3/cloud CLI for this deployment; do not edit or hand-migrate managed state.`);
  }
}

export async function loadManaged(directory = process.cwd(), options: { writable?: boolean } = {}) {
  const resolved = resolve(directory);
  const state = await readState(resolved);
  if (options.writable !== false) assertStateSchemaWritable(state);
  const env = parseEnv(await readText(deploymentPaths(resolved).env));
  assertDeploymentIdentity(state, env);
  assertDeploymentDirectoryIdentity(resolved, state);
  return { directory: resolved, state, env };
}

export async function commitRecoveredState(directory: string, previous: ManagedState, next: ManagedState) {
  // Terminal state is authoritative and must land before the redundant mirror
  // is removed. Mirror cleanup is warning-only: an enclosing catch must not be
  // able to turn a completed commit back into pending state.
  await writeState(directory, next);
  await removeOperationRecordSafely(directory, previous.incompleteOperation?.id);
}

export function assertNoPending(state: ManagedState) {
  if (state.incompleteOperation) {
    throw new Error(`An incomplete ${state.incompleteOperation.operation} is recorded. Run "npx @or3/cloud recover" before starting another operation.`);
  }
}

/**
 * Explicit phase policy for container lifecycle commands (R4.AC4). Stopping is
 * always safe. Starting or restarting while an interrupted operation is
 * recorded would bypass recovery bookkeeping and can resurrect an ambiguous
 * deployment, so it requires the operator to run recovery first.
 */
export function assertPhaseAllowsCommand(command: 'start' | 'stop' | 'restart', state: ManagedState) {
  const pending = state.incompleteOperation;
  if (!pending || command === 'stop') return;
  throw new Error(
    `An incomplete ${pending.operation}${pending.phase ? ` (${pending.phase})` : ''} is recorded. Refusing to ${command} an ambiguous deployment. Run "npx @or3/cloud recover --dry-run" to inspect the supported actions, then "npx @or3/cloud recover --finish" or "npx @or3/cloud recover --restore --yes".`,
  );
}
