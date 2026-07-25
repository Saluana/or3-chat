/**
 * @module server/api/workspaces/[id].delete
 *
 * Purpose:
 * Removes a workspace.
 */
import { defineEventHandler, createError, getRouterParam } from 'h3';
import {
    requireWorkspaceSession,
    resolveTargetWorkspaceSession,
    resolveWorkspaceStore,
} from './_helpers';
import { requireCan } from '../../auth/can';
import { invalidateSharedSessionCacheForIdentity } from '../../auth/session';
import { useRuntimeConfig } from '#imports';

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

    const targetSession = await resolveTargetWorkspaceSession(
        session,
        store,
        workspaceId
    );
    requireCan(targetSession, 'workspace.settings.manage', {
        kind: 'workspace',
        id: workspaceId,
    });

    await store.removeWorkspace({
        userId: session.user.id,
        workspaceId,
    });

    // Deleting a workspace can change the active workspace assignment.
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
