import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

/**
 * POST /api/admin/workspaces/:id/soft-delete
 *
 * Soft delete a workspace.
 */
export default defineEventHandler(async (event) => {
    // Admin must be enabled
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    // Require admin context
    await requireAdminApiContext(event);

    // Get workspace ID
    const workspaceId = getRouterParam(event, 'id');
    if (!workspaceId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace ID is required',
        });
    }

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // Soft delete workspace
    await store.softDeleteWorkspace({
        workspaceId,
        deletedAt: Date.now(),
    });

    return { success: true };
});
