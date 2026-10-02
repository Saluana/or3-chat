/** Cancel a workspace-scoped admission before the client knows its job ID. */
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { requireJobWorkspaceAccess } from '../../utils/background-jobs/access';
import { getJobProvider } from '../../utils/background-jobs/store';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { emitJobStatus } from '../../utils/background-jobs/viewers';
import { getScopedAdmissionKey, markAdmissionCancelled } from '../../utils/background-jobs/admission-cancels';
import { logBackgroundEvent } from '../../utils/background-jobs/logging';

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    requireCloudMutation(event);
    const body = (await readBody(event).catch(() => null)) as {
        admissionId?: unknown;
        workspaceId?: unknown;
    } | null;
    const admissionId = typeof body?.admissionId === 'string' ? body.admissionId.trim() : '';
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    if (!admissionId || admissionId.length > 128 || !workspaceId || workspaceId.length > 256) {
        setResponseStatus(event, 400);
        return { aborted: false, pending: false, error: 'Admission ID and workspace ID are required' };
    }

    const session = isSsrAuthEnabled(event) ? await resolveSessionContext(event) : null;
    const userId = session?.authenticated ? session.user?.id : undefined;
    if (!userId) {
        setResponseStatus(event, 401);
        return { aborted: false, pending: false, error: 'Authentication required' };
    }
    await requireJobWorkspaceAccess(event, session, workspaceId, 'workspace.write');

    // Scope is part of the provider's atomic key. A job that commits after this
    // check cannot change which user/workspace the cancellation can reach.
    const admissionKey = getScopedAdmissionKey(userId, workspaceId, admissionId);
    const provider = await getJobProvider();
    let result: { aborted: boolean; pending: boolean; jobId?: string };
    if (provider.cancelAdmission) {
        result = await provider.cancelAdmission(userId, admissionKey);
    } else {
        // Older adapters retain the documented single-instance fallback.
        logBackgroundEvent('warn', 'admission-abort-provider-without-durable-cancel');
        markAdmissionCancelled(admissionKey);
        const job = await provider.findJobByIdempotencyKey?.(admissionKey, userId);
        result = job
            ? { aborted: await provider.abortJob(job.id, userId), pending: false, jobId: job.id }
            : { aborted: false, pending: true };
    }
    if (result.aborted && result.jobId) {
        const job = await provider.getJob(result.jobId, userId);
        if (job) {
            emitJobStatus(job.id, 'aborted', {
                content: job.content,
                contentLength: job.content.length,
                chunksReceived: job.chunksReceived,
                completedAt: Date.now(),
            });
        }
    }
    return result;
});
