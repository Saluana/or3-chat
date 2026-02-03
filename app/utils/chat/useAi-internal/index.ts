/**
 * @module app/utils/chat/useAi-internal/index
 *
 * Purpose:
 * Barrel exports for useAi internal modules.
 *
 * Constraints:
 * - Internal API only. Do not import directly from UI components.
 */

// Types
export type {
    BackgroundJobUpdate,
    BackgroundJobSubscriber,
    BackgroundJobTracker,
    StoredMessage,
    OpenRouterMessage,
    AttachBackgroundJobParams,
    EnsureBackgroundJobTrackerParams,
    ToolResultPayload,
    AssistantPersister,
} from './types';

// Background job tracking
export {
    BACKGROUND_JOB_POLL_INTERVAL_MS,
    BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS,
    BACKGROUND_JOB_PERSIST_INTERVAL_MS,
    BACKGROUND_JOB_MUTED_KEY,
    backgroundJobTrackers,
    primeBackgroundJobUpdate,
    stopBackgroundJobTracking,
    ensureBackgroundJobTracker,
    subscribeBackgroundJob,
} from './backgroundJobs';

// Persistence helpers
export {
    makeAssistantPersister,
    updateMessageRecord,
} from './persistence';

// Retry functionality
export { retryMessageImpl } from './retry';
export type { RetryMessageContext } from './retry';

// Continue functionality
export { continueMessageImpl } from './continue';
export type { ContinueMessageContext } from './continue';

// Foreground streaming
export { runForegroundStreamLoop } from './foregroundStream';
export type { ForegroundStreamContext } from './foregroundStream';

// System prompt + message build
export {
    resolveSystemPromptText,
    buildSystemPromptMessage,
    buildOpenRouterMessagesForSend,
} from './messageBuild';
export type {
    ResolveSystemPromptParams,
    BuildSystemPromptParams,
    BuildOpenRouterMessagesParams,
} from './messageBuild';
