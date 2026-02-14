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

import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import type { HookEngine } from '~/core/hooks/hooks';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import { nowSec, newId } from '~/db/util';
import { upsert } from '~/db';
import { getDb } from '~/db/client';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import {
    pollJobStatus,
    subscribeBackgroundJobStream,
    abortBackgroundJob,
    type BackgroundJobStatus,
} from '~/utils/chat/openrouterStream';
import { NotificationService } from '~/core/notifications/notification-service';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import type {
    BackgroundJobTracker,
    BackgroundJobSubscriber,
    BackgroundJobUpdate,
    StoredMessage,
    EnsureBackgroundJobTrackerParams,
} from './types';

/**
 * Polling interval when no active subscribers (user navigated away).
 * Balances server load with reasonable update latency.
 */
export const BACKGROUND_JOB_POLL_INTERVAL_MS = 300;

/**
 * Polling interval when subscribers are present (user viewing thread).
 * Provides more responsive updates during active streaming.
 */
export const BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS = 80;

/**
 * Minimum time between IndexedDB persistence writes.
 * Prevents excessive database writes during high-frequency streaming.
 */
export const BACKGROUND_JOB_PERSIST_INTERVAL_MS = 500;

/**
 * KV store key for muted thread list.
 * Array of thread IDs that should not trigger notifications.
 */
export const BACKGROUND_JOB_MUTED_KEY = 'notification_muted_threads';

/**
 * Global tracker map for all active background jobs.
 * Singleton shared across all useChat instances to prevent duplicate tracking.
 */
export const backgroundJobTrackers = new Map<string, BackgroundJobTracker>();

let cachedNotificationHooks: TypedHookEngine | null = null;
let cachedWorkflowHooks: TypedHookEngine | null = null;

function workflowVersionOf(value: unknown): number {
    if (!value || typeof value !== 'object') return -1;
    const version = (value as { version?: unknown }).version;
    return typeof version === 'number' && Number.isFinite(version)
        ? version
        : 0;
}

/**
 * Internal helper. Promise-based delay for polling loops.
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Internal helper. Resolves the global hook engine without relying on composable context.
 * Background trackers can outlive setup/plugin contexts, so `useHooks()` is unsafe here.
 */
function resolveNotificationHooks(): TypedHookEngine | null {
    if (cachedNotificationHooks) return cachedNotificationHooks;
    const g = globalThis as typeof globalThis & {
        __NUXT_HOOKS__?: HookEngine;
    };
    if (!g.__NUXT_HOOKS__) return null;
    cachedNotificationHooks = createTypedHookEngine(g.__NUXT_HOOKS__);
    return cachedNotificationHooks;
}

function resolveWorkflowHooks(): TypedHookEngine | null {
    if (cachedWorkflowHooks) return cachedWorkflowHooks;
    const g = globalThis as typeof globalThis & {
        __NUXT_HOOKS__?: HookEngine;
    };
    if (!g.__NUXT_HOOKS__) return null;
    cachedWorkflowHooks = createTypedHookEngine(g.__NUXT_HOOKS__);
    return cachedWorkflowHooks;
}

/**
 * Internal helper. Checks if a thread is muted via KV store.
 */
async function isThreadMuted(threadId: string): Promise<boolean> {
    if (!import.meta.client) return false;
    try {
        const kv = await getDb().kv.get(BACKGROUND_JOB_MUTED_KEY);
        if (!kv?.value) return false;
        const parsed: unknown = JSON.parse(kv.value);
        return Array.isArray(parsed) && parsed.includes(threadId);
    } catch {
        return false;
    }
}

/**
 * Internal helper. Emits system notification when background job completes without active subscribers.
 */
async function emitBackgroundComplete(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): Promise<void> {
    if (!import.meta.client) return;
    if (!tracker.threadId) return;
    // Notify when detached OR when app tab is backgrounded.
    // Hidden-tab sessions can keep SSE subscribers active, which otherwise
    // suppresses completion notifications indefinitely.
    const hasSubscribers = tracker.subscribers.size > 0;
    const isTabHidden =
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden';
    if (hasSubscribers && !isTabHidden) return;
    if (await isThreadMuted(tracker.threadId)) return;

    const hooks = resolveNotificationHooks();
    if (!hooks) return;
    const isError = status.status === 'error';
    const isAbort = status.status === 'aborted';
    const type = isError || isAbort ? 'system.warning' : 'ai.message.received';
    const title = isError
        ? 'AI response failed'
        : isAbort
            ? 'AI response stopped'
            : 'AI response ready';
    const body = isError
        ? status.error || 'Background response failed.'
        : isAbort
            ? 'Background response was aborted.'
            : 'Your background response is ready.';
    const payload = {
        type,
        title,
        body,
        threadId: tracker.threadId,
        actions: [
            {
                id: newId(),
                label: 'Open chat',
                kind: 'navigate' as const,
                target: { threadId: tracker.threadId },
                data: { messageId: tracker.messageId },
            },
        ],
    };

    try {
        // Prefer hook-based creation so the currently active NotificationService
        // instance owns user scoping (prevents stale tracker user IDs).
        if (hooks.hasAction('notify:action:push')) {
            await hooks.doAction('notify:action:push', payload);
            return;
        }

        const session = getCachedSessionContext();
        const userId = resolveNotificationUserId(session) || tracker.userId;
        const service = new NotificationService(getDb(), hooks, userId);
        await service.create(payload);
    } catch (error) {
        if (import.meta.dev) {
            console.warn(
                '[background-jobs] Failed to emit completion notification',
                error
            );
        }
    }
}

/**
 * Internal helper. Throttled persistence of background job updates to IndexedDB.
 */
async function persistBackgroundJobUpdate(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus,
    content: string
): Promise<boolean> {
    if (!import.meta.client) return true;

    const now = Date.now();
    const statusChanged = status.status !== tracker.status;
    const contentChanged = content.length > tracker.lastPersistedLength;
    const shouldPersistContent =
        contentChanged &&
        (now - tracker.lastPersistAt > BACKGROUND_JOB_PERSIST_INTERVAL_MS ||
            status.status !== 'streaming');

    if (!statusChanged && !shouldPersistContent) return true;

    const existing = (await getDb().messages.get(tracker.messageId)) as
        | StoredMessage
        | undefined;
    if (!existing) return false;

    const baseData =
        existing.data && typeof existing.data === 'object'
            ? (existing.data as Record<string, unknown>)
            : {};
    const nextError =
        status.status === 'error'
            ? status.error || 'Background response failed'
            : status.status === 'aborted'
                ? 'Background response aborted'
                : null;
    const workflowState =
        status.workflow_state && typeof status.workflow_state === 'object'
            ? status.workflow_state
            : null;
    const workflowVersion = workflowVersionOf(workflowState);
    const includeWorkflowState =
        workflowState !== null && workflowVersion >= tracker.lastWorkflowVersion;
    if (includeWorkflowState) {
        tracker.lastWorkflowVersion = workflowVersion;
    }
    const mergedData = {
        ...baseData,
        ...(includeWorkflowState ? workflowState : {}),
        content:
            content.length > 0
                ? content
                : (baseData.content as string | undefined) ?? '',
        background_job_id: tracker.jobId,
        background_job_status: status.status,
        ...(status.error ? { background_job_error: status.error } : {}),
        ...(nextError ? { error: nextError } : {}),
        ...(status.tool_calls ? { tool_calls: status.tool_calls } : {}),
    };

    await upsert.message({
        ...existing,
        pending: status.status === 'streaming',
        error: nextError,
        data: mergedData,
        updated_at: nowSec(),
    });

    tracker.status = status.status;
    tracker.lastPersistAt = now;
    tracker.lastPersistedLength = content.length;
    return true;
}

/**
 * Internal helper. Derives safe content and delta from job status update.
 */
function deriveBackgroundContent(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): { safeContent: string; delta: string } {
    let nextContent = tracker.lastContent;
    if (typeof status.content_delta === 'string') {
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
    const safeContent =
        nextContent.length >= tracker.lastContent.length
            ? nextContent
            : tracker.lastContent;
    const delta =
        safeContent.length > tracker.lastContent.length
            ? safeContent.slice(tracker.lastContent.length)
            : '';
    return { safeContent, delta };
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
        return await pollJobStatus(tracker.jobId);
    } catch {
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
    if (!tracker.active) return false;
    let nextStatus = status;
    if (nextStatus.status !== 'streaming') {
        nextStatus = await ensureFullBackgroundStatus(tracker, nextStatus);
    }
    const { safeContent, delta } = deriveBackgroundContent(tracker, nextStatus);
    tracker.lastContent = safeContent;

    const persisted = await persistBackgroundJobUpdate(
        tracker,
        nextStatus,
        safeContent
    );
    if (!persisted) {
        tracker.active = false;
        tracker.polling = false;
        tracker.streaming = false;
        backgroundJobTrackers.delete(tracker.jobId);
        void abortBackgroundJob(tracker.jobId);
        return false;
    }

    const update: BackgroundJobUpdate = {
        status: nextStatus,
        content: safeContent,
        delta,
    };
    const workflowVersion = workflowVersionOf(nextStatus.workflow_state);
    if (
        nextStatus.workflow_state &&
        typeof nextStatus.workflow_state === 'object' &&
        workflowVersion >= tracker.lastWorkflowVersion
    ) {
        const workflowHooks = resolveWorkflowHooks();
        if (workflowHooks?.hasAction('workflow.execution:action:state_update')) {
            await workflowHooks.doAction('workflow.execution:action:state_update', {
                messageId: tracker.messageId,
                state: nextStatus.workflow_state,
            });
        }
    }
    for (const subscriber of tracker.subscribers) {
        subscriber.onUpdate?.(update);
    }

    if (nextStatus.status !== 'streaming') {
        for (const subscriber of tracker.subscribers) {
            if (nextStatus.status === 'complete') {
                subscriber.onComplete?.(update);
            } else if (nextStatus.status === 'aborted') {
                subscriber.onAbort?.(update);
            } else {
                subscriber.onError?.(update);
            }
        }
        await emitBackgroundComplete(tracker, nextStatus);
        if (nextStatus.workflow_state && typeof nextStatus.workflow_state === 'object') {
            const workflowHooks = resolveWorkflowHooks();
            if (workflowHooks?.hasAction('workflow.execution:action:complete')) {
                const state = nextStatus.workflow_state;
                const workflowId = state.workflowId;
                const finalOutput = state.finalOutput || undefined;
                if (workflowId) {
                    await workflowHooks.doAction('workflow.execution:action:complete', {
                        messageId: tracker.messageId,
                        workflowId,
                        finalOutput,
                    });
                }
            }
        }
        tracker.resolveCompletion(nextStatus);
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
    // Fetch full content from server (no offset) - server is source of truth
    let initialStatus: BackgroundJobStatus | null = null;
    try {
        initialStatus = await pollJobStatus(tracker.jobId);
    } catch {
        initialStatus = null;
    }

    if (!initialStatus) return;

    // Handle terminal states
    if (initialStatus.status !== 'streaming') {
        const fullStatus = await ensureFullBackgroundStatus(tracker, initialStatus);
        const content = fullStatus.content || '';
        tracker.lastContent = content;
        const update: BackgroundJobUpdate = {
            status: fullStatus,
            content,
            delta: content,
        };
        for (const subscriber of tracker.subscribers) {
            if (fullStatus.status === 'complete') {
                subscriber.onComplete?.(update);
            } else if (fullStatus.status === 'error') {
                subscriber.onError?.(update);
            } else if (fullStatus.status === 'aborted') {
                subscriber.onAbort?.(update);
            }
        }
        return;
    }

    // Streaming - deliver full content immediately
    // Only update if server has more content than we currently have
    const serverContent = initialStatus.content || '';
    if (serverContent.length >= tracker.lastContent.length) {
        tracker.lastContent = serverContent;
        const persisted = await persistBackgroundJobUpdate(
            tracker,
            initialStatus,
            serverContent
        );
        if (!persisted) return;
        const update: BackgroundJobUpdate = {
            status: initialStatus,
            content: serverContent,
            delta: serverContent, // Full content as delta since baseline was empty
        };
        for (const subscriber of tracker.subscribers) {
            subscriber.onUpdate?.(update);
        }
    }
    // If server has less, keep our content and let normal polling continue
    // Normal polling will continue from here - no burst loop needed
}

/**
 * Internal helper. Main polling loop for background job status updates.
 */
async function pollBackgroundJob(tracker: BackgroundJobTracker): Promise<void> {
    if (tracker.polling) return;
    tracker.polling = true;
    tracker.active = true;
    const isActive = () => tracker.active;

    while (isActive()) {
        let status: BackgroundJobStatus;
        try {
            status = await pollJobStatus(
                tracker.jobId,
                tracker.lastContent.length
            );
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error';
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

        const shouldContinue = await handleBackgroundStatus(tracker, status);
        if (!shouldContinue) break;

        const pollInterval =
            tracker.subscribers.size > 0
                ? BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS
                : BACKGROUND_JOB_POLL_INTERVAL_MS;
        await sleep(pollInterval);
    }
    tracker.polling = false;
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
    tracker.active = false;
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
    if (tracker.polling || tracker.streaming) return;
    if (options?.useSse) {
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
                onStatus: (status) => {
                    chain = chain
                        .then(() => handleBackgroundStatus(tracker, status))
                        .then((shouldContinue) => {
                            if (!shouldContinue) {
                                closeStream();
                            }
                        })
                        .catch(() => {
                            // Fallback to polling on handler error
                            closeStream();
                            void pollBackgroundJob(tracker);
                        });
                },
                onError: () => {
                    if (!closed) {
                        closeStream();
                        void pollBackgroundJob(tracker);
                    }
                },
            });
        } catch {
            closeStream();
            void pollBackgroundJob(tracker);
            return;
        }

        tracker.streamUnsubscribe = closeStream;
        return;
    }

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
        if (typeof existing.lastWorkflowVersion !== 'number') {
            existing.lastWorkflowVersion = -1;
        }
        if (params.userId && existing.userId !== params.userId) {
            existing.userId = params.userId;
        }
        if (!existing.threadId) existing.threadId = params.threadId;
        if (!existing.messageId) existing.messageId = params.messageId;
        if (
            typeof params.initialContent === 'string' &&
            params.initialContent.length > existing.lastContent.length
        ) {
            existing.lastContent = params.initialContent;
            existing.lastPersistedLength = params.initialContent.length;
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
    const tracker: BackgroundJobTracker = {
        jobId: params.jobId,
        userId: params.userId,
        threadId: params.threadId,
        messageId: params.messageId,
        status: 'streaming',
        lastWorkflowVersion: -1,
        lastContent: seedContent,
        lastPersistedLength: seedContent.length,
        lastPersistAt: 0,
        polling: false,
        streaming: false,
        active: false,
        subscribers: new Set<BackgroundJobSubscriber>(),
        completion,
        resolveCompletion,
    };
    backgroundJobTrackers.set(params.jobId, tracker);
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
    tracker.subscribers.add(subscriber);
    return () => {
        tracker.subscribers.delete(subscriber);
        if (tracker.subscribers.size > 0 || !tracker.active) return;
        // No active UI subscribers: drop SSE viewer so server-side notification
        // suppression doesn't hide completion notifications.
        if (tracker.streaming && tracker.streamUnsubscribe) {
            try {
                tracker.streamUnsubscribe();
            } catch {
                /* intentionally empty */
            }
        }
        // Keep tracking via polling so local persistence and completion callbacks
        // continue even while detached.
        if (!tracker.polling && tracker.status === 'streaming') {
            void pollBackgroundJob(tracker);
        }
    };
}
