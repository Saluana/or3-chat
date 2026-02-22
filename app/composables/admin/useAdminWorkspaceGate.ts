import { ref, watch, type Ref } from 'vue';
import { useAdminWorkspaceContext } from '~/composables/admin/useAdminWorkspaceContext';

export function useAdminWorkspaceGate(
    refreshWorkspace?: (workspaceId: Ref<string | null>) => void | Promise<void>
) {
    const { hasWorkspace, selectWorkspace, selectedWorkspaceId } =
        useAdminWorkspaceContext();
    const showWorkspaceSelector = ref(!hasWorkspace.value);

    function onWorkspaceSelected(workspace: unknown) {
        selectWorkspace(workspace as never);
    }

    watch(selectedWorkspaceId, (newId) => {
        if (!newId) {
            showWorkspaceSelector.value = true;
            return;
        }
        showWorkspaceSelector.value = false;
        if (refreshWorkspace) {
            void refreshWorkspace(selectedWorkspaceId);
        }
    });

    return {
        selectedWorkspaceId,
        showWorkspaceSelector,
        onWorkspaceSelected,
    };
}
