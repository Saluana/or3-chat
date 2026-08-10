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
 * POST /api/jobs/:id/abort
 *
 * Purpose:
 * Stop a background generation.
 *
 * Behavior:
 * - Identifies user.
 * - Tells the Job Provider to signal abortion.
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
        return { aborted: false, message: 'Job not found or already complete' };
    }
    const workflowState = stoppedWorkflowState(job.workflow_state);
    if (workflowState !== job.workflow_state) {
        await provider.updateJob(jobId, { workflow_state: workflowState });
    }
    const aborted = await provider.abortJob(jobId, userId);

    if (!aborted) {
        // Could be: job not found, not authorized, or already complete
        return { aborted: false, message: 'Job not found or already complete' };
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
        status: 'aborted',
        workflow_state: workflowState
    };
});
