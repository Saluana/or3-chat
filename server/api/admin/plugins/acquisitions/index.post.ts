/**
 * @module server/api/admin/plugins/acquisitions/index.post
 *
 * Purpose:
 * Start a reviewed acquisition: resolve one registry release, verify it, record
 * a candidate, run the instance-wide preflight and health check, and promote it
 * if everything holds.
 *
 * Behavior:
 * - Owner-only, super-admin-only mutation, rate limited per acting admin.
 * - Refusals that happen before the durable record exists are reported with the
 *   policy failure code and leave nothing behind.
 * - The durable operation id is returned before the pipeline does its long
 *   running work (a download can take minutes), so the caller can poll and cancel
 *   it; the run itself continues in this process and is picked up by `retry`
 *   after a restart.
 * - The response is the pipeline status view, never package bytes.
 *
 * Constraints:
 * - Never accepts a package URL: the request names a plugin (and optionally a
 *   version) and the registry client resolves it.
 */
import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';
import { checkRateLimit } from '../../../../utils/rate-limit';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionInstanceId } from '../../../../utils/plugins/acquisition/config';
import { acquisitionServiceFor } from '../../../../utils/plugins/acquisition/route-support';
import {
    acquisitionErrorStatus,
    requesterIdentity,
} from '../../../../utils/plugins/acquisition/route-identity';

const BodySchema = z.object({
    pluginId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-z0-9][a-z0-9._-]*$/),
    version: z.string().min(1).max(64).optional(),
    workspaceId: z.string().min(1).optional(),
});

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const requester = requesterIdentity(context);

    // Bounded actor policy for registry acquisitions; the raw-upload limits are
    // a separate path and are unchanged.
    const allowed = await checkRateLimit(`plugin:acquisition:${requester}`, {
        max: 10,
        window: 3600,
    });
    if (!allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many acquisitions in the last hour.',
        });
    }

    const service = await acquisitionServiceFor(event, requester);
    const started = await service.start({
        pluginId: body.data.pluginId,
        ...(body.data.version === undefined ? {} : { version: body.data.version }),
        workspaceId,
        requesterUserId: requester,
        instanceId: acquisitionInstanceId(),
    });
    if (!started.ok) {
        throw createError({
            statusCode: acquisitionErrorStatus(started.failure.code),
            statusMessage: started.failure.message,
        });
    }
    // Long-running work continues after the id has been handed back. The run is
    // durable: a crash or a restart leaves the record at its stage, and the same
    // id can be retried or observed.
    const operationId = started.operation.operationId;
    setResponseStatus(event, 202);
    void service
        .advance(operationId)
        .then(async (finished) => {
            if (finished.status !== 'completed') return;
            await event.context.adminHooks?.doAction('admin.plugin:action:acquired', {
                id: finished.pluginId,
                workspaceId,
                operationId: finished.operationId,
                packageDigest: finished.candidateDigest,
            });
        })
        .catch(() => undefined);

    return {
        ok: true,
        workspaceId,
        operation: describeAcquisitionStatus(started.operation),
    };
});
