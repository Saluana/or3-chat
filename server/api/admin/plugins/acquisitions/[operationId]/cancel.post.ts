/**
 * @module server/api/admin/plugins/acquisitions/[operationId]/cancel.post
 *
 * Purpose:
 * Cancel an acquisition before activation. A running pipeline stops before its
 * next side effect; a paused first install is canceled immediately.
 *
 * Behavior:
 * - Owner-only, super-admin-only mutation.
 * - Cancellation never promotes, so the working pointer keeps its previous
 *   selected version. A recorded candidate is retained until a lifecycle call
 *   removes it.
 */
import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionServiceFor } from '../../../../../utils/plugins/acquisition/route-support';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const operationId = getRouterParam(event, 'operationId');
    if (!operationId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing operation id' });
    }
    const service = await acquisitionServiceFor(event);
    const operation = await service.cancel(operationId).catch(() => null);
    if (!operation) {
        throw createError({ statusCode: 404, statusMessage: 'No such acquisition operation' });
    }
    return { ok: true, operation: describeAcquisitionStatus(operation) };
});
