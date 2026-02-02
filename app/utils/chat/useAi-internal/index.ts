/**
 * @module useAi/index
 * @description Barrel export for useAi internal modules.
 *
 * Re-exports all internal module functionality for use by the main useAi facade.
 * This allows clean imports from a single path while maintaining separation.
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
