/**
 * Background Job Types
 *
 * Defines the pluggable provider interface for background streaming jobs.
 * Implementations can use in-memory, Convex, Redis, etc.
 */

/**
 * Background job record
 */
export interface BackgroundJob {
    /** Unique job identifier */
    id: string;
    /** User who created the job */
    userId: string;
    /** Thread the message belongs to */
    threadId: string;
    /** Message ID being generated */
    messageId: string;
    /** Model being used */
    model: string;
    /** Current job status */
    status: 'streaming' | 'complete' | 'error' | 'aborted';
    /** Accumulated content from streaming */
    content: string;
    /** Number of chunks received (for progress) */
    chunksReceived: number;
    /** Unix timestamp when job started */
    startedAt: number;
    /** Unix timestamp when job completed/failed/aborted */
    completedAt?: number;
    /** Error message if status is 'error' */
    error?: string;
}

/**
 * Parameters for creating a new job
 */
export interface CreateJobParams {
    userId: string;
    threadId: string;
    messageId: string;
    model: string;
}

/**
 * Partial update for a streaming job
 */
export interface JobUpdate {
    /** Content chunk to append */
    contentChunk?: string;
    /** Updated total chunks received */
    chunksReceived?: number;
}

/**
 * Background Job Provider Interface
 *
 * Implement this interface to add a new storage backend for background jobs.
 * Providers are responsible for job persistence and lifecycle management.
 *
 * Built-in providers:
 * - memory: In-memory (single instance, jobs lost on restart)
 * - convex: Convex database (multi-instance, persistent)
 * - redis: Redis (multi-instance, persistent) [future]
 *
 * IMPORTANT: For abort functionality:
 * - Memory provider: Uses AbortController directly
 * - External providers (Convex/Redis): Must poll job status to detect aborts
 */
export interface BackgroundJobProvider {
    /** Provider name for logging/debugging */
    readonly name: string;

    /**
     * Create a new background job.
     * @returns The job ID
     * @throws Error if max concurrent jobs reached
     */
    createJob(params: CreateJobParams): Promise<string>;

    /**
     * Retrieve a job by ID.
     * @param jobId - The job ID
     * @param userId - User ID for authorization check (use '*' to skip check)
     * @returns The job or null if not found/unauthorized
     */
    getJob(jobId: string, userId: string): Promise<BackgroundJob | null>;

    /**
     * Update a streaming job with new content chunk.
     * Called incrementally as chunks arrive.
     * No-op if job is not in 'streaming' status.
     */
    updateJob(jobId: string, update: JobUpdate): Promise<void>;

    /**
     * Mark a job as successfully completed.
     * @param jobId - The job ID
     * @param finalContent - The complete accumulated content
     */
    completeJob(jobId: string, finalContent: string): Promise<void>;

    /**
     * Mark a job as failed.
     * @param jobId - The job ID
     * @param error - Error message
     */
    failJob(jobId: string, error: string): Promise<void>;

    /**
     * Abort a running job.
     * @param jobId - The job ID
     * @param userId - User ID for authorization check
     * @returns true if aborted, false if job not found, unauthorized, or already complete
     */
    abortJob(jobId: string, userId: string): Promise<boolean>;

    /**
     * Get an AbortController for a job (only for in-process providers).
     * Memory provider stores these; external providers return undefined.
     */
    getAbortController?(jobId: string): AbortController | undefined;

    /**
     * Clean up expired/stale jobs.
     * Called periodically to remove old jobs and timeout streaming ones.
     * @returns Number of jobs cleaned up
     */
    cleanupExpired(): Promise<number>;

    /**
     * Get active job count (for monitoring/limits).
     */
    getActiveJobCount?(): Promise<number>;
}

/**
 * Configuration for background job providers
 */
export interface BackgroundJobConfig {
    /** Maximum concurrent streaming jobs */
    maxConcurrentJobs: number;
    /** Job timeout in milliseconds */
    jobTimeoutMs: number;
    /** How long to keep completed jobs before cleanup (ms) */
    completedJobRetentionMs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: BackgroundJobConfig = {
    maxConcurrentJobs: 20,
    jobTimeoutMs: 5 * 60 * 1000, // 5 minutes
    completedJobRetentionMs: 5 * 60 * 1000, // 5 minutes
};
