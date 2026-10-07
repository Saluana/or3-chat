import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPurgeHasVerifiedExport } from '../backup/export';
import { enumerateBackups } from '../backup/manifests';
import { boolFlag, type Flags } from '../cli/args';
import { managedAssetNames } from '../deployment/assets';
import type { ManagedState } from '../deployment/contracts';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import { assertNoPending, loadManaged } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import { compose } from '../runtime/compose';
import { ensureDocker } from '../runtime/docker';

/** Purge targets derived only from validated managed state — never user input. */
export function purgeVolumesFromState(state: ManagedState) {
  const volumes = [state.volumeName];
  if (state.mode === 'public') {
    if (state.caddyDataVolume) volumes.push(state.caddyDataVolume);
    if (state.caddyConfigVolume) volumes.push(state.caddyConfigVolume);
  }
  return volumes;
}

export async function removeCommand(directory: string, flags: Flags) {
  if (boolFlag(flags, 'purge-data') && !boolFlag(flags, 'yes')) {
    throw new Error('--purge-data deletes the data volume, every backup, and the managed files. Re-run with --purge-data --yes after confirming the data-loss boundary.');
  }
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  const { state } = loaded;
  if (!boolFlag(flags, 'purge-data')) {
    // Data-retaining removal: containers and the compose network only.
    // Volumes, backups, .env, state, and the .or3-cloud directory survive.
    await compose(directory, state.mode, ['down']);
    console.log(`Removed runtime containers and network. Data volume, backups, configuration, and managed state are retained at ${directory}. Re-run \`npx @or3/cloud start\` to restore service.`);
    return;
  }
  // Hard refuse unless a fresh export is still checksum-verified on another
  // filesystem, rather than treating a local backup as disaster recovery.
  const exportReceipt = await assertPurgeHasVerifiedExport(directory, await enumerateBackups(directory), Date.now());
  const volumes = purgeVolumesFromState(state);
  const managedFiles = [
    '.env',
    '.or3-cloud',
    ...managedAssetNames(state.mode),
    '.or3-initial-credentials',
  ];
  console.log('Removing exactly these targets:');
  for (const volume of volumes) console.log(`  docker volume ${volume}`);
  for (const file of managedFiles) console.log(`  ${join(directory, file)}`);
  await compose(directory, state.mode, ['down']);
  // Recheck immediately before deletion. A moved mount or symlink cannot turn
  // the receipt that authorized this purge into a descendant of the purge
  // target after the operator confirmed it.
  await assertPurgeHasVerifiedExport(directory, await enumerateBackups(directory), Date.now());
  for (const volume of volumes) {
    const result = await run('docker', ['volume', 'rm', volume], directory);
    if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  }
  for (const file of managedFiles) {
    await rm(join(directory, file), { recursive: true, force: true });
  }
  console.log(`Purged: data volumes, backups, .env, managed state, and compose files were deleted. The verified export at ${exportReceipt.destination} is the remaining copy.`);
}
