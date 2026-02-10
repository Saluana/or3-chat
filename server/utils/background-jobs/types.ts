/**
 * @module server/utils/background-jobs/types
 *
 * Purpose:
 * Defines the background job contract for server-side streaming.
 * These types formalize the provider interface so multiple storage backends
 * can plug in without changing the streaming pipeline.
 *
 * Responsibilities:
 * - Describe the job record and lifecycle state.
 * - Define provider capabilities and required methods.
 * - Centralize provider configuration defaults.
 *
 * Non-Goals:
 * - Implementing any storage or streaming logic.
 * - Defining API routes or authorization.
 */

import type { WorkflowMessageData } from '~/utils/chat/workflow-types';

/**
 * Purpose:
 * Represents a persisted background streaming job.
 *
 * Constraints:
 * - `status` must reflect the terminal state once completed.
 * - `content` is the accumulated stream output.
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
    /** Number of chunks received */
    chunksReceived: number;
    /** Unix timestamp when job started */
    startedAt: number;
    /** Unix timestamp when job completed, failed, or aborted */
    completedAt?: number;
    /** Error message when status is `error` */
    error?: string;
    /** Background job kind */
    kind?: 'chat' | 'workflow';
    /** Tool call state for background tool execution */
    tool_calls?: Array<{
        id?: string;
        name: string;
        status: 'loading' | 'complete' | 'error' | 'pending' | 'skipped';
        args?: string;
        result?: string;
        error?: string;
    }>;
    /** Workflow execution state snapshot */
    workflow_state?: WorkflowMessageData;
}

/**
 * Purpose:
 * Input for creating a new streaming job.
 */
export interface CreateJobParams {
    userId: string;
    threadId: string;
    messageId: string;
    model: string;
    kind?: BackgroundJob['kind'];
    tool_calls?: BackgroundJob['tool_calls'];
    workflow_state?: BackgroundJob['workflow_state'];
}

/**
 * Purpose:
 * Partial update payload for a streaming job.
 *
 * Constraints:
 * - Updates are incremental and should be append-only for `contentChunk`.
 */
export interface JobUpdate {
    /** Content chunk to append */
    contentChunk?: string;
    /** Updated total chunks received */
    chunksReceived?: number;
    /** Tool call status updates */
    tool_calls?: BackgroundJob['tool_calls'];
    /** Workflow state snapshot updates */
    workflow_state?: BackgroundJob['workflow_state'];
}

/**
 * Purpose:
 * Contract for background job storage providers.
 *
 * Behavior:
 * - Providers persist job records and expose lifecycle updates.
 * - The streaming loop depends on `createJob`, `updateJob`, and `completeJob`.
 *
 * Constraints:
 * - `checkAndRecord` style atomicity is not required here, but updates must
 *   be safe for concurrent streaming and viewer polling.
 * - Providers that do not run in-process must not return AbortControllers.
 *
 * Non-Goals:
 * - Directly streaming content to clients. That is handled elsewhere.
 */
export interface BackgroundJobProvider {
    /** Provider name for logging and diagnostics */
    readonly name: string;

    /**
     * Create a new background job.
     *
     * @throws Error when the provider enforces a concurrent job cap.
     */
    createJob(params: CreateJobParams): Promise<string>;

    /**
     * Retrieve a job by ID with optional authorization.
     *
     * Constraints:
     * - `userId` must be validated unless it is `'*'`.
     */
    getJob(jobId: string, userId: string): Promise<BackgroundJob | null>;

    /**
     * Append or update streaming progress for a job.
     * No-op if the job is not in `streaming` status.
     */
    updateJob(jobId: string, update: JobUpdate): Promise<void>;

    /**
     * Mark a job as successfully completed.
     */
    completeJob(jobId: string, finalContent: string): Promise<void>;

    /**
     * Mark a job as failed with an error.
     */
    failJob(jobId: string, error: string): Promise<void>;

    /**
     * Abort a running job.
     *
     * Behavior:
     * - Returns `true` only when a streaming job is successfully aborted.
     */
    abortJob(jobId: string, userId: string): Promise<boolean>;

    /**
     * Optional AbortController lookup for in-process providers.
     * External providers should return `undefined`.
     */
    getAbortController?(jobId: string): AbortController | undefined;

    /**
     * Optional poll-based abort detection for external providers.
     */
    checkJobAborted?(jobId: string): Promise<boolean>;

    /**
     * Clean up expired or stale jobs.
     *
     * @returns Number of jobs removed or timed out.
     */
    cleanupExpired(): Promise<number>;

    /**
     * Optional count of active streaming jobs.
     */
    getActiveJobCount?(): Promise<number>;
}

/**
 * Purpose:
 * Configuration values for background job storage providers.
 */
export interface BackgroundJobConfig {
    /** Maximum concurrent streaming jobs */
    maxConcurrentJobs: number;
    /** Job timeout in milliseconds */
    jobTimeoutMs: number;
    /** Retention window for completed jobs in milliseconds */
    completedJobRetentionMs: number;
}

/**
 * Purpose:
 * Default configuration values for background jobs.
 */
export const DEFAULT_CONFIG: BackgroundJobConfig = {
    maxConcurrentJobs: 20,
    jobTimeoutMs: 5 * 60 * 1000,
    completedJobRetentionMs: 5 * 60 * 1000,
};
