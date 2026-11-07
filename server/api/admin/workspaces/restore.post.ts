/**
 * @module server/api/admin/workspaces/restore.post
 *
 * Purpose:
 * Reverses a soft-deletion of a workspace.
 */
import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceAccessStore } from '../../../admin/stores/registry';
import { withAdminJournal } from '../../../admin/activity/journal';
import { isAdminEnabled } from '../../../utils/admin/is-admin-enabled';

/**
 * POST /api/admin/workspaces/:id/restore
 *
 * Purpose:
 * Bring a deleted workspace back to active status.
 *
 * Behavior:
 * - Clears the `deletedAt` flag.
 * - Does not reconstruct data; assumes data was preserved during soft-delete window.
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
    const adminCtx = await requireAdminApiContext(event, {
        mutation: true,
        superAdminOnly: true,
    });

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

    // Restore workspace
    await withAdminJournal({
        actor: adminCtx.principal.kind === 'super_admin' ? adminCtx.principal.username : adminCtx.principal.userId, action: 'workspace.restore', target: { kind: 'workspace', id: workspaceId },
    }, async () => {
    await store.restoreWorkspace({ workspaceId });
    });

    return { success: true };
});
