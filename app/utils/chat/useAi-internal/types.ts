/**
 * @module app/utils/chat/useAi-internal/types
 *
 * Purpose:
 * Internal type definitions for useAi composable modules.
 *
 * Constraints:
 * - Internal API only. Public types are exported from the facade.
 * - No runtime code should live here.
 */

import type { Message } from '~/db';
import type { ContentPart, ToolCall } from '~/utils/chat/types';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import type { ORMessage } from '~/core/auth/openrouter-build';
import type { Or3DB } from '~/db/client';

/** Background job update payload sent to subscribers */
export type BackgroundJobUpdate = {
    status: BackgroundJobStatus;
    content: string;
    delta: string;
    /** True when recovery replaced a non-monotonic partial response. */
    replace?: boolean;
    /** Full accepted reasoning snapshot. */
    reasoning?: string;
    reasoningDelta?: string;
    /** True when recovery replaced the previous reasoning snapshot. */
    reasoningReplace?: boolean;
};

/** Subscriber callbacks for background job events */
export type BackgroundJobSubscriber = {
    onUpdate?: (update: BackgroundJobUpdate) => void;
    onComplete?: (update: BackgroundJobUpdate) => void;
    onError?: (update: BackgroundJobUpdate) => void;
    onAbort?: (update: BackgroundJobUpdate) => void;
    /**
     * Tracking was interrupted by a connection/protocol/auth problem. The
     * server job may still be healthy; this is not a generation failure.
     */
    onTransportError?: (update: BackgroundJobUpdate) => void;
};

/** Tracks a single background streaming job */
export type BackgroundJobTracker = {
    jobId: string;
    userId: string;
    threadId: string;
    messageId: string;
    preferServerNotifications?: boolean;
    status: BackgroundJobStatus['status'];
    lastWorkflowVersion: number;
    lastWorkflowState?: BackgroundJobStatus['workflow_state'];
    lastToolStateFingerprint?: string;
    lastWorkflowFingerprint?: string;
    lastContent: string;
    lastAttempt?: number;
    lastPersistedLength: number;
    /** Last accepted reasoning snapshot. */
    lastReasoning: string;
    /** Reasoning bytes already committed to local persistence. */
    lastPersistedReasoningLength: number;
    lastPersistAt: number;
    polling: boolean;
    streaming: boolean;
    active: boolean;
    preferSse?: boolean;
    pollRunId?: number;
    pollAbortController?: AbortController;
    consecutivePollFailures?: number;
    notFoundPollFailures?: number;
    authPollFailures?: number;
    streamUnsubscribe?: () => void;
    originDb?: Or3DB;
    originDbName?: string;
    /** Workspace captured before admission; tracker never re-resolves it. */
    workspaceId?: string;
    /** Server owns canonical admission/finalization; local writes are projections. */
    canonicalHistory?: boolean;
    generationId?: string;
    /** Terminal snapshot retained until local persistence succeeds. */
    terminalStatus?: BackgroundJobStatus;
    /** Content/replace semantics captured for terminal persistence retries. */
    terminalContent?: string;
    terminalReplace?: boolean;
    /** True once terminal callbacks/notifications fired (must only fire once). */
    terminalNotified?: boolean;
    /** Bounded retry bookkeeping for terminal persistence. */
    terminalPersistAttempts?: number;
    terminalPersistTimer?: ReturnType<typeof setTimeout>;
    /** Latest SSE processing chain, drained before switching transports. */
    streamChain?: Promise<unknown>;
    /** Incremented per SSE connection; late events from old connections drop. */
    sseGeneration?: number;
    /** Set when tracking stopped due to connection/protocol/auth problems. */
    transportInterrupted?: boolean;
    subscribers: Set<BackgroundJobSubscriber>;
    completion: Promise<BackgroundJobStatus>;
    resolveCompletion: (status: BackgroundJobStatus) => void;
};

/** Extended message row from Dexie with typed data field */
export type StoredMessage = Message & {
    data?: {
        content?: string;
        reasoning_text?: string | null;
        tool_calls?: ToolCallInfo[] | null;
        background_job_id?: string;
        background_job_status?: BackgroundJobStatus['status'];
        background_job_error?: string | null;
        [key: string]: unknown;
    } | null;
    content?: string | ContentPart[];
    file_hashes?: string | null;
    reasoning_text?: string | null;
    stream_id?: string | null;
};

/** OpenRouter message union for API calls */
export type OpenRouterMessage =
    | ORMessage
    | {
          role: 'tool';
          [key: string]: unknown;
      };

/** Parameters for attaching a background job to UI */
export type AttachBackgroundJobParams = {
    jobId: string;
    userId: string;
    messageId: string;
    threadId: string;
    originDb?: Or3DB;
    workspaceId?: string;
    /** Suppress sync capture because the server commits canonical history. */
    canonicalHistory?: boolean;
    generationId?: string;
    initialContent?: string;
    initialAttempt?: number;
    isReattach?: boolean;
    useSse?: boolean;
};

/** Parameters for ensuring a background job tracker exists */
export type EnsureBackgroundJobTrackerParams = {
    jobId: string;
    userId: string;
    threadId: string;
    messageId: string;
    originDb?: Or3DB;
    workspaceId?: string;
    /** Suppress sync capture because the server commits canonical history. */
    canonicalHistory?: boolean;
    generationId?: string;
    preferServerNotifications?: boolean;
    initialContent?: string;
    initialReasoning?: string;
    initialAttempt?: number;
    useSse?: boolean;
};

/** Tool call with result for loop processing */
export type ToolResultPayload = {
    call: ToolCall;
    result: string;
};

/** Persister function signature for assistant messages */
export type AssistantPersister = (params: {
    content?: string;
    reasoning?: string | null;
    toolCalls?: ToolCallInfo[] | null;
    finalize?: boolean;
    /** Terminal generation state applied when finalizing; defaults to complete. */
    terminalState?: 'complete' | 'failed' | 'aborted' | 'interrupted';
}) => Promise<string | null>;
