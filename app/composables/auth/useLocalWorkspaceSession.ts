import { computed } from 'vue';
import { canUseOfflineWorkspaceDb, getOfflineWorkspace, useOfflineWorkspace, type OfflineWorkspace } from './offline-workspace';
import { getCachedSessionContext, getCachedSessionPayload, useSessionContext, type SessionPayload } from './useSessionContext';

function projectOfflineWorkspace(workspace: OfflineWorkspace): SessionPayload {
    return {
        session: {
            authenticated: true,
            user: { id: workspace.userId },
            workspace: { id: workspace.workspaceId, name: workspace.workspaceName },
            role: workspace.role,
        },
        appAccessAllowed: true,
        workspaceItemCapability: workspace.workspaceItemCapability,
        explorerCapability: workspace.explorerCapability,
    };
}

function restrictWorkspace(payload: SessionPayload | null): SessionPayload | null {
    const session = payload?.session;
    if (session?.workspace && !canUseOfflineWorkspaceDb(session.workspace.id, session.user?.id)) {
        return { session: null, appAccessAllowed: false };
    }
    return payload;
}

/** Identity and permissions for local work. Use useSessionContext for Cloud operations. */
export function useLocalWorkspaceSession() {
    const { data: session } = useSessionContext({ autoLoad: false });
    const offline = useOfflineWorkspace();
    return computed<SessionPayload | null>(() =>
        offline.value ? projectOfflineWorkspace(offline.value) : restrictWorkspace(session.value));
}

export function getLocalWorkspacePayload(): SessionPayload | null {
    const workspace = getOfflineWorkspace();
    return workspace ? projectOfflineWorkspace(workspace) : restrictWorkspace(getCachedSessionPayload());
}

export function getLocalWorkspaceSession() {
    const workspace = getOfflineWorkspace();
    if (workspace) return projectOfflineWorkspace(workspace).session;
    const session = getCachedSessionContext();
    return session?.workspace && !canUseOfflineWorkspaceDb(session.workspace.id, session.user?.id) ? null : session;
}
