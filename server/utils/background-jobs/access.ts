import { createError, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { requireCan } from '../../auth/can';
import { getAuthWorkspaceStore } from '../../auth/store/registry';

/** Check fresh membership in the job's workspace, independent of the active workspace. */
export async function requireJobWorkspaceAccess(
    event: H3Event,
    session: SessionContext | null,
    workspaceId: string | undefined,
    permission: 'workspace.read' | 'workspace.write'
): Promise<void> {
    if (!session?.authenticated || !session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    // Legacy jobs without a recorded workspace cannot be safely scoped.
    if (!workspaceId) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    const config = useRuntimeConfig(event);
    const storeId = config.sync?.provider || config.public?.sync?.provider || 'convex';
    const store = getAuthWorkspaceStore(storeId);
    if (!store) {
        throw createError({ statusCode: 503, statusMessage: 'Workspace store unavailable' });
    }
    // Unlike a cached session, this also excludes deleted workspaces.
    const membership = (await store.listUserWorkspaces(session.user.id)).find(
        (workspace) => workspace.id === workspaceId
    );
    if (!membership) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    requireCan({
        ...session,
        workspace: { id: membership.id, name: membership.name },
        role: membership.role,
    }, permission, { kind: 'workspace', id: workspaceId });
}
