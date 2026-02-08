/**
 * @module server/api/workspaces/[id].patch
 *
 * Purpose:
 * Updates workspace metadata.
 */
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3';
import { requireWorkspaceSession, resolveWorkspaceStore } from './_helpers';

type UpdateWorkspaceBody = {
    name?: string;
    description?: string | null;
};

export default defineEventHandler(async (event) => {
    const session = await requireWorkspaceSession(event);
    const store = resolveWorkspaceStore(event);

    const workspaceId = getRouterParam(event, 'id');
    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace id is required' });
    }

    const body = (await readBody(event)) as UpdateWorkspaceBody;
    const name = body.name?.trim() ?? '';
    const description = body.description?.trim() ?? null;

    if (!name) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace name is required' });
    }
    if (name.length > 100) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace name must be under 100 characters',
        });
    }
    if (description && description.length > 1000) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Description must be under 1000 characters',
        });
    }

    if (!session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    await store.updateWorkspace({
        userId: session.user.id,
        workspaceId,
        name,
        description: description || null,
    });

    return { ok: true };
});
