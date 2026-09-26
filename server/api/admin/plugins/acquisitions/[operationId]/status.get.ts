/**
 * @module server/api/admin/plugins/acquisitions/[operationId]/status.get
 *
 * Purpose:
 * Read one acquisition's recorded status: stage, terminal state, failure,
 * whether it is waiting for setup, and whether a retry can continue.
 *
 * Behavior:
 * - Owner-only, read-only. It reports the durable record rather than re-running
 *   the pipeline, so an interrupted operation is visible without side effects.
 */
import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionServiceFor } from '../../../../../utils/plugins/acquisition/route-support';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    const operationId = getRouterParam(event, 'operationId');
    if (!operationId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing operation id' });
    }
    const service = await acquisitionServiceFor(event);
    const operation = await service.status(operationId).catch(() => null);
    if (!operation) {
        throw createError({ statusCode: 404, statusMessage: 'No such acquisition operation' });
    }
    return {
        ok: true,
        pluginId: operation.pluginId,
        workspaceId: operation.workspaceId,
        operation: describeAcquisitionStatus(operation, await service.isInterrupted(operation)),
    };
});
