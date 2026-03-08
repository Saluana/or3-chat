/**
 * @module server/api/workspaces/active.post
 *
 * Purpose:
 * Sets the active workspace for the current user.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { requireWorkspaceSession, resolveWorkspaceStore } from './_helpers';
import { requireCan } from '../../auth/can';
import { invalidateSharedSessionCacheForIdentity } from '../../auth/session';
import { useRuntimeConfig } from '#imports';

type SetActiveBody = { id?: string };

export default defineEventHandler(async (event) => {
    const session = await requireWorkspaceSession(event);
    const store = resolveWorkspaceStore(event);

    const body = (await readBody(event)) as SetActiveBody;
    const workspaceId = body.id;

    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace id is required' });
    }

    if (!session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: workspaceId,
    });

    await store.setActiveWorkspace({
        userId: session.user.id,
        workspaceId,
    });

    // Session cache includes workspace context; invalidate so the next session
    // fetch reflects this switch immediately.
    invalidateSharedSessionCacheForIdentity({
        provider: session.provider,
        providerUserId: session.providerUserId,
        storeId:
            (useRuntimeConfig(event).sync as { provider?: string } | undefined)?.provider ||
            (useRuntimeConfig(event).public as { sync?: { provider?: string } }).sync?.provider ||
            'convex',
    });

    return { ok: true };
});
