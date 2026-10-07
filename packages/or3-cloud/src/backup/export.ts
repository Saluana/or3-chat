import { chmod, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { managedAssetNamesForInventory } from '../deployment/assets';
import type { BackupExportReceipt, BackupListing } from '../deployment/contracts';
import { deploymentPaths } from '../deployment/paths';
import { copySecure, fileExists, readText, sha256File, writeSecure } from '../util/fs';
import { now } from '../util/primitives';
import { readManifest, resolveBackup } from './manifests';

const PURGE_REQUIRES_BACKUP_WITHIN_MS = 24 * 60 * 60 * 1000;

export async function exportBackup(directory: string, backupId: string, destination: string) {
  const backupPath = await resolveBackup(directory, backupId);
  const manifest = await readManifest(backupPath, directory);
  const dest = resolve(destination);
  const source = resolve(backupPath);
  const deploymentRoot = await realpath(directory);
  if (source === dest || dest.startsWith(`${source}${sep}`)) {
    throw new Error('Choose a destination directory different from the backup itself.');
  }
  if (await fileExists(dest)) throw new Error(`Destination ${dest} already exists. Choose a new empty destination so an export can never merge with unrelated files.`);
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  const canonicalDestination = join(await realpath(dirname(dest)), basename(dest));
  if (canonicalDestination === deploymentRoot || canonicalDestination.startsWith(`${deploymentRoot}${sep}`)) {
    throw new Error('Backup exports must live outside the managed deployment directory so `remove --purge-data` can never delete the remaining copy.');
  }
  await mkdir(dest, { mode: 0o700 });
  try {
    if (await realpath(dest) !== canonicalDestination) {
      throw new Error('Backup export destination changed while it was being created. Refusing to write an export through an unexpected path.');
    }
    await chmod(dest, 0o700);
    for (const file of ['data.tgz', 'config.env', 'manifest.json', 'manifest.auth']) {
      await copySecure(join(backupPath, file), join(dest, file));
    }
    if (manifest.managedAssetSha256) {
      for (const name of managedAssetNamesForInventory(manifest.mode, manifest.managedAssetInventoryVersion)) {
        await copySecure(join(backupPath, 'managed-assets', name), join(dest, 'managed-assets', name));
      }
    }
    const dataSha = await sha256File(join(dest, 'data.tgz'));
    if (dataSha !== manifest.dataSha256) {
      throw new Error(`Exported data.tgz checksum mismatch for ${manifest.backupId}. Expected ${manifest.dataSha256}, got ${dataSha}.`);
    }
    if (manifest.configSha256) {
      const configSha = await sha256File(join(dest, 'config.env'));
      if (configSha !== manifest.configSha256) {
        throw new Error(`Exported config.env checksum mismatch for ${manifest.backupId}.`);
      }
    }
    await readManifest(dest, directory);
    const destinationDevice = (await stat(dest)).dev;
    await mkdir(deploymentPaths(directory).exports, { recursive: true, mode: 0o700 });
    const receipt: BackupExportReceipt = {
      schemaVersion: 1,
      backupId: manifest.backupId,
      exportedAt: now(),
      destination: dest,
      destinationDevice,
      dataSha256: manifest.dataSha256,
      configSha256: manifest.configSha256,
    };
    await writeSecure(join(deploymentPaths(directory).exports, `${manifest.backupId}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    let bytes = (await stat(join(dest, 'data.tgz'))).size + (await stat(join(dest, 'config.env'))).size + (await stat(join(dest, 'manifest.json'))).size + (await stat(join(dest, 'manifest.auth'))).size;
    if (manifest.managedAssetSha256) {
      for (const name of managedAssetNamesForInventory(manifest.mode, manifest.managedAssetInventoryVersion)) {
        bytes += (await stat(join(dest, 'managed-assets', name))).size;
      }
    }
    console.log(`Exported backup ${manifest.backupId} (${bytes} bytes) to ${dest}`);
    console.log('The exported copy contains credentials and secrets. It is owner-only (0600); keep it off-host.');
    if ((await stat(backupPath)).dev === destinationDevice) {
      console.log('This export is on the same filesystem as the deployment and cannot authorize `remove --purge-data`. Copy it to a mounted backup disk or another host, then export again there.');
    } else {
      console.log('Verified export recorded. It can authorize `remove --purge-data --yes` while this backup remains fresh.');
    }
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
}

/** Pure freshness gate used before verifying an export receipt. */
export function assertPurgeBackupFreshness(
  backups: Array<{ backupId: string; createdAt: string }>,
  nowMs: number,
) {
  const cutoff = nowMs - PURGE_REQUIRES_BACKUP_WITHIN_MS;
  if (!backups.some((backup) => new Date(backup.createdAt).getTime() >= cutoff)) {
    throw new Error('No backup newer than 24 hours exists for this deployment. Run "npx @or3/cloud backup" and "npx @or3/cloud backup export <backup-id> <destination-dir>" before destroying local data.');
  }
}

async function readBackupExportReceipt(directory: string, backupId: string): Promise<BackupExportReceipt | undefined> {
  try {
    const receipt = JSON.parse(await readText(join(deploymentPaths(directory).exports, `${backupId}.json`))) as Partial<BackupExportReceipt>;
    if (
      receipt.schemaVersion !== 1 ||
      receipt.backupId !== backupId ||
      typeof receipt.destination !== 'string' ||
      !isAbsolute(receipt.destination) ||
      typeof receipt.destinationDevice !== 'number' ||
      !receipt.dataSha256
    ) return undefined;
    return receipt as BackupExportReceipt;
  } catch {
    return undefined;
  }
}

/**
 * Purge is allowed only when a fresh backup has a checksum-verified export on
 * another filesystem. The receipt is revalidated at destruction time so a
 * copied receipt, deleted export, or same-device destination cannot bypass it.
 */
export async function assertPurgeHasVerifiedExport(directory: string, backups: BackupListing[], nowMs: number) {
  assertPurgeBackupFreshness(backups, nowMs);
  const cutoff = nowMs - PURGE_REQUIRES_BACKUP_WITHIN_MS;
  for (const backup of backups) {
    if (new Date(backup.createdAt).getTime() < cutoff) continue;
    const receipt = await readBackupExportReceipt(directory, backup.backupId);
    if (!receipt || !await fileExists(receipt.destination)) continue;
    const deploymentRoot = await realpath(directory);
    try {
      const canonicalDestination = await realpath(receipt.destination);
      if (canonicalDestination === deploymentRoot || canonicalDestination.startsWith(`${deploymentRoot}${sep}`)) continue;
      const exported = await readManifest(receipt.destination, directory);
      const sourceDevice = (await stat(backup.path)).dev;
      const destinationDevice = (await stat(receipt.destination)).dev;
      if (
        sourceDevice !== destinationDevice &&
        receipt.destinationDevice === destinationDevice &&
        exported.backupId === backup.backupId &&
        exported.dataSha256 === receipt.dataSha256 &&
        exported.dataSha256 === backup.dataSha256 &&
        exported.configSha256 === receipt.configSha256
      ) return receipt;
    } catch {
      // Try another fresh backup; a malformed or missing export cannot count.
    }
  }
  throw new Error('No fresh checksum-verified backup export on another filesystem is available. Run `npx @or3/cloud backup export <backup-id> <new-directory-on-a-mounted-backup-disk>` before purging local data.');
}
