/**
 * @module server/api/jobs/[id]/abort.post
 *
 * Purpose:
 * Cancels a running background streaming job.
 */
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { emitJobStatus } from '../../../utils/background-jobs/viewers';
import { logBackgroundEvent } from '../../../utils/background-jobs/logging';
import type { BackgroundJob } from '../../../utils/background-jobs/types';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';

function stoppedWorkflowState(state: WorkflowMessageData | undefined): WorkflowMessageData | undefined {
    if (!state || (state.executionState !== 'running' && state.executionState !== 'idle')) {
        return state;
    }
    return {
        ...state,
        executionState: 'stopped',
        currentNodeId: null,
        failedNodeId: state.failedNodeId ?? state.currentNodeId ?? state.lastActiveNodeId ?? null,
        result: {
            ...state.result,
            success: false,
            duration: state.result?.duration ?? 0,
            error: 'Workflow stopped by user'
        },
        version: (state.version ?? 0) + 1
    };
}

/**
 * Machine-readable cancellation outcome. The UI must never report
 * "cancelled" unless the provider confirmed the stop: `aborted` is the only
 * state that means the remote execution is known-stopped. Every other state
 * records the uncertainty explicitly instead of silently implying success.
 */
export type AbortOutcomeState =
    /** Provider confirmed the upstream execution stopped. */
    | 'aborted'
    /** No such job for this user (or it already aged out of retention). */
    | 'not_found'
    /** Job already reached a terminal state before the stop arrived. */
    | 'already_terminal'
    /** Provider refused to abort a streaming job; remote work may continue. */
    | 'abort_rejected'
    /** Provider threw while stopping; remote state is unknown. */
    | 'abort_error';

export function resolveAbortOutcome(
    job: Pick<BackgroundJob, 'status'> | null,
    providerResult: 'aborted' | 'rejected' | 'threw'
): { state: AbortOutcomeState; httpStatus: number } {
    if (!job) return { state: 'not_found', httpStatus: 200 };
    if (job.status !== 'streaming') {
        return { state: 'already_terminal', httpStatus: 200 };
    }
    if (providerResult === 'threw') return { state: 'abort_error', httpStatus: 500 };
    if (providerResult === 'rejected') {
        return { state: 'abort_rejected', httpStatus: 502 };
    }
    return { state: 'aborted', httpStatus: 200 };
}

/**
 * POST /api/jobs/:id/abort
 *
 * Purpose:
 * Stop a background generation.
 *
 * Behavior:
 * - Identifies user.
 * - Tells the Job Provider to signal abortion.
 * - Reports `aborted: true` only when the provider confirms the stop.
 *
 * Security:
 * - Only the job owner can abort their job.
 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, 'id');

    if (!jobId) {
        setResponseStatus(event, 400);
        return { error: 'Missing job ID', aborted: false };
    }

    // Resolve user ID for authorization
    let userId: string | null = null;
    if (isSsrAuthEnabled(event)) {
        const session = await resolveSessionContext(event);
        if (session.authenticated && session.user?.id) {
            userId = session.user.id;
        }
    }

    if (!userId) {
        setResponseStatus(event, 401);
        return { error: 'Authentication required', aborted: false };
    }

    const provider = await getJobProvider();
    const job = await provider.getJob(jobId, userId);
    if (!job) {
        const outcome = resolveAbortOutcome(null, 'rejected');
        return {
            aborted: false,
            state: outcome.state,
            message: 'Job not found or already complete',
        };
    }
    const workflowState = stoppedWorkflowState(job.workflow_state);
    if (workflowState !== job.workflow_state) {
        await provider.updateJob(jobId, { workflow_state: workflowState });
    }

    let providerResult: 'aborted' | 'rejected' | 'threw' = 'rejected';
    try {
        providerResult = (await provider.abortJob(jobId, userId))
            ? 'aborted'
            : 'rejected';
    } catch (error) {
        providerResult = 'threw';
        logBackgroundEvent('error', 'background.job.abort-error', {
            jobId,
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const outcome = resolveAbortOutcome(job, providerResult);
    if (outcome.state !== 'aborted') {
        setResponseStatus(event, outcome.httpStatus);
        return {
            aborted: false,
            state: outcome.state,
            message:
                outcome.state === 'already_terminal'
                    ? 'Job not found or already complete'
                    : outcome.state === 'abort_rejected'
                      ? 'Provider refused to abort the streaming job; remote work may still be running'
                      : 'Failed to stop the job; remote state is unknown',
        };
    }

    emitJobStatus(jobId, 'aborted', {
        content: job.content,
        contentLength: job.content.length,
        chunksReceived: job.chunksReceived,
        completedAt: Date.now(),
        workflow_state: workflowState
    });

    return {
        aborted: true,
        state: outcome.state,
        status: 'aborted',
        workflow_state: workflowState
    };
});
