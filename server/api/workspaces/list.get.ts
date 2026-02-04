import { defineEventHandler } from 'h3';
import { resolveSessionContext } from '~/server/auth/session';
import { requireCan, requireSession } from '~/server/auth/can';
import { isSsrAuthEnabled } from '~/server/utils/auth/is-ssr-auth-enabled';
import { getWorkspaceStoreOrThrow } from '~/server/utils/workspaces/store';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        return { workspaces: [] };
    }

    const session = await resolveSessionContext(event);
    requireSession(session);
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: session.workspace?.id,
    });

    const store = getWorkspaceStoreOrThrow(event);
    const list = await store.listUserWorkspaces(session.user.id);
    const activeId = session.workspace?.id ?? null;

    return {
        workspaces: list.map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            description: workspace.description ?? null,
            role: workspace.role,
            isActive: workspace.id === activeId,
        })),
    };
});
