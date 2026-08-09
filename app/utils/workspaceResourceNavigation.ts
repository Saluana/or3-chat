import { readonly, shallowRef } from 'vue';
import type { WorkspaceResource } from '~/core/workspace-tabs/types';

export type WorkspaceResourceDestination = 'new-tab' | 'new-pane';

/**
 * Narrow navigation bridge for UI surfaces that open workspace resources.
 * It deliberately accepts the same resource type as workspace tabs, which
 * lets sidebar pages and pane-app plugins share one routing contract.
 */
export interface WorkspaceResourceNavigationApi {
    canOpenInNewTab(): boolean;
    canOpenInNewPane(): boolean;
    openResource(
        resource: WorkspaceResource,
        destination: WorkspaceResourceDestination
    ): Promise<boolean>;
}

const api = shallowRef<WorkspaceResourceNavigationApi | null>(null);

export function useWorkspaceResourceNavigationApi() {
    return readonly(api);
}

export function getWorkspaceResourceNavigationApi() {
    return api.value;
}

export function setWorkspaceResourceNavigationApi(
    next: WorkspaceResourceNavigationApi | null
): () => void {
    api.value = next;
    return () => {
        if (api.value === next) api.value = null;
    };
}
