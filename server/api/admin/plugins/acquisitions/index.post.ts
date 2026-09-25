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
import { PluginAcquisitionOperationStore } from '../../../../utils/plugins/acquisition/operation-store';
import { LibraryInstallRequestStore } from '../../../../admin/library/install-requests';
import { libraryLinkServiceFor } from '../../../../admin/library/route-support';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';
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
    installRequestId: z.string().regex(/^lir_[a-f0-9]{32}$/).optional(),
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
    const request = body.data.installRequestId
        ? await new LibraryInstallRequestStore().read(body.data.installRequestId)
        : null;
    if (body.data.installRequestId) {
        if (!request || request.expiresAt <= Date.now() || request.pluginId !== body.data.pluginId ||
            request.version !== body.data.version || request.workspaceId !== workspaceId ||
            context.session?.workspace?.id !== request.workspaceId) {
            throw createError({ statusCode: 409, statusMessage: 'The buyer request is expired or does not match this release and workspace.' });
        }
        const access = getWorkspaceAccessStore(event);
        const [targetWorkspace, members] = await Promise.all([
            access.getWorkspace({ workspaceId: request.workspaceId }),
            access.listMembers({ workspaceId: request.workspaceId }),
        ]);
        if (!targetWorkspace || targetWorkspace.deleted || !members.some((member) => member.userId === request.buyerUserId)) {
            throw createError({ statusCode: 409, statusMessage: 'The buyer no longer belongs to the requested workspace.' });
        }
        const link = await (await libraryLinkServiceFor(event)).service.status(request.buyerUserId);
        if (link.state !== 'linked' || link.link?.id !== request.linkId || link.link?.accountId !== request.accountId) {
            throw createError({ statusCode: 409, statusMessage: 'The buyer’s Library link changed. Ask for a new install request.' });
        }
        const existing = (await new PluginAcquisitionOperationStore().list(request.pluginId))
            .find((operation) => operation.libraryGrant?.requestId === request.id);
        if (existing) {
            return { ok: true, workspaceId: existing.workspaceId, operation: describeAcquisitionStatus(existing) };
        }
    }

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

    const libraryGrant = request ? {
        requestId: request.id,
        buyerUserId: request.buyerUserId,
        linkId: request.linkId,
        accountId: request.accountId,
        releaseId: request.releaseId,
        archiveSha256: request.archiveSha256,
    } : undefined;
    const service = await acquisitionServiceFor(event, requester,
        request?.buyerUserId ?? context.session?.user?.id ?? '', libraryGrant);
    const started = await service.start({
        pluginId: body.data.pluginId,
        ...(body.data.version === undefined ? {} : { version: body.data.version }),
        workspaceId,
        requesterUserId: requester,
        ...(libraryGrant ? { libraryGrant } : {}),
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
