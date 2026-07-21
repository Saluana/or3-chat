export type PluginRouteHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type WorkspaceRoutePermission = 'workspace.read' | 'workspace.write';

/**
 * Method defaults are authoritative. A manifest override may only strengthen
 * (read → write); it may never weaken write → read.
 */
export function resolvePluginRoutePermission(
    method: string,
    override?: string | null
): WorkspaceRoutePermission {
    const normalized = method.toUpperCase();
    const methodDefault: WorkspaceRoutePermission =
        normalized === 'GET' || normalized === 'HEAD' ? 'workspace.read' : 'workspace.write';
    if (override !== 'workspace.read' && override !== 'workspace.write') {
        return methodDefault;
    }
    if (methodDefault === 'workspace.write' && override === 'workspace.read') {
        return 'workspace.write';
    }
    return override;
}
