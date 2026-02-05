/**
 * @module server/api/workspaces/[id].delete
 *
 * Purpose:
 * Removes a workspace.
 */
import { defineEventHandler, createError, getRouterParam } from 'h3';
import { requireWorkspaceSession, resolveWorkspaceStore } from './_helpers';

export default defineEventHandler(async (event) => {
    const session = await requireWorkspaceSession(event);
    const store = resolveWorkspaceStore(event);

    const workspaceId = getRouterParam(event, 'id');
    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace id is required' });
    }

    if (!session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    await store.removeWorkspace({
        userId: session.user.id,
        workspaceId,
    });

    return { ok: true };
});
