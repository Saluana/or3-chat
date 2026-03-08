/**
 * @module server/api/jobs/[id]/status.get
 *
 * Purpose:
 * Polls the current state and content of a background job.
 */
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { getJobLiveState } from '../../../utils/background-jobs/viewers';

function logBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

/**
 * GET /api/jobs/:id/status
 *
 * Purpose:
 * Retrieve job progress suitable for polling clients.
 *
 * Behavior:
 * - Checks auth/ownership.
 * - Supports `offset` parameter to retrieve only new content (delta).
 *
 * Use Case:
 * - Client reconnection.
 * - Legacy polling fallback if SSE fails.
 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, 'id');

    if (!jobId) {
        logBgStream('jobs-status-missing-job-id', {});
        setResponseStatus(event, 400);
        return { error: 'Missing job ID' };
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
        logBgStream('jobs-status-auth-required', {
            jobId,
        });
        setResponseStatus(event, 401);
        return { error: 'Authentication required' };
    }

    const provider = await getJobProvider();
    const job = await provider.getJob(jobId, userId);

    if (!job) {
        logBgStream('jobs-status-job-not-found', {
            jobId,
            userId,
        });
        setResponseStatus(event, 404);
        return { error: 'Job not found or unauthorized' };
    }

    const query = getQuery(event);
    const offsetParam = typeof query.offset === 'string' ? query.offset : null;
    const offset = offsetParam ? Number(offsetParam) : null;
    const liveState = getJobLiveState(jobId);
    const effectiveContent =
        liveState && liveState.content.length > job.content.length
            ? liveState.content
            : job.content;
    const effectiveChunks =
        liveState && liveState.chunksReceived > job.chunksReceived
            ? liveState.chunksReceived
            : job.chunksReceived;
    const effectiveToolCalls =
        liveState?.tool_calls !== undefined
            ? liveState.tool_calls
            : job.tool_calls;
    const effectiveWorkflowState =
        liveState?.workflow_state !== undefined
            ? liveState.workflow_state
            : job.workflow_state;
    const effectiveError =
        typeof liveState?.error === 'string' ? liveState.error : job.error;
    const effectiveCompletedAt =
        liveState?.completedAt !== undefined
            ? liveState.completedAt
            : job.completedAt;
    const effectiveStatus =
        liveState && liveState.status !== 'streaming'
            ? liveState.status
            : job.status;
    const shouldLogStatusRequest =
        effectiveStatus !== 'streaming' ||
        offset === null ||
        !Number.isFinite(offset);
    if (shouldLogStatusRequest) {
        logBgStream('jobs-status-request', {
            jobId,
            userId,
            requestedOffset: offset,
            jobStatus: job.status,
            effectiveStatus,
            jobContentLength: job.content.length,
            liveStatePresent: Boolean(liveState),
            liveContentLength: liveState?.content.length ?? 0,
        });
    }

    if (
        typeof offset === 'number' &&
        Number.isFinite(offset) &&
        offset >= 0 &&
        typeof effectiveContent === 'string'
    ) {
        const contentLength = effectiveContent.length;
        const safeOffset = Math.min(offset, contentLength);
        const contentDelta = effectiveContent.slice(safeOffset);
        const shouldLogDeltaResponse =
            effectiveStatus !== 'streaming' ||
            contentDelta.length >= 256 ||
            safeOffset < offset;
        if (shouldLogDeltaResponse) {
            logBgStream('jobs-status-response-delta', {
                jobId,
                userId,
                status: effectiveStatus,
                requestedOffset: offset,
                safeOffset,
                contentLength,
                deltaLength: contentDelta.length,
                includesFullContent: safeOffset < offset,
            });
        }
        return {
            id: job.id,
            status: effectiveStatus,
            threadId: job.threadId,
            messageId: job.messageId,
            model: job.model,
            chunksReceived: effectiveChunks,
            startedAt: job.startedAt,
            completedAt: effectiveCompletedAt,
            error: effectiveError,
            tool_calls: effectiveToolCalls,
            workflow_state: effectiveWorkflowState,
            content_delta: contentDelta,
            content_length: contentLength,
            content: safeOffset < offset ? effectiveContent : undefined,
        };
    }

    logBgStream('jobs-status-response-full', {
        jobId,
        userId,
        status: effectiveStatus,
        contentLength: effectiveContent.length,
    });
    return {
        id: job.id,
        status: effectiveStatus,
        threadId: job.threadId,
        messageId: job.messageId,
        model: job.model,
        chunksReceived: effectiveChunks,
        startedAt: job.startedAt,
        completedAt: effectiveCompletedAt,
        error: effectiveError,
        tool_calls: effectiveToolCalls,
        workflow_state: effectiveWorkflowState,
        content: effectiveContent,
    };
});
