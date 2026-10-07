import { createBackup } from '../backup/create';
import { exportBackup } from '../backup/export';
import { inventoryBackups } from '../backup/manifests';
import { BACKUP_RETENTION_KEEP, pruneBackups } from '../backup/retention';
import { boolFlag, type Flags, stringFlag } from '../cli/args';
import type { BackupListing, PendingOperation } from '../deployment/contracts';
import { secretValues } from '../deployment/env';
import { backupDirectory } from '../deployment/paths';
import {
  assertNoPending,
  clearPending,
  loadManaged,
  markPending,
  writeState,
} from '../deployment/state-store';
import { ensureDocker } from '../runtime/docker';
import { projectServiceRunning } from '../runtime/project';
import { id, now, redact } from '../util/primitives';

function parseKeep(flags: Flags) {
  const value = stringFlag(flags, 'keep') ?? String(BACKUP_RETENTION_KEEP);
  const keep = Number(value);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be an integer of at least 1.');
  return keep;
}

async function backupCreateCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const backupId = id('backup');
  const initialAppRunning = await projectServiceRunning(loaded.directory, loaded.state.mode);
  const pending: PendingOperation = {
    id: id('backup-operation'),
    operation: 'backup',
    startedAt: now(),
    message: 'Creating a stopped-volume backup',
    backupId,
    backupPath: backupDirectory(loaded.directory, backupId),
    initialAppRunning,
    phase: 'prepared',
  };
  await markPending(loaded.directory, loaded.state, pending);
  try {
    const result = await createBackup(loaded.directory, loaded.state, loaded.env, { backupId, initiallyRunning: initialAppRunning });
    await clearPending(loaded.directory, loaded.state);
    // Retention is deliberately after the verified snapshot is committed and
    // OR3 is healthy. A corrupt older artifact must not turn a successful
    // backup into an incomplete operation or cause the new copy to be lost.
    const prune = await pruneBackups(loaded.directory, loaded.state, BACKUP_RETENTION_KEEP, false, { automatic: true });
    console.log(`Backup ${result.backupId} created at ${result.backupDir}`);
    console.log(`SHA-256: ${result.manifest.dataSha256}`);
    if (prune.deferred.length > 0) {
      console.warn(`Maintenance warning: ${prune.deferred.length} backup entr${prune.deferred.length === 1 ? 'y' : 'ies'} need inspection; all backups were preserved. Run "npx @or3/cloud backup list" for details.`);
    }
  } catch (error) {
    loaded.state.lastError = redact(error instanceof Error ? error.message : String(error), secretValues(loaded.env));
    await writeState(loaded.directory, loaded.state);
    throw error;
  }
}

async function backupListCommand(directory: string, flags: Flags = {}) {
  const loaded = await loadManaged(directory, { writable: false });
  const inventory = await inventoryBackups(loaded.directory);
  const verified = inventory.entries
    .filter((entry): entry is { kind: 'verified'; backup: BackupListing } => entry.kind === 'verified')
    .map((entry) => entry.backup);
  const findings = inventory.entries.filter((entry) => entry.kind !== 'verified');
  if (boolFlag(flags, 'json')) {
    // One versioned object on stdout; a store-level failure is reported in-band
    // so automation can parse it without losing the diagnostic.
    console.log(JSON.stringify({
      schemaVersion: 1,
      directory: loaded.directory,
      backups: verified.map((backup) => ({
        backupId: backup.backupId,
        createdAt: backup.createdAt,
        appVersion: backup.appVersion,
        bytes: backup.bytes,
        dataSha256: backup.dataSha256,
        trust: 'verified',
      })),
      findings: findings.map((entry) => ({ entryName: entry.entryName, kind: entry.kind, code: entry.code, message: entry.message })),
      storeErrors: inventory.storeErrors,
    }, null, 2));
    return;
  }
  if (verified.length === 0 && findings.length === 0) {
    console.log(`No backups are available for ${loaded.directory}. Run "npx @or3/cloud backup" to create one.`);
    return;
  }
  if (verified.length === 0) {
    console.log(`No authenticated backups are available for ${loaded.directory}.`);
  } else {
    console.log(`OR3 Cloud backups for ${loaded.directory} (${verified.length} verified):`);
    console.log('backupId                      createdAt                      version  bytes     trust     checksum');
    for (const backup of verified) {
      console.log(
        `${backup.backupId.padEnd(30)} ${backup.createdAt.padEnd(30)} ${backup.appVersion.padEnd(8)} ${String(backup.bytes).padStart(9)}  ${'verified'.padEnd(9)} ${backup.dataSha256.slice(0, 12)}`,
      );
    }
  }
  if (findings.length > 0) {
    console.log(`\nPreserved history (${findings.length}; never trusted for restore):`);
    for (const entry of findings) {
      console.log(`  ${entry.entryName.padEnd(30)} ${entry.kind.padEnd(16)} ${entry.code}`);
      console.log(`    ${entry.message}`);
    }
    console.log('\nTo obtain a trusted restore point, create a new backup of the current healthy deployment: npx @or3/cloud backup');
  }
  for (const diagnostic of inventory.storeErrors) {
    console.log(`\nStore error (${diagnostic.severity}): ${diagnostic.message}`);
  }
  console.log('\nBackups contain credentials and secrets; keep them owner-only and export off-host.');
}

async function backupPruneCommand(directory: string, flags: Flags) {
  const loaded = await loadManaged(directory);
  assertNoPending(loaded.state);
  const keep = parseKeep(flags);
  const force = boolFlag(flags, 'force');
  if (force && !boolFlag(flags, 'yes')) throw new Error('--force may delete backups beyond the retention count. Re-run with --force --yes after confirming the exact backups shown by `backup list`.');
  const result = await pruneBackups(loaded.directory, loaded.state, keep, force, { automatic: !force });
  if (!force && result.deferred.length > 0 && result.removed === 0) {
    throw new Error(`Backup pruning is blocked because the store contains entries that need inspection:\n${result.deferred.map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.message}`).join('\n')}\nNo backups were deleted. Run "npx @or3/cloud backup list" to inspect them, or re-run with --force --yes to prune only verified backups while preserving protected recovery sources.`);
  }
  console.log(result.removed > 0
    ? `Pruned ${result.removed} backup(s); keeping the newest ${keep}.`
    : `Nothing to prune: keeping all backups (newest ${keep}).`);
  if (result.deferred.length > 0) {
    console.warn(`Preserved ${result.deferred.length} suspect or legacy entr${result.deferred.length === 1 ? 'y' : 'ies'} without deletion.`);
  }
}

export async function backupCommand(directory: string, positionals: string[], flags: Flags) {
  const subcommand = positionals[0];
  if (!subcommand) return await backupCreateCommand(directory);
  if (subcommand === 'list') {
    if (positionals.length > 1) throw new Error('backup list accepts no arguments.');
    return await backupListCommand(directory, flags);
  }
  if (boolFlag(flags, 'json')) throw new Error('--json is supported only by `backup list`.');
  if (subcommand === 'prune') {
    if (positionals.length > 1) throw new Error('backup prune accepts no arguments.');
    return await backupPruneCommand(directory, flags);
  }
  if (subcommand === 'export') {
    const backupId = positionals[1];
    const destination = positionals[2];
    if (!backupId || !destination) throw new Error('backup export requires a backup ID and a destination directory.');
    if (positionals.length > 3) throw new Error('backup export accepts a backup ID and a destination directory only.');
    return await exportBackup(directory, backupId, destination);
  }
  throw new Error(`Unknown backup subcommand "${subcommand}". Use list, prune, export, or no subcommand to create a backup.`);
}
