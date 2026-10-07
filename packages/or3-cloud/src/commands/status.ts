import { boolFlag, type Flags, stringFlag } from '../cli/args';
import type { Mode } from '../deployment/contracts';
import { secretValues } from '../deployment/env';
import { assertDeploymentDirectoryIdentity } from '../deployment/identity';
import { observationFindings, observeDeployment, publicStateProjection } from '../deployment/observation';
import { loadManaged } from '../deployment/state-store';
import { run } from '../runtime/command-runner';
import { composeArgs } from '../runtime/compose';
import { containerNodeCommand, probeDeepHealth } from '../runtime/health';
import { redact } from '../util/primitives';

const MAINTENANCE_SCRIPT = "fetch('http://127.0.0.1:3000/api/health?deep=true').then(async response=>{const body=await response.json().catch(()=>({}));const m=body?.providers?.sync?.details?.maintenance;if(m)console.log(JSON.stringify(m))}).catch(()=>{})";

/**
 * Reports deployment summary, container status, and a bounded deep-health
 * probe. Uses independent observations so a corrupt state/env/backup source
 * still reports the evidence that is readable, and labels a live lease as
 * in-progress rather than authoritative.
 */
export async function statusCommand(directory: string, flags: Flags = {}) {
  const observation = await observeDeployment(directory, { checkDocker: true, checkImage: true });
  const findings = observationFindings(observation);
  const state = observation.state;
  if (boolFlag(flags, 'json')) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'or3-deployment-status',
      observedAt: observation.observedAt,
      partial: observation.partial,
      inProgress: observation.changing,
      directory: observation.directory,
      state: state ? publicStateProjection(state) : null,
      stateError: observation.stateError,
      envError: observation.envError,
      lease: observation.lease.status,
      docker: observation.docker,
      recordedImageDigest: observation.recordedImageDigest,
      actualImageDigest: observation.actualImageDigest,
      identityMatches: observation.identityMatches,
      lastReceipt: state?.lastReceipt ?? null,
      backups: observation.backups,
      findings,
    }, null, 2));
    return;
  }
  console.log(`OR3 Cloud deployment: ${observation.directory}`);
  if (observation.changing) console.log('  status: in progress (a mutation lease is active; this observation is not authoritative)');
  if (!state) {
    console.log(`  state: unreadable${observation.stateError ? ` — ${observation.stateError}` : ''}`);
  } else {
    console.log(`  mode: ${state.mode}`);
    console.log(`  version: ${state.appVersion}`);
    if (state.domain) console.log(`  domain: ${state.domain}`);
    console.log(`  port: ${state.port}`);
    console.log(`  image digest: ${state.imageDigest}`);
    console.log(`  last successful operation: ${state.lastSuccessfulOperation} (${state.updatedAt})`);
    if (state.incompleteOperation) console.log(`  incomplete operation: ${state.incompleteOperation.operation} (${state.incompleteOperation.id})`);
    if (state.lastError) console.log(`  last error: ${state.lastError}`);
  }
  if (observation.envError) console.log(`  environment: unreadable — ${observation.envError}`);
  if (observation.identityMatches === false) console.log(`  image: MISMATCH (recorded ${observation.recordedImageDigest}, local ${observation.actualImageDigest})`);
  else if (observation.identityMatches === true) console.log('  image: digest matches managed state');
  console.log();
  if (state && observation.docker && observation.env) {
    try {
      const ps = await run('docker', [...composeArgs(directory, state.mode, ['ps'])], directory);
      console.log(ps.ok ? ps.stdout.trim() : `Could not list containers: ${ps.stderr}`);
      const health = await probeDeepHealth(directory, state.mode);
      if (health === 'ok') console.log('Deep health: OK');
      else if (health === 'degraded') console.log('Deep health: DEGRADED (the container is running but /api/health?deep=true is failing).');
      else console.log('Deep health: unreachable (the or3 container is not running).');
      await printMaintenanceSummary(directory, state.mode);
    } catch (error) {
      // Compose needs the managed .env for the project name; a failure here is
      // reported as a skipped check rather than failing the whole status.
      console.log(`Container and health checks were skipped: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  } else if (state && !observation.docker) {
    console.log('Docker is unavailable; container and health checks were skipped.');
  } else if (state && !observation.env) {
    console.log('The managed environment is unreadable; container and health checks were skipped.');
  }
  for (const finding of findings) console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
}

/** Renders the provider maintenance state (SQLite history GC) from deep health. */
async function printMaintenanceSummary(directory: string, mode: Mode) {
  const result = await run('docker', [...composeArgs(directory, mode, ['exec', '-T', 'or3', ...containerNodeCommand(MAINTENANCE_SCRIPT)])], directory);
  if (!result.ok || !result.stdout.trim()) return;
  try {
    const maintenance = JSON.parse(result.stdout.trim()) as {
      enabled?: boolean;
      lastRun?: string;
      backlog?: number;
      lastError?: string;
      state?: string;
    };
    if (!maintenance.enabled) return;
    const state = maintenance.state ?? 'idle';
    const line = `Sync history maintenance: ${state}${maintenance.lastRun ? ` (last run ${maintenance.lastRun})` : ''}${maintenance.backlog !== undefined ? `, backlog ${maintenance.backlog}` : ''}`;
    if (state === 'failed') {
      console.log(`⚠ ${line}${maintenance.lastError ? `: ${maintenance.lastError}` : ''}`);
    } else {
      console.log(`  ${line}`);
    }
  } catch {
    // The maintenance payload is informational; never fail status on a parse issue.
  }
}

export async function logsCommand(directory: string, flags: Flags, positionals: string[]) {
  const loaded = await loadManaged(directory, { writable: false });
  assertDeploymentDirectoryIdentity(directory, loaded.state);
  if (positionals.length > 1) throw new Error('logs accepts at most one service name.');
  const tailValue = stringFlag(flags, 'tail') ?? '200';
  const tail = Number(tailValue);
  if (!Number.isInteger(tail) || tail < 1) throw new Error('--tail must be a positive integer.');
  const service = positionals[0];
  const args = composeArgs(directory, loaded.state.mode, [
    'logs', '--no-color', '--tail', String(tail), ...(service ? [service] : []),
  ]);
  const result = await run('docker', [...args], directory);
  if (!result.ok) throw new Error(`${result.command}\n${result.stderr}`);
  const secrets = secretValues(loaded.env);
  process.stdout.write(redact(result.stdout, secrets));
  if (result.stderr) process.stderr.write(redact(result.stderr, secrets));
}
