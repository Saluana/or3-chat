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
    CreateJobParams,
    JobUpdate,
} from '../types';
import { getJobConfig } from '../store';

/**
 * Internal job record that includes an AbortController.
 */
interface MemoryJob extends BackgroundJob {
    abortController: AbortController;
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
        const age = now - job.startedAt;
        const isStreaming = job.status === 'streaming';
        const isTimedOut = isStreaming && age > config.jobTimeoutMs;

        const isTerminal = ['complete', 'error', 'aborted'].includes(job.status);
        const completedAge = now - (job.completedAt ?? job.startedAt);
        const isStale = isTerminal && completedAge > config.completedJobRetentionMs;

        if (isTimedOut) {
            // Timeout streaming job
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

        // Enforce max concurrent jobs
        const activeCount = Array.from(jobs.values()).filter(
            (j) => j.status === 'streaming'
        ).length;

        if (activeCount >= config.maxConcurrentJobs) {
            throw new Error(
                `Max concurrent background jobs reached (${config.maxConcurrentJobs})`
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
            abortController: new AbortController(),
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

        // Return public interface (without AbortController)
        const { abortController: _, ...publicJob } = job;
        return publicJob;
    },

    async updateJob(jobId: string, update: JobUpdate): Promise<void> {
        const job = jobs.get(jobId);
        if (!job || job.status !== 'streaming') return;

        if (update.contentChunk !== undefined) {
            job.content += update.contentChunk;
        }
        if (update.chunksReceived !== undefined) {
            job.chunksReceived = update.chunksReceived;
        }
    },

    async completeJob(jobId: string, finalContent: string): Promise<void> {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'complete';
        job.content = finalContent;
        job.completedAt = Date.now();
    },

    async failJob(jobId: string, error: string): Promise<void> {
        const job = jobs.get(jobId);
        if (!job) return;

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
