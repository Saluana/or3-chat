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
} from '../types';
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

/** Cleanup interval handle */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Remove timed-out and stale jobs based on configured retention windows.
 */
async function cleanupExpiredJobs(): Promise<number> {
    const config = getJobConfig();
    const now = Date.now();
    let cleaned = 0;

    for (const [id, job] of jobs) {
        const isStreaming = job.status === 'streaming';
        const idleFor = now - (job.lastActivityAt ?? job.startedAt);
        const isTimedOut = isStreaming && idleFor > config.jobTimeoutMs;

        const isTerminal = ['complete', 'error', 'aborted'].includes(job.status);
        const completedAge = now - (job.completedAt ?? job.startedAt);
        const isStale = isTerminal && completedAge > config.completedJobRetentionMs;

        if (isTimedOut) {
            // This is an inactivity watchdog, never a total runtime limit. A
            // workflow that is actively receiving model output must remain live.
            job.abortController.abort();
            job.status = 'error';
            job.error = 'Job timed out';
            job.completedAt = now;
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

function claimJobRecord(
    job: MemoryJob,
    leaseOwner: string,
    now: number,
    leaseExpiresAt: number
): BackgroundJob | null {
    if (job.status !== 'streaming' || !job.execution) return null;
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
        }

        // Enforce max concurrent jobs
        const activeCount = Array.from(jobs.values()).filter(
            (j) => j.status === 'streaming'
        ).length;
        const activeCountForUser = Array.from(jobs.values()).filter(
            (j) => j.status === 'streaming' && j.userId === params.userId
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

        const id = generateJobId();
        const job: MemoryJob = {
            id,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
            model: params.model,
            status: 'streaming',
            content: '',
            chunksReceived: 0,
            startedAt: Date.now(),
            lastActivityAt: Date.now(),
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

    async cleanupExpired(): Promise<number> {
        return await cleanupExpiredJobs();
    },

    async getActiveJobCount(): Promise<number> {
        return Array.from(jobs.values()).filter((j) => j.status === 'streaming').length;
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
