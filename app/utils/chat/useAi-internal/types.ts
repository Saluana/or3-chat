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

/** Background job update payload sent to subscribers */
export type BackgroundJobUpdate = {
    status: BackgroundJobStatus;
    content: string;
    delta: string;
};

/** Subscriber callbacks for background job events */
export type BackgroundJobSubscriber = {
    onUpdate?: (update: BackgroundJobUpdate) => void;
    onComplete?: (update: BackgroundJobUpdate) => void;
    onError?: (update: BackgroundJobUpdate) => void;
    onAbort?: (update: BackgroundJobUpdate) => void;
};

/** Tracks a single background streaming job */
export type BackgroundJobTracker = {
    jobId: string;
    userId: string;
    threadId: string;
    messageId: string;
    status: BackgroundJobStatus['status'];
    lastWorkflowVersion: number;
    lastContent: string;
    lastPersistedLength: number;
    lastPersistAt: number;
    polling: boolean;
    streaming: boolean;
    active: boolean;
    streamUnsubscribe?: () => void;
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
    initialContent?: string;
    isReattach?: boolean;
    useSse?: boolean;
};

/** Parameters for ensuring a background job tracker exists */
export type EnsureBackgroundJobTrackerParams = {
    jobId: string;
    userId: string;
    threadId: string;
    messageId: string;
    initialContent?: string;
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
}) => Promise<string | null>;
