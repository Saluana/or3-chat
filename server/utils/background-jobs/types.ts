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
import type { CanonicalToolResult } from '~~/shared/chat/canonical-tool-transcript';

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
        argument_fingerprint?: string;
        transcript?: CanonicalToolResult;
    }>;
    /** Workflow execution state snapshot */
    workflow_state?: WorkflowMessageData;
    /** Encrypted, server-only input required to resume a chat job. */
    execution?: BackgroundJobExecution;
    /** Current durable worker lease owner. Never exposed by job API routes. */
    leaseOwner?: string;
    /** Unix timestamp when the current worker lease expires. */
    leaseExpiresAt?: number;
    /** Number of times this job has been claimed for execution. */
    attempts?: number;
}

/**
 * Persisted input for restart-safe chat execution.
 *
 * The OpenRouter credential is authenticated-encrypted before this object is
 * handed to a durable provider. It must never contain the plaintext key.
 */
export interface BackgroundJobExecution {
    version: 1;
    body: Record<string, unknown>;
    workspaceId: string;
    referer: string;
    apiKeyCiphertext: string;
    /** Text that is already represented by a durable tool-loop checkpoint. */
    contentBase?: string;
    /** Tool calls whose results are included in the checkpointed request body. */
    checkpointedToolCallIds?: string[];
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
    /** Stable key used to make admission idempotent. */
    idempotencyKey?: string;
    /** Server-only execution input used by the durable worker. */
    execution?: BackgroundJobExecution;
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
    /** Fences writes from a worker whose durable lease was superseded. */
    leaseOwner?: string;
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
 * - `createJob` atomically enforces configured global/per-user limits and
 *   returns the existing job for a duplicate idempotency key.
 * - Leased writes must be rejected after their lease owner is superseded.
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
    completeJob(
        jobId: string,
        finalContent: string,
        leaseOwner?: string
    ): Promise<void>;

    /**
     * Mark a job as failed with an error.
     */
    failJob(jobId: string, error: string, leaseOwner?: string): Promise<void>;

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

    /** Atomically claim one specific durable chat job. */
    claimJob?(
        jobId: string,
        leaseOwner: string,
        now: number,
        leaseExpiresAt: number
    ): Promise<BackgroundJob | null>;

    /** Atomically claim the next unowned or expired durable chat job. */
    claimNextJob?(
        leaseOwner: string,
        now: number,
        leaseExpiresAt: number
    ): Promise<BackgroundJob | null>;

    /** Extend a claim only when it is still owned by the caller. */
    renewJobLease?(
        jobId: string,
        leaseOwner: string,
        now: number,
        leaseExpiresAt: number
    ): Promise<boolean>;

    /** Persist a tool-loop recovery checkpoint under the current lease. */
    updateJobExecution?(
        jobId: string,
        execution: BackgroundJobExecution,
        leaseOwner: string
    ): Promise<boolean>;

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
    /** Maximum concurrent streaming jobs per user */
    maxConcurrentJobsPerUser: number;
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
    maxConcurrentJobsPerUser: 5,
    jobTimeoutMs: 5 * 60 * 1000,
    completedJobRetentionMs: 5 * 60 * 1000,
};
