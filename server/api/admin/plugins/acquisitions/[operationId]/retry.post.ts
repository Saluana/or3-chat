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
import { PluginAcquisitionOperationStore } from '../../../../../utils/plugins/acquisition/operation-store';
import { getWorkspaceAccessStore } from '../../../../../admin/stores/registry';
import {
    acquisitionErrorStatus,
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
    // A delegated retry remains in the buyer-approved workspace. The recorded
    // requester and buyer link survive request expiry; covered bytes still need
    // the buyer's original live link when the pipeline fetches them.
    const recorded = await new PluginAcquisitionOperationStore().read(operationId);
    if (!recorded) throw createError({ statusCode: 404, statusMessage: 'No such acquisition operation' });
    if (recorded.libraryGrant && context.session?.workspace?.id !== recorded.workspaceId) {
        throw createError({ statusCode: 409, statusMessage: 'Switch to the requested workspace before retrying this acquisition.' });
    }
    if (recorded.libraryGrant) {
        const access = getWorkspaceAccessStore(event);
        const [targetWorkspace, members] = await Promise.all([
            access.getWorkspace({ workspaceId: recorded.workspaceId }),
            access.listMembers({ workspaceId: recorded.workspaceId }),
        ]);
        if (!targetWorkspace || targetWorkspace.deleted ||
            !members.some((member) => member.userId === recorded.libraryGrant?.buyerUserId)) {
            throw createError({ statusCode: 409, statusMessage: 'The buyer no longer belongs to the requested workspace.' });
        }
    }
    const service = await acquisitionServiceFor(
        event,
        recorded.requesterUserId,
        recorded.libraryGrant?.buyerUserId ?? context.session?.user?.id ?? '',
        recorded.libraryGrant,
        recorded.setupOwnerUserId ?? context.session?.user?.id ?? ''
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
