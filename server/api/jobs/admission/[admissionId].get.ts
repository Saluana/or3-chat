/** Recover a committed background admission after a lost start response. */
import { defineEventHandler, getQuery, getRouterParam, setHeader, setResponseStatus } from 'h3';
import { getJobProvider } from '../../../utils/background-jobs/store';
import { getChatJobExecution } from '../../../utils/background-jobs/types';
import { getScopedAdmissionKey } from '../../../utils/background-jobs/admission-cancels';
import { requireJobWorkspaceAccess } from '../../../utils/background-jobs/access';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    const admissionId = getRouterParam(event, 'admissionId')?.trim() ?? '';
    const workspaceId = getQuery(event).workspaceId;
    if (!admissionId || admissionId.length > 128 || typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 256) {
        setResponseStatus(event, 400);
        return { error: 'Admission ID and workspace ID are required' };
    }
    const session = isSsrAuthEnabled(event) ? await resolveSessionContext(event) : null;
    const userId = session?.authenticated ? session.user?.id : undefined;
    if (!userId) {
        setResponseStatus(event, 401);
        return { error: 'Authentication required' };
    }
    await requireJobWorkspaceAccess(event, session, workspaceId, 'workspace.read');
    const provider = await getJobProvider();
    if (!provider.findJobByIdempotencyKey) {
        setResponseStatus(event, 501);
        return { error: 'Admission lookup unavailable' };
    }
    // Provider failure is an unknown outcome, never evidence that no job exists.
    const job = await provider.findJobByIdempotencyKey(getScopedAdmissionKey(userId, workspaceId, admissionId), userId);
    if (!job) {
        setResponseStatus(event, 404);
        return { error: 'No job for this admission' };
    }
    const execution = getChatJobExecution(job);
    if (execution?.workspaceId !== workspaceId || execution.history?.version !== 1) {
        setResponseStatus(event, 409);
        return { error: 'Background history contract unavailable', code: 'background_history_unsupported' };
    }
    return { jobId: job.id, status: job.status, threadId: job.threadId, messageId: job.messageId, historyVersion: 1 };
});
