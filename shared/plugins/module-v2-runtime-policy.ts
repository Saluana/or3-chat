export type ModuleV2RuntimeBlockCode =
    | 'module-loader-disabled'
    | 'module-loader-static-host'
    | 'module-loader-outside-canary';

export type ModuleV2RuntimeDecision =
    | { readonly allowed: true }
    | { readonly allowed: false; readonly code: ModuleV2RuntimeBlockCode };

/**
 * Immutable-startup policy for V2 packages. It deliberately does not reuse
 * the bundled V1 manager's canary, so changing one rollout never redirects
 * the other runtime lane.
 */
export function createModuleV2RuntimePolicy(input: {
    readonly enabled: boolean;
    readonly ssrHost: boolean;
    readonly workspaceIds: readonly string[];
}): (workspaceId: string | null | undefined) => ModuleV2RuntimeDecision {
    const enabled = input.enabled;
    const ssrHost = input.ssrHost;
    const workspaceIds = Object.freeze([...input.workspaceIds]);
    const allowedWorkspaces = new Set(workspaceIds);

    return (workspaceId) => {
        if (!enabled) return Object.freeze({ allowed: false, code: 'module-loader-disabled' });
        if (!ssrHost) {
            return Object.freeze({ allowed: false, code: 'module-loader-static-host' });
        }
        if (!workspaceId || (workspaceIds.length > 0 && !allowedWorkspaces.has(workspaceId))) {
            return Object.freeze({
                allowed: false,
                code: 'module-loader-outside-canary',
            });
        }
        return Object.freeze({ allowed: true });
    };
}
