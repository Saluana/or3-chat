import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readText, writeSecure } from '../util/fs';
import { now } from '../util/primitives';
import { deploymentPaths } from './paths';
import { readRestartJournal } from '../../../../shared/server/restarts/controller';

const DASHBOARD_LEASE_STALE_MS = 30_000;

export type LeaseOwner = {
  schemaVersion: 1;
  nonce: string;
  command: string;
  origin: 'cli' | 'dashboard';
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
  jobId?: string;
};

export async function readLeaseOwner(leasePath: string): Promise<LeaseOwner | undefined> {
  try {
    const owner = JSON.parse(await readText(join(leasePath, 'owner.json'))) as Partial<LeaseOwner>;
    if (
      owner.schemaVersion !== 1
      || typeof owner.nonce !== 'string'
      || typeof owner.command !== 'string'
      || (owner.origin !== 'cli' && owner.origin !== 'dashboard')
      || !Number.isSafeInteger(owner.pid)
      || typeof owner.acquiredAt !== 'string'
      || typeof owner.heartbeatAt !== 'string'
    ) return undefined;
    return owner as LeaseOwner;
  } catch {
    return undefined;
  }
}

export function cliLeaseOwnerIsGone(owner: LeaseOwner) {
  if (owner.origin !== 'cli') return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export function dashboardLeaseOwnerIsStale(owner: LeaseOwner, jobId?: string) {
  if (owner.origin !== 'dashboard' || (jobId && owner.jobId !== jobId)) return false;
  const heartbeat = Date.parse(owner.heartbeatAt);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat > DASHBOARD_LEASE_STALE_MS;
}

export async function acquireDeploymentLease(directory: string, command: string, dashboardJobId?: string) {
  const leasePath = deploymentPaths(directory).lease;
  await mkdir(dirname(leasePath), { recursive: true, mode: 0o700 });
  const nonce = randomBytes(16).toString('hex');
  const owner: LeaseOwner = {
    schemaVersion: 1,
    nonce,
    command,
    origin: dashboardJobId || process.env.OR3_DASHBOARD_UPDATE_JOB_ID ? 'dashboard' : 'cli',
    jobId: dashboardJobId || process.env.OR3_DASHBOARD_UPDATE_JOB_ID?.trim() || undefined,
    pid: process.pid,
    acquiredAt: now(),
    heartbeatAt: now(),
  };
  try {
    await mkdir(leasePath, { recursive: false, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const active = await readLeaseOwner(leasePath);
    if (active && (cliLeaseOwnerIsGone(active) || dashboardLeaseOwnerIsStale(active, owner.jobId))) {
      const stalePath = `${leasePath}.stale-${randomBytes(8).toString('hex')}`;
      try {
        await rename(leasePath, stalePath);
        await rm(stalePath, { recursive: true, force: true });
        await mkdir(leasePath, { recursive: false, mode: 0o700 });
      } catch (reclaimError) {
        throw new Error(`Another OR3 Cloud operation owns ${directory}. Refusing to race its lifecycle lock. ${reclaimError instanceof Error ? reclaimError.message : String(reclaimError)}`);
      }
    } else {
      const detail = active
        ? `${active.command} (${active.origin}) acquired at ${active.acquiredAt}`
        : 'an unreadable owner record';
      throw new Error(`Another OR3 Cloud operation owns ${directory}: ${detail}. Refusing to run concurrently.`);
    }
  }
  try {
    await writeSecure(join(leasePath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`);
  } catch (error) {
    await rm(leasePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const heartbeat = setInterval(() => {
    owner.heartbeatAt = now();
    // A transient heartbeat write failure must not become an unhandled
    // rejection that kills the lifecycle process. The atomic lease directory
    // remains owned; CLI leases also retain the live-PID check, while a stale
    // dashboard lease still requires the full recovery protocol before reuse.
    void writeSecure(join(leasePath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`).catch(() => undefined);
  }, 5_000);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    const current = await readLeaseOwner(leasePath);
    if (current?.nonce === nonce) await rm(leasePath, { recursive: true, force: true });
  };
}

export async function withDeploymentLease<T>(directory: string, command: string, action: () => Promise<T>) {
  await assertRestartJournalSettled(directory);
  const release = await acquireDeploymentLease(directory, command);
  try {
    await assertRestartJournalSettled(directory);
    return await action();
  } finally {
    await release();
  }
}

export async function assertRestartJournalSettled(directory: string) {
  try {
    const journal = await readRestartJournal(join(directory, '.or3-cloud', 'restarts', 'restarts.json'));
    if (journal.operations.some(operation => !['succeeded', 'cancelled', 'failed'].includes(operation.phase))) {
      throw new Error('A dashboard restart is unresolved. Run the compatible CLI recover --dry-run to inspect and recover --finish to reconcile it before another mutation.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (error instanceof Error && error.message.startsWith('A dashboard restart')) throw error;
    throw new Error('The dashboard restart journal is invalid. Inspect it with the deployment owner before reconciliation; mutations are blocked.');
  }
}
