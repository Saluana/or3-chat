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

    // Validate workspace name
    if (!name || !name.trim()) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace name is required',
        });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace name must be under 100 characters',
        });
    }

    // Validate description
    if (description && description.length > 1000) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Description must be under 1000 characters',
        });
    }

    // Validate owner user ID format (Convex ID pattern: users:<base36-id>)
    if (!ownerUserId || !/^users:[a-zA-Z0-9_-]+$/.test(ownerUserId)) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Valid owner user ID is required',
        });
    }

    // Get workspace store
    const store = getWorkspaceAccessStore(event);

    // Create workspace
    const result = await store.createWorkspace({
        name: trimmedName,
        description: description?.trim(),
        ownerUserId,
    });

    return result;
});
