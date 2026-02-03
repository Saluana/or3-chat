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

const jobViewers = new Map<string, number>();
const LIVE_JOB_RETENTION_MS = 30_000;

type LiveJobState = {
    content: string;
    status: BackgroundJob['status'];
    chunksReceived: number;
    completedAt?: number;
    error?: string;
    cleanupTimer?: ReturnType<typeof setTimeout> | null;
    listeners: Set<(event: LiveJobEvent) => void>;
};

type LiveJobEvent =
    | {
          type: 'delta';
          content_delta: string;
          content_length: number;
          chunksReceived: number;
      }
    | {
          type: 'status';
          status: BackgroundJob['status'];
          content: string;
          content_length: number;
          chunksReceived: number;
          completedAt?: number;
          error?: string;
      };

const jobStreams = new Map<string, LiveJobState>();

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

    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        state.listeners.delete(listener);
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
}

/**
 * Purpose:
 * Emit a streaming delta to all listeners and update live state.
 */
export function emitJobDelta(
    jobId: string,
    delta: string,
    meta: { contentLength: number; chunksReceived: number }
): void {
    if (!delta) return;
    const state = ensureJobLiveState(jobId);
    state.content += delta;
    state.chunksReceived = meta.chunksReceived;
    state.status = 'streaming';
    const event: LiveJobEvent = {
        type: 'delta',
        content_delta: delta,
        content_length: meta.contentLength,
        chunksReceived: meta.chunksReceived,
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
    }
): void {
    const state = ensureJobLiveState(jobId);
    state.content = meta.content;
    state.status = status;
    state.chunksReceived = meta.chunksReceived;
    state.completedAt = meta.completedAt;
    state.error = meta.error;
    const event: LiveJobEvent = {
        type: 'status',
        status,
        content: meta.content,
        content_length: meta.contentLength,
        chunksReceived: meta.chunksReceived,
        completedAt: meta.completedAt,
        error: meta.error,
    };
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
    }
    return state;
}

function scheduleCleanup(jobId: string, state: LiveJobState): void {
    if (state.cleanupTimer) return;
    state.cleanupTimer = setTimeout(() => {
        jobStreams.delete(jobId);
    }, LIVE_JOB_RETENTION_MS);
    if (typeof state.cleanupTimer.unref === 'function') {
        state.cleanupTimer.unref();
    }
}

function maybeCleanupJobLiveState(jobId: string, state: LiveJobState): void {
    if (state.listeners.size > 0) return;
    if (state.status === 'streaming') return;
    scheduleCleanup(jobId, state);
}
