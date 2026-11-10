import { boolFlag, type Flags } from '../cli/args';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import { assertNoPending, loadManaged } from '../deployment/state-store';
import { compose } from '../runtime/compose';
import { ensureDocker } from '../runtime/docker';

export async function removeCommand(directory: string, flags: Flags) {
  if (boolFlag(flags, 'purge-data') && !boolFlag(flags, 'yes')) {
    throw new Error('--purge-data is disabled because reconstruction from an export is not yet supported. Preserve the deployment and backups.');
  }
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertNoPending(loaded.state);
  // Purge would delete state and containers that the current restore path
  // requires. Keep it disabled until export reconstruction is qualified.
  if (boolFlag(flags, 'purge-data')) {
    throw new Error('Purge is disabled because reconstruction from an export is not yet supported. Preserve the deployment and backups.');
  }
  await compose(directory, loaded.state.mode, ['down']);
  console.log(`Removed runtime containers and network. Data volume, backups, configuration, and managed state are retained at ${directory}. Re-run \`npx @or3/cloud start\` to restore service.`);
}
