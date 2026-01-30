import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { getWorkspaceAccessStore } from '../../admin/stores/registry';
import { isAdminEnabled } from '../../utils/admin/is-admin-enabled';

interface CreateWorkspaceBody {
    name: string;
    description?: string;
    ownerUserId: string;
}

/**
 * POST /api/admin/workspaces
 *
 * Create a new workspace.
 * Requires: name, ownerUserId
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

    const body = await readBody<CreateWorkspaceBody>(event);
    const { name, description, ownerUserId } = body;

    // Validate input
    if (!name || !name.trim()) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace name is required',
        });
    }

    if (!ownerUserId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Owner user ID is required',
        });
    }

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // Create workspace
    const result = await store.createWorkspace({
        name: name.trim(),
        description: description?.trim(),
        ownerUserId,
    });

    return result;
});
