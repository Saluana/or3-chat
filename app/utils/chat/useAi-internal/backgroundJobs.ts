/**
 * @module app/utils/chat/useAi-internal/backgroundJobs.ts
 *
 * Purpose:
 * Background job tracking and polling for streaming AI responses that continue
 * when the user navigates away from the chat thread. Maintains a global registry
 * of active jobs with support for both polling and Server-Sent Events (SSE).
 *
 * Responsibilities:
 * - Maintain global tracker map for background streaming jobs (singleton)
 * - Poll job status via REST API with configurable intervals
 * - Subscribe to SSE streams for real-time updates when user is active
 * - Persist incremental content updates to Dexie (throttled)
 * - Emit system notifications when jobs complete without active subscribers
 * - Handle job lifecycle: streaming, complete, error, aborted
 *
 * Non-responsibilities:
 * - UI state management (handled by useChat composable)
 * - Message creation and initial persistence (handled by persistence layer)
 * - Thread navigation or routing decisions
 *
 * Architecture:
 * - Global singleton: backgroundJobTrackers Map shared across all useChat instances
 * - Dual transport: Polling (fallback) and SSE (preferred when active)
 * - Adaptive intervals: Faster polling when subscribers present
 * - Throttled persistence: Writes to Dexie no more than every 500ms
 *
 * Invariants:
 * - Trackers are removed from map when jobs reach terminal state
 * - Notifications only emit when no subscribers (user navigated away)
 * - Muted threads skip notifications (stored in kv table)
 * - Content is never truncated, only extended or synchronized
 */

import { nowSec } from '~/db/util';
import { getDb } from '~/db/client';
import {
    pollJobStatus,
    subscribeBackgroundJobStream,
    abortBackgroundJob,
    BackgroundJobPollError,
    type BackgroundJobStatus,
} from '~/utils/chat/openrouterStream';
import {
    refreshCachedSessionContext,
} from '~/composables/auth/useSessionContext';
import type {
    BackgroundJobTracker,
    BackgroundJobSubscriber,
    BackgroundJobUpdate,
    EnsureBackgroundJobTrackerParams,
} from './types';
import { abortableDelay } from '~~/shared/openrouter/deadlines';
import {
    emitBackgroundComplete,
} from './backgroundJobNotifications';
import {
    persistBackgroundJobUpdate,
} from './backgroundJobPersistence';
import {
    dispatchWorkflowComplete,
    dispatchWorkflowStateUpdate,
} from './backgroundJobWorkflowEvents';

export { BACKGROUND_JOB_MUTED_KEY } from './backgroundJobNotifications';
export { BACKGROUND_JOB_PERSIST_INTERVAL_MS } from './backgroundJobPersistence';

/**
 * Polling interval when no active subscribers (user navigated away). Detached
 * jobs do not need sub-second UI updates; a lower request rate is more
 * resilient on slow or lossy connections.
 */
export const BACKGROUND_JOB_POLL_INTERVAL_MS = 1_000;

/**
 * Fallback polling interval when subscribers are present (user viewing a
 * thread). SSE is preferred when available; this stays responsive without
 * competing with token delivery on constrained connections.
 */
export const BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS = 250;

/** Bounded retries for terminal client-side authorization or lookup failures. */
export const BACKGROUND_JOB_MAX_NOT_FOUND_POLLS = 3;
export const BACKGROUND_JOB_MAX_AUTH_POLLS = 2;
export const BACKGROUND_JOB_MAX_RETRY_DELAY_MS = 10_000;

/**
 * KV store key for muted thread list.
 * Array of thread IDs that should not trigger notifications.
 */
/**
 * Global tracker map for all active background jobs.
 * Singleton shared across all useChat instances to prevent duplicate tracking.
 */
export const backgroundJobTrackers = new Map<string, BackgroundJobTracker>();

export type BackgroundJobTrackerLifecycleEvent = {
    readonly type: 'created' | 'removed';
    readonly tracker: BackgroundJobTracker;
};

const backgroundJobTrackerLifecycleListeners = new Set<
    (event: BackgroundJobTrackerLifecycleEvent) => void
>();

export function subscribeBackgroundJobTrackerLifecycle(
    listener: (event: BackgroundJobTrackerLifecycleEvent) => void
): () => void {
    backgroundJobTrackerLifecycleListeners.add(listener);
    return () => {
        backgroundJobTrackerLifecycleListeners.delete(listener);
    };
}

function notifyBackgroundJobTrackerLifecycle(
    event: BackgroundJobTrackerLifecycleEvent
): void {
    for (const listener of [
        ...backgroundJobTrackerLifecycleListeners,
    ]) {
        try {
            listener(event);
        } catch {
            // Observers cannot interrupt canonical background job tracking.
        }
    }
}

function bgStreamLog(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function bgStreamWarn(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function isClientRuntime(): boolean {
    const override = (globalThis as { __OR3_TEST_CLIENT?: boolean })
        .__OR3_TEST_CLIENT;
    if (typeof override === 'boolean') return override;
    return Boolean(import.meta.client);
}

function workflowVersionOf(value: unknown): number {
    if (!value || typeof value !== 'object') return -1;
    const version = (value as { version?: unknown }).version;
    return typeof version === 'number' && Number.isFinite(version)
        ? version
        : 0;
}

function notifyBackgroundSubscribers(
    tracker: BackgroundJobTracker,
    callback: keyof Pick<
        BackgroundJobSubscriber,
        'onUpdate' | 'onComplete' | 'onError' | 'onAbort'
    >,
    update: BackgroundJobUpdate
): void {
    for (const subscriber of [...tracker.subscribers]) {
        try {
            subscriber[callback]?.(update);
        } catch (error) {
            bgStreamWarn('subscriber-callback-failed', {
                jobId: tracker.jobId,
                callback,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

/**
 * Internal helper. Promise-based delay for polling loops.
 */
function retryDelayMs(error: BackgroundJobPollError, attempt: number): number {
    if (typeof error.retryAfterMs === 'number') {
        return Math.min(BACKGROUND_JOB_MAX_RETRY_DELAY_MS, error.retryAfterMs);
    }
    const exponential = Math.min(
        BACKGROUND_JOB_MAX_RETRY_DELAY_MS,
        250 * 2 ** Math.max(0, attempt - 1)
    );
    return Math.floor(exponential * (0.75 + Math.random() * 0.5));
}

/**
 * Internal helper. Derives safe content and delta from job status update.
 */
function deriveBackgroundContent(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): { safeContent: string; delta: string; replace: boolean } {
    const replace =
        typeof status.content === 'string' &&
        (status.content_reset === true ||
            (typeof tracker.lastAttempt === 'number' &&
                typeof status.attempt === 'number' &&
                status.attempt > tracker.lastAttempt));
    let nextContent = tracker.lastContent;
    if (replace) {
        nextContent = status.content!;
    } else if (typeof status.content_delta === 'string') {
        nextContent = tracker.lastContent + status.content_delta;
    } else if (typeof status.content === 'string') {
        nextContent = status.content;
    }
    if (
        typeof status.content_length === 'number' &&
        Number.isFinite(status.content_length)
    ) {
        const len = status.content_length;
        if (nextContent.length > len) {
            nextContent = nextContent.slice(0, len);
        } else if (
            nextContent.length < len &&
            typeof status.content === 'string'
        ) {
            nextContent = status.content;
        }
    }
    const safeContent = replace
        ? nextContent
        : nextContent.length >= tracker.lastContent.length
            ? nextContent
            : tracker.lastContent;
    const delta =
        !replace && safeContent.length > tracker.lastContent.length
            ? safeContent.slice(tracker.lastContent.length)
            : '';
    return { safeContent, delta, replace };
}

/**
 * Internal helper. Fetches full content from server for terminal states if needed.
 */
async function ensureFullBackgroundStatus(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): Promise<BackgroundJobStatus> {
    if (status.status === 'streaming') return status;
    const contentLen =
        typeof status.content_length === 'number'
            ? status.content_length
            : typeof status.content === 'string'
                ? status.content.length
                : null;
    const hasFullContent =
        typeof status.content === 'string' &&
        (contentLen === null || status.content.length >= contentLen);
    if (hasFullContent) return status;
    try {
        bgStreamLog('ensure-full-status-refetch', {
            jobId: tracker.jobId,
            priorStatus: status.status,
            priorContentLength:
                typeof status.content === 'string' ? status.content.length : 0,
            declaredContentLength: contentLen,
        });
        const refetched = await pollJobStatus(tracker.jobId);
        bgStreamLog('ensure-full-status-refetched', {
            jobId: tracker.jobId,
            status: refetched.status,
            contentLength:
                typeof refetched.content === 'string'
                    ? refetched.content.length
                    : 0,
        });
        return refetched;
    } catch {
        bgStreamWarn('ensure-full-status-refetch-failed', {
            jobId: tracker.jobId,
            priorStatus: status.status,
        });
        return status;
    }
}

/**
 * Internal helper. Processes a background job status update and notifies subscribers.
 */
async function handleBackgroundStatus(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): Promise<boolean> {
    if (!tracker.active) {
        bgStreamLog('status-ignored-inactive', {
            jobId: tracker.jobId,
            incomingStatus: status.status,
        });
        return false;
    }
    if (
        typeof status.attempt === 'number' &&
        typeof tracker.lastAttempt === 'number' &&
        status.attempt < tracker.lastAttempt
    ) {
        bgStreamLog('status-ignored-stale-attempt', {
            jobId: tracker.jobId,
            incomingAttempt: status.attempt,
            currentAttempt: tracker.lastAttempt,
        });
        return true;
    }
    let nextStatus = status;
    if (nextStatus.status !== 'streaming') {
        nextStatus = await ensureFullBackgroundStatus(tracker, nextStatus);
    }
    const { safeContent, delta, replace } = deriveBackgroundContent(
        tracker,
        nextStatus
    );
    const shouldLogStatusProgress =
        nextStatus.status !== 'streaming' ||
        delta.length >= 256 ||
        (Array.isArray(nextStatus.tool_calls) &&
            nextStatus.tool_calls.length > 0);
    if (shouldLogStatusProgress) {
        bgStreamLog('status-processed', {
            jobId: tracker.jobId,
            status: nextStatus.status,
            incomingContentLength:
                typeof nextStatus.content === 'string'
                    ? nextStatus.content.length
                    : 0,
            trackerContentLengthBefore: tracker.lastContent.length,
            safeContentLength: safeContent.length,
            deltaLength: delta.length,
            subscribers: tracker.subscribers.size,
            polling: tracker.polling,
            streaming: tracker.streaming,
        });
    }
    tracker.lastContent = safeContent;

    const persisted = await persistBackgroundJobUpdate(
        tracker,
        nextStatus,
        safeContent,
        replace
    );
    if (!persisted) {
        bgStreamWarn('status-persist-failed-stop-tracking', {
            jobId: tracker.jobId,
            status: nextStatus.status,
        });
        tracker.active = false;
        tracker.polling = false;
        tracker.streaming = false;
        backgroundJobTrackers.delete(tracker.jobId);
        notifyBackgroundJobTrackerLifecycle({
            type: 'removed',
            tracker,
        });
        void abortBackgroundJob(tracker.jobId);
        return false;
    }
    if (typeof nextStatus.attempt === 'number') {
        tracker.lastAttempt = nextStatus.attempt;
    }

    const update: BackgroundJobUpdate = {
        status: nextStatus,
        content: safeContent,
        delta,
        replace,
    };
    const workflowVersion = workflowVersionOf(nextStatus.workflow_state);
    notifyBackgroundSubscribers(tracker, 'onUpdate', update);
    if (
        nextStatus.workflow_state &&
        typeof nextStatus.workflow_state === 'object' &&
        workflowVersion >= tracker.lastWorkflowVersion
    ) {
        dispatchWorkflowStateUpdate(tracker.messageId, nextStatus.workflow_state);
    }

    if (nextStatus.status !== 'streaming') {
        notifyBackgroundSubscribers(
            tracker,
            nextStatus.status === 'complete'
                ? 'onComplete'
                : nextStatus.status === 'aborted'
                    ? 'onAbort'
                    : 'onError',
            update
        );
        await emitBackgroundComplete(tracker, nextStatus);
        if (nextStatus.workflow_state && typeof nextStatus.workflow_state === 'object') {
            const state = nextStatus.workflow_state;
            const workflowId = state.workflowId;
            const finalOutput = state.finalOutput || undefined;
            if (workflowId) {
                dispatchWorkflowComplete(
                    tracker.messageId,
                    workflowId,
                    finalOutput
                );
            }
        }
        tracker.resolveCompletion(nextStatus);
        bgStreamLog('status-terminal-cleanup', {
            jobId: tracker.jobId,
            status: nextStatus.status,
            contentLength: safeContent.length,
            subscribers: tracker.subscribers.size,
        });
        tracker.active = false;
        tracker.polling = false;
        tracker.streaming = false;
        backgroundJobTrackers.delete(tracker.jobId);
        return false;
    }

    return true;
}

/**
 * Primes a background job with initial content from server.
 *
 * Purpose:
 * Synchronizes local state with server state when re-attaching to a background
 * job. Handles both terminal states (complete/error/aborted) and streaming state.
 *
 * Behavior:
 * - Fetches current job status from server (no offset)
 * - For terminal states: notifies subscribers immediately
 * - For streaming state: persists and notifies if server has more content
 * - Server is treated as source of truth
 *
 * Constraints:
 * - Returns early if job status fetch fails
 * - Does not start polling or SSE (separate concern)
 * - Safe to call multiple times
 *
 * @example
 * ```ts
 * const tracker = ensureBackgroundJobTracker({ jobId: '123', ... });
 * await primeBackgroundJobUpdate(tracker);
 * // Tracker now synchronized with server state
 * ```
 */
export async function primeBackgroundJobUpdate(
    tracker: BackgroundJobTracker
): Promise<void> {
    bgStreamLog('prime-start', {
        jobId: tracker.jobId,
        knownContentLength: tracker.lastContent.length,
        subscribers: tracker.subscribers.size,
    });
    // Fetch full content from server (no offset) - server is source of truth
    let initialStatus: BackgroundJobStatus | null = null;
    try {
        initialStatus = await pollJobStatus(
            tracker.jobId,
            undefined,
            undefined,
            tracker.lastAttempt
        );
    } catch {
        bgStreamWarn('prime-status-fetch-failed', {
            jobId: tracker.jobId,
        });
        initialStatus = null;
    }

    if (!initialStatus) return;
    bgStreamLog('prime-status-received', {
        jobId: tracker.jobId,
        status: initialStatus.status,
        contentLength:
            typeof initialStatus.content === 'string'
                ? initialStatus.content.length
                : 0,
    });

    // Handle terminal states
    if (initialStatus.status !== 'streaming') {
        tracker.active = true;
        await handleBackgroundStatus(tracker, initialStatus);
        return;
    }

    tracker.active = true;
    await handleBackgroundStatus(tracker, initialStatus);
}

/**
 * Internal helper. Main polling loop for background job status updates.
 */
async function pollBackgroundJob(tracker: BackgroundJobTracker): Promise<void> {
    if (tracker.polling) return;
    if (typeof tracker.pollRunId !== 'number') tracker.pollRunId = 0;
    const runId = tracker.pollRunId + 1;
    tracker.pollAbortController?.abort();
    const pollAbortController = new AbortController();
    tracker.pollAbortController = pollAbortController;
    tracker.pollRunId = runId;
    tracker.polling = true;
    tracker.active = true;
    bgStreamLog('poll-start', {
        jobId: tracker.jobId,
        runId,
        baselineLength: tracker.lastContent.length,
        subscribers: tracker.subscribers.size,
    });
    const isActive = () => tracker.active;

    try {
    while (isActive() && tracker.pollRunId === runId) {
        let status: BackgroundJobStatus;
        try {
            status = await pollJobStatus(
                tracker.jobId,
                tracker.lastContent.length,
                pollAbortController.signal,
                tracker.lastAttempt
            );
            tracker.consecutivePollFailures = 0;
            tracker.notFoundPollFailures = 0;
            tracker.authPollFailures = 0;
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error';
            bgStreamWarn('poll-status-failed', {
                jobId: tracker.jobId,
                runId,
                error,
            });
            if (err instanceof BackgroundJobPollError && err.retryable) {
                tracker.consecutivePollFailures =
                    (tracker.consecutivePollFailures ?? 0) + 1;
                if (err.kind === 'not_found') {
                    tracker.notFoundPollFailures =
                        (tracker.notFoundPollFailures ?? 0) + 1;
                }
                if (err.kind === 'auth') {
                    tracker.authPollFailures = (tracker.authPollFailures ?? 0) + 1;
                    if (tracker.authPollFailures === 1) {
                        try {
                            await refreshCachedSessionContext();
                        } catch {
                            /* the bounded poll retry remains authoritative */
                        }
                    }
                }
                const withinKindBound =
                    (err.kind !== 'not_found' ||
                        (tracker.notFoundPollFailures ?? 0) <=
                            BACKGROUND_JOB_MAX_NOT_FOUND_POLLS) &&
                    (err.kind !== 'auth' ||
                        (tracker.authPollFailures ?? 0) <=
                            BACKGROUND_JOB_MAX_AUTH_POLLS);
                // A client-side transport failure does not mean the server-side
                // generation failed. Keep reconciling retryable network, 429,
                // and 5xx responses with a capped backoff so an intermittent or
                // slow connection cannot permanently mark an active job as an
                // error. Authentication and not-found responses remain bounded:
                // retrying them indefinitely cannot recover the job.
                if (withinKindBound) {
                    await abortableDelay(
                        retryDelayMs(err, tracker.consecutivePollFailures),
                        pollAbortController.signal
                    );
                    continue;
                }
            }
            status = {
                id: tracker.jobId,
                status: 'error',
                threadId: tracker.threadId,
                messageId: tracker.messageId,
                model: 'unknown',
                chunksReceived: 0,
                startedAt: Date.now(),
                completedAt: Date.now(),
                error,
                content: tracker.lastContent,
            };
        }
        if (!isActive() || tracker.pollRunId !== runId) break;

        const shouldContinue = await handleBackgroundStatus(tracker, status);
        if (!shouldContinue) break;
        if (
            tracker.preferSse &&
            tracker.subscribers.size > 0 &&
            tracker.status === 'streaming' &&
            !tracker.streaming
        ) {
            tracker.polling = false;
            bgStreamLog('poll-upgrade-to-sse', {
                jobId: tracker.jobId,
                runId,
                subscribers: tracker.subscribers.size,
            });
            startBackgroundJobTracking(tracker, { useSse: true });
            return;
        }

        const pollInterval =
            tracker.subscribers.size > 0
                ? BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS
                : BACKGROUND_JOB_POLL_INTERVAL_MS;
        await abortableDelay(pollInterval, pollAbortController.signal);
    }
    } catch (error) {
        if (!pollAbortController.signal.aborted) throw error;
    } finally {
        if (tracker.pollRunId === runId) {
            tracker.polling = false;
            tracker.pollAbortController = undefined;
        }
        bgStreamLog('poll-stop', {
            jobId: tracker.jobId,
            runId,
            active: tracker.active,
            pollRunId: tracker.pollRunId,
            status: tracker.status,
        });
    }
}

/**
 * Stops tracking a background job and cleans up resources.
 *
 * Purpose:
 * Gracefully shuts down a background job tracker, stopping both polling and
 * SSE streams. Cleans up subscriptions without deleting persisted data.
 *
 * Behavior:
 * - Sets tracker to inactive state
 * - Stops polling loop
 * - Closes SSE stream if open
 * - Does NOT remove from global map or delete message
 *
 * Constraints:
 * - Safe to call multiple times (idempotent)
 * - Does not abort the job on the server
 * - Does not emit notifications
 *
 * @example
 * ```ts
 * const tracker = backgroundJobTrackers.get(jobId);
 * if (tracker) {
 *   stopBackgroundJobTracking(tracker);
 * }
 * ```
 */
export function stopBackgroundJobTracking(
    tracker: BackgroundJobTracker
): void {
    bgStreamLog('stop-tracking', {
        jobId: tracker.jobId,
        status: tracker.status,
        subscribers: tracker.subscribers.size,
        polling: tracker.polling,
        streaming: tracker.streaming,
    });
    tracker.active = false;
    tracker.pollRunId = (tracker.pollRunId ?? 0) + 1;
    tracker.pollAbortController?.abort();
    tracker.pollAbortController = undefined;
    tracker.polling = false;
    tracker.streaming = false;
    if (tracker.streamUnsubscribe) {
        try {
            tracker.streamUnsubscribe();
        } catch {
            /* intentionally empty */
        }
        tracker.streamUnsubscribe = undefined;
    }
}

/**
 * Internal helper. Initiates background job tracking via SSE or polling fallback.
 */
function startBackgroundJobTracking(
    tracker: BackgroundJobTracker,
    options?: { useSse?: boolean }
): void {
    if (tracker.polling || tracker.streaming) {
        bgStreamLog('start-tracking-skipped-already-running', {
            jobId: tracker.jobId,
            polling: tracker.polling,
            streaming: tracker.streaming,
            requestedSse: Boolean(options?.useSse),
        });
        return;
    }
    if (options?.useSse) {
        bgStreamLog('start-sse', {
            jobId: tracker.jobId,
            offset: tracker.lastContent.length,
            subscribers: tracker.subscribers.size,
        });
        tracker.streaming = true;
        tracker.active = true;
        let closed = false;
        let chain = Promise.resolve();
        let unsubscribe: (() => void) | null = null;

        const closeStream = () => {
            if (closed) return;
            closed = true;
            tracker.streaming = false;
            tracker.streamUnsubscribe = undefined;
            bgStreamLog('sse-closed', {
                jobId: tracker.jobId,
                status: tracker.status,
                subscribers: tracker.subscribers.size,
            });
            if (unsubscribe) {
                try {
                    unsubscribe();
                } catch {
                    /* intentionally empty */
                }
            }
        };

        try {
            unsubscribe = subscribeBackgroundJobStream({
                jobId: tracker.jobId,
                offset: tracker.lastContent.length,
                attempt: tracker.lastAttempt,
                onStatus: (status) => {
                    const shouldLogSseStatus =
                        status.status !== 'streaming' ||
                        (typeof status.content_delta === 'string' &&
                            status.content_delta.length >= 256);
                    if (shouldLogSseStatus) {
                        bgStreamLog('sse-status', {
                            jobId: tracker.jobId,
                            status: status.status,
                            contentLength:
                                typeof status.content === 'string'
                                    ? status.content.length
                                    : 0,
                            deltaLength:
                                typeof status.content_delta === 'string'
                                    ? status.content_delta.length
                                    : 0,
                        });
                    }
                    chain = chain
                        .then(() => handleBackgroundStatus(tracker, status))
                        .then((shouldContinue) => {
                            if (!shouldContinue) {
                                closeStream();
                            }
                        })
                        .catch(() => {
                            // Fallback to polling on handler error
                            bgStreamWarn('sse-handler-error-fallback-poll', {
                                jobId: tracker.jobId,
                            });
                            closeStream();
                            void pollBackgroundJob(tracker);
                        });
                },
                onError: (error) => {
                    if (!closed) {
                        const terminalState =
                            tracker.status !== 'streaming' || !tracker.active;
                        if (terminalState) {
                            bgStreamLog('sse-error-ignored-terminal', {
                                jobId: tracker.jobId,
                                status: tracker.status,
                                active: tracker.active,
                                error: error.message,
                            });
                            closeStream();
                            return;
                        }
                        bgStreamWarn('sse-error-fallback-poll', {
                            jobId: tracker.jobId,
                            error: error.message,
                        });
                        closeStream();
                        // Drain already-queued SSE statuses before polling so
                        // an older event cannot land after a recovered attempt.
                        void chain.finally(() => {
                            if (tracker.active) void pollBackgroundJob(tracker);
                        });
                    }
                },
            });
        } catch (error) {
            bgStreamWarn('sse-start-failed-fallback-poll', {
                jobId: tracker.jobId,
                error: error instanceof Error ? error.message : String(error),
            });
            closeStream();
            void pollBackgroundJob(tracker);
            return;
        }

        tracker.streamUnsubscribe = closeStream;
        return;
    }

    bgStreamLog('start-poll', {
        jobId: tracker.jobId,
        subscribers: tracker.subscribers.size,
        status: tracker.status,
    });
    void pollBackgroundJob(tracker);
}

/**
 * Ensures a background job tracker exists and is actively running.
 *
 * Purpose:
 * Primary entry point for background job tracking. Returns existing tracker if
 * present, or creates and starts a new one. Updates tracker metadata with any
 * new information provided.
 *
 * Behavior:
 * - Returns existing tracker from global map if found
 * - Updates existing tracker with new userId, threadId, messageId if provided
 * - Seeds content if longer than existing
 * - Starts SSE if requested and not already running
 * - Creates new tracker with completion promise if not found
 * - Automatically starts polling or SSE transport
 *
 * Constraints:
 * - Job ID is the unique identifier
 * - Only starts SSE if explicitly requested (useSse: true)
 * - Content is only updated if longer than existing (no truncation)
 *
 * @example
 * ```ts
 * const tracker = ensureBackgroundJobTracker({
 *   jobId: 'job-123',
 *   userId: 'user-456',
 *   threadId: 'thread-789',
 *   messageId: 'msg-abc',
 *   initialContent: 'Hello',
 *   useSse: true
 * });
 *
 * // Subscribe to updates
 * const unsubscribe = subscribeBackgroundJob(tracker, {
 *   onUpdate: (update) => console.log(update.content)
 * });
 * ```
 */
export function ensureBackgroundJobTracker(
    params: EnsureBackgroundJobTrackerParams
): BackgroundJobTracker {
    const existing = backgroundJobTrackers.get(params.jobId);
    if (existing) {
        bgStreamLog('tracker-reused', {
            jobId: params.jobId,
            existingStatus: existing.status,
            existingContentLength: existing.lastContent.length,
            incomingInitialLength:
                typeof params.initialContent === 'string'
                    ? params.initialContent.length
                    : 0,
            useSse: Boolean(params.useSse),
            subscribers: existing.subscribers.size,
            polling: existing.polling,
            streaming: existing.streaming,
        });
        if (typeof existing.pollRunId !== 'number') {
            existing.pollRunId = 0;
        }
        if (typeof existing.lastWorkflowVersion !== 'number') {
            existing.lastWorkflowVersion = -1;
        }
        const incomingAttempt = params.initialAttempt;
        const currentAttempt = existing.lastAttempt;
        const isNewerAttempt =
            typeof incomingAttempt === 'number' &&
            (typeof currentAttempt !== 'number' || incomingAttempt > currentAttempt);
        const isStaleAttempt =
            typeof incomingAttempt === 'number' &&
            typeof currentAttempt === 'number' &&
            incomingAttempt < currentAttempt;
        if (isNewerAttempt) existing.lastAttempt = incomingAttempt;
        if (typeof existing.preferSse !== 'boolean') {
            existing.preferSse = false;
        }
        if (params.userId && existing.userId !== params.userId) {
            existing.userId = params.userId;
        }
        if (!existing.threadId) existing.threadId = params.threadId;
        if (!existing.messageId) existing.messageId = params.messageId;
        if (
            !isStaleAttempt &&
            typeof params.initialContent === 'string' &&
            (isNewerAttempt ||
                params.initialContent.length > existing.lastContent.length)
        ) {
            existing.lastContent = params.initialContent;
            existing.lastPersistedLength = params.initialContent.length;
        }
        if (params.useSse) {
            existing.preferSse = true;
        }
        if (typeof params.preferServerNotifications === 'boolean') {
            existing.preferServerNotifications = params.preferServerNotifications;
        }
        if (params.useSse && !existing.polling && !existing.streaming) {
            startBackgroundJobTracking(existing, { useSse: true });
        }
        return existing;
    }

    let resolveCompletion: (status: BackgroundJobStatus) => void = () => {};
    const completion = new Promise<BackgroundJobStatus>((resolve) => {
        resolveCompletion = resolve;
    });
    const seedContent =
        typeof params.initialContent === 'string' ? params.initialContent : '';
    const originDb = getDb();
    const tracker: BackgroundJobTracker = {
        jobId: params.jobId,
        userId: params.userId,
        threadId: params.threadId,
        messageId: params.messageId,
        status: 'streaming',
        preferServerNotifications: Boolean(params.preferServerNotifications),
        lastWorkflowVersion: -1,
        lastToolStateFingerprint: '[]',
        lastWorkflowFingerprint: 'null',
        lastContent: seedContent,
        lastAttempt: params.initialAttempt,
        lastPersistedLength: seedContent.length,
        lastPersistAt: 0,
        polling: false,
        streaming: false,
        active: false,
        preferSse: Boolean(params.useSse),
        pollRunId: 0,
        originDb,
        originDbName: originDb.name,
        subscribers: new Set<BackgroundJobSubscriber>(),
        completion,
        resolveCompletion,
    };
    backgroundJobTrackers.set(params.jobId, tracker);
    notifyBackgroundJobTrackerLifecycle({
        type: 'created',
        tracker,
    });
    bgStreamLog('tracker-created', {
        jobId: tracker.jobId,
        threadId: tracker.threadId,
        messageId: tracker.messageId,
        userId: tracker.userId,
        initialContentLength: seedContent.length,
        preferSse: tracker.preferSse,
        preferServerNotifications: tracker.preferServerNotifications === true,
    });
    startBackgroundJobTracking(tracker, { useSse: params.useSse });
    return tracker;
}

/**
 * Subscribes to background job update events.
 *
 * Purpose:
 * Registers a subscriber to receive streaming updates, completion, error,
 * and abort events from a background job tracker.
 *
 * Behavior:
 * - Adds subscriber to tracker's subscriber Set
 * - Subscriber receives onUpdate, onComplete, onError, onAbort callbacks
 * - Returns unsubscribe function to remove subscription
 * - Presence of subscribers affects polling interval and notifications
 *
 * Constraints:
 * - Subscribers are stored in a Set (no duplicates)
 * - Unsubscribe function is idempotent (safe to call multiple times)
 * - Adding/removing subscribers does not affect job lifecycle
 *
 * @example
 * ```ts
 * const unsubscribe = subscribeBackgroundJob(tracker, {
 *   onUpdate: (update) => {
 *     console.log('Content:', update.content);
 *   },
 *   onComplete: (update) => {
 *     console.log('Job complete:', update.status);
 *   },
 *   onError: (update) => {
 *     console.error('Job failed:', update.status);
 *   }
 * });
 *
 * // Later, when done listening
 * unsubscribe();
 * ```
 */
export function subscribeBackgroundJob(
    tracker: BackgroundJobTracker,
    subscriber: BackgroundJobSubscriber
): () => void {
    if (typeof tracker.pollRunId !== 'number') tracker.pollRunId = 0;
    if (typeof tracker.preferSse !== 'boolean') tracker.preferSse = false;
    tracker.subscribers.add(subscriber);
    bgStreamLog('subscriber-added', {
        jobId: tracker.jobId,
        subscribers: tracker.subscribers.size,
        preferSse: tracker.preferSse,
        polling: tracker.polling,
        streaming: tracker.streaming,
        status: tracker.status,
    });
    if (
        tracker.preferSse &&
        tracker.subscribers.size > 0 &&
        tracker.status === 'streaming' &&
        !tracker.streaming
    ) {
        if (tracker.polling) {
            tracker.pollRunId += 1;
            tracker.pollAbortController?.abort();
            tracker.pollAbortController = undefined;
            tracker.polling = false;
            bgStreamLog('subscriber-upgrade-cancel-poll', {
                jobId: tracker.jobId,
                pollRunId: tracker.pollRunId,
            });
        }
        startBackgroundJobTracking(tracker, { useSse: true });
    }
    return () => {
        tracker.subscribers.delete(subscriber);
        bgStreamLog('subscriber-removed', {
            jobId: tracker.jobId,
            subscribers: tracker.subscribers.size,
            active: tracker.active,
            status: tracker.status,
            polling: tracker.polling,
            streaming: tracker.streaming,
        });
        if (tracker.subscribers.size > 0 || !tracker.active) return;
        // No active UI subscribers: drop SSE viewer so server-side notification
        // suppression doesn't hide completion notifications.
        if (tracker.streaming && tracker.streamUnsubscribe) {
            bgStreamLog('subscriber-none-close-sse', {
                jobId: tracker.jobId,
            });
            try {
                tracker.streamUnsubscribe();
            } catch {
                /* intentionally empty */
            }
        }
        // Keep tracking via polling so local persistence and completion callbacks
        // continue even while detached.
        if (!tracker.polling && tracker.status === 'streaming') {
            bgStreamLog('subscriber-none-start-poll', {
                jobId: tracker.jobId,
            });
            void pollBackgroundJob(tracker);
        }
    };
}
