/**
 * @module server/api/workspaces/index.post
 *
 * Purpose:
 * Creates a new workspace for the current user.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { requireWorkspaceSession, resolveWorkspaceStore } from './_helpers';

type CreateWorkspaceBody = {
    name?: string;
    description?: string | null;
};

export default defineEventHandler(async (event) => {
    const session = await requireWorkspaceSession(event);
    const store = resolveWorkspaceStore(event);

    const body = (await readBody(event)) as CreateWorkspaceBody;
    const name = body?.name?.trim() ?? '';
    const description = body?.description?.trim() ?? null;

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

    const result = await store.createWorkspace({
        userId: session.user.id,
        name,
        description: description || null,
    });

    return { id: result.workspaceId };
});
