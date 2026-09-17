/**
 * @module server/api/admin/plugins/acquisitions/index.get
 *
 * Purpose:
 * List the acquisition operations this host has recorded, newest first, so an
 * admin who lost the response to a start can still find an in-flight operation
 * (and its id) instead of guessing.
 *
 * Behavior:
 * - Owner-only, read-only. Optional `pluginId` narrows the list.
 * - Reports the same status view as the single-operation route.
 */
import { defineEventHandler, getQuery } from 'h3';
import { requireAdminApiContext } from '../../../../admin/api';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionServiceFor } from '../../../../utils/plugins/acquisition/route-support';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    const query = getQuery(event);
    const pluginId = typeof query.pluginId === 'string' ? query.pluginId : undefined;
    const service = await acquisitionServiceFor(event);
    const operations = pluginId
        ? await service.listForPlugin(pluginId)
        : await service.listAll();
    return {
        ok: true,
        operations: operations.map((operation) => describeAcquisitionStatus(operation)),
    };
});
