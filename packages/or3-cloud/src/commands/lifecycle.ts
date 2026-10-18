import { secretValues } from '../deployment/env';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import { assertPhaseAllowsCommand, loadManaged } from '../deployment/state-store';
import { assertRunningAppImage, assertSafeComposeBinding, compose, composeArgs } from '../runtime/compose';
import { run } from '../runtime/command-runner';
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

export async function restartCommand(directory: string, lifecycle?: { applySaved: boolean; deadline: number }) {
  if (!lifecycle) await ensureDocker();
  const loaded = await loadManaged(directory);
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  assertPhaseAllowsCommand('restart', loaded.state);
  if (lifecycle) {
    await assertSafeComposeBinding(directory, loaded.state.mode, loaded.env, lifecycle.deadline);
    await assertRunningAppImage(directory, loaded.state.mode, loaded.state.image, lifecycle.deadline);
    const command = lifecycle.applySaved
      ? ['up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', '--no-build', 'or3']
      : ['restart', 'or3'];
    const result = await run('docker', composeArgs(directory, loaded.state.mode, command), directory, undefined, lifecycle.deadline - performance.now());
    if (!result.ok) throw new Error('The application replacement did not complete. Inspect deployment diagnostics before recovery.');
    return;
  }
  await compose(directory, loaded.state.mode, ['restart', 'or3']);
  await waitForDeepHealth(directory, loaded.state.mode, secretValues(loaded.env));
  console.log('OR3 restarted and is deeply healthy.');
}
