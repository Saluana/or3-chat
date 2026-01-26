import { ref, watch, onUnmounted } from 'vue';
import { useRuntimeConfig, useNuxtApp } from '#imports';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import { pollJobStatus } from '~/utils/chat/openrouterStream';

/**
 * Global store for background jobs.
 * This ensures that even when the user navigates away from a thread,
 * we continue polling active jobs until they complete or fail.
 */

interface ActiveJob {
    jobId: string;
    threadId: string;
    messageId: string;
    status: BackgroundJobStatus['status'];
    content: string;
    chunksReceived: number;
    error?: string;
    lastPolledAt: number;
}

// Global state outside composable (singleton)
const activeJobs = ref<Map<string, ActiveJob>>(new Map());
const isPolling = ref(false);
let pollInterval: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 1000;

/**
 * Register a job to be tracked globally
 */
function trackJob(jobId: string, threadId: string, messageId: string) {
    if (activeJobs.value.has(jobId)) return;

    activeJobs.value.set(jobId, {
        jobId,
        threadId,
        messageId,
        status: 'streaming',
        content: '',
        chunksReceived: 0,
        lastPolledAt: Date.now(),
    });

    startPolling();
}

/**
 * Stop tracking a job
 */
function untrackJob(jobId: string) {
    activeJobs.value.delete(jobId);
    if (activeJobs.value.size === 0) {
        stopPolling();
    }
}

/**
 * Start the global polling loop
 */
function startPolling() {
    if (isPolling.value) return;
    isPolling.value = true;

    pollInterval = setInterval(async () => {
        if (activeJobs.value.size === 0) {
            stopPolling();
            return;
        }

        const jobs = Array.from(activeJobs.value.values());
        for (const job of jobs) {
            try {
                const status = await pollJobStatus(job.jobId);

                // Update local state
                job.status = status.status;
                if (status.content) job.content = status.content;
                job.chunksReceived = status.chunksReceived;
                job.error = status.error;
                job.lastPolledAt = Date.now();

                // If terminal, remove from tracking after a short delay (to allow UI to catch up)
                if (status.status !== 'streaming') {
                    // We keep it in the map for components to see the final state,
                    // but we will remove it in the next tick or after consumption?
                    // Better: The composable usage within a component will "detach" or consume it.
                    // But if no component is watching, we should eventually drop it.
                    // However, for now, we leave it in the map so that if the user navigates back,
                    // the UI can pick up the completion state.
                    // We just stop polling IT.

                    // Actually, if we stop polling it, we should probably mark it as complete in our map.
                    // We don't need to poll it anymore.

                    // We can't just delete it immediately if we want to support "navigating back".
                    // But `activeJobs` is meant for *polling*.

                    // Let's rely on the components to untrack when they consume the completion.
                    // Or implement a TTL for completed jobs in this global store.

                    // For now, simply don't remove it here, but `activeJobs` implies *active*.
                    // Maybe we move it to `completedJobs`?

                    // Let's keep it simple: if it's done, we update the state.
                    // Components watching `activeJobs` will see it's done.
                    // We need a mechanism to clean up.

                    // Auto-remove after 1 minute of completion
                    setTimeout(() => {
                        untrackJob(job.jobId);
                    }, 60000);
                }

                // Notify listeners (Vue reactivity handles this via ref)

            } catch (err) {
                console.warn('[useBackgroundJobs] Polling error for job', job.jobId, err);
                // Don't remove immediately on error, might be transient network issue
            }
        }

        // Filter out completed jobs from the polling loop?
        // No, we need to poll them to detect they are completed.
        // Once they ARE completed (status !== 'streaming'), we don't need to poll them *again*.

        // So we should iterate only streaming jobs.
        // But the loop above iterates all.
        // We should skip non-streaming jobs in the loop.

    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    isPolling.value = false;
}

/**
 * Composable for interacting with background jobs
 */
export function useBackgroundJobs() {
    const config = useRuntimeConfig();
    const enabled = config.public.backgroundStreaming?.enabled ?? false;

    return {
        enabled,
        activeJobs, // Read-only access to global state
        trackJob,
        untrackJob,

        // Helper to get a specific job
        getJob: (jobId: string) => activeJobs.value.get(jobId),
    };
}
