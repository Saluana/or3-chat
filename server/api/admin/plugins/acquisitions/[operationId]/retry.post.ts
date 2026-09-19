/**
 * @module server/api/admin/plugins/acquisitions/[operationId]/retry.post
 *
 * Purpose:
 * Continue an interrupted acquisition from its recorded stage: an expired
 * download URL, a partial download, a failure, a blocking workspace that has
 * since been disabled, or a first install whose setup is now saved.
 *
 * Behavior:
 * - Owner-only, super-admin-only mutation.
 * - Retries the same operation id and stage; it never restarts from scratch and
 *   never fabricates progress the record does not show.
 */
import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import { acquisitionServiceFor } from '../../../../../utils/plugins/acquisition/route-support';
import {
    acquisitionErrorStatus,
    requesterIdentity,
} from '../../../../../utils/plugins/acquisition/route-identity';

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        superAdminOnly: true,
    });
    const operationId = getRouterParam(event, 'operationId');
    if (!operationId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing operation id' });
    }
    // A retry re-evaluates setup readiness, so the host plan is built for the
    // acting admin's view of the target workspace.
    const service = await acquisitionServiceFor(
        event,
        requesterIdentity(context),
        context.session?.user?.id ?? ''
    );
    try {
        const operation = await service.retry(operationId);
        return { ok: true, operation: describeAcquisitionStatus(operation) };
    } catch (error) {
        if (error instanceof Error && error.name === 'PluginAcquisitionOperationError') {
            const code = (error as { code?: string }).code;
            if (code === 'operation-not-found') {
                throw createError({ statusCode: 404, statusMessage: 'No such acquisition operation' });
            }
            throw createError({
                statusCode: 409,
                statusMessage: `The operation cannot be retried: ${error.message}`,
            });
        }
        throw createError({
            statusCode: acquisitionErrorStatus('internal-error'),
            statusMessage: error instanceof Error ? error.message : 'The operation failed',
        });
    }
});
