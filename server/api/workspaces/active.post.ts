/**
 * @module server/api/workspaces/active.post
 *
 * Purpose:
 * Sets the active workspace for the current user.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { requireWorkspaceSession, resolveWorkspaceStore } from './_helpers';

type SetActiveBody = { id?: string };

export default defineEventHandler(async (event) => {
    const session = await requireWorkspaceSession(event);
    const store = resolveWorkspaceStore(event);

    const body = (await readBody(event)) as SetActiveBody;
    const workspaceId = body?.id;

    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace id is required' });
    }

    if (!session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    await store.setActiveWorkspace({
        userId: session.user.id,
        workspaceId,
    });

    return { ok: true };
});
