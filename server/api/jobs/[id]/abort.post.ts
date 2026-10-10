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
import type { BackgroundJob } from '../../../utils/background-jobs/types';
import { projectBackgroundWorkflowState } from '~~/shared/chat/background-workflow-state';

/**
 * Machine-readable cancellation outcome. The UI must never report
 * "cancelled" unless the provider confirmed its cancellation transaction.
 * This does not prove that every upstream service acknowledged the stop or
 * that an already-dispatched tool side effect was rolled back.
 */
export type AbortOutcomeState =
    /** Provider committed cancellation of the job. */
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
    if (providerResult === 'aborted') return { state: 'aborted', httpStatus: 200 };
    if (!job) return { state: 'not_found', httpStatus: 200 };
    if (job.status !== 'streaming') {
        return { state: 'already_terminal', httpStatus: 200 };
    }
    if (providerResult === 'threw') return { state: 'abort_error', httpStatus: 500 };
    return { state: 'abort_rejected', httpStatus: 502 };
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
        const outcome = resolveAbortOutcome(null, 'rejected');
        return {
            aborted: false,
            state: outcome.state,
            message: 'Job not found or already complete',
        };
    }
    await requireJobWorkspaceAccess(event, session, job.execution?.workspaceId, 'workspace.write');

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

    // Completion may win between the initial read and the stop transaction.
    const latest = providerResult === 'aborted' ? job : await provider.getJob(jobId, userId).catch(() => job);
    const outcome = resolveAbortOutcome(latest, providerResult);
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

    const workflowState = projectBackgroundWorkflowState('aborted', job.workflow_state);
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
