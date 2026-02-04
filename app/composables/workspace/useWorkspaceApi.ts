import { getActiveWorkspaceApi } from '~/core/workspaces/workspace-api-registry';
import type { WorkspaceApi } from '~/core/workspaces/types';

export function useWorkspaceApi(): WorkspaceApi {
    const api = getActiveWorkspaceApi();
    if (!api) {
        throw new Error('[workspace-api] No WorkspaceApi registered');
    }
    return api;
}
