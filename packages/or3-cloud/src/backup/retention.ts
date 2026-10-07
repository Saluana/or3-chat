import { rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  BackupEntry,
  BackupListing,
  Diagnostic,
  ManagedState,
  RetentionPlan,
} from '../deployment/contracts';
import { backupDirectory, deploymentPaths } from '../deployment/paths';
import { lifecycleFaults } from '../lifecycle-faults';
import { BACKUP_ID_PATTERN, inspectBackupEntry, inventoryBackups } from './manifests';

export const BACKUP_RETENTION_KEEP = 5;

/** Pure guard: only an operation's own generated backup ID may be removed. */
export function assertRemovableArtifactName(name: string) {
  if (!BACKUP_ID_PATTERN.test(name)) {
    throw new Error(`Refusing to remove a backup artifact named "${name}". Only paths matching an OR3-generated backup ID may be removed.`);
  }
  return name;
}

/**
 * Removes exactly the named backup directory under .or3-cloud/backups and
 * nothing else: the name must match an OR3-generated backup ID and the
 * resolved path must sit directly inside the backups root.
 */
export async function removeNamedBackupArtifact(directory: string, backupId: string) {
  await lifecycleFaults.beforeArtifactDelete?.();
  assertRemovableArtifactName(backupId);
  const target = backupDirectory(directory, backupId);
  if (dirname(target) !== deploymentPaths(directory).backups) {
    throw new Error(`Refusing to remove a path outside the backups directory: ${target}.`);
  }
  await rm(target, { recursive: true, force: true });
  await rm(join(deploymentPaths(directory).exports, `${backupId}.json`), { force: true });
}

async function removeEnumeratedBackupArtifact(directory: string, backup: BackupListing) {
  await lifecycleFaults.beforeArtifactDelete?.();
  const backupsRoot = resolve(deploymentPaths(directory).backups);
  const target = resolve(backup.path);
  if (
    dirname(target) !== backupsRoot
    || basename(target) !== backup.backupId
    || !BACKUP_ID_PATTERN.test(backup.backupId)
  ) {
    throw new Error(`Refusing to prune an untrusted backup path ${backup.path}.`);
  }
  await rm(target, { recursive: true, force: true });
  await rm(join(deploymentPaths(directory).exports, `${backup.backupId}.json`), { force: true });
}

/**
 * Pure retention rule: keeps the newest `keep` verified backups. Backups
 * referenced by the rollback point, an update, or a restore/rollback are never
 * removed. This helper keeps the legacy force-override only for its original
 * unit contract; `planRetention` is the production planner.
 */
export function selectPruneTargets(
  backups: Array<{ backupId: string; createdAt: string }>,
  keep: number,
  protectedIds: ReadonlySet<string>,
  force = false,
) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Backup retention must be an integer of at least 1.');
  const sorted = [...backups].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const deletable = force ? sorted : sorted.filter((backup) => !protectedIds.has(backup.backupId));
  return deletable.slice(keep).map((backup) => backup.backupId);
}

/**
 * Separated retention decision. No force path can override protected IDs
 * (rollback point, update snapshot, or a pending restore/rollback source).
 * Suspect or legacy entries are preserved; automatic pruning is deferred when
 * any entry is invalid/unreadable/unsupported, but a fresh authenticated
 * snapshot and update are never blocked by an unrelated suspect entry.
 */
export function planRetention(
  entries: BackupEntry[],
  keep: number,
  protectedIds: ReadonlySet<string>,
  options: { automatic?: boolean } = {},
): RetentionPlan {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Backup retention must be an integer of at least 1.');
  const automatic = options.automatic ?? true;
  const warnings: Diagnostic[] = [];
  const preserve: Array<{ entryName: string; reason: string }> = [];
  let canPrune = true;
  for (const entry of entries) {
    if (entry.kind === 'verified') continue;
    preserve.push({ entryName: entry.entryName, reason: entry.message });
    if (entry.kind === 'legacy-unsigned' || entry.kind === 'legacy-adoption') continue;
    warnings.push({
      code: entry.code,
      severity: entry.kind === 'unreadable' ? 'blocker' : 'warning',
      resource: entry.entryName,
      message: entry.message,
    });
    if (automatic) canPrune = false;
  }
  const verified = entries
    .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
    .map((entry) => entry.backup)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const removable = verified.filter((backup) => !protectedIds.has(backup.backupId));
  const remove = removable.slice(keep).map((backup) => backup.backupId);
  const removeSet = new Set(remove);
  return {
    keep: verified.filter((backup) => !removeSet.has(backup.backupId)).map((backup) => backup.backupId),
    remove,
    preserve,
    warnings,
    canPrune,
  };
}

export type PruneResult = { removed: number; deferred: Diagnostic[] };

export function retentionProtectedIds(state: ManagedState) {
  const protectedIds = new Set<string>();
  if (state.rollback?.backupId) protectedIds.add(state.rollback.backupId);
  const pending = state.incompleteOperation;
  if (pending?.backupId) protectedIds.add(pending.backupId);
  if (pending?.previousBackupId) protectedIds.add(pending.previousBackupId);
  return protectedIds;
}

/**
 * Enforces bounded backup retention from a classified inventory. Automatic
 * housekeeping defers (never deletes) when a suspect entry is present, and no
 * path removes protected recovery sources. `force` (explicit, already
 * confirmed) bypasses the suspect-entry deferral but not protection.
 */
export async function pruneBackups(
  directory: string,
  state: ManagedState,
  keep: number,
  force: boolean,
  options: { automatic?: boolean; log?: (message: string) => void; warn?: (message: string) => void } = {},
): Promise<PruneResult> {
  const automatic = options.automatic ?? !force;
  const log = options.log ?? ((message: string) => console.log(message));
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const inventory = await inventoryBackups(directory);
  if (inventory.storeErrors.length > 0) {
    if (automatic) return { removed: 0, deferred: inventory.storeErrors };
    throw new Error(inventory.storeErrors.map((diagnostic) => diagnostic.message).join(' '));
  }
  const plan = planRetention(inventory.entries, keep, retentionProtectedIds(state), { automatic });
  if (!plan.canPrune && !force) {
    warn('Automatic backup pruning was deferred because the store contains entries that need inspection.');
    for (const warning of plan.warnings) warn(`  ${warning.code}: ${warning.message}`);
    return { removed: 0, deferred: plan.warnings };
  }
  const verified = new Map(
    inventory.entries
      .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
      .map((entry) => [entry.backup.backupId, entry.backup]),
  );
  if (force && plan.remove.length > 0) {
    log(`--force --yes will permanently delete: ${plan.remove.join(', ')}`);
  }
  // Inventory once above, then revalidate only the selected entry immediately
  // before its deletion. Re-inventorying the whole store per deletion rehashed
  // every remaining archive, which is quadratic on large histories.
  let removed = 0;
  for (const backupId of plan.remove) {
    const backup = verified.get(backupId);
    if (!backup) throw new Error(`Retention selected backup ${backupId}, but its verified path disappeared before deletion.`);
    const revalidated = await inspectBackupEntry(deploymentPaths(directory).backups, backupId, directory);
    const current = revalidated.kind === 'verified' ? revalidated.backup : undefined;
    if (!current || current.path !== backup.path || current.dataSha256 !== backup.dataSha256) {
      throw new Error(`Backup ${backupId} changed while pruning was in progress. Aborting retention before deletion.`);
    }
    await removeEnumeratedBackupArtifact(directory, current);
    log(`Deleted backup ${backupId} at ${current.path}`);
    removed += 1;
  }
  return { removed, deferred: plan.warnings };
}
