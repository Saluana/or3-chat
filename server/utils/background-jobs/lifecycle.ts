import { randomUUID } from 'node:crypto';
import type {
    BackgroundJob,
    BackgroundJobProvider,
    JobUpdate,
} from './types';
import type { BackgroundStreamParams } from './stream-handler';
import { decryptBackgroundCredential } from './crypto';
import { emitJobStatus } from './viewers';

export const BACKGROUND_JOB_LEASE_MS = 30_000;
const BACKGROUND_JOB_HEARTBEAT_MS = 10_000;

export type BackgroundJobExecutor = (
    jobId: string,
    params: BackgroundStreamParams,
    provider: BackgroundJobProvider,
    abortSignal: AbortSignal
) => Promise<void>;

export interface BackgroundJobLifecycleDependencies {
    provider: BackgroundJobProvider;
    encryptionKey: string;
    execute: BackgroundJobExecutor;
    workerId?: string;
    now?: () => number;
    leaseMs?: number;
}

const activeJobs = new Map<
    string,
    { leaseOwner: string; abortController: AbortController }
>();

function launchClaimedJob(
    job: BackgroundJob,
    dependencies: BackgroundJobLifecycleDependencies
): void {
    void runClaimedBackgroundJob(job, dependencies).catch((error) => {
        console.warn(
            '[background-jobs] Claimed job runner failed:',
            error instanceof Error ? error.message : 'Unknown error'
        );
    });
}

function supportsDurableClaims(provider: BackgroundJobProvider): boolean {
    return Boolean(
        provider.claimJob &&
        provider.claimNextJob &&
        provider.renewJobLease
    );
}

function hasUnsafeInterruptedTool(job: BackgroundJob): boolean {
    if ((job.attempts ?? 0) <= 1) return false;
    const checkpointed = new Set(
        job.execution?.checkpointedToolCallIds ?? []
    );
    return (job.tool_calls ?? []).some(
        (call) =>
            call.status !== 'pending' &&
            (!call.id || !checkpointed.has(call.id))
    );
}

function pendingToolCleanup(job: BackgroundJob): JobUpdate | null {
    if ((job.attempts ?? 0) <= 1 || !job.tool_calls?.length) return null;
    const checkpointed = new Set(
        job.execution?.checkpointedToolCallIds ?? []
    );
    const retained = job.tool_calls.filter(
        (call) => call.id && checkpointed.has(call.id)
    );
    return retained.length === job.tool_calls.length
        ? null
        : { tool_calls: retained };
}

/** Execute one already-claimed job while renewing and fencing its lease. */
export async function runClaimedBackgroundJob(
    job: BackgroundJob,
    dependencies: BackgroundJobLifecycleDependencies
): Promise<void> {
    const workerId = job.leaseOwner;
    const renew = dependencies.provider.renewJobLease;
    const execution = job.execution;
    if (!workerId || !renew || !execution) {
        return;
    }

    const abortController =
        dependencies.provider.getAbortController?.(job.id) ??
        new AbortController();
    const previous = activeJobs.get(job.id);
    if (previous?.leaseOwner === workerId) return;
    previous?.abortController.abort(
        new Error('Background job lease was superseded')
    );
    activeJobs.set(job.id, { leaseOwner: workerId, abortController });
    const now = dependencies.now ?? Date.now;
    const leaseMs = dependencies.leaseMs ?? BACKGROUND_JOB_LEASE_MS;
    let renewing = false;
    const heartbeat = setInterval(() => {
        if (renewing || abortController.signal.aborted) return;
        renewing = true;
        void renew.call(
            dependencies.provider,
            job.id,
            workerId,
            now(),
            now() + leaseMs
        ).then((owned) => {
            if (!owned) {
                abortController.abort(
                    new Error('Background job lease was superseded')
                );
            }
        }).catch(() => {
            // A transient provider outage is retried on the next heartbeat.
            // Fenced writes still prevent this worker from committing if the
            // lease expires and another process takes over.
        }).finally(() => {
            renewing = false;
        });
    }, Math.min(BACKGROUND_JOB_HEARTBEAT_MS, Math.max(1, leaseMs / 3)));
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    try {
        if (hasUnsafeInterruptedTool(job)) {
            await dependencies.provider.failJob(
                job.id,
                'Server restarted while a tool result was not safely checkpointed. Retry the message to avoid repeating a side effect.',
                workerId
            );
            return;
        }

        const cleanup = pendingToolCleanup(job);
        if (cleanup) {
            await dependencies.provider.updateJob(job.id, {
                ...cleanup,
                leaseOwner: workerId,
            });
        }

        if ((job.attempts ?? 0) > 1) {
            emitJobStatus(job.id, 'streaming', {
                content: job.content,
                contentLength: job.content.length,
                chunksReceived: job.chunksReceived,
                tool_calls: cleanup?.tool_calls ?? job.tool_calls,
                workflow_state: job.workflow_state,
                attempt: job.attempts ?? 0,
                content_reset: true,
            });
        }

        const apiKey = decryptBackgroundCredential(
            execution.apiKeyCiphertext,
            dependencies.encryptionKey
        );
        await dependencies.execute(
            job.id,
            {
                body: execution.body,
                apiKey,
                userId: job.userId,
                workspaceId: execution.workspaceId,
                threadId: job.threadId,
                messageId: job.messageId,
                referer: execution.referer,
                execution,
                leaseOwner: workerId,
            },
            dependencies.provider,
            abortController.signal
        );
    } catch (error) {
        const latest = await dependencies.provider
            .getJob(job.id, job.userId)
            .catch(() => null);
        if (
            latest?.status === 'streaming' &&
            latest.leaseOwner === workerId &&
            !abortController.signal.aborted
        ) {
            await dependencies.provider.failJob(
                job.id,
                error instanceof Error ? error.message : String(error),
                workerId
            );
        }
    } finally {
        clearInterval(heartbeat);
        if (activeJobs.get(job.id)?.leaseOwner === workerId) {
            activeJobs.delete(job.id);
        }
    }
}

/** Claim and start a newly admitted job. Duplicate starts simply lose the claim. */
export async function claimAndRunBackgroundJob(
    jobId: string,
    dependencies: BackgroundJobLifecycleDependencies
): Promise<boolean> {
    if (!supportsDurableClaims(dependencies.provider)) return false;
    const workerId = `${dependencies.workerId ?? 'worker'}:${randomUUID()}`;
    const now = dependencies.now ?? Date.now;
    const leaseMs = dependencies.leaseMs ?? BACKGROUND_JOB_LEASE_MS;
    const job = await dependencies.provider.claimJob!(
        jobId,
        workerId,
        now(),
        now() + leaseMs
    );
    if (!job) return false;
    launchClaimedJob(job, { ...dependencies, workerId });
    return true;
}

/** Claim every currently recoverable job without waiting for model completion. */
export async function reconcileBackgroundJobs(
    dependencies: BackgroundJobLifecycleDependencies,
    maxClaims = 20
): Promise<number> {
    if (!supportsDurableClaims(dependencies.provider)) return 0;
    const now = dependencies.now ?? Date.now;
    const leaseMs = dependencies.leaseMs ?? BACKGROUND_JOB_LEASE_MS;
    let claimed = 0;
    while (claimed < maxClaims) {
        const workerId = `${dependencies.workerId ?? 'worker'}:${randomUUID()}`;
        const job = await dependencies.provider.claimNextJob!(
            workerId,
            now(),
            now() + leaseMs
        );
        if (!job) break;
        claimed += 1;
        launchClaimedJob(job, { ...dependencies, workerId });
    }
    return claimed;
}

/** Test-only process-local lifecycle reset. */
export function resetBackgroundJobLifecycleForTests(): void {
    for (const active of activeJobs.values()) {
        active.abortController.abort();
    }
    activeJobs.clear();
}
