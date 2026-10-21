import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '../deployment/contracts';
import { parseEnv, secretValues } from '../deployment/env';
import { run } from './command-runner';
import { assertRunningAppImage, assertSafeComposeBinding, compose, composeArgs } from './compose';
import { waitForDeepHealth } from './health';

export function managedVaultEnabled(directory: string, env?: Record<string, string>) {
  const selected = env ?? parseEnv(readFileSync(join(directory, '.env'), 'utf8'));
  return selected.SSR_AUTH_ENABLED === 'true' && (selected.NUXT_SECRETS_PROVIDER ?? 'or3-secrets') === 'or3-secrets'
    && readFileSync(join(directory, 'compose.yaml'), 'utf8').includes('\n  or3-vault:\n');
}

export async function stopProject(directory: string, mode: Mode) {
  await compose(directory, mode, ['stop', 'or3', ...(managedVaultEnabled(directory) ? ['or3-vault'] : [])]);
}

export async function projectServiceRunning(directory: string, mode: Mode) {
  const result = await run('docker', composeArgs(directory, mode, ['ps', '--status', 'running', '-q', 'or3']), directory);
  if (!result.ok) throw new Error(`Could not determine whether OR3 is running. ${result.stderr.trim()}`);
  return Boolean(result.stdout.trim());
}

export async function startProject(directory: string, mode: Mode, env: Record<string, string>) {
  await assertSafeComposeBinding(directory, mode, env);
  // A dashboard-origin update runs inside the operator service. Recreating the
  // whole project here can kill that process before it commits its terminal
  // journal state. Keep its supervisor and proxy running; replace only the
  // application service, then let the operator restart itself after commit.
  const services = process.env.OR3_DASHBOARD_UPDATE_JOB_ID ? ['or3'] : [];
  await compose(directory, mode, ['up', '-d', '--wait', '--wait-timeout', '180', ...services], secretValues(env));
  await waitForDeepHealth(directory, mode, secretValues(env));
  await assertRunningAppImage(directory, mode, env.OR3_IMAGE);
}
