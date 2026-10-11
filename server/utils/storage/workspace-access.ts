import { createError, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { requireCan } from '../../auth/can';
import { getAuthWorkspaceStore } from '../../auth/store/registry';

/** Recheck membership before storage authority crosses an awaited boundary. */
export async function requireStorageWorkspaceAccess(
    event: H3Event,
    session: SessionContext,
    workspaceId: string,
    permission: 'workspace.read' | 'workspace.write' = 'workspace.read',
): Promise<void> {
    if (!session.authenticated || !session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    const config = useRuntimeConfig(event) as {
        sync?: { provider?: string }; public?: { sync?: { provider?: string } };
    };
    const storeId = config.sync?.provider || config.public?.sync?.provider || 'convex';
    const store = getAuthWorkspaceStore(storeId);
    if (!store) {
        throw createError({ statusCode: 503, statusMessage: 'Workspace store unavailable' });
    }
    const workspaces = await store.listUserWorkspaces(session.user.id).catch(() => {
        throw createError({ statusCode: 503, statusMessage: 'Workspace permissions unavailable' });
    });
    const membership = workspaces.find(workspace => workspace.id === workspaceId);
    if (!membership) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    requireCan({ ...session, workspace: { id: membership.id, name: membership.name }, role: membership.role },
        permission, { kind: 'workspace', id: workspaceId });
}
