/**
 * @module server/api/jobs/admission-abort.post
 *
 * Purpose:
 * Cancels a background admission before the client has received its job ID.
 *
 * Behavior:
 * - Prefers the provider's durable `cancelAdmission` contract, which aborts a
 *   committed job and otherwise records a marker that creation observes.
 * - Falls back to a process-local marker for providers that predate it.
 *
 * Security:
 * - Only the authenticated owner can cancel.
 */
import { getJobProvider } from '../../utils/background-jobs/store';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { emitJobStatus } from '../../utils/background-jobs/viewers';
import { logBackgroundEvent } from '../../utils/background-jobs/logging';
import { markAdmissionCancelled } from '../../utils/background-jobs/admission-cancels';

function warnBgStream(
    stage: string,
    details?: Record<string, unknown>
): void {
    logBackgroundEvent('warn', 'background.admission.abort', {
        stage,
        ...details,
    });
}

export default defineEventHandler(async (event) => {
    const body = (await readBody(event).catch(() => null)) as {
        admissionId?: unknown;
    } | null;
    const admissionId =
        typeof body?.admissionId === 'string' ? body.admissionId.trim() : '';

    if (!admissionId || admissionId.length > 128) {
        setResponseStatus(event, 400);
        return { aborted: false, pending: false, error: 'Missing admission ID' };
    }

    let userId: string | null = null;
    if (isSsrAuthEnabled(event)) {
        const session = await resolveSessionContext(event);
        if (session.authenticated && session.user?.id) {
            userId = session.user.id;
        }
    }

    if (!userId) {
        setResponseStatus(event, 401);
        return {
            aborted: false,
            pending: false,
            error: 'Authentication required',
        };
    }

    const provider = await getJobProvider();
    if (provider.cancelAdmission) {
        // Durable path: the provider records the cancellation and any committed
        // streaming job is aborted in the same operation.
        const result = await provider.cancelAdmission(userId, admissionId);
        if (result.aborted && result.jobId) {
            const job = await provider
                .getJob(result.jobId, userId)
                .catch(() => null);
            const content = job?.content ?? '';
            emitJobStatus(result.jobId, 'aborted', {
                content,
                contentLength: content.length,
                chunksReceived: job?.chunksReceived ?? 0,
                completedAt: Date.now(),
            });
        }
        return {
            aborted: result.aborted,
            pending: result.pending,
            jobId: result.jobId,
            // Cancellation requested (marker recorded, no committed job yet) is
            // distinct from cancellation confirmed (a streaming job was
            // actually aborted). Callers must not treat `pending` as stopped.
            state: result.aborted
                ? 'aborted'
                : result.pending
                  ? 'cancel_requested'
                  : 'already_terminal',
        };
    }

    // Fallback for providers that predate the durable contract. This is
    // process-local and best-effort; upgrading the provider closes the gap.
    warnBgStream('admission-abort-provider-without-durable-cancel', {});
    if (provider.findJobByIdempotencyKey) {
        const job = await provider
            .findJobByIdempotencyKey(admissionId, userId)
            .catch(() => null);
        if (job) {
            markAdmissionCancelled(admissionId);
            let aborted = false;
            let abortError: unknown = null;
            try {
                aborted = await provider.abortJob(job.id, userId);
            } catch (error) {
                // The cancellation marker is already recorded, so a late
                // createJob still cannot launch work. Report the uncertainty
                // explicitly instead of an opaque 500.
                abortError = error;
                warnBgStream('admission-abort-stop-error', {
                    jobId: job.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (abortError) {
                setResponseStatus(event, 500);
                return {
                    aborted: false,
                    pending: true,
                    jobId: job.id,
                    state: 'abort_error',
                    message:
                        'Stop request failed after the cancellation was recorded; remote state is unknown',
                };
            }
            if (aborted) {
                const content = job.content;
                emitJobStatus(job.id, 'aborted', {
                    content,
                    contentLength: content.length,
                    chunksReceived: job.chunksReceived,
                    completedAt: Date.now(),
                });
            }
            return {
                aborted,
                pending: false,
                jobId: job.id,
                state: aborted ? 'aborted' : 'already_terminal',
                ...(aborted
                    ? {}
                    : { message: 'Job not found or already complete' }),
            };
        }
    }

    markAdmissionCancelled(admissionId);
    return {
        aborted: false,
        pending: true,
        state: 'cancel_requested',
    };
});
