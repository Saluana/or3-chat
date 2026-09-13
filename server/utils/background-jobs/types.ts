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
import type { ChatGenerationAdmissionEnvelope } from '~~/shared/chat/background-history';

/**
 * Durable history phase for a generation. The model finishing, the job being
 * saved, and the message reaching canonical history are separate events; this
 * tracks where the canonical write stands.
 */
export type GenerationHistoryPhase =
    | 'admission_pending'
    | 'ready'
    | 'finalization_pending'
    | 'committed'
    | 'superseded'
    | 'blocked';

/**
 * Immutable identity for one user-requested generation. A worker restart
 * increments `attempt`; it must never create another generation ID.
 */
export type GenerationIdentity = {
    admissionId: string;
    generationId: string;
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    syncProviderId?: string;
};

/**
 * Immutable terminal result of model execution, consumed by the canonical
 * history worker. Saving this and moving the job to `finalization_pending`
 * must be one provider transaction.
 */
export type TerminalGenerationSnapshot = {
    status: 'complete' | 'error' | 'aborted';
    content: string;
    reasoning: string;
    toolCalls?: BackgroundJob['tool_calls'];
    error?: string;
    completedAt: number;
};

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
    /** Accumulated model reasoning, kept distinct from request reasoning config. */
    reasoning: string;
    /** One user-requested generation; stable across worker attempts. */
    generationId?: string;
    /** Where the canonical history write stands for this generation. */
    historyPhase?: GenerationHistoryPhase;
    /** Sync provider that owns canonical history for the job's workspace. */
    syncProviderId?: string;
    /** Number of chunks received */
    chunksReceived: number;
    /** Unix timestamp when job started */
    startedAt: number;
    /** Unix timestamp of the most recent streaming progress update. */
    lastActivityAt?: number;
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
    /** Immutable canonical-history admission captured before paid execution. */
    history?: ChatGenerationAdmissionEnvelope;
    /** Text that is already represented by a durable tool-loop checkpoint. */
    contentBase?: string;
    /** Reasoning already represented by a durable tool-loop checkpoint. */
    reasoningBase?: string;
    /** Continuation normalization contract when this job continues existing text. */
    continuation?: {
        prefix: string;
    };
    /** Tool calls whose results are included in the checkpointed request body. */
    checkpointedToolCallIds?: string[];
}

/**
 * Result of cancelling an admission that may not have committed yet.
 */
export interface AdmissionCancellationResult {
    /** True when a committed streaming job was aborted. */
    aborted: boolean;
    /** Committed job ID, when one existed. */
    jobId?: string;
    /**
     * True when a durable marker now guarantees a not-yet-committed admission
     * cannot launch work.
     */
    pending: boolean;
}

/**
 * Thrown by `createJob` when a durable admission-cancellation marker exists.
 * Cross-package providers throw an error with this name; use
 * `isAdmissionCancelledError` rather than `instanceof` at boundaries.
 */
export class AdmissionCancelledError extends Error {
    constructor(readonly admissionId: string) {
        super(`Background admission ${admissionId} was cancelled`);
        this.name = 'AdmissionCancelledError';
    }
}

export function isAdmissionCancelledError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AdmissionCancelledError';
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
    /** Stable generation identity for canonical-history finalization. */
    generationId?: string;
    /** Present when durable provider execution is resumable. */
    syncProviderId?: string;
    /** Where the canonical write stands at admission time. */
    historyPhase?: GenerationHistoryPhase;
    /** Seed content for a continuation; the model appends after this base. */
    initialContent?: string;
    /** Seed reasoning for a continuation. */
    initialReasoning?: string;
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
    /** Reasoning chunk to append (distinct from request reasoning config). */
    reasoningChunk?: string;
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
     * Optional lookup by admission idempotency key. Enables cancellation of an
     * admission before the client has received its job ID.
     */
    findJobByIdempotencyKey?(
        idempotencyKey: string,
        userId: string
    ): Promise<BackgroundJob | null>;

    /**
     * Durably cancel an admission by its idempotency key. Committed streaming
     * jobs are aborted immediately; otherwise a marker is recorded that
     * `createJob` observes atomically so a late commit cannot launch work.
     */
    cancelAdmission?(
        userId: string,
        admissionId: string
    ): Promise<AdmissionCancellationResult>;

    /**
     * Atomically persist the terminal snapshot and move the job's history
     * phase to `finalization_pending`. Returns false when the lease was
     * superseded (the existing terminal result remains authoritative).
     */
    saveTerminalSnapshot?(
        jobId: string,
        snapshot: TerminalGenerationSnapshot,
        leaseOwner?: string
    ): Promise<boolean>;

    /**
     * Conditionally update the durable history phase. When `from` is supplied,
     * the update only applies if the current phase is one of those values, so a
     * late failure cannot move `committed` back to `finalization_pending`.
     */
    setHistoryPhase?(
        jobId: string,
        phase: GenerationHistoryPhase,
        options?: { from?: GenerationHistoryPhase[] }
    ): Promise<boolean>;

    /** Return a bounded page of jobs whose canonical history delivery is pending. */
    getPendingHistoryJobs?(limit: number): Promise<BackgroundJob[]>;

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
