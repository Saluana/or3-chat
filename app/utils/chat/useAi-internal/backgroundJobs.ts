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
import { getActiveWorkspaceId, getDb } from '~/db/client';
import { redactDiagnosticDetails } from '~~/shared/logging/sensitive-metadata';
import {
    pollJobStatus,
    subscribeBackgroundJobStream,
    abortBackgroundJob,
    claimBackgroundClientTool,
    submitBackgroundClientToolResult,
    BackgroundJobPollError,
    type BackgroundJobStatus,
} from '~/utils/chat/openrouterStream';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import {
    refreshCachedSessionContext,
    getCachedSessionContext,
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
    normalizeTerminalWorkflowState,
    persistBackgroundJobUpdate,
    persistBackgroundTrackingInterruption,
} from './backgroundJobPersistence';
import {
    dispatchWorkflowComplete,
    dispatchWorkflowStateUpdate,
} from './backgroundJobWorkflowEvents';

export { BACKGROUND_JOB_MUTED_KEY } from './backgroundJobNotifications';
export { BACKGROUND_JOB_PERSIST_INTERVAL_MS } from './backgroundJobPersistence';

const clientToolDispatches = new Map<
    string,
    { promise: Promise<void>; abortController: AbortController }
>();
const clientToolRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const clientToolRetryAttempts = new Map<string, number>();
const CLIENT_TOOL_JOURNAL_PREFIX = 'or3:bg-client-tool:';
const CLIENT_TOOL_JOURNAL_TTL_MS = 24 * 60 * 60 * 1000;
let lastClientToolJournalPruneAt = 0;

type ClientToolJournal =
    | { state: 'running'; createdAt?: number }
    | { state: 'settled'; result?: string; error?: string; createdAt?: number };

function clientToolJournalKey(jobId: string, callId: string): string {
    return `${CLIENT_TOOL_JOURNAL_PREFIX}${jobId}:${callId}`;
}

function clearClientToolJournalsForJob(jobId: string): void {
    if (typeof localStorage === 'undefined') return;
    const prefix = `${CLIENT_TOOL_JOURNAL_PREFIX}${jobId}:`;
    try {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) clearClientToolJournal(key);
        }
    } catch {
        // Storage access can be blocked while a session is closing.
    }
}

function pruneClientToolJournals(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith(CLIENT_TOOL_JOURNAL_PREFIX)) continue;
            const journal = readClientToolJournal(key);
            if (!journal || (journal.createdAt && Date.now() - journal.createdAt > CLIENT_TOOL_JOURNAL_TTL_MS)) {
                clearClientToolJournal(key);
            }
        }
    } catch {
        // Journals are also removed at settlement and logout.
    }
}

function clearClientToolRetriesForJob(jobId: string): void {
    for (const [key, timer] of clientToolRetryTimers) {
        if (!key.startsWith(`${jobId}:`)) continue;
        clearTimeout(timer);
        clientToolRetryTimers.delete(key);
        clientToolRetryAttempts.delete(key);
    }
    for (const key of clientToolRetryAttempts.keys()) {
        if (key.startsWith(`${jobId}:`)) clientToolRetryAttempts.delete(key);
    }
}

export function abortBackgroundClientToolDispatchesForWorkspace(workspaceId: string): void {
    for (const [key, active] of clientToolDispatches) {
        const jobId = key.slice(0, key.indexOf(':'));
        if (backgroundJobTrackers.get(jobId)?.workspaceId === workspaceId) {
            active.abortController.abort();
            clearClientToolRetriesForJob(jobId);
        }
    }
}

export function refreshPendingClientToolsForWorkspace(workspaceId: string): void {
    for (const tracker of backgroundJobTrackers.values()) {
        if (!tracker.active || tracker.workspaceId !== workspaceId) continue;
        void pollJobStatus(tracker.jobId).then(
            (status) => dispatchPendingClientTools(tracker, status),
            () => undefined
        );
    }
}

function readClientToolJournal(key: string): ClientToolJournal | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const value = localStorage.getItem(key);
        return value ? (JSON.parse(value) as ClientToolJournal) : null;
    } catch {
        return null;
    }
}

function writeClientToolJournal(
    key: string,
    value: ClientToolJournal
): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

function clearClientToolJournal(key: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(key);
    } catch {
        // A stale journal is safe: accepted server results are no longer claimable.
    }
}

async function executePendingClientTool(
    tracker: BackgroundJobTracker,
    callId: string,
    toolName: string
): Promise<void> {
    const dispatchKey = `${tracker.jobId}:${callId}`;
    if (clientToolDispatches.has(dispatchKey)) return;
    if (Date.now() - lastClientToolJournalPruneAt > 60 * 60 * 1000) {
        pruneClientToolJournals();
        lastClientToolJournalPruneAt = Date.now();
    }
    if ((getActiveWorkspaceId() ?? 'local') !== tracker.workspaceId) return;
    if (getCachedSessionContext()?.user?.id !== tracker.userId) return;
    // Portable tools register after their sandbox activates. Leave the server
    // call unclaimed until its exact browser handler exists so startup order
    // cannot turn a recoverable reconnect into a false tool failure.
    if (!useToolRegistry().getTool(toolName)) return;
    const abortController = new AbortController();
    const dispatch = (async () => {
        const claim = await claimBackgroundClientTool(tracker.jobId, callId);
        if (!claim) return;
        if (
            !tracker.active ||
            abortController.signal.aborted ||
            (getActiveWorkspaceId() ?? 'local') !== tracker.workspaceId ||
            getCachedSessionContext()?.user?.id !== tracker.userId ||
            claim.context.workspaceId !== tracker.workspaceId
        ) return;
        const journalKey = clientToolJournalKey(tracker.jobId, callId);
        let settled = readClientToolJournal(journalKey);
        if (settled?.state === 'running') {
            settled = {
                state: 'settled',
                error: 'The browser closed while this tool was running, so its outcome is unknown. Retry explicitly if needed.',
            };
            writeClientToolJournal(journalKey, { ...settled, createdAt: Date.now() });
        }
        if (!settled) {
            if (!writeClientToolJournal(journalKey, { state: 'running', createdAt: Date.now() })) {
                settled = {
                    state: 'settled',
                    error: 'The browser could not create a durable tool execution journal.',
                };
            } else {
                const registry = useToolRegistry();
                const execution = await registry.executeTool(
                    claim.call.name,
                    claim.call.arguments,
                    {
                        subject: tracker.userId || null,
                        workspaceId: claim.context.workspaceId,
                        threadId: claim.context.threadId,
                        messageId: claim.context.messageId,
                        callId: claim.call.id,
                        requestId: tracker.jobId,
                        abortSignal: abortController.signal,
                    },
                    { definition: claim.call.definition }
                );
                settled = {
                    state: 'settled',
                    result: execution.error ? undefined : execution.result ?? '',
                    error: execution.error,
                };
                writeClientToolJournal(journalKey, { ...settled, createdAt: Date.now() });
            }
        }
        if (
            !tracker.active ||
            abortController.signal.aborted ||
            (getActiveWorkspaceId() ?? 'local') !== tracker.workspaceId ||
            getCachedSessionContext()?.user?.id !== tracker.userId
        ) return;
        await submitBackgroundClientToolResult({
            jobId: tracker.jobId,
            callId,
            claimToken: claim.claimToken,
            result: settled.result,
            error: settled.error,
        });
        clearClientToolJournal(journalKey);
    })().finally(() => {
        clientToolDispatches.delete(dispatchKey);
    });
    clientToolDispatches.set(dispatchKey, { promise: dispatch, abortController });
    await dispatch;
}

function dispatchPendingClientTools(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): void {
    if (status.status !== 'streaming') {
        clearClientToolRetriesForJob(tracker.jobId);
        clearClientToolJournalsForJob(tracker.jobId);
        for (const [key, active] of clientToolDispatches) {
            if (key.startsWith(`${tracker.jobId}:`)) {
                active.abortController.abort();
            }
        }
        return;
    }
    for (const call of status.tool_calls ?? []) {
        if (call.id && call.runtime === 'client' && call.status === 'pending') {
            const dispatchKey = `${tracker.jobId}:${call.id}`;
            if (!clientToolRetryTimers.has(dispatchKey)) {
                const attempts = clientToolRetryAttempts.get(dispatchKey) ?? 0;
                clientToolRetryAttempts.set(dispatchKey, attempts + 1);
                const timer = setTimeout(() => {
                    clientToolRetryTimers.delete(dispatchKey);
                    if (!tracker.active || (getActiveWorkspaceId() ?? 'local') !== tracker.workspaceId) return;
                    void pollJobStatus(tracker.jobId).then(
                        (fresh) => dispatchPendingClientTools(tracker, fresh),
                        () => dispatchPendingClientTools(tracker, status)
                    );
                }, Math.min(30_000, 3_000 * 2 ** Math.min(attempts, 4)));
                clientToolRetryTimers.set(dispatchKey, timer);
            }
            void executePendingClientTool(tracker, call.id, call.name).catch((error) => {
                bgStreamWarn('client-tool-dispatch-failed', {
                    jobId: tracker.jobId,
                    callId: call.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        } else if (call.id && call.runtime === 'client') {
            const key = `${tracker.jobId}:${call.id}`;
            const timer = clientToolRetryTimers.get(key);
            if (timer) clearTimeout(timer);
            clientToolRetryTimers.delete(key);
            clientToolRetryAttempts.delete(key);
            clearClientToolJournal(clientToolJournalKey(tracker.jobId, call.id));
        }
    }
}

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

function bgStreamDebugEnabled(): boolean {
    if (import.meta.dev) return true;
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem('or3:debug:background-stream') === 'true';
    } catch {
        return false;
    }
}

function bgStreamLog(
    stage: string,
    details?: Record<string, unknown>
): void {
    if (!bgStreamDebugEnabled()) return;
    console.debug('[bg-stream]', stage, redactDiagnosticDetails(details));
}

function bgStreamWarn(
    stage: string,
    details?: Record<string, unknown>
): void {
    if (!bgStreamDebugEnabled()) return;
    console.warn('[bg-stream]', stage, redactDiagnosticDetails(details));
}

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
        'onUpdate' | 'onComplete' | 'onError' | 'onAbort' | 'onTransportError'
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
 * Internal helper. Derives safe reasoning and delta from a job status update.
 * Reasoning has its own offset so text and reasoning recovery stay independent.
 */
function deriveBackgroundReasoning(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): { safeReasoning: string; reasoningDelta: string; replace: boolean } {
    const current = tracker.lastReasoning ?? '';
    const replace =
        status.reasoning_reset === true ||
        (typeof tracker.lastAttempt === 'number' &&
            typeof status.attempt === 'number' &&
            status.attempt > tracker.lastAttempt);
    let nextReasoning = current;
    if (replace) {
        nextReasoning = status.reasoning_text ?? '';
    } else if (typeof status.reasoning_text === 'string') {
        nextReasoning = status.reasoning_text;
    } else if (typeof status.reasoning_delta === 'string') {
        nextReasoning = current + status.reasoning_delta;
    }
    if (
        typeof status.reasoning_length === 'number' &&
        Number.isFinite(status.reasoning_length) &&
        nextReasoning.length > status.reasoning_length
    ) {
        nextReasoning = nextReasoning.slice(0, status.reasoning_length);
    }
    const safeReasoning = replace
        ? nextReasoning
        : nextReasoning.length >= current.length
          ? nextReasoning
          : current;
    const reasoningDelta =
        !replace && safeReasoning.length > current.length
            ? safeReasoning.slice(current.length)
            : '';
    return { safeReasoning, reasoningDelta, replace };
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
    dispatchPendingClientTools(tracker, status);
    let nextStatus = status;
    if (nextStatus.status !== 'streaming') {
        nextStatus = await ensureFullBackgroundStatus(tracker, nextStatus);
    }
    if (
        nextStatus.workflow_state &&
        typeof nextStatus.workflow_state === 'object'
    ) {
        tracker.lastWorkflowState = nextStatus.workflow_state;
    } else if (nextStatus.status !== 'streaming' && tracker.lastWorkflowState) {
        nextStatus = {
            ...nextStatus,
            workflow_state: normalizeTerminalWorkflowState(
                tracker.lastWorkflowState,
                nextStatus.status,
                nextStatus.error
            ),
        };
    }
    const { safeContent, delta, replace } = deriveBackgroundContent(
        tracker,
        nextStatus
    );
    const {
        safeReasoning,
        reasoningDelta,
        replace: replaceReasoning,
    } = deriveBackgroundReasoning(tracker, nextStatus);
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
    tracker.lastReasoning = safeReasoning;

    const persistence = await persistBackgroundJobUpdate(
        tracker,
        nextStatus,
        safeContent,
        replace,
        safeReasoning,
        replaceReasoning
    ).catch((error) => {
        bgStreamWarn('status-persist-failed', {
            jobId: tracker.jobId,
            status: nextStatus.status,
            error: error instanceof Error ? error.message : String(error),
        });
        return { persisted: false as const, missing: false as const };
    });
    if (!persistence.persisted) {
        // Local projection failures must never cancel a valid server job. The
        // next status will retry persistence while subscribers keep receiving
        // live progress.
        bgStreamWarn('status-persist-failed-continue-tracking', {
            jobId: tracker.jobId,
            status: nextStatus.status,
        });
    }
    if (persistence.persisted && persistence.workflowState) {
        tracker.lastWorkflowState = persistence.workflowState;
        nextStatus = {
            ...nextStatus,
            workflow_state: persistence.workflowState,
        };
    }
    if (typeof nextStatus.attempt === 'number') {
        tracker.lastAttempt = nextStatus.attempt;
    }

    const update: BackgroundJobUpdate = {
        status: nextStatus,
        content: safeContent,
        delta,
        replace,
        reasoning: safeReasoning,
        reasoningDelta,
        reasoningReplace: replaceReasoning,
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
        tracker.terminalStatus = nextStatus;
        tracker.terminalContent = safeContent;
        tracker.terminalReplace = replace;
        if (!tracker.terminalNotified) {
            tracker.terminalNotified = true;
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
            if (
                nextStatus.status === 'complete' &&
                nextStatus.workflow_state &&
                typeof nextStatus.workflow_state === 'object'
            ) {
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
            // The generation indicator may stop immediately; local persistence
            // is allowed to retry independently below.
            tracker.resolveCompletion(nextStatus);
        }
        if (persistence.persisted) {
            bgStreamLog('status-terminal-cleanup', {
                jobId: tracker.jobId,
                status: nextStatus.status,
                contentLength: safeContent.length,
                subscribers: tracker.subscribers.size,
            });
            finalizeTrackerCleanup(tracker);
            return false;
        }
        if (persistence.missing) {
            // Deleted or superseded: never recreate the row.
            bgStreamWarn('status-terminal-persist-row-missing', {
                jobId: tracker.jobId,
                status: nextStatus.status,
            });
            finalizeTrackerCleanup(tracker);
            return false;
        }
        // Keep the final snapshot and retry the local write with capped
        // backoff instead of discarding a completed answer.
        bgStreamWarn('status-terminal-persist-retry-scheduled', {
            jobId: tracker.jobId,
            status: nextStatus.status,
        });
        scheduleTerminalPersistenceRetry(tracker);
        return false;
    }

    return true;
}

/**
 * Releases a tracker after its terminal state has been durably projected (or
 * the row no longer exists).
 */
function finalizeTrackerCleanup(tracker: BackgroundJobTracker): void {
    clearClientToolRetriesForJob(tracker.jobId);
    clearClientToolJournalsForJob(tracker.jobId);
    if (tracker.terminalPersistTimer) {
        clearTimeout(tracker.terminalPersistTimer);
        tracker.terminalPersistTimer = undefined;
    }
    tracker.active = false;
    tracker.polling = false;
    tracker.streaming = false;
    backgroundJobTrackers.delete(tracker.jobId);
    notifyBackgroundJobTrackerLifecycle({
        type: 'removed',
        tracker,
    });
}

/**
 * Retries the terminal snapshot when the first local write failed.
 */
async function retryTerminalPersistence(
    tracker: BackgroundJobTracker
): Promise<void> {
    const status = tracker.terminalStatus;
    if (!status || tracker.transportInterrupted) return;
    const content = tracker.terminalContent ?? tracker.lastContent;
    const persistence = await persistBackgroundJobUpdate(
        tracker,
        status,
        content,
        tracker.terminalReplace === true
    ).catch((error) => {
        bgStreamWarn('terminal-persist-retry-error', {
            jobId: tracker.jobId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { persisted: false as const, missing: false as const };
    });
    if (persistence.persisted) {
        bgStreamLog('terminal-persist-retry-succeeded', {
            jobId: tracker.jobId,
            status: status.status,
        });
        finalizeTrackerCleanup(tracker);
        return;
    }
    if (persistence.missing) {
        bgStreamWarn('terminal-persist-retry-row-missing', {
            jobId: tracker.jobId,
        });
        finalizeTrackerCleanup(tracker);
        return;
    }
    scheduleTerminalPersistenceRetry(tracker);
}

/**
 * Schedules one bounded-backoff retry of the terminal snapshot.
 */
function scheduleTerminalPersistenceRetry(tracker: BackgroundJobTracker): void {
    if (tracker.terminalPersistTimer) return;
    const attempt = (tracker.terminalPersistAttempts ?? 0) + 1;
    tracker.terminalPersistAttempts = attempt;
    const base = Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 6));
    const delay = Math.floor(base * (0.8 + Math.random() * 0.4));
    const timer = setTimeout(() => {
        tracker.terminalPersistTimer = undefined;
        void retryTerminalPersistence(tracker);
    }, delay);
    (timer as { unref?: () => void }).unref?.();
    tracker.terminalPersistTimer = timer;
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
 * Stops local tracking after a connection/protocol/auth failure without
 * fabricating an authoritative generation result. `interrupt` writes the
 * durable interrupted projection (job confirmed missing); otherwise the row
 * stays pending so reattachment can retry after recovery.
 */
async function interruptBackgroundTracking(
    tracker: BackgroundJobTracker,
    message: string,
    options: { interrupt: boolean; kind: 'missing' | 'auth' | 'protocol' }
): Promise<void> {
    if (tracker.transportInterrupted) return;
    clearClientToolRetriesForJob(tracker.jobId);
    tracker.transportInterrupted = true;
    tracker.active = false;
    tracker.pollRunId = (tracker.pollRunId ?? 0) + 1;
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
    bgStreamWarn('tracking-interrupted', {
        jobId: tracker.jobId,
        message,
        interrupt: options.interrupt,
    });
    if (options.interrupt) {
        tracker.status = 'error';
        await persistBackgroundTrackingInterruption(tracker, {
            interrupt: true,
        }).catch((error) => {
            bgStreamWarn('tracking-interruption-persist-failed', {
                jobId: tracker.jobId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
    const interruptedStatus: BackgroundJobStatus = {
        id: tracker.jobId,
        status: 'error',
        threadId: tracker.threadId,
        messageId: tracker.messageId,
        model: 'unknown',
        chunksReceived: 0,
        attempt: tracker.lastAttempt,
        startedAt: Date.now(),
        completedAt: Date.now(),
        error: message,
        content: tracker.lastContent,
        trackingInterrupted: true,
        trackingInterruptedKind: options.kind,
    };
    notifyBackgroundSubscribers(tracker, 'onTransportError', {
        status: interruptedStatus,
        content: tracker.lastContent,
        delta: '',
    });
    tracker.resolveCompletion(interruptedStatus);
    backgroundJobTrackers.delete(tracker.jobId);
    notifyBackgroundJobTrackerLifecycle({ type: 'removed', tracker });
}

/**
 * Internal helper. Main polling loop for background job status updates.
 */
async function pollBackgroundJob(tracker: BackgroundJobTracker): Promise<void> {
    if (tracker.polling) return;
    if (tracker.terminalStatus) return;
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
                // error.
                if (withinKindBound) {
                    await abortableDelay(
                        retryDelayMs(err, tracker.consecutivePollFailures),
                        pollAbortController.signal
                    );
                    continue;
                }
                // Bounded kind exhausted. A missing or unauthorized job is a
                // reconciliation problem, never an authoritative generation
                // failure. Confirmed-missing jobs get a durable interrupted
                // projection so Continue is offered; auth failures stay pending
                // for session recovery.
                await interruptBackgroundTracking(tracker, error, {
                    interrupt: err.kind === 'not_found',
                    kind: err.kind === 'not_found' ? 'missing' : 'auth',
                });
                return;
            }
            if (err instanceof BackgroundJobPollError && !err.retryable) {
                // Malformed protocol response: stop automatic reconnection
                // without rewriting the generation as failed.
                await interruptBackgroundTracking(tracker, error, {
                    interrupt: false,
                    kind: 'protocol',
                });
                return;
            }
            // Unknown failure shape: treat as transport and keep retrying with
            // capped backoff instead of minting a terminal error.
            tracker.consecutivePollFailures =
                (tracker.consecutivePollFailures ?? 0) + 1;
            await abortableDelay(
                retryDelayMs(
                    new BackgroundJobPollError(error, 'transport', true),
                    tracker.consecutivePollFailures
                ),
                pollAbortController.signal
            );
            continue;
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
    clearClientToolRetriesForJob(tracker.jobId);
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
    if (tracker.terminalStatus) {
        // A terminal snapshot awaiting local persistence must not restart a
        // transport; the persistence retry owns finalization.
        bgStreamLog('start-tracking-skipped-terminal-persist-pending', {
            jobId: tracker.jobId,
            requestedSse: Boolean(options?.useSse),
        });
        return;
    }
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
        // Each SSE connection gets a generation. Callbacks from an abandoned
        // connection must never mutate tracker state after a transport switch.
        const sseGeneration = (tracker.sseGeneration ?? 0) + 1;
        tracker.sseGeneration = sseGeneration;
        let closed = false;
        let chain: Promise<void> = Promise.resolve();
        tracker.streamChain = chain;
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

        const fallbackToPolling = () => {
            if (tracker.sseGeneration !== sseGeneration) return;
            // Drain already-accepted SSE updates before polling so an older
            // event cannot land after polling has advanced the offset.
            void chain.finally(() => {
                if (tracker.sseGeneration !== sseGeneration) return;
                if (tracker.streaming) return;
                if (tracker.active && !tracker.polling) {
                    void pollBackgroundJob(tracker);
                }
            });
        };

        try {
            unsubscribe = subscribeBackgroundJobStream({
                jobId: tracker.jobId,
                offset: tracker.lastContent.length,
                attempt: tracker.lastAttempt,
                onStatus: (status) => {
                    if (closed || tracker.sseGeneration !== sseGeneration) return;
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
                        .then(() => {
                            if (
                                closed ||
                                tracker.sseGeneration !== sseGeneration
                            ) {
                                return;
                            }
                            return handleBackgroundStatus(tracker, status).then(
                                (shouldContinue) => {
                                    if (!shouldContinue) {
                                        closeStream();
                                    }
                                }
                            );
                        })
                        .catch(() => {
                            if (
                                closed ||
                                tracker.sseGeneration !== sseGeneration
                            ) {
                                return;
                            }
                            // Fallback to polling on handler error
                            bgStreamWarn('sse-handler-error-fallback-poll', {
                                jobId: tracker.jobId,
                            });
                            closeStream();
                            fallbackToPolling();
                        });
                    tracker.streamChain = chain;
                },
                onError: (error) => {
                    if (closed || tracker.sseGeneration !== sseGeneration) return;
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
                    fallbackToPolling();
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
        if (
            (existing.threadId && existing.threadId !== params.threadId) ||
            (existing.messageId && existing.messageId !== params.messageId)
        ) {
            // A job's ownership must never be silently reassigned. Reusing the
            // tracker for a different thread/message would bind persistence and
            // Stop controls to the wrong conversation.
            bgStreamWarn('tracker-reuse-ownership-conflict', {
                jobId: params.jobId,
                existingThreadId: existing.threadId,
                incomingThreadId: params.threadId,
                existingMessageId: existing.messageId,
                incomingMessageId: params.messageId,
            });
            return existing;
        }
        if (!existing.threadId) existing.threadId = params.threadId;
        if (!existing.messageId) existing.messageId = params.messageId;
        if (params.originDb && !existing.originDb) {
            existing.originDb = params.originDb;
            existing.originDbName = params.originDb.name;
        }
        if (params.workspaceId && !existing.workspaceId) {
            existing.workspaceId = params.workspaceId;
        }
        if (params.canonicalHistory) existing.canonicalHistory = true;
        if (params.generationId && !existing.generationId) {
            existing.generationId = params.generationId;
        }
        if (
            !isStaleAttempt &&
            typeof params.initialContent === 'string' &&
            (isNewerAttempt ||
                params.initialContent.length > existing.lastContent.length)
        ) {
            existing.lastContent = params.initialContent;
            existing.lastPersistedLength = params.initialContent.length;
        }
        if (typeof existing.lastReasoning !== 'string') {
            existing.lastReasoning = '';
        }
        if (typeof existing.lastPersistedReasoningLength !== 'number') {
            existing.lastPersistedReasoningLength =
                existing.lastReasoning.length;
        }
        if (
            !isStaleAttempt &&
            typeof params.initialReasoning === 'string' &&
            (isNewerAttempt ||
                params.initialReasoning.length > existing.lastReasoning.length)
        ) {
            existing.lastReasoning = params.initialReasoning;
            existing.lastPersistedReasoningLength =
                params.initialReasoning.length;
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
    const seedReasoning =
        typeof params.initialReasoning === 'string'
            ? params.initialReasoning
            : '';
    // The originating workspace database must be captured at admission, not
    const originDb = params.originDb ?? getDb();
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
        lastReasoning: seedReasoning,
        lastAttempt: params.initialAttempt,
        lastPersistedLength: seedContent.length,
        lastPersistedReasoningLength: seedReasoning.length,
        lastPersistAt: 0,
        polling: false,
        streaming: false,
        active: false,
        preferSse: Boolean(params.useSse),
        pollRunId: 0,
        originDb,
        originDbName: originDb.name,
        workspaceId: params.workspaceId,
        canonicalHistory: params.canonicalHistory,
        generationId: params.generationId,
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
            const closingGeneration = tracker.sseGeneration;
            const drainChain = tracker.streamChain ?? Promise.resolve();
            try {
                tracker.streamUnsubscribe();
            } catch {
                /* intentionally empty */
            }
            // Drain already-accepted SSE updates before the polling path starts
            // so both transports cannot process overlapping deltas.
            void drainChain.finally(() => {
                if (!tracker.active || tracker.streaming) return;
                if (tracker.sseGeneration !== closingGeneration) return;
                if (!tracker.polling && tracker.status === 'streaming') {
                    bgStreamLog('subscriber-none-start-poll-after-drain', {
                        jobId: tracker.jobId,
                    });
                    void pollBackgroundJob(tracker);
                }
            });
            return;
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
