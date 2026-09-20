/**
 * @module server/api/workspaces/active.post
 *
 * Purpose:
 * Sets the active workspace for the current user.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import {
    requireWorkspaceSession,
    resolveTargetWorkspaceSession,
    resolveWorkspaceStore,
} from './_helpers';
import { requireCan } from '../../auth/can';
import { invalidateSharedSessionCacheForIdentity } from '../../auth/session';
import { revokeHostActivationsForUserWorkspace } from '../../utils/plugins/isolation/activation-registry';
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

    const targetSession = await resolveTargetWorkspaceSession(
        session,
        store,
        workspaceId
    );

    requireCan(targetSession, 'workspace.read', {
        kind: 'workspace',
        id: workspaceId,
    });

    // The session still carries the workspace being left; capture it before the
    // switch commits so stale portable handles can be revoked authoritatively.
    const previousWorkspaceId = session.workspace?.id;

    await store.setActiveWorkspace({
        userId: session.user.id,
        workspaceId,
    });

    // Authoritative switch teardown, scoped to this user and the workspace
    // being left: the client's own DELETE runs after the session already
    // changed (and other tabs never send one), so the server revokes here.
    // Never workspace-wide — that would stop other users sharing the old
    // workspace.
    if (previousWorkspaceId && previousWorkspaceId !== workspaceId) {
        revokeHostActivationsForUserWorkspace(
            session.user.id,
            previousWorkspaceId,
            'workspace-switch'
        );
    }

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
