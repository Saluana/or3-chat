import { computed, type MaybeRef, toValue } from 'vue';
import type { WorkspaceResource } from '~/core/workspace-tabs/types';
import {
    useWorkspaceResourceNavigationApi,
    type WorkspaceResourceDestination,
} from '~/utils/workspaceResourceNavigation';

/**
 * Shared open actions for any resource that can be represented in the
 * workspace: chats, documents, and registered pane apps.
 */
export function useWorkspaceResourceActions(
    resource: MaybeRef<WorkspaceResource | null>
) {
    const navigation = useWorkspaceResourceNavigationApi();

    const canOpenInNewTab = computed(
        () =>
            !!toValue(resource) &&
            (navigation.value?.canOpenInNewTab() ?? false)
    );
    const canOpenInNewPane = computed(
        () =>
            !!toValue(resource) &&
            (navigation.value?.canOpenInNewPane() ?? false)
    );

    async function open(destination: WorkspaceResourceDestination) {
        const target = toValue(resource);
        const api = navigation.value;
        if (!target || !api) return false;
        if (destination === 'new-tab' && !api.canOpenInNewTab()) return false;
        if (destination === 'new-pane' && !api.canOpenInNewPane()) return false;
        return api.openResource(target, destination);
    }

    return {
        canOpenInNewTab,
        canOpenInNewPane,
        openInNewTab: () => open('new-tab'),
        openInNewPane: () => open('new-pane'),
    };
}
