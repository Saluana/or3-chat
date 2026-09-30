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
