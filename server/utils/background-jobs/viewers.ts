/**
 * @module server/utils/background-jobs/viewers
 *
 * Purpose:
 * Track live viewers and broadcast updates for background jobs.
 * This supports suppressing server notifications while a client is
 * actively attached to a job stream.
 *
 * Responsibilities:
 * - Track viewer counts per job ID.
 * - Maintain in-memory live job state for streaming updates.
 * - Provide listener registration and cleanup.
 *
 * Non-Goals:
 * - Cross-instance coordination or persistence.
 * - Authorization for viewers.
 *
 * Constraints:
 * - Process-local only. Multi-instance deployments need an external channel.
 */

import type { BackgroundJob } from './types';

function logBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

const jobViewers = new Map<string, number>();
const LIVE_JOB_RETENTION_MS = 30_000;

type LiveJobState = {
    content: string;
    status: BackgroundJob['status'];
    chunksReceived: number;
    completedAt?: number;
    error?: string;
    tool_calls?: BackgroundJob['tool_calls'];
    workflow_state?: BackgroundJob['workflow_state'];
    attempt?: number;
    cleanupTimer?: ReturnType<typeof setTimeout> | null;
    listeners: Set<(event: LiveJobEvent) => void>;
};

type LiveJobEvent =
    | {
          type: 'delta';
          content_delta: string;
          content_length: number;
          chunksReceived: number;
          tool_calls?: BackgroundJob['tool_calls'];
          workflow_state?: BackgroundJob['workflow_state'];
          attempt?: number;
      }
    | {
          type: 'status';
          status: BackgroundJob['status'];
          content: string;
          content_length: number;
          chunksReceived: number;
          completedAt?: number;
          error?: string;
          tool_calls?: BackgroundJob['tool_calls'];
          workflow_state?: BackgroundJob['workflow_state'];
          attempt?: number;
          content_reset?: boolean;
      };

const jobStreams = new Map<string, LiveJobState>();
const JOB_RECONCILE_LIVE_MS = 1_000;
const JOB_RECONCILE_FALLBACK_MS = 300;

type JobReconciler = {
    poll: () => Promise<BackgroundJob | null>;
    listeners: Set<(job: BackgroundJob | null, error?: Error) => void>;
    timer: ReturnType<typeof setTimeout> | null;
    running: boolean;
};

const jobReconcilers = new Map<string, JobReconciler>();

/** One adaptive provider poller per job, shared by every SSE viewer. */
export function registerJobReconciler(
    jobId: string,
    poll: () => Promise<BackgroundJob | null>,
    listener: (job: BackgroundJob | null, error?: Error) => void
): () => void {
    let reconciler = jobReconcilers.get(jobId);
    if (!reconciler) {
        reconciler = { poll, listeners: new Set(), timer: null, running: false };
        jobReconcilers.set(jobId, reconciler);
    }
    reconciler.listeners.add(listener);

    const run = async () => {
        const current = jobReconcilers.get(jobId);
        if (!current || current.running || current.listeners.size === 0) return;
        current.running = true;
        let terminal = false;
        try {
            const job = await current.poll();
            terminal = job !== null && job.status !== 'streaming';
            for (const subscriber of [...current.listeners]) {
                try { subscriber(job); } catch { /* isolate viewers */ }
            }
        } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            for (const subscriber of [...current.listeners]) {
                try { subscriber(null, failure); } catch { /* isolate viewers */ }
            }
        } finally {
            current.running = false;
        }
        if (jobReconcilers.get(jobId) !== current) return;
        if (terminal || current.listeners.size === 0) {
            jobReconcilers.delete(jobId);
            return;
        }
        const live = getJobLiveState(jobId);
        const delay = live?.status === 'streaming'
            ? JOB_RECONCILE_LIVE_MS
            : JOB_RECONCILE_FALLBACK_MS;
        current.timer = setTimeout(() => void run(), delay);
        if (typeof current.timer.unref === 'function') current.timer.unref();
    };

    if (!reconciler.running && !reconciler.timer) void run();
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        const current = jobReconcilers.get(jobId);
        if (!current) return;
        current.listeners.delete(listener);
        if (current.listeners.size === 0) {
            if (current.timer) clearTimeout(current.timer);
            jobReconcilers.delete(jobId);
        }
    };
}

export function getJobReconcilerCount(): number {
    return jobReconcilers.size;
}

/** Test isolation for process-local viewer state. */
export function resetJobViewersForTests(): void {
    for (const reconciler of jobReconcilers.values()) {
        if (reconciler.timer) clearTimeout(reconciler.timer);
    }
    for (const state of jobStreams.values()) {
        if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
    }
    jobReconcilers.clear();
    jobStreams.clear();
    jobViewers.clear();
}

/**
 * Purpose:
 * Register a viewer for a job and return a disposer.
 *
 * Behavior:
 * - Increments the viewer count for the job.
 * - The returned function decrements the count once.
 */
export function registerJobViewer(jobId: string): () => void {
    const nextCount = (jobViewers.get(jobId) ?? 0) + 1;
    jobViewers.set(jobId, nextCount);
    logBgStream('viewers-register', {
        jobId,
        viewers: nextCount,
    });

    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        const current = jobViewers.get(jobId) ?? 0;
        const remaining = current - 1;
        if (remaining > 0) {
            jobViewers.set(jobId, remaining);
        } else {
            jobViewers.delete(jobId);
        }
        logBgStream('viewers-unregister', {
            jobId,
            viewers: Math.max(remaining, 0),
        });
    };
}

/**
 * Purpose:
 * Determine whether a job currently has active viewers.
 */
export function hasJobViewers(jobId: string): boolean {
    return (jobViewers.get(jobId) ?? 0) > 0;
}

/**
 * Purpose:
 * Get the current live state for a job, if present.
 *
 * Constraints:
 * - Returns `null` when no live state exists.
 */
export function getJobLiveState(jobId: string): LiveJobState | null {
    return jobStreams.get(jobId) ?? null;
}

/**
 * Purpose:
 * Register a listener for live job events.
 *
 * Behavior:
 * - Ensures live state exists for the job.
 * - Returns a disposer that removes the listener.
 */
export function registerJobStream(
    jobId: string,
    listener: (event: LiveJobEvent) => void
): () => void {
    const state = ensureJobLiveState(jobId);
    state.listeners.add(listener);
    logBgStream('viewers-stream-listener-add', {
        jobId,
        listeners: state.listeners.size,
        status: state.status,
        contentLength: state.content.length,
    });

    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        state.listeners.delete(listener);
        logBgStream('viewers-stream-listener-remove', {
            jobId,
            listeners: state.listeners.size,
            status: state.status,
            contentLength: state.content.length,
        });
        maybeCleanupJobLiveState(jobId, state);
    };
}

/**
 * Purpose:
 * Ensure a live job state exists and cancel pending cleanup.
 */
export function initJobLiveState(jobId: string): void {
    const state = ensureJobLiveState(jobId);
    if (state.cleanupTimer) {
        clearTimeout(state.cleanupTimer);
        state.cleanupTimer = null;
    }
    logBgStream('viewers-live-state-init', {
        jobId,
        listeners: state.listeners.size,
        status: state.status,
        contentLength: state.content.length,
    });
}

/**
 * Purpose:
 * Emit a streaming delta to all listeners and update live state.
 */
export function emitJobDelta(
    jobId: string,
    delta: string,
    meta: {
        contentLength: number;
        chunksReceived: number;
        tool_calls?: BackgroundJob['tool_calls'];
        workflow_state?: BackgroundJob['workflow_state'];
        attempt?: number;
    }
): void {
    if (!delta) return;
    const state = ensureJobLiveState(jobId);
    state.content += delta;
    state.chunksReceived = meta.chunksReceived;
    state.status = 'streaming';
    if (meta.tool_calls !== undefined) {
        state.tool_calls = meta.tool_calls;
    }
    if (meta.workflow_state !== undefined) {
        state.workflow_state = meta.workflow_state;
    }
    if (meta.attempt !== undefined) state.attempt = meta.attempt;
    const event: LiveJobEvent = {
        type: 'delta',
        content_delta: delta,
        content_length: meta.contentLength,
        chunksReceived: meta.chunksReceived,
        tool_calls: meta.tool_calls,
        workflow_state: meta.workflow_state,
        attempt: meta.attempt ?? state.attempt,
    };
    for (const listener of state.listeners) {
        listener(event);
    }
}

/**
 * Purpose:
 * Emit a status update and schedule cleanup for completed jobs.
 */
export function emitJobStatus(
    jobId: string,
    status: BackgroundJob['status'],
    meta: {
        content: string;
        contentLength: number;
        chunksReceived: number;
        completedAt?: number;
        error?: string;
        tool_calls?: BackgroundJob['tool_calls'];
        workflow_state?: BackgroundJob['workflow_state'];
        attempt?: number;
        content_reset?: boolean;
    }
): void {
    const state = ensureJobLiveState(jobId);
    state.content = meta.content;
    state.status = status;
    state.chunksReceived = meta.chunksReceived;
    state.completedAt = meta.completedAt;
    state.error = meta.error;
    state.tool_calls = meta.tool_calls;
    state.workflow_state = meta.workflow_state;
    if (meta.attempt !== undefined) state.attempt = meta.attempt;
    const event: LiveJobEvent = {
        type: 'status',
        status,
        content: meta.content,
        content_length: meta.contentLength,
        chunksReceived: meta.chunksReceived,
        completedAt: meta.completedAt,
        error: meta.error,
        tool_calls: meta.tool_calls,
        workflow_state: meta.workflow_state,
        attempt: meta.attempt ?? state.attempt,
        content_reset: meta.content_reset,
    };
    logBgStream('viewers-emit-status', {
        jobId,
        status,
        contentLength: meta.contentLength,
        chunksReceived: meta.chunksReceived,
        listeners: state.listeners.size,
        hasError: Boolean(meta.error),
    });
    for (const listener of state.listeners) {
        listener(event);
    }
    if (status !== 'streaming') {
        scheduleCleanup(jobId, state);
    }
}

function ensureJobLiveState(jobId: string): LiveJobState {
    let state = jobStreams.get(jobId);
    if (!state) {
        state = {
            content: '',
            status: 'streaming',
            chunksReceived: 0,
            listeners: new Set(),
            cleanupTimer: null,
        };
        jobStreams.set(jobId, state);
        logBgStream('viewers-live-state-created', {
            jobId,
        });
    }
    return state;
}

function scheduleCleanup(jobId: string, state: LiveJobState): void {
    if (state.cleanupTimer) return;
    state.cleanupTimer = setTimeout(() => {
        jobStreams.delete(jobId);
        logBgStream('viewers-live-state-cleanup-run', {
            jobId,
        });
    }, LIVE_JOB_RETENTION_MS);
    logBgStream('viewers-live-state-cleanup-scheduled', {
        jobId,
        retentionMs: LIVE_JOB_RETENTION_MS,
        listeners: state.listeners.size,
        status: state.status,
    });
    if (typeof state.cleanupTimer.unref === 'function') {
        state.cleanupTimer.unref();
    }
}

function maybeCleanupJobLiveState(jobId: string, state: LiveJobState): void {
    if (state.listeners.size > 0) return;
    if (state.status === 'streaming') return;
    scheduleCleanup(jobId, state);
}
