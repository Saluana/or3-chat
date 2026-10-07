import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSET_ROOT } from '../package-info';
import { copySecure, durableRename, fileExists, sha256File } from '../util/fs';
import type { BackupManifest, Mode } from './contracts';

export const MANAGED_ASSET_INVENTORY_VERSION = 3;

export function managedAssetNames(mode: Mode) {
  return ['compose.yaml', 'compose.operator.yaml', 'dashboard-operator.mjs', ...(mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [])];
}

export function managedAssetNamesForInventory(mode: Mode, inventoryVersion?: number) {
  if (inventoryVersion === MANAGED_ASSET_INVENTORY_VERSION) return managedAssetNames(mode);
  if (inventoryVersion === 2) {
    return ['compose.yaml', 'dashboard-operator.mjs', ...(mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [])];
  }
  return ['compose.yaml', ...(mode === 'public' ? ['compose.public.yaml', 'Caddyfile'] : [])];
}

async function installManagedAssets(directory: string, assets: Map<string, Buffer>) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(4).toString('hex');
  const staged: Array<{ destination: string; replacement: string; rollback?: string }> = [];
  let retainRollbackCopies = false;
  const canCleanRollback = (): boolean => !retainRollbackCopies;
  try {
    for (const [name, contents] of assets) {
      const destination = join(directory, name);
      const replacement = `${destination}.next-${token}`;
      const entry: { destination: string; replacement: string; rollback?: string } = {
        destination,
        replacement,
      };
      staged.push(entry);
      await writeFile(replacement, contents, { mode: 0o644 });
      await chmod(replacement, 0o644);
      if (await fileExists(destination)) {
        entry.rollback = `${destination}.previous-${token}`;
        await copyFile(destination, entry.rollback);
        await chmod(entry.rollback, 0o644);
      }
    }
    const applied: typeof staged = [];
    try {
      for (const entry of staged) {
        applied.push(entry);
        await durableRename(entry.replacement, entry.destination);
      }
      for (const [name, contents] of assets) {
        if (!(await readFile(join(directory, name))).equals(contents)) {
          throw new Error(`Managed asset ${name} did not match its staged replacement after commit.`);
        }
      }
    } catch (error) {
      const rollbackErrors: Error[] = [];
      for (const entry of applied.reverse()) {
        try {
          if (entry.rollback) await durableRename(entry.rollback, entry.destination);
          else await rm(entry.destination, { force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
        }
      }
      if (rollbackErrors.length > 0) {
        retainRollbackCopies = true;
        throw new AggregateError([error, ...rollbackErrors], 'Managed asset installation failed and one or more rollback copies could not be restored. Recovery copies were retained.');
      }
      throw error;
    }
  } finally {
    for (const entry of staged) {
      await rm(entry.replacement, { force: true }).catch(() => undefined);
      if (entry.rollback && canCleanRollback()) await rm(entry.rollback, { force: true }).catch(() => undefined);
    }
  }
}

export async function copyAssets(directory: string, mode: Mode) {
  const assets = new Map<string, Buffer>();
  for (const name of managedAssetNames(mode)) {
    assets.set(name, await readFile(join(ASSET_ROOT, name)));
  }
  await installManagedAssets(directory, assets);
}

/** Checksums of the managed assets currently installed in the deployment. */
export async function installedManagedAssetChecksums(directory: string, mode: Mode) {
  const checksums: Record<string, string> = {};
  for (const name of managedAssetNames(mode)) {
    if (!await fileExists(join(directory, name))) continue;
    checksums[name] = await sha256File(join(directory, name));
  }
  return checksums;
}

export async function snapshotManagedAssets(directory: string, mode: Mode, backupDir: string) {
  const assetDir = join(backupDir, 'managed-assets');
  await mkdir(assetDir, { recursive: true, mode: 0o700 });
  await chmod(assetDir, 0o700);
  const checksums: Record<string, string> = {};
  for (const name of managedAssetNames(mode)) {
    // The first dashboard-capable update must still snapshot and roll back a
    // deployment created before the operator asset existed.
    if ((name === 'dashboard-operator.mjs' || name === 'compose.operator.yaml') && !await fileExists(join(directory, name))) continue;
    const destination = join(assetDir, name);
    await copySecure(join(directory, name), destination);
    checksums[name] = await sha256File(destination);
  }
  return checksums;
}

export async function verifiedManagedAssetContents(backupPath: string, manifest: BackupManifest) {
  const checksums = manifest.managedAssetSha256;
  if (!checksums) return undefined;
  const expected = managedAssetNamesForInventory(manifest.mode, manifest.managedAssetInventoryVersion).sort();
  const actual = Object.keys(checksums).sort();
  if (
    (manifest.managedAssetInventoryVersion !== undefined && manifest.managedAssetInventoryVersion !== 2 && manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION)
    || actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error(`Backup ${manifest.backupId} has an invalid managed asset inventory.`);
  }
  const assets = new Map<string, Buffer>();
  for (const name of expected) {
    const expectedSha = checksums[name];
    if (!expectedSha || !/^[0-9a-f]{64}$/i.test(expectedSha)) {
      throw new Error(`Backup ${manifest.backupId} has an invalid checksum for managed asset ${name}.`);
    }
    const source = join(backupPath, 'managed-assets', name);
    const actualSha = await sha256File(source);
    if (actualSha !== expectedSha) {
      throw new Error(`Backup managed asset checksum mismatch for ${name}. Expected ${expectedSha}, got ${actualSha}.`);
    }
    assets.set(name, await readFile(source));
  }
  return assets;
}

export async function restoreManagedAssets(directory: string, backupPath: string, manifest: BackupManifest) {
  const assets = await verifiedManagedAssetContents(backupPath, manifest);
  if (!assets) {
    throw new Error(`Backup ${manifest.backupId} predates authenticated managed-asset snapshots. Refusing to run its image under today's Compose/Caddy assets; restore with the exact historical @or3/cloud release after separately authenticating its assets.`);
  }
  await installManagedAssets(directory, assets);
  if (manifest.managedAssetInventoryVersion !== 2 && manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION) {
    await rm(join(directory, 'dashboard-operator.mjs'), { force: true });
  }
  if (manifest.managedAssetInventoryVersion !== MANAGED_ASSET_INVENTORY_VERSION) {
    await rm(join(directory, 'compose.operator.yaml'), { force: true });
  }
  return true;
}

export function assertRestorableManagedAssets(manifest: BackupManifest) {
  if (!manifest.managedAssetSha256) {
    throw new Error(`Backup ${manifest.backupId} predates authenticated managed-asset snapshots. Refusing to run its image under today's Compose/Caddy assets; restore with the exact historical @or3/cloud release after separately authenticating its assets.`);
  }
}
