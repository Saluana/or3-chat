import { deploymentPaths } from '../deployment/paths';
import type { ManagedState } from '../deployment/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '../deployment/contracts';
import { parseEnv, secretValues } from '../deployment/env';
import { run } from './command-runner';
import { updatePending } from '../deployment/state-store';
import { assertRunningAppImage, assertSafeComposeBinding, compose, composeArgs } from './compose';
import { containerNodeCommand, waitForDeepHealth } from './health';

export function managedVaultEnabled(directory: string, env?: Record<string, string>) {
  const selected = env ?? parseEnv(readFileSync(join(directory, '.env'), 'utf8'));
  return selected.SSR_AUTH_ENABLED === 'true' && (selected.NUXT_SECRETS_PROVIDER ?? 'or3-secrets') === 'or3-secrets'
    && readFileSync(join(directory, 'compose.yaml'), 'utf8').includes('\n  or3-vault:\n');
}

export async function stopProject(directory: string, mode: Mode) {
  await compose(directory, mode, ['stop', 'or3', ...(managedVaultEnabled(directory) ? ['or3-vault'] : [])]);
  if (await projectServiceRunning(directory, mode)) throw new Error('OR3 writers remain running after stop; refusing data replacement');
}

export async function projectServiceRunning(directory: string, mode: Mode) {
  const result = await run('docker', composeArgs(directory, mode, ['ps', '--status', 'running', '-q', 'or3']), directory);
  if (!result.ok) throw new Error(`Could not determine whether OR3 is running. ${result.stderr.trim()}`);
  return Boolean(result.stdout.trim());
}

export async function startProject(directory: string, mode: Mode, env: Record<string, string>) {
  let state: ManagedState | undefined;
  try { state = JSON.parse(readFileSync(deploymentPaths(directory).state, 'utf8')) as ManagedState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const pending = state?.incompleteOperation;
  if (pending?.phase === 'history-reset-required' || pending?.historyReset &&
      ((pending.historyReset.kind === 'legacy-snapshot' ? pending.historyReset.progress !== 'verified' : pending.historyReset.progress !== 'reset-complete') || !['starting-target', 'starting-previous'].includes(pending.phase ?? ''))) {
    throw new Error('Refusing startup across an unfinished history reset gate; run managed recovery');
  }
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

/** Inspects the immutable container configuration, including failed/stopped boots.
 * Missing/ambiguous containers are never evidence of closed admission. */
export async function validationAdmissionProof(directory: string, state: ManagedState): Promise<string | undefined> {
  const pending = state.incompleteOperation;
  if (pending?.phase !== 'validating-target' || pending.admission?.state !== 'closed' || pending.admission.targetImage !== pending.targetImage) return;
  const listed = await run('docker', composeArgs(directory, state.mode, ['ps', '-aq', 'or3']), directory);
  const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
  if (!listed.ok || ids.length !== 1 || pending.admission.containerId && pending.admission.containerId !== ids[0]) return;
  const inspected = await run('docker', ['inspect', '--format', '{{json .Config.Env}}\n{{json .Image}}', ids[0]!], directory);
  const image = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', pending.targetImage!], directory);
  try {
    const lines = inspected.stdout.trim().split('\n');
    const env = JSON.parse(lines[0]!) as unknown;
    if (!inspected.ok || !image.ok || JSON.parse(lines[1]!) !== image.stdout.trim() || !Array.isArray(env)
      || env.filter(value => typeof value === 'string' && value.startsWith('OR3_CLOUD_UPDATE_VALIDATION=')).join() !== 'OR3_CLOUD_UPDATE_VALIDATION=true') return;
    return ids[0];
  } catch { return; }
}

export async function startValidationProject(directory: string, state: ManagedState, env: Record<string, string>) {
  await startProject(directory, state.mode, env);
  const containerId = await validationAdmissionProof(directory, state);
  if (!containerId) throw new Error('Closed health-only admission could not be proven; explicit recovery required');
  await updatePending(directory, state, { admission: { state: 'closed', targetImage: env.OR3_IMAGE!, containerId } });
  const result = await run('docker', composeArgs(directory, state.mode, ['exec', '-T', 'or3', ...containerNodeCommand(`
// OR3_VALIDATION_PROBE: actual health marker plus pre-handler application refusal.
(async()=>{const health=await fetch('http://127.0.0.1:3000/api/health?deep=true',{signal:AbortSignal.timeout(10000)});
const body=await health.json();
if(!health.ok||body.status!=='ok'||body.validation!=='health-only-v1')throw Error('Invalid validation health');
for(const [path,method] of [['/','GET'],['/api/auth/session','GET'],['/api/sync/push','POST'],['/api/health','POST']]){
 const response=await fetch('http://127.0.0.1:3000'+path,{method,redirect:'manual',signal:AbortSignal.timeout(10000)});
 const body=await response.json();
 if(response.status!==503||body.data?.code!=='update_validation')throw Error('Application admission is not closed');
}})().catch(()=>process.exit(1));`)]), directory);
  if (!result.ok) throw new Error('Candidate health-only validation failed');
}
