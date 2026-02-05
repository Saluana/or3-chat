/**
 * @module server/api/workspaces/index.get
 *
 * Purpose:
 * Lists workspaces available to the current user.
 */
import { defineEventHandler, createError } from 'h3';
import { requireWorkspaceSession, resolveWorkspaceStore } from './_helpers';

export default defineEventHandler(async (event) => {
    const session = await requireWorkspaceSession(event);
    const store = resolveWorkspaceStore(event);

    if (!session.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    const workspaces = await store.listUserWorkspaces(session.user.id);
    const activeId = session.workspace?.id ?? null;

    const normalized = workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description ?? null,
        role: workspace.role,
        createdAt: workspace.createdAt ?? 0,
        isActive: workspace.isActive ?? (activeId ? workspace.id === activeId : false),
    }));

    normalized.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    return { workspaces: normalized };
});
