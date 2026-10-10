import type { WorkspacePluginCoordinator } from '~~/shared/plugins/workspace-plugin-coordinator';

let installed: WorkspacePluginCoordinator | null = null;

export function installWorkspacePluginCoordinator(coordinator: WorkspacePluginCoordinator | null): void {
    installed = coordinator;
}

export function getWorkspacePluginCoordinator(): WorkspacePluginCoordinator {
    if (!installed) throw new Error('Workspace plugin coordinator is not initialized');
    return installed;
}

/** Logout cleanup joins the same teardown barrier as workspace transitions. */
export async function stopWorkspacePluginsAndAwait(): Promise<void> {
    await installed?.stop();
}

export const WORKSPACE_PLUGIN_RECONCILE_EVENT = 'or3:workspace-plugin-reconcile';

export type WorkspacePluginReconcileReason =
    | 'workspace-session-change'
    | 'local-admin-change'
    | 'focus-refresh'
    | 'manifest-revision-change'
    | 'boot';

export interface WorkspacePluginReconcileEventDetail {
    readonly reason: Extract<
        WorkspacePluginReconcileReason,
        'local-admin-change' | 'manifest-revision-change'
    >;
}

export function requestWorkspacePluginReconcile(
    reason: WorkspacePluginReconcileEventDetail['reason'] = 'local-admin-change'
): void {
    if (!import.meta.client) return;
    window.dispatchEvent(
        new CustomEvent<WorkspacePluginReconcileEventDetail>(WORKSPACE_PLUGIN_RECONCILE_EVENT, {
            detail: { reason },
        })
    );
}
