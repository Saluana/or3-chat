/**
 * @module server/utils/background-jobs/providers/memory
 *
 * Purpose:
 * In-process background job provider for single-instance deployments.
 * Jobs are stored in memory and are lost on server restart.
 *
 * Responsibilities:
 * - Persist job state in memory.
 * - Enforce max concurrent job limits.
 * - Provide AbortController access for streaming cancellation.
 * - Periodically clean up stale or timed-out jobs.
 *
 * Non-Goals:
 * - Multi-instance coordination.
 * - Durable persistence across restarts.
 */

import type {
    BackgroundJobProvider,
    BackgroundJob,
    BackgroundJobExecution,
    CreateJobParams,
    JobUpdate,
    AdmissionCancellationResult,
    GenerationHistoryPhase,
    TerminalGenerationSnapshot,
} from '../types';
import { AdmissionCancelledError } from '../types';
import { getJobConfig } from '../store';

/**
 * Internal job record that includes an AbortController.
 */
interface MemoryJob extends BackgroundJob {
    abortController: AbortController;
    idempotencyKey?: string;
}

/** In-memory job storage */
const jobs = new Map<string, MemoryJob>();

/**
 * Admission cancellation markers. Process-local, like the jobs they guard,
 * but shared by creation and cancellation so a late commit cannot launch work.
 * Value is the marker expiry timestamp.
 */
const cancelledAdmissions = new Map<string, number>();
const ADMISSION_CANCEL_TTL_MS = 10 * 60 * 1000;

function admissionKey(userId: string, admissionId: string): string {
    return `${userId}:${admissionId}`;
}

function hasActiveAdmissionCancel(
    userId: string,
    admissionId: string
): boolean {
    const key = admissionKey(userId, admissionId);
    const expiresAt = cancelledAdmissions.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
        cancelledAdmissions.delete(key);
        return false;
    }
    return true;
}

function pruneAdmissionCancels(): void {
    const now = Date.now();
    for (const [key, expiresAt] of cancelledAdmissions) {
        if (expiresAt <= now) cancelledAdmissions.delete(key);
    }
}

/** Cleanup interval handle */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Remove timed-out and stale jobs based on configured retention windows.
 */
async function cleanupExpiredJobs(): Promise<number> {
    const config = getJobConfig();
    const now = Date.now();
    let cleaned = 0;
    pruneAdmissionCancels();

    for (const [id, job] of jobs) {
        const isStreaming = job.status === 'streaming';
        const idleFor = now - (job.lastActivityAt ?? job.startedAt);
        const isTimedOut = isStreaming && idleFor > config.jobTimeoutMs;

        const isTerminal = ['complete', 'error', 'aborted'].includes(job.status);
        const completedAge = now - (job.completedAt ?? job.startedAt);
        // Durable history owns deletion: a terminal job whose canonical write
        // is still pending must never be reclaimed by retention.
        const historySettled =
            !job.historyPhase ||
            job.historyPhase === 'ready' ||
            job.historyPhase === 'committed' ||
            job.historyPhase === 'superseded';
        const isStale =
            isTerminal &&
            historySettled &&
            completedAge > config.completedJobRetentionMs;

        if (isTimedOut) {
            // This is an inactivity watchdog, never a total runtime limit. A
            // workflow that is actively receiving model output must remain live.
            job.abortController.abort();
            job.status = 'error';
            job.error = 'Job timed out';
            job.completedAt = now;
            if (job.execution?.history && job.historyPhase !== 'admission_pending') {
                job.historyPhase = 'finalization_pending';
            }
            cleaned++;
        } else if (isStale) {
            // Remove old completed jobs
            jobs.delete(id);
            cleaned++;
        }
    }

    return cleaned;
}

/**
 * Start periodic cleanup if not already running.
 */
function ensureCleanupInterval(): void {
    if (cleanupInterval) return;

    cleanupInterval = setInterval(
        () => {
            void cleanupExpiredJobs();
        },
        60_000
    );

    // Do not block process exit
    if (typeof cleanupInterval.unref === 'function') {
        cleanupInterval.unref();
    }
}

/**
 * Generate a unique job identifier.
 */
function generateJobId(): string {
    return crypto.randomUUID();
}

function ownsLease(job: MemoryJob, leaseOwner?: string): boolean {
    if (job.leaseOwner === undefined) return leaseOwner === undefined;
    return (
        job.leaseOwner === leaseOwner &&
        (job.leaseExpiresAt ?? 0) > Date.now()
    );
}

function throwLeaseLost(): never {
    const error = new Error('Background job lease was superseded');
    error.name = 'BackgroundJobLeaseLostError';
    throw error;
}

function toPublicJob(job: MemoryJob): BackgroundJob {
    const {
        abortController: _,
        idempotencyKey: _idempotencyKey,
        ...result
    } = job;
    return result;
}

function cloneJob(job: MemoryJob): BackgroundJob {
    return structuredClone(toPublicJob(job));
}

function claimJobRecord(
    job: MemoryJob,
    leaseOwner: string,
    now: number,
    leaseExpiresAt: number
): BackgroundJob | null {
    if (
        job.status !== 'streaming' ||
        !job.execution ||
        job.execution.clientToolCall !== undefined ||
        (job.historyPhase ?? 'ready') !== 'ready'
    ) return null;
    if (job.leaseOwner && (job.leaseExpiresAt ?? 0) > now) {
        return null;
    }

    const recovering = (job.attempts ?? 0) > 0;
    job.leaseOwner = leaseOwner;
    job.leaseExpiresAt = leaseExpiresAt;
    job.attempts = (job.attempts ?? 0) + 1;
    job.abortController = new AbortController();
    if (recovering) {
        job.content = job.execution.contentBase ?? '';
        job.reasoning = job.execution.reasoningBase ?? '';
        job.chunksReceived = 0;
    }
    return toPublicJob(job);
}

/**
 * Purpose:
 * Memory-backed provider implementation for background jobs.
 *
 * Constraints:
 * - Process-local storage only.
 * - Abort controllers are available for in-process streaming cancellation.
 */
export const memoryJobProvider: BackgroundJobProvider = {
    name: 'memory',

    async createJob(params: CreateJobParams): Promise<string> {
        ensureCleanupInterval();

        const config = getJobConfig();

        if (params.idempotencyKey) {
            const existing = Array.from(jobs.values()).find(
                (job) =>
                    job.userId === params.userId &&
                    job.idempotencyKey === params.idempotencyKey
            );
            if (existing) return existing.id;
            if (hasActiveAdmissionCancel(params.userId, params.idempotencyKey)) {
                throw new AdmissionCancelledError(params.idempotencyKey);
            }
        }

        // Enforce max concurrent jobs
        const currentJobs = Array.from(jobs.values());
        const activeCount = currentJobs.filter(
            (j) => j.status === 'streaming' && !j.execution?.clientToolCall
        ).length;
        const activeCountForUser = currentJobs.filter(
            (j) => j.status === 'streaming' && !j.execution?.clientToolCall && j.userId === params.userId
        ).length;
        // Browser handoffs release a worker slot, but parked records still
        // need a separate bound so abandoned browsers cannot grow the queue.
        const waitingCount = currentJobs.filter(
            (j) => j.status === 'streaming' && Boolean(j.execution?.clientToolCall)
        ).length;
        const waitingCountForUser = currentJobs.filter(
            (j) => j.status === 'streaming' && Boolean(j.execution?.clientToolCall) && j.userId === params.userId
        ).length;

        if (activeCount >= config.maxConcurrentJobs) {
            throw new Error(
                `Max concurrent background jobs reached (${config.maxConcurrentJobs})`
            );
        }
        if (activeCountForUser >= config.maxConcurrentJobsPerUser) {
            throw new Error(
                `Max concurrent background jobs per user reached (${config.maxConcurrentJobsPerUser})`
            );
        }
        if (
            waitingCount >= config.maxConcurrentJobs ||
            waitingCountForUser >= config.maxConcurrentJobsPerUser
        ) {
            throw new Error('Maximum pending browser tool handoffs reached');
        }

        const id = generateJobId();
        const now = Date.now();
        const job: MemoryJob = {
            id,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
            model: params.model,
            status: 'streaming',
            content: params.initialContent ?? '',
            reasoning: params.initialReasoning ?? '',
            generationId: params.generationId,
            historyPhase: params.historyPhase ?? 'ready',
            syncProviderId: params.syncProviderId,
            chunksReceived: 0,
            startedAt: now,
            lastActivityAt: now,
            abortController: new AbortController(),
            kind: params.kind ?? 'chat',
            tool_calls: params.tool_calls ?? undefined,
            workflow_state: params.workflow_state ?? undefined,
            execution: params.execution,
            attempts: 0,
            idempotencyKey: params.idempotencyKey,
        };

        jobs.set(id, job);
        return id;
    },

    async getJob(jobId: string, userId: string): Promise<BackgroundJob | null> {
        const job = jobs.get(jobId);
        if (!job) return null;

        // Authorization check (skip if userId is '*')
        if (userId !== '*' && job.userId !== userId) {
            return null;
        }

        return toPublicJob(job);
    },

    async findJobByIdempotencyKey(
        idempotencyKey: string,
        userId: string
    ): Promise<BackgroundJob | null> {
        const job = Array.from(jobs.values()).find(
            (candidate) =>
                candidate.userId === userId &&
                candidate.idempotencyKey === idempotencyKey
        );
        return job ? toPublicJob(job) : null;
    },

    async cancelAdmission(
        userId: string,
        admissionId: string
    ): Promise<AdmissionCancellationResult> {
        pruneAdmissionCancels();
        const job = Array.from(jobs.values()).find(
            (candidate) =>
                candidate.userId === userId &&
                candidate.idempotencyKey === admissionId
        );
        if (job) {
            if (job.status === 'streaming') {
                job.abortController.abort();
                job.status = 'aborted';
                job.error = 'Cancelled by user';
                job.completedAt = Date.now();
                if (job.execution?.history && job.historyPhase !== 'admission_pending') {
                    job.historyPhase = 'finalization_pending';
                }
                cancelledAdmissions.set(
                    admissionKey(userId, admissionId),
                    Date.now() + ADMISSION_CANCEL_TTL_MS
                );
                return { aborted: true, jobId: job.id, pending: false };
            }
            return { aborted: false, jobId: job.id, pending: false };
        }
        // No committed job: a marker guarantees a late createJob cannot launch.
        cancelledAdmissions.set(
            admissionKey(userId, admissionId),
            Date.now() + ADMISSION_CANCEL_TTL_MS
        );
        return { aborted: false, pending: true };
    },

    async updateJob(jobId: string, update: JobUpdate): Promise<void> {
        const job = jobs.get(jobId);
        if (
            !job ||
            job.status !== 'streaming' ||
            !ownsLease(job, update.leaseOwner)
        ) {
            if (update.leaseOwner) throwLeaseLost();
            return;
        }

        if (update.contentChunk !== undefined) {
            job.content += update.contentChunk;
        }
        if (update.reasoningChunk !== undefined) {
            job.reasoning += update.reasoningChunk;
        }
        if (update.chunksReceived !== undefined) {
            job.chunksReceived = update.chunksReceived;
        }
        if (update.tool_calls !== undefined) {
            job.tool_calls = update.tool_calls;
        }
        if (update.workflow_state !== undefined) {
            job.workflow_state = update.workflow_state;
        }
        job.lastActivityAt = Date.now();
    },

    async completeJob(
        jobId: string,
        finalContent: string,
        leaseOwner?: string
    ): Promise<void> {
        const job = jobs.get(jobId);
        if (
            !job ||
            job.status !== 'streaming' ||
            !ownsLease(job, leaseOwner)
        ) {
            if (leaseOwner) throwLeaseLost();
            return;
        }

        job.status = 'complete';
        job.content = finalContent;
        job.completedAt = Date.now();
    },

    async failJob(
        jobId: string,
        error: string,
        leaseOwner?: string
    ): Promise<void> {
        const job = jobs.get(jobId);
        if (
            !job ||
            job.status !== 'streaming' ||
            !ownsLease(job, leaseOwner)
        ) {
            if (leaseOwner) throwLeaseLost();
            return;
        }

        job.status = 'error';
        job.error = error;
        job.completedAt = Date.now();
    },

    async abortJob(jobId: string, userId: string): Promise<boolean> {
        const job = jobs.get(jobId);
        if (!job) return false;

        // Authorization check
        if (userId !== '*' && job.userId !== userId) {
            return false;
        }

        // Can only abort streaming jobs
        if (job.status !== 'streaming') {
            return false;
        }

        // Abort the controller (stops the upstream fetch)
        job.abortController.abort();
        job.status = 'aborted';
        job.completedAt = Date.now();
        if (job.execution?.history && job.historyPhase !== 'admission_pending') {
            job.historyPhase = 'finalization_pending';
        }
        return true;
    },

    getAbortController(jobId: string): AbortController | undefined {
        return jobs.get(jobId)?.abortController;
    },

    async checkJobAborted(jobId: string): Promise<boolean> {
        return jobs.get(jobId)?.status === 'aborted';
    },

    async claimJob(jobId, leaseOwner, now, leaseExpiresAt) {
        const job = jobs.get(jobId);
        return job
            ? claimJobRecord(job, leaseOwner, now, leaseExpiresAt)
            : null;
    },

    async claimNextJob(leaseOwner, now, leaseExpiresAt) {
        for (const job of jobs.values()) {
            const claimed = claimJobRecord(
                job,
                leaseOwner,
                now,
                leaseExpiresAt
            );
            if (claimed) return claimed;
        }
        return null;
    },

    async renewJobLease(jobId, leaseOwner, now, leaseExpiresAt) {
        const job = jobs.get(jobId);
        if (
            !job ||
            job.status !== 'streaming' ||
            job.leaseOwner !== leaseOwner ||
            (job.leaseExpiresAt ?? 0) <= now
        ) {
            return false;
        }
        job.leaseExpiresAt = leaseExpiresAt;
        return true;
    },

    async updateJobExecution(
        jobId: string,
        execution: BackgroundJobExecution,
        leaseOwner: string
    ): Promise<boolean> {
        const job = jobs.get(jobId);
        if (
            !job ||
            job.status !== 'streaming' ||
            !ownsLease(job, leaseOwner)
        ) {
            return false;
        }
        job.execution = execution;
        return true;
    },

    async claimClientToolCall(
        jobId,
        userId,
        callId,
        claimToken,
        claimExpiresAt
    ) {
        const job = jobs.get(jobId);
        const pending = job?.execution?.clientToolCall;
        if (
            !job ||
            job.userId !== userId ||
            job.status !== 'streaming' ||
            !pending ||
            pending.callId !== callId ||
            (pending.claimToken && (pending.claimExpiresAt ?? 0) > Date.now())
        ) {
            return null;
        }
        pending.claimToken = claimToken;
        pending.claimExpiresAt = claimExpiresAt;
        job.lastActivityAt = Date.now();
        return cloneJob(job);
    },

    async settleClientToolCall(
        jobId,
        userId,
        callId,
        claimToken,
        execution,
        toolCalls
    ) {
        const job = jobs.get(jobId);
        const pending = job?.execution?.clientToolCall;
        if (
            !job ||
            job.userId !== userId ||
            job.status !== 'streaming' ||
            !pending ||
            pending.callId !== callId ||
            pending.claimToken !== claimToken ||
            (pending.claimExpiresAt ?? 0) <= Date.now()
        ) {
            return false;
        }
        job.execution = execution;
        job.tool_calls = toolCalls;
        job.leaseOwner = undefined;
        job.leaseExpiresAt = undefined;
        job.lastActivityAt = Date.now();
        return true;
    },

    async saveTerminalSnapshot(
        jobId: string,
        snapshot: TerminalGenerationSnapshot,
        leaseOwner?: string
    ): Promise<boolean> {
        const job = jobs.get(jobId);
        if (!job || job.status !== 'streaming' || !ownsLease(job, leaseOwner)) {
            return false;
        }
        job.status = snapshot.status;
        job.content = snapshot.content;
        job.reasoning = snapshot.reasoning;
        if (snapshot.toolCalls !== undefined) {
            job.tool_calls = snapshot.toolCalls;
        }
        job.error = snapshot.error;
        job.completedAt = snapshot.completedAt;
        job.historyPhase = 'finalization_pending';
        job.leaseOwner = undefined;
        job.leaseExpiresAt = undefined;
        return true;
    },

    async setHistoryPhase(
        jobId: string,
        phase: GenerationHistoryPhase,
        options?: { from?: GenerationHistoryPhase[] }
    ): Promise<boolean> {
        const job = jobs.get(jobId);
        if (!job) return false;
        if (
            options?.from &&
            !options.from.includes(job.historyPhase ?? 'ready')
        ) {
            return false;
        }
        job.historyPhase = phase;
        return true;
    },

    async getPendingHistoryJobs(limit: number): Promise<BackgroundJob[]> {
        return Array.from(jobs.values())
            .filter(
                (job) =>
                    job.historyPhase === 'admission_pending' ||
                    job.historyPhase === 'finalization_pending'
            )
            .sort((left, right) => left.startedAt - right.startedAt)
            .slice(0, Math.max(1, limit))
            .map(cloneJob);
    },

    async cleanupExpired(): Promise<number> {
        return await cleanupExpiredJobs();
    },

    async getActiveJobCount(): Promise<number> {
        return Array.from(jobs.values()).filter(
            (j) => j.status === 'streaming' && !j.execution?.clientToolCall
        ).length;
    },
};

/**
 * Internal API.
 *
 * Purpose:
 * Clear all in-memory jobs and cleanup state, primarily for tests.
 */
export function clearAllJobs(): void {
    jobs.clear();
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

/**
 * Internal API.
 *
 * Purpose:
 * Return the number of in-memory jobs, primarily for tests.
 */
export function getJobCount(): number {
    return jobs.size;
}
