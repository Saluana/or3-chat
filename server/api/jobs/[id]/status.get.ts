/**
 * @module server/api/jobs/[id]/status.get
 *
 * Purpose:
 * Polls the current state and content of a background job.
 */
import { requireJobWorkspaceAccess } from '../../../utils/background-jobs/access';
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { getJobLiveState } from '../../../utils/background-jobs/viewers';
import { shouldResetBackgroundContent } from '../../../utils/background-jobs/recovery';
import { projectJobViewWithChildStatus } from '../../../utils/background-jobs/job-view';

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

        setResponseStatus(event, 400);
        return { error: 'Missing job ID' };
    }

    // Job content is user-specific and changes frequently; intermediaries must
    // not reuse a stale response after a reconnect or workspace switch.
    setHeader(event, 'Cache-Control', 'no-store, private');

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
        return { error: 'Authentication required' };
    }

    const provider = await getJobProvider();
    const job = await provider.getJob(jobId, userId);

    if (!job) {

        setResponseStatus(event, 404);
        return { error: 'Job not found or unauthorized' };
    }

    await requireJobWorkspaceAccess(event, session, job.execution?.workspaceId, 'workspace.read');

    const query = getQuery(event);
    const offsetParam = typeof query.offset === 'string' ? query.offset : null;
    const offset = offsetParam ? Number(offsetParam) : null;
    const reasoningOffsetParam =
        typeof query.reasoning_offset === 'string'
            ? query.reasoning_offset
            : null;
    const reasoningOffset = reasoningOffsetParam
        ? Number(reasoningOffsetParam)
        : null;
    const attemptParam =
        typeof query.attempt === 'string' ? Number(query.attempt) : null;
    const view = await projectJobViewWithChildStatus(provider, job, userId, getJobLiveState(jobId));
    if (view.tool_calls?.some(call => call.delegation?.version === 3))
        await requireJobWorkspaceAccess(event, session, job.execution?.workspaceId, 'workspace.read');
    const { attempt: currentAttempt, content: effectiveContent,
        reasoning_text: effectiveReasoning } = view;
    const attemptChanged = shouldResetBackgroundContent(
        attemptParam, currentAttempt, offset
    );

    if (
        typeof offset === 'number' &&
        Number.isFinite(offset) &&
        offset >= 0 &&
        typeof effectiveContent === 'string'
    ) {
        const contentLength = effectiveContent.length;
        const safeOffset = attemptChanged ? 0 : Math.min(offset, contentLength);
        const contentDelta = attemptChanged
            ? undefined
            : effectiveContent.slice(safeOffset);

        const reasoningLength = effectiveReasoning.length;
        const safeReasoningOffset = attemptChanged
            ? 0
            : reasoningOffset !== null &&
                Number.isFinite(reasoningOffset) &&
                reasoningOffset >= 0
              ? Math.min(reasoningOffset, reasoningLength)
              : reasoningLength;
        const reasoningDelta = attemptChanged
            ? undefined
            : reasoningOffset !== null &&
                Number.isFinite(reasoningOffset) &&
                reasoningOffset >= 0
              ? effectiveReasoning.slice(safeReasoningOffset)
              : effectiveReasoning;
        return {
            ...view,
            content_delta: contentDelta,
            content_length: contentLength,
            content_reset: attemptChanged || undefined,
            content:
                attemptChanged || safeOffset < offset
                    ? effectiveContent
                    : undefined,
            reasoning_delta: reasoningDelta,
            reasoning_length: reasoningLength,
            reasoning_text:
                attemptChanged ||
                reasoningOffset === null ||
                !Number.isFinite(reasoningOffset) ||
                safeReasoningOffset < reasoningOffset
                    ? effectiveReasoning
                    : undefined,
            reasoning_reset: attemptChanged || undefined,
        };
    }

    return {
        ...view,
        reasoning_length: effectiveReasoning.length,
    };
});
