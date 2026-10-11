/**
 * @module server/api/jobs/[id]/abort.post
 *
 * Purpose:
 * Cancels a running background streaming job.
 */
import { requireCloudMutation } from '../../../utils/security/cloud-mutation';
import { requireJobWorkspaceAccess } from '../../../utils/background-jobs/access';
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { emitJobStatus } from '../../../utils/background-jobs/viewers';
import { logBackgroundEvent } from '../../../utils/background-jobs/logging';
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
    setHeader(event, 'Cache-Control', 'no-store, private');
    requireCloudMutation(event);
    const jobId = getRouterParam(event, 'id');

    if (!jobId) {
        setResponseStatus(event, 400);
        return { error: 'Missing job ID', aborted: false };
    }

    // Resolve user ID for authorization
    let userId: string | null = null;
    let session: Awaited<ReturnType<typeof resolveSessionContext>> | null = null;
    if (isSsrAuthEnabled(event)) {
        session = await resolveSessionContext(event);
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
        return { aborted: false, state: 'not_found', message: 'Job not found or already complete' };
    }
    await requireJobWorkspaceAccess(event, session, job.execution?.workspaceId, 'workspace.write');
    if (job.status !== 'streaming') {
        return { aborted: false, state: 'already_terminal', status: job.status };
    }
    let aborted: boolean;
    try {
        aborted = await provider.abortJob(jobId, userId);
    } catch (error) {
        logBackgroundEvent('error', 'background.job.abort-error', { jobId, userId,
            error: error instanceof Error ? error.message : String(error) });
        setResponseStatus(event, 500);
        return { aborted: false, state: 'abort_error', message: 'Failed to stop the job; remote state is unknown' };
    }

    if (!aborted) {
        // A job may have finished between the initial read and the stop.
        const current = await provider.getJob(jobId, userId);
        if (!current) return { aborted: false, state: 'not_found' };
        if (current.status !== 'streaming') return { aborted: false, state: 'already_terminal', status: current.status };
        setResponseStatus(event, 502);
        return { aborted: false, state: 'abort_rejected', message: 'Provider refused to stop the job; remote work may still be running' };
    }

    const workflowState = stoppedWorkflowState(job.workflow_state);
    emitJobStatus(jobId, 'aborted', {
        content: job.content,
        contentLength: job.content.length,
        chunksReceived: job.chunksReceived,
        completedAt: Date.now(),
        workflow_state: workflowState
    });

    return {
        aborted: true,
        state: 'aborted',
        status: 'aborted',
        workflow_state: workflowState
    };
});
