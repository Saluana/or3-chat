import { secretValues } from '../deployment/env';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import { assertPhaseAllowsCommand, loadManaged } from '../deployment/state-store';
import { compose } from '../runtime/compose';
import { ensureDocker } from '../runtime/docker';
import { waitForDeepHealth } from '../runtime/health';
import { startProject, stopProject } from '../runtime/project';

export async function startCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertPhaseAllowsCommand('start', loaded.state);
  await startProject(directory, loaded.state.mode, loaded.env);
  const url = loaded.state.mode === 'public' ? `https://${loaded.state.domain}` : `http://127.0.0.1:${loaded.state.port}`;
  console.log(`OR3 started and is deeply healthy at ${url}.`);
}

export async function stopCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  await stopProject(directory, loaded.state.mode);
  console.log('OR3 stopped. The data volume, backups, and managed state are retained.');
}

export async function restartCommand(directory: string) {
  await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertPhaseAllowsCommand('restart', loaded.state);
  await compose(directory, loaded.state.mode, ['restart', 'or3']);
  await waitForDeepHealth(directory, loaded.state.mode, secretValues(loaded.env));
  console.log('OR3 restarted and is deeply healthy.');
}
