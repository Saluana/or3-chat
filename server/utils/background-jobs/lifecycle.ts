import { serializeError } from '~~/shared/errors';
import { randomUUID } from 'node:crypto';
import type { BackgroundJob, BackgroundJobProvider, DurableBackgroundJobProvider, JobUpdate } from './types';
import { getChatJobExecution } from './types';
import type { BackgroundStreamParams } from './stream-handler';
import { decryptBackgroundCredential } from './crypto';
import { emitJobStatus } from './viewers';
import { reconcileBackgroundJobHistory } from './history';
import { getShutdownRuntime } from '../shutdown/runtime';
import { supportsDurableBackgroundJobs } from './capabilities';
import { classifyDelegationDispatchFailure } from './model-dispatch';

export const BACKGROUND_JOB_LEASE_MS = 30_000;
const BACKGROUND_JOB_HEARTBEAT_MS = 10_000;

export type BackgroundJobExecutor = (
    jobId: string,
    params: BackgroundStreamParams,
    provider: DurableBackgroundJobProvider,
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
    void getShutdownRuntime().controller.track(runClaimedBackgroundJob(job, dependencies)).catch((error) => {
        console.warn(
            '[background-jobs] Claimed job runner failed:',
            error instanceof Error ? error.message : 'Unknown error'
        );
    });
}

function hasUnsafeInterruptedTool(job: BackgroundJob): boolean {
    if ((job.attempts ?? 0) <= 1) return false;
    const checkpointed = new Set(getChatJobExecution(job)?.checkpointedToolCallIds ?? []);
    return (job.tool_calls ?? []).some(
        (call) =>
            call.status !== 'pending' &&
            (!call.id || !checkpointed.has(call.id))
    );
}

function pendingToolCleanup(job: BackgroundJob): JobUpdate | null {
    if ((job.attempts ?? 0) <= 1 || !job.tool_calls?.length) return null;
    const checkpointed = new Set(getChatJobExecution(job)?.checkpointedToolCallIds ?? []);
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
    if (!supportsDurableBackgroundJobs(dependencies.provider)) return;
    const provider = dependencies.provider;
    const workerId = job.leaseOwner;
    const renew = provider.renewJobLease;
    const execution = getChatJobExecution(job);
    if (!workerId || !execution) {
        return;
    }

    const abortController =
        provider.getAbortController?.(job.id) ??
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
    const heartbeat = setInterval(
        () => {
            if (renewing || abortController.signal.aborted) return;
            renewing = true;
            void renew
                .call(
                    provider,
                    job.id,
                    workerId,
                    now(),
                    now() + leaseMs
                )
                .then((owned) => {
                    if (!owned) {
                        abortController.abort(
                            new Error('Background job lease was superseded')
                        );
                    }
                })
                .catch(() => {
                    // A transient provider outage is retried on the next heartbeat.
                    // Fenced writes still prevent this worker from committing if the
                    // lease expires and another process takes over.
                })
                .finally(() => {
                    renewing = false;
                });
        },
        Math.min(BACKGROUND_JOB_HEARTBEAT_MS, Math.max(1, leaseMs / 3))
    );
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    try {
        if (execution.cancellationRequestedAt) {
            const saved = await provider.saveTerminalSnapshot(job.id, { status: 'aborted',
                content: job.content, reasoning: job.reasoning, toolCalls: job.tool_calls, usage: job.usage, completedAt: now() }, workerId);
            if (saved) {
                const stopped = await provider.getJob(job.id, job.userId);
                if (stopped) await reconcileBackgroundJobHistory(provider, stopped);
            }
            return;
        }
        // Presence alone is unsafe, even if the marker is malformed or from a
        // newer version. Never contact the model to guess its outcome.
        if (execution.delegationDispatch !== undefined) {
            throw Object.assign(new Error('Model request outcome is unknown.'), { code: 'ERR_MODEL_OUTCOME_UNKNOWN', retryable: false });
        }
        if (execution.delegationRecoveryPolicy !== undefined && execution.delegationRecoveryPolicy !== 'v1') {
            throw Object.assign(new Error('Unsupported model recovery policy.'), { code: 'ERR_VALIDATION', retryable: false });
        }
        if (hasUnsafeInterruptedTool(job)) {
            throw Object.assign(new Error('Tool execution was interrupted before checkpointing.'), { code: 'ERR_TOOL_OUTCOME_UNKNOWN', retryable: false });
        }

        const cleanup = pendingToolCleanup(job);
        if (cleanup) {
            await provider.updateJob(job.id, {
                ...cleanup,
                leaseOwner: workerId,
            });
        }

        if ((job.attempts ?? 0) > 1) {
            emitJobStatus(job.id, 'streaming', {
                content: job.content,
                usage: job.usage,
                contentLength: job.content.length,
                reasoning: job.reasoning,
                reasoningLength: job.reasoning.length,
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
                attempt: job.attempts,
            },
            provider,
            abortController.signal
        );
        const completed = await dependencies.provider
            .getJob(job.id, job.userId)
            .catch(() => null);
        if (completed?.historyPhase === 'finalization_pending') {
            await reconcileBackgroundJobHistory(
                provider,
                completed
            );
        }
    } catch (error) {
        const latest = await dependencies.provider
            .getJob(job.id, job.userId)
            .catch(() => null);
        if (latest?.status === 'streaming' && getChatJobExecution(latest)?.cancellationRequestedAt
            && latest.leaseOwner === workerId) {
            const saved = await provider.saveTerminalSnapshot(job.id, { status: 'aborted',
                content: latest.content, reasoning: latest.reasoning, toolCalls: latest.tool_calls, usage: latest.usage, completedAt: now() }, workerId);
            if (saved) {
                const stopped = await provider.getJob(job.id, job.userId);
                if (stopped) await reconcileBackgroundJobHistory(provider, stopped);
            }
            return;
        }
        // A worker that yielded after an ambiguous write or lost lease cannot
        // decide a terminal outcome, even if its old lease is still visible.
        if (error instanceof Error && error.name === 'BackgroundJobLeaseLostError') return;
        if (
            latest?.status === 'streaming' &&
            latest.leaseOwner === workerId &&
            !abortController.signal.aborted
        ) {
            const execution = getChatJobExecution(latest);
            const message = serializeError(classifyDelegationDispatchFailure(error, execution), { code: 'ERR_STREAM_FAILURE', source: 'provider', credentialSource: execution?.credentialSource });
            if (
                execution?.history
            ) {
                const saved = await provider.saveTerminalSnapshot(
                    job.id,
                    {
                        status: 'error',
                        content: latest.content,
                        usage: latest.usage,
                        reasoning: latest.reasoning,
                        toolCalls: latest.tool_calls,
                        error: message,
                        completedAt: Date.now(),
                    },
                    workerId
                );
                if (saved) {
                    emitJobStatus(job.id, 'error', {
                        content: latest.content,
                        usage: latest.usage,
                        contentLength: latest.content.length,
                        reasoning: latest.reasoning,
                        error: message,
                        tool_calls: latest.tool_calls,
                        attempt: latest.attempts ?? 0,
                        chunksReceived: latest.chunksReceived,
                    });
                    const terminal = await provider.getJob(
                        job.id,
                        job.userId
                    );
                    if (terminal) {
                        await reconcileBackgroundJobHistory(
                            provider,
                            terminal
                        );
                    }
                }
            } else {
                await provider.failJob(job.id, message, workerId);
            }
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
    if (!getShutdownRuntime().controller.canStartWork() || !supportsDurableBackgroundJobs(dependencies.provider)) return false;
    const workerId = `${dependencies.workerId ?? 'worker'}:${randomUUID()}`;
    const now = dependencies.now ?? Date.now;
    const leaseMs = dependencies.leaseMs ?? BACKGROUND_JOB_LEASE_MS;
    const job = await getShutdownRuntime().controller.track(dependencies.provider.claimJob(
        jobId,
        workerId,
        now(),
        now() + leaseMs
    ));
    if (!job) return false;
    launchClaimedJob(job, { ...dependencies, workerId });
    return true;
}

/** Claim every currently recoverable job without waiting for model completion. */
export async function reconcileBackgroundJobs(
    dependencies: BackgroundJobLifecycleDependencies,
    maxClaims = 20
): Promise<number> {
    if (!getShutdownRuntime().controller.canStartWork() || !supportsDurableBackgroundJobs(dependencies.provider)) return 0;
    const now = dependencies.now ?? Date.now;
    const leaseMs = dependencies.leaseMs ?? BACKGROUND_JOB_LEASE_MS;
    let claimed = 0;
    while (claimed < maxClaims && getShutdownRuntime().controller.canStartWork()) {
        const workerId = `${dependencies.workerId ?? 'worker'}:${randomUUID()}`;
        const job = await getShutdownRuntime().controller.track(dependencies.provider.claimNextJob(
            workerId,
            now(),
            now() + leaseMs
        ));
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
